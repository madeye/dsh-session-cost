/**
 * dsh-session-cost smoke test.
 *
 * Loads the browser bundle the same way the DSH module system does, runs the
 * plugin body against a fake client context, renders the surface with a
 * minimal React stand-in, and checks the billing math against an independent
 * timezone reference (Intl / Asia-Shanghai).
 *
 *   node scripts/smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let failures = 0;
const lines = [];
function check(label, ok, detail) {
  lines.push((ok ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  → ' + detail));
  if (!ok) failures++;
}

/* ------------------------------------------------------------------ React */
const hookState = [];
/** Effect cleanups by hook slot, plus the effects queued by the render in flight. */
const effectCleanups = [];
let pendingEffects = [];
let cursor = 0;
const react = {
  useState(initial) {
    const i = cursor++;
    if (!(i in hookState)) hookState[i] = typeof initial === 'function' ? initial() : initial;
    return [hookState[i], (next) => { hookState[i] = typeof next === 'function' ? next(hookState[i]) : next; }];
  },
  useRef(initial) {
    const i = cursor++;
    if (!(i in hookState)) hookState[i] = { current: initial };
    return hookState[i];
  },
  useEffect(fn) { pendingEffects.push({ slot: cursor++, fn }); },
  useMemo(fn) { return fn(); }
};
/** Timers installed through the sandbox, keyed by the id handed back to the bundle. */
const timers = new Map();
let nextTimerId = 1;
/** Fire every live interval once, the way a wall-clock tick would. */
function fireTimers() { for (const fn of [...timers.values()]) fn(); }
/** Start a render pass: hooks re-invoke from slot 0 while state persists. */
function beginRender() { cursor = 0; pendingEffects = []; }
/** Run this pass's effects, retiring the previous cleanup of each slot. */
function flushEffects() {
  const pending = pendingEffects;
  pendingEffects = [];
  for (const { slot, fn } of pending) {
    if (typeof effectCleanups[slot] === 'function') effectCleanups[slot]();
    const cleanup = fn();
    effectCleanups[slot] = typeof cleanup === 'function' ? cleanup : undefined;
  }
}
/** Full reset: drop all hook/effect/timer state between independent scenarios. */
function resetHooks() {
  beginRender();
  for (const cleanup of effectCleanups) if (typeof cleanup === 'function') cleanup();
  effectCleanups.length = 0;
  timers.clear();
}

const jsxRuntime = {
  jsx: (type, props, key) => ({ type, props: props || {}, key }),
  jsxs: (type, props, key) => ({ type, props: props || {}, key })
};

/* --------------------------------------------------------------- document */
const styleTags = [];
const documentStub = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '', setAttribute() {} }),
  head: { appendChild: (tag) => styleTags.push(tag) },
  addEventListener() {},
  removeEventListener() {}
};

