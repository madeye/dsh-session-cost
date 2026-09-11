window.__ModuleLoader__.load({
	id: "dsh-session-cost",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");

		//#region lib/types/client/pricing.js
		/**
		 * DeepSeek 官方价目表，单位：人民币元 / 百万 tokens。
		 * 来源 https://api-docs.deepseek.com/zh-cn/quick_start/pricing
		 *
		 * 高峰时段 = 北京时间周一至周五 09:00–12:00 与 14:00–18:00；
		 * 空闲时段价格为高峰时段的一半，其余时刻一律按空闲价计费。
		 */
		const PRICING = {
			flash: {
				id: "deepseek-flash",
				label: "DeepSeek-V4.1-Flash",
				peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
				offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 }
			},
			pro: {
				id: "deepseek-v4-pro",
				label: "DeepSeek-V4-Pro",
				peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
				offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 }
			}
		};
		/** 未识别到模型时使用的 tier。 */
		const DEFAULT_TIER = "flash";
		/**
		 * 把模型 id 归一到价目表 tier。历史模型名（deepseek-v4-flash、
		 * deepseek-chat 等）都按 flash tier 计价，因为官方已把它们路由到 Flash。
		 * @param model - 模型 id，可能为 null。
		 * @returns 价目表 tier 键。
		 */
		function tierForModel(model) {
			const id = String(model == null ? "" : model).toLowerCase();
			if (id.indexOf("pro") !== -1) return "pro";
			return DEFAULT_TIER;
		}
		/**
		 * 用 UTC 位移读取北京时间墙上时钟，不依赖运行环境时区。
		 * @param date - 要判定的时刻。
		 * @returns 北京时间的星期（0=周日）与小时（0–23）。
		 */
		function beijingClock(date) {
			const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
			return { day: shifted.getUTCDay(), hour: shifted.getUTCHours() };
		}
		/**
		 * 该时刻是否处于高峰时段。
		 * @param date - 要判定的时刻。
		 * @returns 高峰为 true。
		 */
		function isPeak(date) {
			const clock = beijingClock(date);
			if (clock.day === 0 || clock.day === 6) return false;
			return (clock.hour >= 9 && clock.hour < 12) || (clock.hour >= 14 && clock.hour < 18);
		}
		/**
		 * 该时刻生效的单价表。
		 * @param tier - 价目表 tier 键。
		 * @param date - 要判定的时刻。
		 * @returns 单价表。
		 */
		function priceAt(tier, date) {
			const table = PRICING[tier] || PRICING[DEFAULT_TIER];
			return isPeak(date) ? table.peak : table.offPeak;
		}
		/**
		 * 按四个分别计量、互不重复的 token bucket 计算费用。
		 *
		 * `dsh-token-meter` 的 TokenUsageProjection 保证四个 bucket 分别计量、互不重复；官方价目表只有
		 * cache hit / cache miss 两类，因此**缓存写入按 cache miss 价计费**——首次把
		 * 前缀写进缓存的那次请求本来就是 cache miss。
		 *
		 * @param usage - tokenUsage projection 值。
		 * @param prices - 生效单价（元 / 百万 tokens）。
		 * @returns 分项与合计费用（元）。
		 */
		function computeCost(usage, prices) {
			const u = usage || {};
			const cacheRead = ((u.cacheReadTokens || 0) * prices.cacheHit) / 1e6;
			const cacheMiss = ((u.uncachedInputTokens || 0) * prices.cacheMiss) / 1e6;
			const cacheWrite = ((u.cacheWriteTokens || 0) * prices.cacheMiss) / 1e6;
			const output = ((u.outputTokens || 0) * prices.output) / 1e6;
			return {
				cacheRead: cacheRead,
				cacheMiss: cacheMiss,
				cacheWrite: cacheWrite,
				output: output,
				total: cacheRead + cacheMiss + cacheWrite + output
			};
		}
		/**
		 * 金额显示：数额越小保留越多小数位，避免低成本会话显示成 ¥0.00。
		 * @param value - 人民币金额。
		 * @returns 带 ¥ 前缀的字符串。
		 */
		function formatCNY(value) {
			const v = Number.isFinite(value) ? value : 0;
			if (v === 0) return "¥0";
			if (v < 0.01) return "¥" + v.toFixed(4);
			if (v < 1) return "¥" + v.toFixed(3);
			return "¥" + v.toFixed(2);
		}
		/**
		 * 千分位 token 计数。
		 * @param n - token 数。
		 * @returns 千分位字符串。
		 */
		function formatTokens(n) {
			const v = Number.isFinite(n) ? n : 0;
			return v.toLocaleString("en-US");
		}
		/**
		 * 单价显示（元 / 百万 tokens），最多三位小数。
		 * @param unit - 单价。
		 * @returns 字符串。
		 */
		function formatUnit(unit) {
			return "¥" + Number(unit).toString();
		}
		//#endregion

		//#region lib/types/client/SessionCostAction.module.css
		const css = ".dscRoot{position:relative;display:inline-flex}.dscTrigger{min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:baseline;gap:5px;padding:3px 6px;font-size:12px;line-height:18px;display:inline-flex;font-variant-numeric:tabular-nums}.dscTrigger:hover,.dscTrigger:focus-visible{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-l2,transparent)}.dscTriggerOpen{color:var(--dsw-alias-label-primary)}.dscSign{font-size:11px;opacity:.75}.dscAmount{font-family:var(--dsw-font-mono,ui-monospace,monospace)}.dscTier{font-size:10px;line-height:14px;border-radius:4px;padding:0 4px;background:var(--dsw-alias-fill-l2,rgba(148,163,184,.2));color:var(--dsw-alias-label-tertiary)}.dscTierPeak{background:rgba(245,158,11,.18);color:#f59e0b}.dscMenu{z-index:100;box-sizing:border-box;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1,#111827));--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);width:326px;max-width:min(400px,100vw - 32px);box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.45));border:1px solid var(--dsw-alias-border-l1,rgba(148,163,184,.2));border-radius:14px;margin:0;padding:12px 14px;position:absolute;top:calc(100% + 6px);right:0}.dscHead{align-items:center;gap:8px;display:flex;justify-content:space-between}.dscHeadTitle{color:var(--dsw-alias-label-primary,#e5e7eb);font-size:13px;font-weight:600}.dscModel{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:3px}.dscTable{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}.dscTable th{color:var(--dsw-alias-label-tertiary);font-weight:500;text-align:right;padding:3px 0;font-size:11px}.dscTable th:first-child{text-align:left}.dscTable td{color:var(--dsw-alias-label-secondary);padding:3px 0;text-align:right;font-variant-numeric:tabular-nums}.dscTable td:first-child{text-align:left;color:var(--dsw-alias-label-primary)}.dscUnit{color:var(--dsw-alias-label-tertiary);font-size:11px}.dscTotalRow{border-top:1px solid var(--dsw-alias-border-l1,rgba(148,163,184,.2));margin-top:8px;padding-top:8px;align-items:baseline;display:flex;justify-content:space-between}.dscTotalLabel{color:var(--dsw-alias-label-secondary);font-size:12px}.dscTotalValue{color:#22c55e;font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;font-family:var(--dsw-font-mono,ui-monospace,monospace)}.dscNote{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1.6;margin-top:8px}";
		const tagId = "dsh-session-cost/SessionCostAction.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-session-cost";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region lib/types/client/locales.js
		/** 简体中文词典（键集的事实来源）。 */
		const zh = {
			"trigger.aria": "本会话花费 {amount}，点击查看明细",
			"panel.title": "本会话花费",
			"panel.aria": "会话花费明细",
			"panel.model": "模型 {model}",
			"tier.peak": "高峰时段",
			"tier.offPeak": "空闲时段",
			"tier.peakShort": "峰",
			"tier.offPeakShort": "闲",
			"row.cacheHit": "输入 · 缓存命中",
			"row.cacheMiss": "输入 · 缓存未命中",
			"row.cacheWrite": "输入 · 缓存写入",
			"row.output": "输出",
			"col.tokens": "tokens",
			"col.unit": "单价",
			"col.cost": "费用",
			"panel.total": "合计（人民币）",
			"panel.note": "单价取自 DeepSeek 官方价目表（元 / 百万 tokens），按当前生效时段计算。缓存写入按未命中价计费。跨时段的历史用量会一并按当前时段单价重算，实际账单请以官方为准。"
		};
		/** English dictionary, key-identical to the Chinese source of truth. */
		const en = {
			"trigger.aria": "This session cost {amount}; activate for the breakdown",
			"panel.title": "Session cost",
			"panel.aria": "Session cost breakdown",
			"panel.model": "Model {model}",
			"tier.peak": "peak hours",
			"tier.offPeak": "off-peak hours",
			"tier.peakShort": "peak",
			"tier.offPeakShort": "off",
			"row.cacheHit": "Input · cache hit",
			"row.cacheMiss": "Input · cache miss",
			"row.cacheWrite": "Input · cache write",
			"row.output": "Output",
			"col.tokens": "tokens",
			"col.unit": "unit",
			"col.cost": "cost",
			"panel.total": "Total (CNY)",
			"panel.note": "Unit prices come from DeepSeek's official price list (CNY per million tokens) and follow the currently effective window. Cache writes are billed at the miss price. Usage from another window is re-priced at the current window's rates; the official invoice is authoritative."
		};
		//#endregion

		//#region lib/types/client/SessionCostAction.js
		/** 明细行：token bucket → 词条键与单价字段。 */
		const ROWS = [
			{ key: "cacheHit", usageKey: "cacheReadTokens", label: "row.cacheHit", priceKey: "cacheHit", costKey: "cacheRead" },
			{ key: "cacheMiss", usageKey: "uncachedInputTokens", label: "row.cacheMiss", priceKey: "cacheMiss", costKey: "cacheMiss" },
			{ key: "cacheWrite", usageKey: "cacheWriteTokens", label: "row.cacheWrite", priceKey: "cacheMiss", costKey: "cacheWrite" },
			{ key: "output", usageKey: "outputTokens", label: "row.output", priceKey: "output", costKey: "output" }
		];
		/**
		 * 会话头部的实时花费条目。
		 *
		 * token 用量来自 `tokenUsage` projection（宿主侧回放持久日志得出，客户端只做
		 * 展示），模型来自 `modelSelection` projection。两者都通过本插件自己的 slot
		 * `inject` 以 observable 形式注入，因此不依赖所在 slot 恰好提供了哪些标准
		 * props；`useProjection` 作为兜底。
		 *
		 * @param props - slot 运行时 props（sessionId、t，以及注入的 observable）。
		 * @returns 花费按钮与其明细面板；没有用量时返回 null。
		 */
		function SessionCostAction(props) {
			const t = props.t;
			const useInjectedUsage = props.useCostTokenUsage;
			const useInjectedModel = props.useCostModelSelection;
			const useProjection = props.useProjection;

			const injectedUsage = typeof useInjectedUsage === "function" ? useInjectedUsage((value) => value) : undefined;
			const projectedUsage = typeof useProjection === "function" ? useProjection("tokenUsage") : undefined;
			const usage = injectedUsage !== undefined ? injectedUsage : projectedUsage;

			const injectedModel = typeof useInjectedModel === "function" ? useInjectedModel((value) => value) : undefined;
			const projectedModel = typeof useProjection === "function" ? useProjection("modelSelection") : undefined;
			const modelSelection = injectedModel !== undefined ? injectedModel : projectedModel;

			const openState = react.useState(false);
			const open = openState[0];
			const setOpen = openState[1];
			const nowState = react.useState(() => Date.now());
			const now = nowState[0];
			const setNow = nowState[1];
			const rootRef = react.useRef(null);

			/**
			 * 每 30 秒跟随墙上时钟重算一次——面板关着也照跑。跨过高峰/空闲边界时
			 * 单价与「峰 / 闲」标记会自己切换，否则一次挂载后定价会一直停在
			 * 打开页面那一刻的时段上。
			 */
			react.useEffect(() => {
				const timer = setInterval(() => setNow(Date.now()), 30000);
				return () => clearInterval(timer);
			}, []);

			/** 点击外部或 Esc 关闭明细。 */
			react.useEffect(() => {
				if (!open) return undefined;
				const onPointerDown = (event) => {
					const root = rootRef.current;
					if (root && event.target && typeof root.contains === "function" && !root.contains(event.target)) setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown, true);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open, setOpen]);

			if (usage === undefined || usage === null) return null;

			const model = (modelSelection && (modelSelection.next || modelSelection.lastUsed) || {}).model || null;
			const tierKey = tierForModel(model);
			const tier = PRICING[tierKey] || PRICING[DEFAULT_TIER];
			const moment = new Date(now);
			const prices = priceAt(tierKey, moment);
			const peak = isPeak(moment);
			const cost = computeCost(usage, prices);

			let tokenTotal = 0;
			for (const row of ROWS) tokenTotal += usage[row.usageKey] || 0;
			if (tokenTotal === 0) return null;

			const amountText = formatCNY(cost.total);
			const tierText = t(peak ? "tier.peak" : "tier.offPeak");

			const rows = ROWS.map((row) => {
				const tokens = usage[row.usageKey] || 0;
				if (tokens === 0) return null;
				return react_jsx_runtime.jsxs("tr", {
					children: [
						react_jsx_runtime.jsx("td", { children: t(row.label) }),
						react_jsx_runtime.jsx("td", { children: formatTokens(tokens) }),
						react_jsx_runtime.jsx("td", {
							className: "dscUnit",
							children: formatUnit(prices[row.priceKey])
						}),
						react_jsx_runtime.jsx("td", { children: formatCNY(cost[row.costKey]) })
					]
				}, row.key);
			}).filter(Boolean);

			return react_jsx_runtime.jsxs("div", {
				ref: rootRef,
				className: "dscRoot",
				children: [
					react_jsx_runtime.jsxs("button", {
						type: "button",
						className: open ? "dscTrigger dscTriggerOpen" : "dscTrigger",
						"aria-expanded": open,
						"aria-label": t("trigger.aria", { amount: amountText }),
						title: t("panel.model", { model: model || tier.label }) + " · " + tierText,
						onClick: () => {
							setNow(Date.now());
							setOpen((current) => !current);
						},
						children: [
							react_jsx_runtime.jsx("span", { className: "dscSign", children: "¥" }),
							react_jsx_runtime.jsx("span", { className: "dscAmount", children: amountText.slice(1) }),
							react_jsx_runtime.jsx("span", {
								className: peak ? "dscTier dscTierPeak" : "dscTier",
								children: t(peak ? "tier.peakShort" : "tier.offPeakShort")
							})
						]
					}),
					open ? react_jsx_runtime.jsxs("div", {
						className: "dscMenu",
						role: "dialog",
						"aria-label": t("panel.aria"),
						children: [
							react_jsx_runtime.jsxs("div", {
								children: [
									react_jsx_runtime.jsx("div", { className: "dscHeadTitle", children: t("panel.title") }),
									react_jsx_runtime.jsx("div", {
										className: "dscModel",
										children: t("panel.model", { model: model || tier.label }) + " · " + tierText
									})
								]
							}),
							react_jsx_runtime.jsxs("table", {
								className: "dscTable",
								children: [
									react_jsx_runtime.jsx("thead", {
										children: react_jsx_runtime.jsxs("tr", {
											children: [
												react_jsx_runtime.jsx("th", { children: "" }),
												react_jsx_runtime.jsx("th", { children: t("col.tokens") }),
												react_jsx_runtime.jsx("th", { children: t("col.unit") }),
												react_jsx_runtime.jsx("th", { children: t("col.cost") })
											]
										})
									}),
									react_jsx_runtime.jsx("tbody", { children: rows })
								]
							}),
							react_jsx_runtime.jsxs("div", {
								className: "dscTotalRow",
								children: [
									react_jsx_runtime.jsx("span", { className: "dscTotalLabel", children: t("panel.total") }),
									react_jsx_runtime.jsx("span", { className: "dscTotalValue", children: amountText })
								]
							}),
							react_jsx_runtime.jsx("div", { className: "dscNote", children: t("panel.note") })
						]
					}) : null
				]
			});
		}
		//#endregion

		//#region lib/types/client/index.js
		/** 必需服务：会话绑定、slot 注册与词典。 */
		const inject = ["sessions", "slots", "locale"];
		/** 词典命名空间。 */
		const NS = "session-cost";
		/**
		 * Client plugin body: register the dictionaries and the session-header entry.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), "session-cost: dictionaries");
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "session-cost",
				order: 15,
				locale: NS,
				inject: (sessionId) => {
					const binding = ctx.sessions.binding(sessionId);
					const projections = binding && binding.session ? binding.session.projections : undefined;
					if (!projections) return {};
					return {
						hooks: {
							costTokenUsage: projections.faceOf("tokenUsage"),
							costModelSelection: projections.faceOf("modelSelection")
						}
					};
				}
			}, SessionCostAction));
		}
		//#endregion

		exports.SessionCostAction = SessionCostAction;
		exports.apply = apply;
		exports.inject = inject;
		exports.PRICING = PRICING;
		exports.computeCost = computeCost;
		exports.tierForModel = tierForModel;
		exports.isPeak = isPeak;
		exports.priceAt = priceAt;
		exports.formatCNY = formatCNY;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
