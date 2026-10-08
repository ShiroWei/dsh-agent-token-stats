# Changelog

## v1.1.1 (2026-10-08)

### Fixed
- **DSH 0.2.0 host compatibility**: the shell service renamed `run(spec)` to `execute(spec)` (returning a live handle settled via `result()`). All three call sites now go through a `shellStart()` shim supporting both API generations, so the bundle runs on 0.1.x and 0.2.x hosts.

## v1.1.0 (2026-09-22)

### Fixed
- **OpenCode storage-migration blind spot**: OpenCode moved messages from `message` to `session_message` (nested `model.id` shape) plus a `session_v2` table; the legacy table froze at migration, silently dropping all newer usage. The collector now probes `sqlite_master` and unions legacy rows with `session_message` rows strictly after the freeze point — overlap-free by construction, ratchet-consistent with existing ledger keys.
- **WAL signature gaps**: `state.vscdb-wal` (Cursor), `state.db-wal` (Hermes), `local.db-wal` (Lingma) are now watched, so WAL-only writes trigger re-collection.
- **Hover popups clipped by overflow containers**: trend tooltip is now `position: fixed` following the mouse with viewport-edge flipping; donut SVG allows overflow for the widened hover arc; heatmap padding accommodates the hover scale.

### Added
- **Session Explorer tab**: per-session title / project / model / messages / tokens / cost for OpenCode, CodeWhale and Cursor (Cursor results cached 30 min server-side).
- **Schema-drift sentinel**: a source whose files keep updating while its parsed activity stays >48h behind gets a "⚠ possible schema drift" badge — silent breakage becomes visible.
- **Claude Code auto-delete warning**: detects a missing/short `cleanupPeriodDays` and warns in the source card.
- **Budget alerts**: `~/.agent-token-stats/config.json` → `{"budgets":{"dailyTokens":N,"monthlyTokens":N,"dailyCost":N,"monthlyCost":N}}`; exceeding shows a red banner.
- **User-editable pricing**: `~/.agent-token-stats/pricing.json` → `{"rules":[{"pat":"model-substr","i":$,"o":$,"cr":$,"cw":$}]}` (USD per 1M tokens); user rules take precedence over built-ins.
- **Weekly / monthly Markdown reports**: one-click download with period-over-period deltas, per-agent / per-vendor / top-model tables.
- **API quota query**: DeepSeek balance + Kimi/Moonshot balance via `~/.agent-token-stats/quota.json` (`{"deepseek":{"apiKey":"..."},"kimi":{"apiKey":"..."}}`) or `DEEPSEEK_API_KEY` / `MOONSHOT_API_KEY` env vars; keys stay local.
- **English UI**: header `EN / 中文` toggle covering all interface chrome (host-generated source details remain Chinese).
- **CI**: dependency-free smoke workflow (`node --check` + factory/slot dry-run).

## v1.0.0 (2026-09-22)

- Initial public release: cross-agent token usage dashboard with persistent ratchet ledger, 10 parsed sources + 9 detection/standby sources, cache-hit analytics, cost estimation, comparison views, day drill-down, sticky filter toolbar, CSV export.