/* ------------------------------------------- load the bundle like DSH does */
const clientSource = readFileSync(join(root, 'lib/client.js'), 'utf8');
let registration;
let fakeNow = Date.UTC(2026, 8, 12, 2, 0, 0);   // 北京时间周六 10:00 —— 空闲时段
class FakeDate extends Date {
  constructor(...args) { if (args.length === 0) super(fakeNow); else super(...args); }
  static now() { return fakeNow; }
}
const sandbox = {
  window: { __ModuleLoader__: { load: (record) => { registration = record; } } },
  document: documentStub,
  setInterval: (fn) => { const id = nextTimerId++; timers.set(id, fn); return id; },
  clearInterval: (id) => { timers.delete(id); },
  Date: FakeDate, Number, String, Math, JSON, Array, Object, Symbol, console
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(clientSource, sandbox, { filename: 'lib/client.js' });

check('bundle 注册到 ModuleLoader', registration !== undefined);
check('模块 id = 包名（client-modules 用包名做模块 id）',
  registration.id === 'dsh-session-cost', registration.id);

const exportsObj = registration.factory((specifier) => {
  if (specifier === 'react') return react;
  if (specifier === 'react/jsx-runtime') return jsxRuntime;
  throw new Error('unexpected external request: ' + specifier);
});

check('导出 apply()', typeof exportsObj.apply === 'function');
check('导出 inject 服务列表', JSON.stringify(exportsObj.inject) === JSON.stringify(['sessions', 'slots', 'locale']),
  JSON.stringify(exportsObj.inject));
check('CSS 已注入文档', styleTags.length === 1 && styleTags[0].dataset.pluginCss !== undefined);

/* ------------------------------------------------------- plugin activation */
let registered = null;
const fakeFace = (key) => ({ __key: key, getSnapshot: () => undefined, subscribe: () => () => {} });
const fakeCtx = {
  effect: (fn) => { fn(); return () => {}; },
  locale: { register: (ns) => { fakeCtx.__ns = ns; return () => {}; } },
  sessions: {
    binding: (id) => (id === 's1'
      ? { session: { projections: { faceOf: (key) => fakeFace(key) } } }
      : undefined)
  },
  slots: {
    inject: (name, fn) => fn(),
    register: (descriptor, component) => { registered = { descriptor, component }; return () => {}; }
  }
};
exportsObj.apply(fakeCtx);

check('注册到 conversation.session.header.actions',
  registered !== null && registered.descriptor.name === 'conversation.session.header.actions',
  registered && registered.descriptor.name);
check('slot id 稳定', registered.descriptor.id === 'session-cost');
check('词典命名空间已注册', fakeCtx.__ns === 'session-cost');

const injected = registered.descriptor.inject('s1');
check('注入 tokenUsage observable', injected.hooks.costTokenUsage.__key === 'tokenUsage');
check('注入 modelSelection observable', injected.hooks.costModelSelection.__key === 'modelSelection');
const injectedMissing = registered.descriptor.inject('missing-session');
check('会话绑定缺失时返回空注入而不抛错', Object.keys(injectedMissing).length === 0);

/* ------------------------------------------------------ pricing unit tests */
const { computeCost, tierForModel, isPeak, priceAt, formatCNY, PRICING } = exportsObj;

check('文本模型 id 归入 pro tier', tierForModel('deepseek-v4-pro') === 'pro');
check('flash 及其历史别名归入 flash tier',
  tierForModel('deepseek-flash') === 'flash' &&
  tierForModel('deepseek-v4-flash') === 'flash' &&
  tierForModel('deepseek-chat') === 'flash' &&
  tierForModel(null) === 'flash');

const offFlash = PRICING.flash.offPeak;
const cost = computeCost(
  { uncachedInputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 0 },
  offFlash);
check('分项：缓存命中 2M × ¥0.02 = ¥0.04', Math.abs(cost.cacheRead - 0.04) < 1e-9, cost.cacheRead);
check('分项：cache miss 1M × ¥1 = ¥1', Math.abs(cost.cacheMiss - 1) < 1e-9, cost.cacheMiss);
check('分项：输出 0.5M × ¥4 = ¥2', Math.abs(cost.output - 2) < 1e-9, cost.output);
check('合计 = ¥3.04', Math.abs(cost.total - 3.04) < 1e-9, cost.total);

check('缓存写入按 cache miss 价计费',
  Math.abs(computeCost({ cacheWriteTokens: 1_000_000 }, offFlash).total - 1) < 1e-9);

check('四个 bucket 分别计量、互不重复',
  Math.abs(computeCost({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, offFlash).total) < 1e-12);

check('高峰价 = 空闲价 × 2',
  PRICING.flash.peak.cacheHit === PRICING.flash.offPeak.cacheHit * 2 &&
  PRICING.flash.peak.cacheMiss === PRICING.flash.offPeak.cacheMiss * 2 &&
  PRICING.flash.peak.output === PRICING.flash.offPeak.output * 2);

check('金额格式：小额保留 4 位', formatCNY(0.0034) === '¥0.0034', formatCNY(0.0034));
check('金额格式：中等额 3 位', formatCNY(0.123) === '¥0.123', formatCNY(0.123));
check('金额格式：大额 2 位', formatCNY(12.3456) === '¥12.35', formatCNY(12.3456));

/* ------------------------------- timezone correctness against Intl oracle */
const bjParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', hour12: false
});
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function oraclePeak(date) {
  const parts = bjParts.formatToParts(date);
  const day = WEEKDAY[parts.find((p) => p.type === 'weekday').value];
  const hour = Number(parts.find((p) => p.type === 'hour').value) % 24;
  if (day === 0 || day === 6) return false;
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}

let mismatches = 0, peakCount = 0;
const start = Date.UTC(2026, 8, 13, 0, 0, 0);           // 2026-09-13T00:00Z
for (let h = 0; h < 24 * 7; h++) {
  const at = new Date(start + h * 3600 * 1000);
  const mine = isPeak(at);
  const oracle = oraclePeak(at);
  if (mine !== oracle) mismatches++;
  if (mine) peakCount++;
}
check('7×24 小时内的高峰判定与 Intl/Asia-Shanghai 完全一致',
  mismatches === 0, mismatches + ' 处不一致');
