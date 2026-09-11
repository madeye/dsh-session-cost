# dsh-session-cost

DeepSeek Harness（dsh）客户端插件：在 **Web GUI 会话头部实时显示本次会话的人民币花费**，
点击可展开按 token 桶拆分的明细。价格取自 DeepSeek 官方价目表，**本身就是人民币计价**，
不做任何汇率换算。

```
会话头部右侧 →  ¥3.04  [闲]      ← 点击展开
                ┌──────────────────────────────────┐
                │ 本会话花费                        │
                │ 模型 deepseek-flash · 空闲时段     │
                │ ──────────────────────────────── │
                │ 输入 · 缓存命中   2,000,000  ¥0.02  ¥0.04
                │ 输入 · 缓存未命中 1,000,000  ¥1     ¥1.00
                │ 输出               500,000   ¥4     ¥2.00
                │ ──────────────────────────────── │
                │ 合计（人民币）              ¥3.04  │
                └──────────────────────────────────┘
```

## 安装

```sh
# 1) 装进目标 profile
#    从 GitHub 装（版本钉在 commit 上，适合日常使用）
dsh plugin --profile web add github:madeye/dsh-session-cost

#    或从本地目录装成 link:（改代码即时生效，适合开发）
dsh plugin --profile web add /Volumes/DATA/workspace/dsh-session-cost

# 2) 在 profile 的 patch 层里注册宿主行
#    ~/.dsh/profiles/web/cordis.patch.yml
```

```yaml
- insert:
    - id: session-cost
      name: dsh-session-cost
```

```sh
# 3) 确认 patch 已合成进配置树
dsh --profile web --dump-config | grep -A2 session-cost
```

**然后刷新浏览器页面。** 客户端插件的清单是在页面加载时注入 `window.__DSH_BOOT__`
的，所以新增插件必须刷新一次才会出现。

两种装法的差别：

| 装法 | profile 里的 spec | 改 `lib/client.js` 之后 |
|---|---|---|
| GitHub | `github:madeye/dsh-session-cost`（钉 commit） | 要 push 后重跑 `dsh plugin ... add`，再刷新页面 |
| 本地目录 | `link:/path/to/dsh-session-cost` | 直接刷新页面即可 |

两种装法下，`package.json` 的变更（例如 `dsh.client`）都需要重跑 `dsh plugin ... add`。

### 卸载

```sh
dsh plugin --profile web remove dsh-session-cost
# 再把 cordis.patch.yml 里那段 insert 删掉
```

## 计费口径

价格来自 <https://api-docs.deepseek.com/zh-cn/quick_start/pricing>，**单位：人民币元 / 百万 tokens**。

| 项目 | deepseek-flash（V4.1-Flash） | deepseek-v4-pro |
|---|---|---|
| 输入 · 缓存命中 | 空闲 0.02 / 高峰 0.04 | 空闲 0.15 / 高峰 0.30 |
| 输入 · 缓存未命中 | 空闲 1 / 高峰 2 | 空闲 4.5 / 高峰 9.0 |
| 输出 | 空闲 4 / 高峰 8 | 空闲 13.5 / 高峰 27.0 |

**高峰时段** = 北京时间周一至周五 09:00–12:00 与 14:00–18:00，其余为空闲时段；
空闲价恰为高峰价的一半。时段判定用 UTC 位移读取北京墙上时钟，不依赖运行环境时区
（smoke test 拿 `Intl` / `Asia-Shanghai` 做了一周 × 24 小时的对拍）。

### token 桶与「缓存写入」

用量来自 `dsh-token-meter` 的 `tokenUsage` 会话投影，四个桶**互不重叠**：

| 投影字段 | 计费档 |
|---|---|
| `cacheReadTokens` | 缓存命中价 |
| `uncachedInputTokens` | 缓存未命中价 |
| `cacheWriteTokens` | **缓存未命中价** |
| `outputTokens` | 输出价 |

官方价目表只区分「缓存命中 / 缓存未命中」两档，首次把前缀写进缓存的那次请求本来就是
未命中，因此 `cacheWriteTokens` 按未命中价计费，且因为是互斥桶，不会与
`uncachedInputTokens` 重复计费。

### 已知口径限制

- **跨时段历史会按当前时段重算。** 投影只给累计 token 数，不带「每个 token 是什么时候
  产生的」。所以明细里的金额是「把全部累计用量按此刻生效的单价折算」，跨过高峰/空闲
  边界时整笔金额会跳一次。真实账单以官方为准——面板底部也写了这句。
- **切换模型后按新模型单价重算全部历史。** `tokenUsage` 没有按模型拆分的字段。
- 这是**成本展示**，不是账单：不含赠送余额、折扣、并发计费等。

## 实现

单文件浏览器半侧，无构建步骤：

| 文件 | 作用 |
|---|---|
| `lib/index.js` | 宿主半侧：空 `apply()`，只为让插件出现在 Loader 里 |
| `lib/client.js` | 浏览器半侧：`window.__ModuleLoader__.load(...)` 包装的 React 组件 |
| `scripts/smoke.mjs` | 冒烟测试：加载 bundle、跑 `apply`、渲染、校验计费数学 |

挂载点：`conversation.session.header.actions` 槽位（`order: 15`），是个会话作用域的槽位。

数据来源不依赖该槽位恰好提供了哪些标准 props：插件通过 **slot 自己的 `inject`** 从
`ctx.sessions.binding(sessionId).session.projections.faceOf(...)` 取 `tokenUsage` 与
`modelSelection` 两个 observable；`useProjection` 只作为兜底。两条路都拿不到用量时组件
返回 `null`，不占位、不报错。

## 开发

```sh
cd /Volumes/DATA/workspace/dsh-session-cost
node scripts/smoke.mjs      # 48 项断言
```

smoke test 覆盖：bundle 注册 id、`apply`/`inject` 契约、slot 注册描述符、observable 注入、
会话绑定缺失时的降级、四桶计费与缓存写入口径、金额格式化、高峰判定的时区对拍、
空闲/高峰/pro 三档的端到端渲染金额，点击展开明细面板，以及

- **注入命名契约**：按运行时的同一条规则（`hooks.<key>` → prop `use<Key>`）从 `inject`
  的真实输出构造 props 并渲染；任何一侧改名都会渲染不出金额，而不是静默退化成
  `useProjection` 兜底。
- **挂钟心跳**：面板关着时也注册 30 秒定时器；只推进时间、不改 props，单价与
  「峰 / 闲」标记必须自己翻过边界。

改完 `lib/client.js` 后能否直接刷新浏览器，取决于 profile 的装法（见「安装」一节的对照表）：
`link:` 装法直接刷新即可；GitHub 装法要 push 后重跑 `dsh plugin ... add`。
