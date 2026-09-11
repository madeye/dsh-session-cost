# AGENTS.md

DeepSeek Harness client plugin: a live session-cost chip in the Web GUI header.
**No build step** — `lib/client.js` is the shipped browser bundle, hand-written in
the `window.__ModuleLoader__.load({ id, factory })` format the DSH module system
serves verbatim from `/plugins/<package-name>/client.js`.

## Verify

```sh
node scripts/smoke.mjs        # the only check; 48 assertions
```

It loads the bundle in a `node:vm` sandbox with the same stub `require` the real
module system provides, runs `apply()` against a fake client context, renders the
component through a minimal React stand-in, and checks the billing math. Always
run it after touching `lib/client.js`.

End-to-end verification needs the CLI from outside this repo:

```sh
cd /Volumes/DATA/workspace
dsh plugin --profile web add ./dsh-session-cost   # local link: form
dsh --profile web --dump-config | grep -A2 session-cost

# the live boot graph of a running server (unauthenticated SSE) proves the
# client row composed; the running `dsh web` must be restarted if the
# dependency spec changed on disk, since module resolution is cached at boot
curl -s -N --max-time 4 http://127.0.0.1:3080/plugins/events | grep -o dsh-session-cost | head -1
```

Then **refresh the browser** — `window.__DSH_BOOT__` is injected at page load, so a
newly added plugin only appears after one reload.

## Hard contracts (breaking any of these silently kills the plugin)

- **The `id` passed to `__ModuleLoader__.load` must equal the package name**, not
  the Loader row id. `client-modules` keys the whole module graph and the
  `/plugins/<id>/client.js` URL by package name. Rows in `cordis.patch.yml` may
  use any `id`; their `name` must be the package name.
- `package.json` needs **both** `dsh.client.platform === "web"` **and**
  `exports["./client"]` resolving to a string path (or `{ default: "..." }`).
  Declaring `dsh.client` without the export throws at composition time.
- Every `require()` in the bundle must be in the implicit client baseline
  (`react`, `react-dom`, `react/jsx-runtime`, `@deepseek-ai/dsh-client-store`,
  `@deepseek-ai/dsh-client-ui-dockkit`, `@deepseek-ai/dsh-client-ui-primitives`,
  `@deepseek-ai/dsh-client-ui-slots`) or listed in `dsh.client.external`. A stray
  request fails at module materialization, in the browser, at runtime.
- Hook props come from the slot descriptor's `inject`: a key `foo` in the returned
  `hooks` object arrives as the prop `useFoo`.

## Pricing must stay verifiable

Prices live in the `PRICING` table in `lib/client.js`, in **CNY per million
tokens** — DeepSeek publishes CNY directly, so never introduce an FX rate.
Source: <https://api-docs.deepseek.com/zh-cn/quick_start/pricing>.

When the price list changes, update `PRICING` **and** the table in `README.md`,
then re-run the smoke test: three assertions pin the exact arithmetic
(flash off-peak ¥3.04, flash peak ¥6.08, pro off-peak ¥11.55 for a fixed usage
vector) and one pins peak = off-peak × 2.

Peak windows are Beijing time, Mon–Fri 09:00–12:00 and 14:00–18:00. The
implementation shifts the timestamp by +8h and reads **UTC** fields; do not
"simplify" this to `getHours()` — that would make the tier depend on the host
timezone. The smoke test cross-checks a full 7×24 hour grid against
`Intl.DateTimeFormat` with `timeZone: 'Asia/Shanghai'`.

## Billing semantics that are easy to get wrong

- The four `tokenUsage` buckets are **disjoint** (`dsh-token-meter`). Never sum
  `cacheWriteTokens` into `uncachedInputTokens`; they are separate charges.
- `cacheWriteTokens` is billed at the **cache-miss** price, because the official
  list has only hit/miss tiers and the request that populates the cache is the
  miss.
- Costs are recomputed from cumulative tokens at the **current** tier. This is a
  display, not an invoice: historical usage from another window or another model
  is re-priced. Say so in the UI (`panel.note`) and in `README.md`; do not remove
  that disclaimer.

## Docs language

`README.md` and the source comments are Chinese prose, but every technical term
keeps its source spelling — never a translated stand-in. Established so far:

| keep | never |
|---|---|
| `bucket`, `slot`, `projection`, `tier` | 桶, 槽位, 投影, 档 / 档位 |
| `cache hit` / `cache miss` / `output` (the price tiers) | 缓存命中价 / 未命中价 |
| `props`, `observable`, `bundle`, `spec`, `commit`, `smoke test` | — |

UI copy is the exception: the labels a user actually reads (`缓存命中`,
`高峰时段`) stay Chinese in `README.md` tables and diagrams, because they mirror
the `zh` dictionary in `lib/client.js`.

For disjointness say **分别计量、互不重复**, not 互不重叠 and never 互斥 — 互斥
reads as "cannot both hold", and all four buckets are routinely nonzero at once.

## Repo quirks

- Not a monorepo, no dependencies, no bundler. ESM (`"type": "module"`).
- The `web` profile can hold this package either way, and the difference decides
  the edit loop:
  - `link:/path/to/dsh-session-cost` — edits to `lib/client.js` take effect on the
    next browser reload, no reinstall. This is the development form.
  - `github:madeye/dsh-session-cost` — pinned to a commit; changing runtime code
    means push, then re-run `dsh plugin ... add`, then reload.
  Either way a `package.json` change (e.g. `dsh.client`) requires re-running
  `dsh plugin ... add`, and switching between the two specs needs a `dsh web`
  restart because module resolution is cached at boot.