check('一周内确实存在高峰时段样本', peakCount > 0, peakCount + ' 个小时为高峰');

const OFF_PEAK_INSTANT = new Date(Date.UTC(2026, 8, 12, 2, 0, 0));   // 北京 周六 10:00
const PEAK_INSTANT = new Date(Date.UTC(2026, 8, 14, 2, 0, 0));       // 北京 周一 10:00
check('周六为空闲时段', isPeak(OFF_PEAK_INSTANT) === false);
check('周一 10:00 为高峰时段', isPeak(PEAK_INSTANT) === true);
check('同一 tier 在两个时段的单价不同',
  priceAt('flash', PEAK_INSTANT).cacheMiss === 2 && priceAt('flash', OFF_PEAK_INSTANT).cacheMiss === 1);

/* ------------------------------------------------------------- rendering */
function collectText(node, out) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((child) => collectText(child, out)); return out; }
  if (node.props) {
    collectText(node.props.children, out);
    Object.keys(node.props).forEach((key) => {
      if (key !== 'children' && (key === 'title' || key === 'aria-label')) collectText(node.props[key], out);
    });
  }
  return out;
}
const tStub = (key, vars) => {
  let text = key;
  if (vars) Object.keys(vars).forEach((name) => { text = text.replace('{' + name + '}', String(vars[name])); });
  return text;
};

/**
 * Render once and run the effects that render queued. `reset` starts a fresh
 * scenario (state cleared by the caller, cleanups and timers dropped); the
 * no-reset form is a re-render, the way a state update or a projection frame
 * re-renders the live component.
 */
function renderWith(props, reset) {
  if (reset) resetHooks(); else beginRender();
  const out = exportsObj.SessionCostAction(Object.assign({
    t: tStub,
    sessionId: 's1',
    useProjection: undefined
  }, props));
  flushEffects();
  return out;
}
function render(props) { return renderWith(props, true); }
function rerender(props) { return renderWith(props, false); }

const MODEL = { next: { provider: 'deepseek', model: 'deepseek-flash' }, lastUsed: null };
const USAGE = { uncachedInputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 0 };
const propsFor = () => ({
  t: tStub,
  sessionId: 's1',
  useCostTokenUsage: () => USAGE,
  useCostModelSelection: () => MODEL
});

function findButton(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'button') return node;
  const kids = node.props ? node.props.children : null;
  const list = Array.isArray(kids) ? kids : [kids];
  for (const kid of list) {
    const found = findButton(kid);
    if (found) return found;
  }
  return null;
}

/* --- 空闲时段：¥3.04 --- */
fakeNow = Date.UTC(2026, 8, 12, 2, 0, 0);
hookState.length = 0;
const chip = render(propsFor());
let text = collectText(chip, []).join(' ');
check('空闲时段合计 = ¥3.04', text.indexOf('3.04') !== -1, text.slice(0, 90));
check('空闲时段标记为「闲」', text.indexOf('tier.offPeakShort') !== -1);

/* --- 注入契约：inject 产出的 hooks 键 → 组件消费的 prop 名 --- */
/*
 * 运行时把 `inject` 返回的 `hooks.<key>` 折算成 prop `use<Key>`（首字母大写）
 * （PropsHooks 映射）。组件读的是 `useCostTokenUsage` / `useCostModelSelection`，
 * 所以这里按同一条规则从 inject 的真实输出构造 props：任何一侧改名都会让下面
 * 这条断言渲染不出金额，而不是静默退化成 useProjection 兜底。
 */
function propsFromInjection(values) {
  const injectedHere = registered.descriptor.inject('s1');
  const built = { t: tStub, sessionId: 's1' };
  for (const key of Object.keys(injectedHere.hooks || {})) {
    built['use' + key.charAt(0).toUpperCase() + key.slice(1)] = () => values[injectedHere.hooks[key].__key];
  }
  return built;
}
const bridgedProps = propsFromInjection({ tokenUsage: USAGE, modelSelection: MODEL });
check('inject 的 hooks 键按 use + 首字母大写 折算成 prop',
  typeof bridgedProps.useCostTokenUsage === 'function' && typeof bridgedProps.useCostModelSelection === 'function',
  Object.keys(bridgedProps).join(', '));
fakeNow = Date.UTC(2026, 8, 12, 2, 0, 0);
hookState.length = 0;
const bridgedText = collectText(render(bridgedProps), []).join(' ');
check('仅凭 inject 产出的 prop 名即可渲染出金额',
  bridgedText.indexOf('3.04') !== -1, bridgedText.slice(0, 90));

