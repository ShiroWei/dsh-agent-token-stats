# dsh-agent-token-stats

Cross-agent local LLM token usage dashboard for DeepSeek Harness (web profile). 跨 Agent 的本地 token 用量看板。

Aggregates local conversation logs from **Claude Code, WPS Claude, OpenCode, DSH, OpenClaw, QClaw, CodeWhale, WorkBuddy, Cursor IDE and Hermes** (with **Codex CLI, Gemini CLI, Cline/Roo and Pi** parsers on standby, plus detection-only probes for Trae / Lingma / CodeGeeX / Comate / Ollama / AionUi / Copilot) into a persistent ratchet ledger, and renders a full analytics panel in the DSH web GUI sidebar.

聚合本机 10+ 个 AI 工具的对话日志到持久化台账(源日志删除后历史仍保留),在 DSH web 侧边栏提供完整分析面板。

## Install

```sh
dsh plugin --profile web add dsh-agent-token-stats   # from npm
# or: dsh plugin --profile web add github:skyzhao1223/dsh-agent-token-stats
# then restart: dsh web
```

Requires system `sqlite3`, `jq`, and `zstd` (macOS: `brew install zstd`). Host: DSH >= 0.1.5-rc.

## Features

- **Metrics**: input / output / reasoning / cache read / cache write split, cache-hit rate, request counts, reported cost vs. estimated cost (built-in reference price list, never mixed)
- **Views**: overview cards with period-over-period deltas, vendor & prompt-composition donuts (hover + click-to-filter), stacked trend chart (hover tooltip + click day drill-down), activity heatmap (click drill-down), model detail table (sort / search / expand daily sparkline / totals footer), period comparison, agent comparison, session explorer, source status with schema-drift sentinel
- **Persistence**: `~/.agent-token-stats/ledger.json` — ratchet-merged per source × model × day; rescans never double-count; history survives source-log deletion
- **Reports**: weekly / monthly Markdown download; CSV export
- **Sticky toolbar**: source chips, time range, vendor select, model search, active-filter summary with one-click clear
- **i18n**: 中文 / English toggle
- **Auto-refresh** every 2 minutes; instant-open client cache

## Configuration (all optional, all in `~/.agent-token-stats/`)

| File | Purpose |
| --- | --- |
| `config.json` | `{"budgets":{"dailyTokens":0,"monthlyTokens":0,"dailyCost":0,"monthlyCost":0}}` — budget alert thresholds |
| `pricing.json` | `{"rules":[{"pat":"model-substr","i":3,"o":15,"cr":0.3,"cw":3.75}]}` — USD per 1M tokens, overrides built-in prices |
| `quota.json` | `{"deepseek":{"apiKey":"sk-..."},"kimi":{"apiKey":"..."}}` — balance queries (env `DEEPSEEK_API_KEY` / `MOONSHOT_API_KEY` also work) |
| `export-*.csv` | CSV exports land here |

## Architecture

One bundle row, two halves:
- **Host** (`lib/index.js`, injects `shell` + `webServer`): signature-based incremental scanners, ledger, pricing, and routes `GET /agent-token-stats/{data,export,sessions,report,quota}` (loopback, Origin-checked)
- **Client** (`lib/client.js`, `dsh.client` web bundle): sidebar panel + main-slot dashboard, plain `React.createElement`, no build step needed for edits

## Development

```sh
node --check lib/index.js && node --check lib/client.js
node scripts/smoke.mjs
```

Maintenance: edit source → `dsh plugin --profile web update dsh-agent-token-stats` → restart `dsh web`.

MIT © skyzhao1223