/* --- 点开明细面板 --- */
const button = findButton(chip);
check('渲染出触发器按钮（含 onClick）', button !== null && typeof button.props.onClick === 'function');
button.props.onClick();                       // 打开面板
const opened = render(propsFor());
const openText = collectText(opened, []).join(' ');
check('明细面板列出四个 token bucket 中的三个非零项',
  openText.indexOf('row.cacheHit') !== -1 && openText.indexOf('row.cacheMiss') !== -1 &&
  openText.indexOf('row.output') !== -1);
check('明细面板不列出零用量的缓存写入行', openText.indexOf('row.cacheWrite') === -1);
check('明细面板显示 token 数', openText.indexOf('2,000,000') !== -1 && openText.indexOf('1,000,000') !== -1);
check('明细面板显示合计', openText.indexOf('panel.total') !== -1 && openText.indexOf('3.04') !== -1);
check('明细面板带说明与免责声明', openText.indexOf('panel.note') !== -1);

/* --- 高峰时段：同一用量翻倍 --- */
fakeNow = Date.UTC(2026, 8, 14, 2, 0, 0);
hookState.length = 0;
const peakChip = render(propsFor());
const peakText = collectText(peakChip, []).join(' ');
check('高峰时段合计 = ¥6.08（空闲价的 2 倍）', peakText.indexOf('6.08') !== -1, peakText.slice(0, 90));
check('高峰时段标记为「峰」', peakText.indexOf('tier.peakShort') !== -1);

/* --- 面板关着也跟随挂钟：跨过边界自动改价 --- */
/*
 * 挂载时是空闲时段，只让时间走到高峰、不改 props —— 这正是「页面上挂着不动」
 * 的情形。心跳必须自己把单价和「峰 / 闲」标记翻过来，否则一次挂载后定价会
 * 永远停在打开页面那一刻的时段上。
 */
fakeNow = Date.UTC(2026, 8, 12, 2, 0, 0);        // 北京 周六 10:00 —— 空闲
hookState.length = 0;
const liveChip = render(propsFor());             // 关闭状态挂载
const liveBefore = collectText(liveChip, []).join(' ');
check('关闭状态挂载时按空闲时段计价', liveBefore.indexOf('3.04') !== -1, liveBefore.slice(0, 90));
check('关闭状态也注册了 30 秒心跳', timers.size === 1, timers.size + ' 个定时器');
fakeNow = Date.UTC(2026, 8, 14, 2, 0, 0);        // 北京 周一 10:00 —— 高峰
fireTimers();                                     // 心跳 → setNow
const liveAfter = collectText(rerender(propsFor()), []).join(' ');
check('心跳后自动切到高峰价（无需打开面板）', liveAfter.indexOf('6.08') !== -1, liveAfter.slice(0, 90));
check('心跳后「峰 / 闲」标记同步更新', liveAfter.indexOf('tier.peakShort') !== -1);

/* --- 模型切换改价（回到空闲时段，隔离模型这一个变量） --- */
fakeNow = Date.UTC(2026, 8, 12, 2, 0, 0);
hookState.length = 0;
const proChip = render({
  t: tStub, sessionId: 's1',
  useCostTokenUsage: () => USAGE,
  useCostModelSelection: () => ({ next: { provider: 'deepseek', model: 'deepseek-v4-pro' }, lastUsed: null })
});
const proText = collectText(proChip, []).join(' ');
check('同一用量在 pro tier = ¥11.55（flash 空闲价 ¥3.04 的 3.8 倍）',
  proText.indexOf('11.55') !== -1, proText.slice(0, 90));

/* --- 空态与兜底 --- */
check('无用量时返回 null（不占位）',
  exportsObj.SessionCostAction({ t: tStub, useCostTokenUsage: () => undefined,
    useCostModelSelection: () => MODEL, useProjection: () => undefined }) === null);
check('零 token 时返回 null',
  exportsObj.SessionCostAction({ t: tStub,
    useCostTokenUsage: () => ({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
    useCostModelSelection: () => MODEL }) === null);
check('走 useProjection 兜底路径也能渲染',
  exportsObj.SessionCostAction({ t: tStub,
    useProjection: (key) => (key === 'tokenUsage'
      ? { uncachedInputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 }
      : MODEL) }) !== null);

/* ------------------------------------------------------------------ report */
console.log('dsh-session-cost smoke test\n');
lines.forEach((line) => console.log(line));
console.log('\n' + (failures === 0 ? '全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
