export const inject = ['shell', 'webServer']

export function apply(ctx) {
    const shell = ctx.shell

    function num(v) {
      const n = Number(v)
      return Number.isFinite(n) ? n : 0
    }
    function pad2(n) {
      return (n < 10 ? '0' : '') + String(n)
    }
    function localDay(ms) {
      if (!(ms > 0)) return ''
      const d = new Date(ms)
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    }
    const VENDOR_RULES = [
      ['claude', 'anthropic'], ['sonnet', 'anthropic'], ['opus', 'anthropic'], ['haiku', 'anthropic'],
      ['gpt', 'openai'], ['chatgpt', 'openai'], ['o1-', 'openai'], ['o3-', 'openai'], ['o4-', 'openai'],
      ['gemini', 'google'], ['deepseek', 'deepseek'], ['qwen', 'alibaba'], ['qwq', 'alibaba'],
      ['kimi', 'moonshot'], ['moonshot', 'moonshot'], ['glm', 'zhipu'], ['mistral', 'mistral'],
      ['codestral', 'mistral'], ['llama', 'meta'], ['grok', 'xai'], ['doubao', 'bytedance'],
      ['ernie', 'baidu'], ['minimax', 'minimax'], ['step', 'stepfun'], ['nova', 'amazon'],
      ['command', 'cohere'], ['jamba', 'ai21'], ['hy3', 'tencent'], ['hunyuan', 'tencent']
    ]
    function inferVendor(model) {
      if (!model) return 'unknown'
      const m = String(model).toLowerCase()
      const slash = m.indexOf('/')
      const head = slash > 0 ? m.slice(0, slash) : m
      for (let i = 0; i < VENDOR_RULES.length; i++) {
        if (head.indexOf(VENDOR_RULES[i][0]) === 0) return VENDOR_RULES[i][1]
      }
      if (slash > 0) return head
      return 'other'
    }

    // 参考价目表(USD / 1M tokens):i=输入 o=输出 cr=缓存读 cw=缓存写。
    // 仅用于未上报费用的来源做「估算」,与上报费用分列,不混算。
    const PRICING_RULES = [
      { pat: 'claude-opus', i: 15, o: 75, cr: 1.5, cw: 18.75 },
      { pat: 'claude-sonnet', i: 3, o: 15, cr: 0.3, cw: 3.75 },
      { pat: 'claude-haiku', i: 0.8, o: 4, cr: 0.08, cw: 1 },
      { pat: 'claude', i: 3, o: 15, cr: 0.3, cw: 3.75 },
      { pat: 'gpt-5', i: 1.25, o: 10, cr: 0.125, cw: 0 },
      { pat: 'gpt-4', i: 2.5, o: 10, cr: 1.25, cw: 0 },
      { pat: 'gpt-oss', i: 0, o: 0, cr: 0, cw: 0 },
      { pat: 'o3-', i: 10, o: 40, cr: 2.5, cw: 0 },
      { pat: 'o4-', i: 2.5, o: 10, cr: 0.625, cw: 0 },
      { pat: 'gemini-2.5-flash', i: 0.3, o: 2.5, cr: 0.075, cw: 0 },
      { pat: 'gemini-2.5-pro', i: 1.25, o: 10, cr: 0.31, cw: 0 },
      { pat: 'gemini', i: 1.25, o: 10, cr: 0.31, cw: 0 },
      { pat: 'deepseek', i: 0.28, o: 0.42, cr: 0.028, cw: 0.28 },
      { pat: 'kimi', i: 0.6, o: 2.2, cr: 0.1, cw: 0 },
      { pat: 'glm', i: 0.6, o: 2.2, cr: 0.11, cw: 0 },
      { pat: 'qwen', i: 0.4, o: 1.2, cr: 0.08, cw: 0 },
      { pat: 'hy3', i: 0.11, o: 0.55, cr: 0.02, cw: 0 },
      { pat: 'hunyuan', i: 0.11, o: 0.55, cr: 0.02, cw: 0 },
      { pat: 'mistral', i: 0.3, o: 0.8, cr: 0.1, cw: 0 },
      { pat: 'grok', i: 0.5, o: 2, cr: 0.125, cw: 0 },
      { pat: 'llama', i: 0.06, o: 0.08, cr: 0, cw: 0 }
    ]
    let USER_PRICING = null

    async function loadUserPricing() {
      try {
        const out = await runShell('cat "$HOME/.agent-token-stats/pricing.json" 2>/dev/null || true', 30000)
        const text = out.trim()
        if (text === '') { USER_PRICING = null; return }
        const parsed = JSON.parse(text)
        USER_PRICING = parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.rules) ? parsed.rules : null
      } catch (e) {
        USER_PRICING = null
      }
    }

    function estimateCost(model, i, o, cr, cw) {
      if (!model) return 0
      const m = String(model).toLowerCase()
      const tables = USER_PRICING !== null ? [USER_PRICING, PRICING_RULES] : [PRICING_RULES]
      for (let ti = 0; ti < tables.length; ti++) {
        const rules = tables[ti]
        for (let idx = 0; idx < rules.length; idx++) {
          const rule = rules[idx]
          if (rule !== null && typeof rule === 'object' && typeof rule.pat === 'string' && m.indexOf(rule.pat) >= 0) {
            return (num(i) * num(rule.i) + num(o) * num(rule.o) + num(cr) * num(rule.cr) + num(cw) * num(rule.cw)) / 1000000
          }
        }
      }
      return 0
    }

    let BUDGETS = null

    async function loadBudgets() {
      try {
        const out = await runShell('cat "$HOME/.agent-token-stats/config.json" 2>/dev/null || true', 30000)
        const text = out.trim()
        if (text === '') { BUDGETS = null; return }
        const parsed = JSON.parse(text)
        const b = parsed !== null && typeof parsed === 'object' && parsed.budgets !== null && typeof parsed.budgets === 'object' ? parsed.budgets : null
        if (b === null) { BUDGETS = null; return }
        BUDGETS = {
          dailyTokens: num(b.dailyTokens) > 0 ? num(b.dailyTokens) : 0,
          monthlyTokens: num(b.monthlyTokens) > 0 ? num(b.monthlyTokens) : 0,
          dailyCost: num(b.dailyCost) > 0 ? num(b.dailyCost) : 0,
          monthlyCost: num(b.monthlyCost) > 0 ? num(b.monthlyCost) : 0
        }
      } catch (e) {
        BUDGETS = null
      }
    }

    // DSH 0.2.0 renamed shell.run(spec) to shell.execute(spec), which returns a
    // live handle whose result() settles with the foreground ShellRunResult.
    // Support both generations so the bundle works on 0.1.x and 0.2.x hosts.
    async function shellStart(spec) {
      if (typeof shell.execute === 'function') {
        // execute() resolves to a live ShellExecution handle; the foreground
        // ShellRunResult only comes from awaiting its result() projection.
        const exec = await shell.execute(spec)
        if (exec !== null && typeof exec === 'object' && typeof exec.result === 'function') return await exec.result()
        return exec
      }
      if (typeof shell.run === 'function') return shell.run(spec)
      throw new Error('shell service exposes neither execute() nor run()')
    }
    function collectedText(c) {
      if (typeof c === 'string') return c
      if (c !== null && typeof c === 'object' && typeof c.text === 'string') return c.text
      return ''
    }

    // DSH 0.2.0: agentless (plugin) shell calls default to the composition's
    // sandbox-policy row ('workspace-write' rooted at the server cwd), which
    // denies this plugin's ledger writes under ~/.agent-token-stats and puts
    // every read-only log scan through seatbelt confinement for no benefit.
    // The plugin's whole job is machine-wide log reading plus writing its own
    // data directory, so request danger-full-access explicitly. 0.1.x hosts
    // strip/ignore the unknown field; a hard rejection falls back to bare resolve.
    function resolveSpec(request) {
      try {
        return shell.resolve(Object.assign({}, request, {
          sandboxPolicy: {
            mode: 'danger-full-access',
            workspaceRoot: (typeof process !== 'undefined' && process.env && process.env.HOME) || '.'
          }
        }))
      } catch (e) {
        return shell.resolve(request)
      }
    }

    async function runShell(command, timeoutMs) {
      const spec = resolveSpec({
        command: command,
        timeoutMs: timeoutMs === undefined ? 240000 : timeoutMs,
        stdoutMaxBytes: 134217728
      })
      const res = await shellStart(spec)
      const out = collectedText(res && res.stdout)
      if (!res || res.exitCode !== 0) {
        const errText = collectedText(res && res.stderr).slice(0, 300)
        const facts = res === null || res === undefined
          ? '(no result)'
          : 'code=' + String(res.exitCode) + ' signal=' + String(res.signal) + ' timedOut=' + String(res.timedOut) + ' aborted=' + String(res.aborted) + ' effTimeoutMs=' + String(res.timeoutMs) + (res.sandbox ? ' sandbox=' + JSON.stringify(res.sandbox).slice(0, 220) : '')
        throw new Error('shell failed [' + facts + ']' + (errText ? ' stderr: ' + errText : '') + ' cmd<' + String(command).slice(0, 70).replace(/\n/g, ' ') + '>')
      }
      return out
    }

    const SIG_CMD = [
      'echo == claude',
      'find "$HOME/.claude/projects" -type f -name "*.jsonl" 2>/dev/null | wc -l',
      'find "$HOME/.claude/projects" -type f -name "*.jsonl" -exec stat -f "%m" {} + 2>/dev/null | sort -rn | head -1',
      'echo == wpsclaude',
      'find "$HOME/.wps_claude/projects" -type f -name "*.jsonl" 2>/dev/null | wc -l',
      'find "$HOME/.wps_claude/projects" -type f -name "*.jsonl" -exec stat -f "%m" {} + 2>/dev/null | sort -rn | head -1',
      'echo == dsh',
      'find "$HOME/.dsh/sessions" -type f -name "*.jsonl.zstd" 2>/dev/null | wc -l',
      'find "$HOME/.dsh/sessions" -type f -name "*.jsonl.zstd" -exec stat -f "%m" {} + 2>/dev/null | sort -rn | head -1',
      'echo == opencode',
      'stat -f "%m %z" "$HOME/.local/share/opencode/opencode.db" 2>/dev/null || echo none',
      'stat -f "%m %z" "$HOME/.local/share/opencode/opencode.db-wal" 2>/dev/null || echo nowal',
      'echo == claw',
      'find "$HOME/.openclaw" "$HOME/.openclaw-autoclaw" "$HOME/.qclaw" -type f -path "*/agents/*/sessions/*.jsonl" 2>/dev/null | wc -l',
      'find "$HOME/.openclaw" "$HOME/.openclaw-autoclaw" "$HOME/.qclaw" -type f -path "*/agents/*/sessions/*.jsonl" -exec stat -f "%m" {} + 2>/dev/null | sort -rn | head -1',
      'echo == codewhale',
      'find "$HOME/.codewhale/sessions" -maxdepth 1 -type f -name "*.json" 2>/dev/null | wc -l',
      'find "$HOME/.codewhale/sessions" -maxdepth 1 -type f -name "*.json" -exec stat -f "%m" {} + 2>/dev/null | sort -rn | head -1',
      'echo == workbuddy',
      'find "$HOME/.workbuddy" -type f -name "*.jsonl" 2>/dev/null | wc -l',
      'find "$HOME/.workbuddy" -type f -name "*.jsonl" -exec stat -f "%m" {} + 2>/dev/null | sort -rn | head -1',
      'echo == cursor',
      'find "$HOME/.cursor/chats" -type f -name "store.db" 2>/dev/null | wc -l',
      'echo == cursoride',
      'stat -f "%m %z" "$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb" 2>/dev/null || echo none',
      'stat -f "%m %z" "$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb-wal" 2>/dev/null || echo 0',
      'echo == codex',
      'find "$HOME/.codex/sessions" -type f -name "*.jsonl" 2>/dev/null | wc -l',
      'find "$HOME/.codex/sessions" -type f -name "*.jsonl" -exec stat -f "%m" {} + 2>/dev/null | sort -rn | head -1',
      'echo == gemini',
      'find "$HOME/.gemini" -type f \\( -name "*.json" -o -name "*.jsonl" \\) 2>/dev/null | wc -l',
      'find "$HOME/.gemini" -type f \\( -name "*.json" -o -name "*.jsonl" \\) -exec stat -f "%m" {} + 2>/dev/null | sort -rn | head -1',
      'echo == cline',
      'find "$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks" "$HOME/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks" -name "api_conversation_history.json" 2>/dev/null | wc -l',
      'echo == trae',
      'find "$HOME/Library/Application Support/Trae CN/User/workspaceStorage" "$HOME/.trae-cn" "$HOME/.trae-aicc" -type f \\( -name "state.vscdb" -o -name "*.jsonl" \\) 2>/dev/null | wc -l',
      'echo == hermes',
      'find "$HOME/.hermes/sessions" -type f -name "session_*.json" 2>/dev/null | wc -l',
      'echo == ollama',
      'stat -f "%m %z" "$HOME/Library/Application Support/Ollama/db.sqlite" 2>/dev/null || echo none',
      'echo == aionui',
      'stat -f "%m %z" "$HOME/.aionui/aionui-backend.db" 2>/dev/null || echo none',
      'echo == hermesdb',
      'stat -f "%m %z" "$HOME/.hermes/state.db" 2>/dev/null || echo none',
      'stat -f "%m %z" "$HOME/.hermes/state.db-wal" 2>/dev/null || echo 0',
      'echo == lingma',
      'stat -f "%m %z" "$HOME/.lingma/cache/db/local.db" 2>/dev/null || echo none',
      'stat -f "%m %z" "$HOME/.lingma/cache/db/local.db-wal" 2>/dev/null || echo 0',
      'echo == codegeex',
      'stat -f "%m %z" "$HOME/Library/Application Support/Code/User/globalStorage/aminer.codegeex/agent/history.json" 2>/dev/null || echo none',
      'echo == pi',
      'find "$HOME/.pi/agent/sessions" -type f 2>/dev/null | wc -l',
      '[ -f "$HOME/.pi/agent/auth.json" ] && echo installed || echo absent',
      'echo == comate',
      'stat -f "%m %z" "$HOME/.comate/data/globalStorage.json" 2>/dev/null || echo none',
      'echo == copilot',
      'ls -d "$HOME/Library/Application Support/Code/User/globalStorage/github.copilot-chat" 2>/dev/null | wc -l'
    ].join('\n')

    function parseSig(text) {
      const out = {}
      let cur = null
      let vals = []
      const lines = String(text).split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (line.indexOf('== ') === 0) {
          if (cur !== null) out[cur] = vals.join('|')
          cur = line.slice(3).trim()
          vals = []
          continue
        }
        if (cur !== null && line !== '') vals.push(line)
      }
      if (cur !== null) out[cur] = vals.join('|')
      return out
    }
    function sigFirst(sig, name) {
      const raw = sig && sig[name] !== undefined ? String(sig[name]) : ''
      return raw.split('|')[0].trim()
    }
    function sigInt(sig, name) {
      return parseInt(sigFirst(sig, name), 10) || 0
    }

    function ccCmd(rootRel) {
      return `if [ -d "$HOME/${rootRel}" ]; then find "$HOME/${rootRel}" -type f -name "*.jsonl" -exec cat {} + 2>/dev/null | jq -c -R 'fromjson? | select(.type=="assistant") | select(.message.usage != null) | select(.message.model != null and .message.model != "" and .message.model != "<synthetic>") | {t:.timestamp, id:(((.message.id // .uuid) // "?") + "|" + (.timestamp // "?")), m:.message.model, cwd:(.cwd // null), i:((.message.usage.input_tokens) // 0), o:((.message.usage.output_tokens) // 0), cr:((.message.usage.cache_read_input_tokens) // 0), cw:((.message.usage.cache_creation_input_tokens) // 0)}' 2>/dev/null; fi`
    }

    async function collectCC(rootRel, agent) {
      const out = await runShell(ccCmd(rootRel), 240000)
      const seen = new Set()
      const records = []
      let lastAt = 0
      let withTokens = 0
      const lines = out.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line === '') continue
        let d
        try { d = JSON.parse(line) } catch (e) { continue }
        const model = typeof d.m === 'string' ? d.m : ''
        if (model === '') continue
        const idKey = d.id === undefined || d.id === null ? 'row' + i : String(d.id)
        if (seen.has(idKey)) continue
        seen.add(idKey)
        const parsed = typeof d.t === 'string' ? Date.parse(d.t) : NaN
        const ms = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
        const vendor = inferVendor(model)
        const rec = {
          agent: agent,
          provider: vendor,
          vendor: vendor,
          model: model,
          ms: ms,
          day: localDay(ms),
          n: 1,
          i: num(d.i),
          o: num(d.o),
          r: 0,
          cr: num(d.cr),
          cw: num(d.cw),
          tt: 0,
          c: 0,
          project: typeof d.cwd === 'string' && d.cwd !== '' ? d.cwd : '(未知)'
        }
        if (rec.i + rec.o + rec.cr + rec.cw > 0) withTokens++
        if (ms > lastAt) lastAt = ms
        records.push(rec)
      }
      return { records: records, sessions: 0, lastAt: lastAt, withTokens: withTokens }
    }

    const DSH_CMD = `if [ -d "$HOME/.dsh/sessions" ]; then find "$HOME/.dsh/sessions" -type f -name "*.jsonl.zstd" -print0 2>/dev/null | while IFS= read -r -d '' f; do zstd -dc "$f" 2>/dev/null | jq -c -R --arg f "$f" 'fromjson? | if .type=="session" then {k:"s", sid:(.id // null), cwd:(.cwd // null), f:$f} elif .type=="assistant/message" then {k:"m", t:.time, id:(.data.message.id // null), p:(.data.message.source.provider // null), m:(.data.message.source.model // null), i:((.data.usage.inputTokens) // 0), o:((.data.usage.outputTokens) // 0), r:((.data.usage.reasoningTokens) // 0), cr:((.data.usage.cacheReadTokens) // 0), cw:((.data.usage.cacheWriteTokens) // 0), f:$f} else empty end' 2>/dev/null; done; fi`

    async function collectDsh() {
      const out = await runShell(DSH_CMD, 300000)
      const lines = out.split('\n')
      const parsed = []
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') continue
        let d
        try { d = JSON.parse(lines[i]) } catch (e) { continue }
        parsed.push(d)
      }
      const fileCwd = {}
      const sessions = new Set()
      for (let i = 0; i < parsed.length; i++) {
        const d = parsed[i]
        if (d.k !== 's') continue
        if (typeof d.f === 'string') fileCwd[d.f] = typeof d.cwd === 'string' && d.cwd !== '' ? d.cwd : '(未知)'
        if (d.sid !== null && d.sid !== undefined) sessions.add(String(d.sid))
      }
      const seen = new Set()
      const seenFp = new Set()
      const records = []
      let lastAt = 0
      let withTokens = 0
      for (let i = 0; i < parsed.length; i++) {
        const d = parsed[i]
        if (d.k !== 'm') continue
        const model = typeof d.m === 'string' && d.m !== '' ? d.m : 'unknown'
        const idKey = d.id === null || d.id === undefined ? '' : String(d.id)
        if (idKey !== '') {
          if (seen.has(idKey)) continue
          seen.add(idKey)
        }
        const ms = num(d.t)
        const provider = typeof d.p === 'string' && d.p !== '' ? d.p : 'unknown'
        const rec = {
          agent: 'dsh',
          provider: provider,
          vendor: inferVendor(model),
          model: model,
          ms: ms,
          day: localDay(ms),
          n: 1,
          i: num(d.i),
          o: num(d.o),
          r: num(d.r),
          cr: num(d.cr),
          cw: num(d.cw),
          tt: 0,
          c: 0,
          project: typeof d.f === 'string' && fileCwd[d.f] !== undefined ? fileCwd[d.f] : '(未知)'
        }
        if (rec.i + rec.o + rec.cr + rec.cw > 0) {
          // fork/续接会话即使换了消息 ID,时间戳+模型+token 指纹也相同 → 复合去重
          const fp = rec.ms + '|' + model + '|' + rec.i + '|' + rec.o + '|' + rec.cr + '|' + rec.cw
          if (seenFp.has(fp)) continue
          seenFp.add(fp)
          withTokens++
        }
        if (ms > lastAt) lastAt = ms
        records.push(rec)
      }
      return { records: records, sessions: sessions.size, lastAt: lastAt, withTokens: withTokens }
    }

    const OC_TABLES_CMD = `if [ -f "$HOME/.local/share/opencode/opencode.db" ]; then sqlite3 -readonly "$HOME/.local/share/opencode/opencode.db" "SELECT group_concat(name) FROM sqlite_master WHERE type='table' AND name IN ('message','session_message','session','session_v2');" 2>/dev/null; fi`

    // OpenCode 新版把消息存储从 message 迁到 session_message(model.id 嵌套形态),
    // 两表存在迁移重叠(相同 id)。策略:旧表全量 + 新表仅取 time_created 大于旧表
    // 最大值的行,天然免重复;台账棘轮保证与历史入账无缝衔接。
    function ocBuildSql(tables) {
      const hasLegacy = tables.indexOf('message') >= 0
      const hasNew = tables.indexOf('session_message') >= 0
      const legacyPart = "SELECT json_extract(data,'$.providerID') AS p, json_extract(data,'$.modelID') AS m, json_extract(data,'$.path.root') AS cwd, date(time_created/1000,'unixepoch','localtime') AS d, coalesce(json_extract(data,'$.tokens.input'),0) AS i, coalesce(json_extract(data,'$.tokens.output'),0) AS o, coalesce(json_extract(data,'$.tokens.reasoning'),0) AS r, coalesce(json_extract(data,'$.tokens.cache.read'),0) AS cr, coalesce(json_extract(data,'$.tokens.cache.write'),0) AS cw, coalesce(json_extract(data,'$.cost'),0) AS c, time_created AS la FROM message WHERE json_extract(data,'$.role')='assistant'"
      const newPart = "SELECT json_extract(sm.data,'$.model.providerID') AS p, json_extract(sm.data,'$.model.id') AS m, coalesce(sv.directory, so.directory) AS cwd, date(sm.time_created/1000,'unixepoch','localtime') AS d, coalesce(json_extract(sm.data,'$.tokens.input'),0) AS i, coalesce(json_extract(sm.data,'$.tokens.output'),0) AS o, coalesce(json_extract(sm.data,'$.tokens.reasoning'),0) AS r, coalesce(json_extract(sm.data,'$.tokens.cache.read'),0) AS cr, coalesce(json_extract(sm.data,'$.tokens.cache.write'),0) AS cw, coalesce(json_extract(sm.data,'$.cost'),0) AS c, sm.time_created AS la FROM session_message sm LEFT JOIN session_v2 sv ON sv.id = sm.session_id LEFT JOIN session so ON so.id = sm.session_id WHERE sm.type='assistant'"
      let inner = null
      if (hasLegacy) {
        inner = legacyPart
      } else if (hasNew) {
        inner = newPart
      }
      if (inner === null) return null
      return 'SELECT p, m, cwd, d, count(*) AS n, sum(i) AS i, sum(o) AS o, sum(r) AS r, sum(cr) AS cr, sum(cw) AS cw, round(sum(c),6) AS c, max(la) AS la FROM (' + inner + ') GROUP BY 1,2,3,4;'
    }

    async function collectOpencode() {
      const tablesOut = await runShell(OC_TABLES_CMD, 60000)
      const tables = String(tablesOut).trim().split(',')
      const sql = ocBuildSql(tables)
      if (sql === null) return { records: [], sessions: 0, lastAt: 0, withTokens: 0 }
      const out = await runShell(`if [ -f "$HOME/.local/share/opencode/opencode.db" ]; then sqlite3 -readonly -json "$HOME/.local/share/opencode/opencode.db" "${sql}"; fi`, 300000)
      let rows = []
      if (out.trim() !== '') {
        try { rows = JSON.parse(out) } catch (e) { rows = [] }
      }
      if (!Array.isArray(rows)) rows = []
      const records = []
      let lastAt = 0
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (row === null || typeof row !== 'object') continue
        const model = row.m === null || row.m === undefined || row.m === '' ? 'unknown' : String(row.m)
        const provider = row.p === null || row.p === undefined || row.p === '' ? 'unknown' : String(row.p)
        const ms = num(row.la)
        if (ms > lastAt) lastAt = ms
        records.push({
          agent: 'opencode',
          provider: provider,
          vendor: inferVendor(model),
          model: model,
          ms: ms,
          day: typeof row.d === 'string' && row.d !== '' ? row.d : localDay(ms),
          n: num(row.n),
          i: num(row.i),
          o: num(row.o),
          r: num(row.r),
          cr: num(row.cr),
          cw: num(row.cw),
          tt: 0,
          c: num(row.c),
          project: typeof row.cwd === 'string' && row.cwd !== '' ? row.cwd : '(未知)'
        })
      }
      let sessions = 0
      try {
        const sessionTable = tables.indexOf('session_v2') >= 0 ? 'session_v2' : 'session'
        const countOut = await runShell(`sqlite3 -readonly "$HOME/.local/share/opencode/opencode.db" "SELECT count(*) FROM ${sessionTable};" 2>/dev/null || echo 0`, 120000)
        sessions = parseInt(countOut.trim(), 10) || 0
      } catch (e) {
        sessions = 0
      }
      return { records: records, sessions: sessions, lastAt: lastAt, withTokens: records.length }
    }

    function clawCmd(roots) {
      return `for root in ${roots}; do find "$root" -type f -path "*/agents/*/sessions/*.jsonl" 2>/dev/null | while IFS= read -r f; do jq -c -R --arg f "$f" 'fromjson? | if .type=="session" then {k:"s", sid:(.id // null), cwd:(.cwd // null), f:$f} elif (.type=="message" and (.message.role=="assistant") and (.message.usage != null)) then {k:"m", t:(.message.timestamp // null), ts:(.timestamp // null), id:(.id // null), p:(.message.provider // null), m:(.message.model // null), i:((.message.usage.input) // 0), o:((.message.usage.output) // 0), cr:((.message.usage.cacheRead) // 0), cw:((.message.usage.cacheWrite) // 0), c:(((.message.usage.cost // {}).total) // 0), f:$f} else empty end' "$f" 2>/dev/null; done; done`
    }

    async function collectClaw(roots, agent) {
      const out = await runShell(clawCmd(roots), 240000)
      const lines = out.split('\n')
      const parsed = []
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') continue
        let d
        try { d = JSON.parse(lines[i]) } catch (e) { continue }
        parsed.push(d)
      }
      const fileCwd = {}
      const sessions = new Set()
      for (let i = 0; i < parsed.length; i++) {
        const d = parsed[i]
        if (d.k !== 's') continue
        if (typeof d.f === 'string') fileCwd[d.f] = typeof d.cwd === 'string' && d.cwd !== '' ? d.cwd : '(未知)'
        if (d.sid !== null && d.sid !== undefined) sessions.add(String(d.sid))
      }
      const seen = new Set()
      const seenFp = new Set()
      const records = []
      let lastAt = 0
      let withTokens = 0
      for (let i = 0; i < parsed.length; i++) {
        const d = parsed[i]
        if (d.k !== 'm') continue
        const model = typeof d.m === 'string' && d.m !== '' ? d.m : 'unknown'
        if (model === 'gateway-injected') continue
        const idKey = d.id === null || d.id === undefined ? '' : agent + '|' + String(d.id)
        if (idKey !== '') {
          if (seen.has(idKey)) continue
          seen.add(idKey)
        }
        let ms = num(d.t)
        if (!(ms > 0) && typeof d.ts === 'string') {
          const p = Date.parse(d.ts)
          if (Number.isFinite(p)) ms = p
        }
        const provider = typeof d.p === 'string' && d.p !== '' ? d.p : 'unknown'
        const rec = {
          agent: agent,
          provider: provider,
          vendor: inferVendor(model),
          model: model,
          ms: ms,
          day: localDay(ms),
          n: 1,
          i: num(d.i),
          o: num(d.o),
          r: 0,
          cr: num(d.cr),
          cw: num(d.cw),
          tt: 0,
          c: num(d.c),
          project: typeof d.f === 'string' && fileCwd[d.f] !== undefined ? fileCwd[d.f] : '(未知)'
        }
        if (rec.i + rec.o + rec.cr + rec.cw > 0) {
          const fp = agent + '|' + rec.ms + '|' + model + '|' + rec.i + '|' + rec.o + '|' + rec.cr + '|' + rec.cw
          if (seenFp.has(fp)) continue
          seenFp.add(fp)
          withTokens++
        }
        if (ms > lastAt) lastAt = ms
        records.push(rec)
      }
      return { records: records, sessions: sessions.size, lastAt: lastAt, withTokens: withTokens }
    }

    const CW_CMD = `find "$HOME/.codewhale/sessions" -maxdepth 1 -type f -name "*.json" 2>/dev/null | while IFS= read -r f; do jq -c '[.. | objects | select(has("total_tokens") and has("model"))] | .[0] // empty | {id:(.id // null), tt:((.total_tokens) // 0), n:((.message_count) // 0), m:(.model // null), p:(.model_provider_id // .model_provider // null), w:(.workspace // null), u:(.updated_at // .created_at // null), ca:(.created_at // null), c:(((.cost // {}).session_cost_usd) // 0)}' "$f" 2>/dev/null; done`

    async function collectCodewhale() {
      const out = await runShell(CW_CMD, 120000)
      const seen = new Set()
      const records = []
      let lastAt = 0
      let withTokens = 0
      const lines = out.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') continue
        let d
        try { d = JSON.parse(lines[i]) } catch (e) { continue }
        const model = typeof d.m === 'string' && d.m !== '' ? d.m : 'unknown'
        const idKey = d.id === null || d.id === undefined ? 'row' + i : String(d.id)
        if (seen.has(idKey)) continue
        seen.add(idKey)
        const parsedU = typeof d.u === 'string' ? Date.parse(d.u) : NaN
        const ms = Number.isFinite(parsedU) && parsedU > 0 ? parsedU : 0
        const parsedC = typeof d.ca === 'string' ? Date.parse(d.ca) : NaN
        const dayMs = Number.isFinite(parsedC) && parsedC > 0 ? parsedC : ms
        const tt = num(d.tt)
        if (tt > 0) withTokens++
        if (ms > lastAt) lastAt = ms
        records.push({
          agent: 'codewhale',
          provider: typeof d.p === 'string' && d.p !== '' ? d.p : 'unknown',
          vendor: inferVendor(model),
          model: model,
          ms: ms,
          day: localDay(dayMs),
          n: num(d.n),
          i: 0,
          o: 0,
          r: 0,
          cr: 0,
          cw: 0,
          tt: tt,
          c: num(d.c),
          project: typeof d.w === 'string' && d.w !== '' ? d.w : '(未知)'
        })
      }
      return { records: records, sessions: records.length, lastAt: lastAt, withTokens: withTokens }
    }

    const WB_CMD = `find "$HOME/.workbuddy" -type f -name "*.jsonl" 2>/dev/null | while IFS= read -r f; do jq -c -R --arg f "$f" 'fromjson? | select(.type=="message" and .role=="assistant") | (.providerData.usage // .message.usage // null) as $u | select($u != null) | {t:.timestamp, id:(.id // null), m:((.providerData.model) // null), cwd:(.cwd // null), i:(($u.inputTokens // $u.input_tokens) // 0), o:(($u.outputTokens // $u.output_tokens) // 0), r:(($u.reasoningTokens // ([($u.outputTokensDetails // [])[] | (.reasoning_tokens // 0)] | add)) // 0), cr:(($u.cache_read_input_tokens // ([($u.inputTokensDetails // [])[] | (.cached_tokens // 0)] | add)) // 0)}' "$f" 2>/dev/null; done`

    async function collectWorkbuddy() {
      const out = await runShell(WB_CMD, 120000)
      const seen = new Set()
      const records = []
      let lastAt = 0
      let withTokens = 0
      const lines = out.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') continue
        let d
        try { d = JSON.parse(lines[i]) } catch (e) { continue }
        const model = typeof d.m === 'string' && d.m !== '' ? d.m : 'unknown'
        const idKey = d.id === null || d.id === undefined ? 'row' + i : String(d.id)
        if (seen.has(idKey)) continue
        seen.add(idKey)
        const ms = num(d.t)
        const rec = {
          agent: 'workbuddy',
          provider: 'workbuddy',
          vendor: inferVendor(model),
          model: model,
          ms: ms,
          day: localDay(ms),
          n: 1,
          i: num(d.i),
          o: num(d.o),
          r: num(d.r),
          cr: num(d.cr),
          cw: 0,
          tt: 0,
          c: 0,
          project: typeof d.cwd === 'string' && d.cwd !== '' ? d.cwd : '(未知)'
        }
        if (rec.i + rec.o + rec.cr > 0) withTokens++
        if (ms > lastAt) lastAt = ms
        records.push(rec)
      }
      return { records: records, sessions: 0, lastAt: lastAt, withTokens: withTokens }
    }

    const CURSOR_CMD = `DB="$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb"; if [ -f "$DB" ]; then sqlite3 -readonly -json "$DB" "SELECT substr(c.key, 14, 36) AS cid, json_extract(c.value,'$.createdAt') AS ca, json_extract(c.value,'$.modelConfig.modelName') AS mn, json_extract(c.value,'$.usageData') AS ud, coalesce(t.nb,0) AS nb, coalesce(t.ti,0) AS ti, coalesce(t.tok,0) AS tok FROM cursorDiskKV c LEFT JOIN (SELECT substr(key,10,36) AS cid, count(*) AS nb, sum(coalesce(json_extract(value,'$.tokenCount.inputTokens'),0)) AS ti, sum(coalesce(json_extract(value,'$.tokenCount.outputTokens'),0)) AS tok FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' AND (coalesce(json_extract(value,'$.tokenCount.inputTokens'),0)>0 OR coalesce(json_extract(value,'$.tokenCount.outputTokens'),0)>0) GROUP BY 1) t ON substr(c.key,14,36)=t.cid WHERE c.key LIKE 'composerData:%' AND ((json_type(c.value,'$.usageData')='object' AND json_extract(c.value,'$.usageData')<>'{}') OR coalesce(t.ti,0)>0 OR coalesce(t.tok,0)>0);"; fi`

    async function collectCursorIde() {
      const out = await runShell(CURSOR_CMD, 600000)
      let rows = []
      if (out.trim() !== '') {
        try { rows = JSON.parse(out) } catch (e) { rows = [] }
      }
      if (!Array.isArray(rows)) rows = []
      const records = []
      const composers = new Set()
      let lastAt = 0
      let withTokens = 0
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (row === null || typeof row !== 'object') continue
        let ud = row.ud
        if (typeof ud === 'string' && ud !== '') {
          try { ud = JSON.parse(ud) } catch (e) { ud = null }
        }
        if (ud !== null && typeof ud !== 'object') ud = null
        const caMs = num(row.ca)
        const mn = typeof row.mn === 'string' && row.mn !== '' ? row.mn : null
        const day = localDay(caMs)
        const ti = num(row.ti)
        const tok = num(row.tok)
        const nb = num(row.nb)
        if (caMs > lastAt) lastAt = caMs
        if (typeof row.cid === 'string') composers.add(row.cid)
        const slugs = ud !== null ? Object.keys(ud) : []
        if (slugs.length === 0) {
          if (ti <= 0 && tok <= 0) continue
          const model = mn !== null ? mn : 'unknown'
          records.push({
            agent: 'cursor',
            provider: 'cursor',
            vendor: inferVendor(mn !== null ? mn : ''),
            model: model,
            ms: caMs,
            day: day,
            n: nb > 0 ? nb : 1,
            i: ti,
            o: tok,
            r: 0,
            cr: 0,
            cw: 0,
            tt: 0,
            c: 0,
            project: '(Cursor IDE)'
          })
          withTokens++
          continue
        }
        let totalAmount = 0
        for (let si = 0; si < slugs.length; si++) {
          const v = ud[slugs[si]]
          if (v !== null && typeof v === 'object') totalAmount += num(v.amount)
        }
        for (let si = 0; si < slugs.length; si++) {
          const slug = slugs[si]
          const v = ud[slug]
          if (v === null || typeof v !== 'object') continue
          const amount = num(v.amount)
          const cents = num(v.costInCents)
          let shareI = 0
          let shareO = 0
          if (totalAmount > 0) {
            shareI = Math.round(ti * amount / totalAmount)
            shareO = Math.round(tok * amount / totalAmount)
          } else if (si === 0) {
            shareI = ti
            shareO = tok
          }
          if (amount <= 0 && cents <= 0 && shareI <= 0 && shareO <= 0) continue
          let model = slug
          if (slug === 'default') model = mn !== null ? mn + '(default)' : 'default(未记录模型名)'
          const vendorSrc = slug === 'default' && mn !== null ? mn : slug
          const rec = {
            agent: 'cursor',
            provider: 'cursor',
            vendor: inferVendor(vendorSrc),
            model: model,
            ms: caMs,
            day: day,
            n: amount,
            i: shareI,
            o: shareO,
            r: 0,
            cr: 0,
            cw: 0,
            tt: 0,
            c: cents / 100,
            project: '(Cursor IDE)'
          }
          if (rec.i + rec.o > 0) withTokens++
          records.push(rec)
        }
      }
      return { records: records, sessions: composers.size, lastAt: lastAt, withTokens: withTokens }
    }

    const CODEX_CMD = `if [ -d "$HOME/.codex/sessions" ]; then find "$HOME/.codex/sessions" -type f -name "*.jsonl" 2>/dev/null | while IFS= read -r f; do jq -c -R --arg f "$f" 'fromjson? | if .type=="session_meta" then {k:"s", t:((.payload.timestamp) // .timestamp // null), id:((.payload.id) // null), cwd:((.payload.cwd) // null), f:$f} elif .type=="turn_context" then {k:"m", m:((.payload.model) // null), f:$f} elif (.type=="event_msg" and ((.payload.type) // "")=="token_count") then {k:"u", t:(.timestamp // null), u:((.payload.info.total_token_usage) // null), f:$f} else empty end' "$f" 2>/dev/null; done; fi`

    async function collectCodex() {
      const out = await runShell(CODEX_CMD, 240000)
      const lines = out.split('\n')
      const files = new Map()
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') continue
        let d
        try { d = JSON.parse(lines[i]) } catch (e) { continue }
        if (typeof d.f !== 'string') continue
        let st = files.get(d.f)
        if (st === undefined) {
          st = { s: null, m: null, u: null, ut: null, uCount: 0 }
          files.set(d.f, st)
        }
        if (d.k === 's') {
          if (st.s === null) st.s = d
        } else if (d.k === 'm') {
          if (typeof d.m === 'string' && d.m !== '') st.m = d.m
        } else if (d.k === 'u') {
          st.uCount++
          if (d.u !== null && typeof d.u === 'object') {
            st.u = d.u
            if (typeof d.t === 'string') st.ut = d.t
          }
        }
      }
      const records = []
      let lastAt = 0
      let withTokens = 0
      files.forEach(function (st) {
        if (st.u === null) return
        const u = st.u
        const totalIn = num(u.input_tokens)
        const cached = num(u.cached_input_tokens)
        const outTok = num(u.output_tokens)
        const reason = num(u.reasoning_output_tokens)
        let ms = 0
        if (st.s !== null && typeof st.s.t === 'string') {
          const p = Date.parse(st.s.t)
          if (Number.isFinite(p) && p > 0) ms = p
        }
        if (!(ms > 0) && typeof st.ut === 'string') {
          const p = Date.parse(st.ut)
          if (Number.isFinite(p) && p > 0) ms = p
        }
        const model = st.m !== null && st.m !== '' ? st.m : 'unknown'
        if (ms > lastAt) lastAt = ms
        if (totalIn + cached + outTok > 0) withTokens++
        records.push({
          agent: 'codex',
          provider: 'openai',
          vendor: inferVendor(model),
          model: model,
          ms: ms,
          day: localDay(ms),
          n: st.uCount > 0 ? st.uCount : 1,
          i: Math.max(0, totalIn - cached),
          o: Math.max(0, outTok - reason),
          r: reason,
          cr: cached,
          cw: 0,
          tt: 0,
          c: 0,
          project: st.s !== null && typeof st.s.cwd === 'string' && st.s.cwd !== '' ? st.s.cwd : '(未知)'
        })
      })
      return { records: records, sessions: records.length, lastAt: lastAt, withTokens: withTokens }
    }

    const GEMINI_CMD = `if [ -d "$HOME/.gemini" ]; then find "$HOME/.gemini" -type f \\( -name "*.json" -o -name "*.jsonl" \\) -size -20M 2>/dev/null | while IFS= read -r f; do mt=$(stat -f "%m" "$f" 2>/dev/null || echo 0); jq -c --arg mt "$mt" '.. | objects | select(has("usageMetadata") or (has("tokens") and ((.tokens | type)=="object"))) | {um:(.usageMetadata // null), tk:(.tokens // null), m:((.model // .modelId // .modelName // null)), t:((.timestamp // null)), mt:$mt}' "$f" 2>/dev/null; done; fi`

    async function collectGemini() {
      const out = await runShell(GEMINI_CMD, 240000)
      const seenFp = new Set()
      const records = []
      let lastAt = 0
      let withTokens = 0
      const lines = out.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') continue
        let d
        try { d = JSON.parse(lines[i]) } catch (e) { continue }
        let ti = 0
        let to = 0
        let tr = 0
        let tcr = 0
        if (d.um !== null && typeof d.um === 'object') {
          const cached = num(d.um.cachedContentTokenCount)
          ti = Math.max(0, num(d.um.promptTokenCount) - cached)
          tcr = cached
          to = num(d.um.candidatesTokenCount)
          tr = num(d.um.thoughtsTokenCount)
        } else if (d.tk !== null && typeof d.tk === 'object') {
          ti = num(d.tk.input !== undefined ? d.tk.input : d.tk.inputTokens)
          to = num(d.tk.output !== undefined ? d.tk.output : d.tk.outputTokens)
          tcr = num(d.tk.cached !== undefined ? d.tk.cached : d.tk.cacheRead)
          tr = num(d.tk.reasoning)
        }
        if (ti + to + tr + tcr <= 0) continue
        let ms = 0
        if (typeof d.t === 'string') {
          const p = Date.parse(d.t)
          if (Number.isFinite(p) && p > 0) ms = p
        } else if (typeof d.t === 'number' && d.t > 0) {
          ms = d.t < 100000000000 ? d.t * 1000 : d.t
        }
        if (!(ms > 0)) ms = num(d.mt) * 1000
        const model = typeof d.m === 'string' && d.m !== '' ? d.m : 'unknown'
        const fp = ms + '|' + model + '|' + ti + '|' + to + '|' + tcr + '|' + tr
        if (seenFp.has(fp)) continue
        seenFp.add(fp)
        withTokens++
        if (ms > lastAt) lastAt = ms
        records.push({
          agent: 'gemini',
          provider: 'google',
          vendor: inferVendor(model),
          model: model,
          ms: ms,
          day: localDay(ms),
          n: 1,
          i: ti,
          o: to,
          r: tr,
          cr: tcr,
          cw: 0,
          tt: 0,
          c: 0,
          project: '(Gemini CLI)'
        })
      }
      return { records: records, sessions: 0, lastAt: lastAt, withTokens: withTokens }
    }

    const CLINE_CMD = `for base in "$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks" "$HOME/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks"; do if [ -d "$base" ]; then find "$base" -name "api_conversation_history.json" 2>/dev/null; fi; done | while IFS= read -r f; do mt=$(stat -f "%m" "$f" 2>/dev/null || echo 0); jq -c --arg f "$f" --arg mt "$mt" '.[]? | select((.role // "")=="assistant") | select(.message.usage != null) | {id:((.message.id) // null), m:((.message.model) // null), i:((.message.usage.input_tokens) // 0), o:((.message.usage.output_tokens) // 0), r:0, cr:((.message.usage.cache_read_input_tokens) // 0), cw:((.message.usage.cache_creation_input_tokens) // 0), mt:$mt}' "$f" 2>/dev/null; done`

    async function collectCline() {
      const out = await runShell(CLINE_CMD, 240000)
      const seen = new Set()
      const seenFp = new Set()
      const records = []
      let lastAt = 0
      let withTokens = 0
      const lines = out.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') continue
        let d
        try { d = JSON.parse(lines[i]) } catch (e) { continue }
        const model = typeof d.m === 'string' && d.m !== '' ? d.m : 'unknown'
        const idKey = d.id === null || d.id === undefined ? '' : String(d.id)
        if (idKey !== '') {
          if (seen.has(idKey)) continue
          seen.add(idKey)
        }
        const ms = num(d.mt) * 1000
        const rec = {
          agent: 'cline',
          provider: inferVendor(model),
          vendor: inferVendor(model),
          model: model,
          ms: ms,
          day: localDay(ms),
          n: 1,
          i: num(d.i),
          o: num(d.o),
          r: 0,
          cr: num(d.cr),
          cw: num(d.cw),
          tt: 0,
          c: 0,
          project: '(Cline/Roo)'
        }
        if (rec.i + rec.o + rec.cr + rec.cw > 0) {
          const fp = rec.ms + '|' + model + '|' + rec.i + '|' + rec.o + '|' + rec.cr + '|' + rec.cw
          if (seenFp.has(fp)) continue
          seenFp.add(fp)
          withTokens++
        }
        if (ms > lastAt) lastAt = ms
        records.push(rec)
      }
      return { records: records, sessions: 0, lastAt: lastAt, withTokens: withTokens }
    }

    const HERMES_CMD = `if [ -f "$HOME/.hermes/state.db" ]; then sqlite3 -readonly -json "$HOME/.hermes/state.db" "SELECT s.id AS id, s.model AS m, s.billing_provider AS bp, s.started_at AS st, coalesce(s.input_tokens,0) AS i, coalesce(s.output_tokens,0) AS o, coalesce(s.reasoning_tokens,0) AS r, coalesce(s.cache_read_tokens,0) AS cr, coalesce(s.cache_write_tokens,0) AS cw, (SELECT count(*) FROM messages mm WHERE mm.session_id=s.id AND mm.role='assistant') AS na FROM sessions s;"; fi`

    async function collectHermes() {
      const out = await runShell(HERMES_CMD, 120000)
      let rows = []
      if (out.trim() !== '') {
        try { rows = JSON.parse(out) } catch (e) { rows = [] }
      }
      if (!Array.isArray(rows)) rows = []
      const records = []
      let lastAt = 0
      let withTokens = 0
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (row === null || typeof row !== 'object') continue
        const model = row.m !== null && row.m !== undefined && row.m !== '' ? String(row.m) : 'unknown'
        const ms = num(row.st) > 0 ? num(row.st) * 1000 : 0
        const ii = num(row.i)
        const oo = num(row.o)
        const rr = num(row.r)
        const cr = num(row.cr)
        const cw = num(row.cw)
        if (ii + oo + rr + cr + cw > 0) withTokens++
        if (ms > lastAt) lastAt = ms
        const na = num(row.na)
        records.push({
          agent: 'hermes',
          provider: row.bp !== null && row.bp !== undefined && row.bp !== '' ? String(row.bp) : inferVendor(model),
          vendor: inferVendor(model),
          model: model,
          ms: ms,
          day: localDay(ms),
          n: na > 0 ? na : 1,
          i: ii,
          o: oo,
          r: rr,
          cr: cr,
          cw: cw,
          tt: 0,
          c: 0,
          project: '(Hermes Agent)'
        })
      }
      return { records: records, sessions: records.length, lastAt: lastAt, withTokens: withTokens }
    }

    const LINGMA_CMD = `if [ -f "$HOME/.lingma/cache/db/local.db" ]; then sqlite3 -readonly -json "$HOME/.lingma/cache/db/local.db" "SELECT (SELECT count(*) FROM chat_session) AS ns, (SELECT count(*) FROM chat_record) AS nr, (SELECT max(gmt_create) FROM chat_record) AS la, (SELECT max(gmt_create) FROM chat_session) AS ls;"; fi`

    async function collectLingma() {
      const out = await runShell(LINGMA_CMD, 120000)
      let rows = []
      if (out.trim() !== '') {
        try { rows = JSON.parse(out) } catch (e) { rows = [] }
      }
      const row = Array.isArray(rows) && rows.length > 0 && rows[0] !== null && typeof rows[0] === 'object' ? rows[0] : null
      const ns = row !== null ? num(row.ns) : 0
      const nr = row !== null ? num(row.nr) : 0
      let la = row !== null ? Math.max(num(row.la), num(row.ls)) : 0
      if (la > 0 && la < 100000000000) la = la * 1000
      return { records: [], sessions: ns, requests: nr, lastAt: la, withTokens: 0 }
    }

    const PI_CMD = `if [ -d "$HOME/.pi/agent/sessions" ]; then find "$HOME/.pi/agent/sessions" -type f -name "*.jsonl" 2>/dev/null | while IFS= read -r f; do jq -c -R --arg f "$f" 'fromjson? | (.message // .) as $m | select(($m.role // "")=="assistant") | ($m.usage // .usage // null) as $u | select($u != null) | {t:((.timestamp // $m.timestamp) // null), id:((.id // $m.id) // null), m:(($m.model) // null), i:(($u.input // $u.inputTokens // $u.input_tokens // $u.promptTokens) // 0), o:(($u.output // $u.outputTokens // $u.output_tokens // $u.completionTokens) // 0), cr:(($u.cacheRead // $u.cache_read // $u.cacheReadTokens) // 0), cw:(($u.cacheWrite // $u.cache_write // $u.cacheWriteTokens) // 0)}' "$f" 2>/dev/null; done; fi`

    async function collectPi() {
      const out = await runShell(PI_CMD, 120000)
      const seen = new Set()
      const seenFp = new Set()
      const records = []
      let lastAt = 0
      let withTokens = 0
      const lines = out.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') continue
        let d
        try { d = JSON.parse(lines[i]) } catch (e) { continue }
        const model = typeof d.m === 'string' && d.m !== '' ? d.m : 'unknown'
        const idKey = d.id === null || d.id === undefined ? '' : String(d.id)
        if (idKey !== '') {
          if (seen.has(idKey)) continue
          seen.add(idKey)
        }
        let ms = 0
        if (typeof d.t === 'string') {
          const pp = Date.parse(d.t)
          if (Number.isFinite(pp) && pp > 0) ms = pp
        } else if (typeof d.t === 'number' && d.t > 0) {
          ms = d.t < 100000000000 ? d.t * 1000 : d.t
        }
        const rec = {
          agent: 'pi',
          provider: inferVendor(model),
          vendor: inferVendor(model),
          model: model,
          ms: ms,
          day: localDay(ms),
          n: 1,
          i: num(d.i),
          o: num(d.o),
          r: 0,
          cr: num(d.cr),
          cw: num(d.cw),
          tt: 0,
          c: 0,
          project: '(Pi)'
        }
        if (rec.i + rec.o + rec.cr + rec.cw > 0) {
          const fp = rec.ms + '|' + model + '|' + rec.i + '|' + rec.o + '|' + rec.cr + '|' + rec.cw
          if (seenFp.has(fp)) continue
          seenFp.add(fp)
          withTokens++
        }
        if (ms > lastAt) lastAt = ms
        records.push(rec)
      }
      return { records: records, sessions: 0, lastAt: lastAt, withTokens: withTokens }
    }

    function aggregateRows(records) {
      const map = new Map()
      for (let i = 0; i < records.length; i++) {
        const rec = records[i]
        const key = rec.agent + '\u0001' + rec.provider + '\u0001' + rec.vendor + '\u0001' + rec.model + '\u0001' + rec.day
        let row = map.get(key)
        if (row === undefined) {
          row = { a: rec.agent, p: rec.provider, v: rec.vendor, m: rec.model, d: rec.day, n: 0, i: 0, o: 0, r: 0, cr: 0, cw: 0, tt: 0, c: 0 }
          map.set(key, row)
        }
        row.n += rec.n
        row.i += rec.i
        row.o += rec.o
        row.r += rec.r
        row.cr += rec.cr
        row.cw += rec.cw
        row.tt += rec.tt
        row.c += rec.c
      }
      const out = []
      map.forEach(function (v) {
        v.c = Math.round(v.c * 1000000) / 1000000
        out.push(v)
      })
      out.sort(function (x, y) {
        return (y.i + y.o + y.r + y.cr + y.cw + y.tt) - (x.i + x.o + x.r + x.cr + x.cw + x.tt)
      })
      return out
    }

    function aggregateProjects(records) {
      const map = new Map()
      for (let i = 0; i < records.length; i++) {
        const rec = records[i]
        const key = rec.agent + '\u0001' + rec.project
        let e = map.get(key)
        if (e === undefined) {
          e = { a: rec.agent, name: rec.project, n: 0, total: 0, lastAt: 0 }
          map.set(key, e)
        }
        e.n += rec.n
        e.total += rec.i + rec.o + rec.r + rec.cr + rec.cw + rec.tt
        if (rec.ms > e.lastAt) e.lastAt = rec.ms
      }
      const out = []
      map.forEach(function (v) { out.push(v) })
      out.sort(function (a, b) { return b.total - a.total })
      return out.slice(0, 500)
    }

    function sourceEntry(id, label, status, detail, files, records, sessions, lastActivityAt, error) {
      return {
        id: id,
        label: label,
        status: status,
        detail: detail,
        files: files,
        records: records,
        sessions: sessions,
        lastActivityAt: lastActivityAt,
        error: error === undefined ? null : String(error).slice(0, 400)
      }
    }

    function parsedSource(id, label, part, filesCount, zeroNote) {
      if (part === undefined) {
        return sourceEntry(id, label, filesCount > 0 ? 'pending' : 'missing', filesCount + ' 个文件', filesCount, 0, 0, 0)
      }
      if (part.error !== null && part.error !== undefined) {
        return sourceEntry(id, label, 'error', '解析失败', filesCount, 0, 0, 0, part.error)
      }
      if (filesCount === 0) {
        return sourceEntry(id, label, 'missing', '未找到本地记录', 0, 0, 0, 0)
      }
      const d = part.data
      let detail = filesCount + ' 个文件 · ' + d.records.length + ' 条模型响应'
      if (d.sessions > 0) detail = filesCount + ' 个文件 · ' + d.sessions + ' 个会话 · ' + d.records.length + ' 条响应'
      const zero = d.records.length - d.withTokens
      if (zeroNote && zero > 0) detail += ' · ' + zero + ' ' + zeroNote
      return sourceEntry(id, label, 'ok', detail, filesCount, d.records.length, d.sessions, d.lastAt)
    }

    const ROW_FIELDS = ['n', 'i', 'o', 'r', 'cr', 'cw', 'tt', 'c']

    function emptyLedger() {
      return { version: 1, updatedAt: 0, rows: {}, projects: {}, sources: {} }
    }

    async function loadLedger() {
      try {
        const out = await runShell('cat "$HOME/.agent-token-stats/ledger.json" 2>/dev/null || true', 30000)
        const text = out.trim()
        if (text === '') return emptyLedger()
        const parsed = JSON.parse(text)
        if (parsed === null || typeof parsed !== 'object') return emptyLedger()
        return {
          version: 1,
          updatedAt: num(parsed.updatedAt),
          rows: parsed.rows !== null && typeof parsed.rows === 'object' ? parsed.rows : {},
          projects: parsed.projects !== null && typeof parsed.projects === 'object' ? parsed.projects : {},
          sources: parsed.sources !== null && typeof parsed.sources === 'object' ? parsed.sources : {}
        }
      } catch (e) {
        return emptyLedger()
      }
    }

    async function saveLedger(ledger) {
      ledger.updatedAt = Date.now()
      const json = JSON.stringify(ledger)
      const cmd = 'mkdir -p "$HOME/.agent-token-stats" && cat > "$HOME/.agent-token-stats/ledger.json.tmp" && mv "$HOME/.agent-token-stats/ledger.json.tmp" "$HOME/.agent-token-stats/ledger.json"'
      const spec = resolveSpec({ command: cmd, timeoutMs: 60000, stdin: json })
      const res = await shellStart(spec)
      if (!res || res.exitCode !== 0) {
        const saveErr = collectedText(res && res.stderr).slice(0, 200)
        throw new Error('ledger save failed [code=' + (res ? String(res.exitCode) : '?') + ' signal=' + (res ? String(res.signal) : '?') + ']' + (saveErr ? ' stderr: ' + saveErr : ''))
      }
    }

    function mergeRows(ledger, scanRows) {
      for (let idx = 0; idx < scanRows.length; idx++) {
        const r = scanRows[idx]
        const key = r.a + '\u0001' + r.p + '\u0001' + r.v + '\u0001' + r.m + '\u0001' + r.d
        let e = ledger.rows[key]
        if (e === undefined) {
          e = { a: r.a, p: r.p, v: r.v, m: r.m, d: r.d }
          for (let fi = 0; fi < ROW_FIELDS.length; fi++) {
            const f = ROW_FIELDS[fi]
            e[f] = 0
            e['l' + f] = 0
          }
          ledger.rows[key] = e
        }
        for (let fi = 0; fi < ROW_FIELDS.length; fi++) {
          const f = ROW_FIELDS[fi]
          const scanned = num(r[f])
          const last = num(e['l' + f])
          const delta = scanned - last
          if (delta > 0) e[f] = num(e[f]) + delta
          e['l' + f] = scanned
        }
      }
    }

    function mergeProjects(ledger, scanProjects) {
      for (let idx = 0; idx < scanProjects.length; idx++) {
        const p = scanProjects[idx]
        const key = p.a + '\u0001' + p.name
        let e = ledger.projects[key]
        if (e === undefined) {
          e = { a: p.a, name: p.name, n: 0, total: 0, lastAt: 0, ln: 0, ltotal: 0 }
          ledger.projects[key] = e
        }
        const dn = num(p.n) - num(e.ln)
        if (dn > 0) e.n = num(e.n) + dn
        e.ln = num(p.n)
        const dt = num(p.total) - num(e.ltotal)
        if (dt > 0) e.total = num(e.total) + dt
        e.ltotal = num(p.total)
        if (num(p.lastAt) > num(e.lastAt)) e.lastAt = num(p.lastAt)
      }
    }

    function mergeSources(ledger, sources) {
      for (let idx = 0; idx < sources.length; idx++) {
        const s = sources[idx]
        let e = ledger.sources[s.id]
        if (e === undefined) {
          e = { records: 0, sessions: 0, files: 0, lastActivityAt: 0, everOk: false }
          ledger.sources[s.id] = e
        }
        if (num(s.records) > num(e.records)) e.records = num(s.records)
        if (num(s.sessions) > num(e.sessions)) e.sessions = num(s.sessions)
        if (num(s.files) > num(e.files)) e.files = num(s.files)
        if (num(s.lastActivityAt) > num(e.lastActivityAt)) e.lastActivityAt = num(s.lastActivityAt)
        if (s.status === 'ok') e.everOk = true
      }
    }

    function ledgerRows(ledger) {
      const out = []
      const keys = Object.keys(ledger.rows)
      for (let idx = 0; idx < keys.length; idx++) {
        const e = ledger.rows[keys[idx]]
        const ri = num(e.i)
        const ro = num(e.o)
        const rr = num(e.r)
        const rcr = num(e.cr)
        const rcw = num(e.cw)
        const c = Math.round(num(e.c) * 1000000) / 1000000
        const ec = c > 0 ? 0 : Math.round(estimateCost(e.m, ri, ro, rcr, rcw) * 1000000) / 1000000
        out.push({
          a: e.a,
          p: e.p,
          v: e.v,
          m: e.m,
          d: e.d,
          n: num(e.n),
          i: ri,
          o: ro,
          r: rr,
          cr: rcr,
          cw: rcw,
          tt: num(e.tt),
          c: c,
          ec: ec
        })
      }
      out.sort(function (x, y) {
        return (y.i + y.o + y.r + y.cr + y.cw + y.tt) - (x.i + x.o + x.r + x.cr + x.cw + x.tt)
      })
      return out.slice(0, 5000)
    }

    function ledgerProjects(ledger) {
      const out = []
      const keys = Object.keys(ledger.projects)
      for (let idx = 0; idx < keys.length; idx++) {
        const e = ledger.projects[keys[idx]]
        out.push({ a: e.a, name: e.name, n: num(e.n), total: num(e.total), lastAt: num(e.lastAt) })
      }
      out.sort(function (a, b) { return b.total - a.total })
      return out.slice(0, 40)
    }

    function csvCell(v) {
      const s = String(v === null || v === undefined ? '' : v)
      if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
        return '"' + s.replace(/"/g, '""') + '"'
      }
      return s
    }

    const state = { sig: {}, parts: {}, result: null, inflight: null, ledger: null }

    async function build(force) {
      let sigText = ''
      try {
        sigText = await runShell(SIG_CMD, 120000)
      } catch (e1) {
        try {
          sigText = await runShell(SIG_CMD, 120000)
        } catch (e2) {
          console.error('agent-token-stats signature scan failed, degrading to full collect: ' + String((e2 && e2.message) || e2))
          sigText = ''
        }
      }
      const sig = parseSig(sigText)
      const prev = state.sig || {}
      const parts = state.parts
      await loadUserPricing()
      await loadBudgets()

      const ocMissing = sig.opencode === undefined || String(sig.opencode).indexOf('none') === 0
      const cursorIdeMissing = sig.cursoride === undefined || String(sig.cursoride).indexOf('none') === 0

      const claudeFiles = sigInt(sig, 'claude')
      const wpsFiles = sigInt(sig, 'wpsclaude')
      const dshFiles = sigInt(sig, 'dsh')
      const clawFiles = sigInt(sig, 'claw')
      const cwFiles = sigInt(sig, 'codewhale')
      const wbFiles = sigInt(sig, 'workbuddy')
      const cursorChats = sigInt(sig, 'cursor')
      const codexFiles = sigInt(sig, 'codex')
      const geminiFiles = sigInt(sig, 'gemini')
      const clineFiles = sigInt(sig, 'cline')
      const traeFiles = sigInt(sig, 'trae')
      const hermesFiles = sigInt(sig, 'hermes')
      const ollamaDb = sig.olama !== undefined && String(sig.olama).indexOf('none') !== 0
      const aionuiDb = sig.aionui !== undefined && String(sig.aionui).indexOf('none') !== 0
      const copilotDir = sigInt(sig, 'copilot') > 0
      const hermesDbExists = sig.hermesdb !== undefined && String(sig.hermesdb).indexOf('none') === -1
      const lingmaDbExists = sig.lingma !== undefined && String(sig.lingma).indexOf('none') === -1
      const codegeexExists = sig.codegeex !== undefined && String(sig.codegeex).indexOf('none') === -1
      const piFiles = sigInt(sig, 'pi')
      const piInstalled = String(sig.pi === undefined ? '' : sig.pi).split('|')[1] === 'installed'
      const comateExists = sig.comate !== undefined && String(sig.comate).indexOf('none') === -1

      const need = function (name, sigKey) {
        return force === true || parts[name] === undefined || prev[sigKey] !== sig[sigKey]
      }

      function guard(promise) {
        return promise.then(
          function (data) { return { data: data, error: null } },
          function (e) { return { data: null, error: String((e && e.message) || e) } }
        )
      }

      const jobs = [
        ['claude', need('claude', 'claude') ? guard(collectCC('.claude/projects', 'claude-code')) : null],
        ['wpsclaude', need('wpsclaude', 'wpsclaude') ? guard(collectCC('.wps_claude/projects', 'wps-claude')) : null],
        ['dsh', need('dsh', 'dsh') ? guard(collectDsh()) : null],
        ['opencode', !ocMissing && need('opencode', 'opencode') ? guard(collectOpencode()) : null],
        ['clawOpen', need('clawOpen', 'claw') ? guard(collectClaw('"$HOME/.openclaw" "$HOME/.openclaw-autoclaw"', 'openclaw')) : null],
        ['clawQ', need('clawQ', 'claw') ? guard(collectClaw('"$HOME/.qclaw"', 'qclaw')) : null],
        ['codewhale', need('codewhale', 'codewhale') ? guard(collectCodewhale()) : null],
        ['workbuddy', need('workbuddy', 'workbuddy') ? guard(collectWorkbuddy()) : null],
        ['cursoride', !cursorIdeMissing && need('cursoride', 'cursoride') ? guard(collectCursorIde()) : null],
        ['codex', codexFiles > 0 && need('codex', 'codex') ? guard(collectCodex()) : null],
        ['gemini', geminiFiles > 0 && need('gemini', 'gemini') ? guard(collectGemini()) : null],
        ['cline', clineFiles > 0 && need('cline', 'cline') ? guard(collectCline()) : null],
        ['hermes', hermesDbExists && need('hermes', 'hermesdb') ? guard(collectHermes()) : null],
        ['lingma', lingmaDbExists && need('lingma', 'lingma') ? guard(collectLingma()) : null],
        ['pi', piFiles > 0 && need('pi', 'pi') ? guard(collectPi()) : null]
      ]
      const results = await Promise.all(jobs.map(function (j) { return j[1] === null ? Promise.resolve(null) : j[1] }))
      for (let i = 0; i < jobs.length; i++) {
        if (results[i] === null) continue
        parts[jobs[i][0]] = results[i]
      }
      state.sig = sig

      const sources = []
      let all = []
      function take(part) {
        if (part !== undefined && part.error === null && part.data !== null && part.data !== undefined) {
          all = all.concat(part.data.records)
        }
      }

      const ccEntry = parsedSource('claude-code', 'Claude Code', parts.claude, claudeFiles, '条未上报 token(本地网关)')
      if (claudeFiles > 0) {
        try {
          const settingsOut = await runShell('cat "$HOME/.claude/settings.json" 2>/dev/null || true', 30000)
          const stText = settingsOut.trim()
          let days = null
          if (stText !== '') {
            try {
              const sj = JSON.parse(stText)
              if (sj !== null && typeof sj === 'object' && typeof sj.cleanupPeriodDays === 'number') days = sj.cleanupPeriodDays
            } catch (e) {
              days = null
            }
          }
          if (days === null) ccEntry.detail += ' · ⚠ 未设置 cleanupPeriodDays:Claude Code 默认约 30 天自动删除本地会话日志(台账聚合已留存,原始日志会消失),建议加 "cleanupPeriodDays": 3655'
          else if (days < 365) ccEntry.detail += ' · ⚠ cleanupPeriodDays=' + days + ' 天,原始日志滚动删除中(台账聚合不受影响)'
        } catch (e) {
          // 忽略:仅提示性质
        }
      }
      sources.push(ccEntry)
      take(parts.claude)
      sources.push(parsedSource('wps-claude', 'WPS Claude', parts.wpsclaude, wpsFiles, '条零 token'))
      take(parts.wpsclaude)
      if (ocMissing) {
        sources.push(sourceEntry('opencode', 'OpenCode', 'missing', '未找到 opencode.db', 0, 0, 0, 0))
      } else if (parts.opencode === undefined) {
        sources.push(sourceEntry('opencode', 'OpenCode', 'pending', '等待解析', 1, 0, 0, 0))
      } else if (parts.opencode.error !== null && parts.opencode.error !== undefined) {
        sources.push(sourceEntry('opencode', 'OpenCode', 'error', '查询失败', 1, 0, 0, 0, parts.opencode.error))
      } else {
        const d = parts.opencode.data
        sources.push(sourceEntry('opencode', 'OpenCode', 'ok', d.sessions + ' 个会话 · ' + d.records.length + ' 个聚合行', 1, d.records.length, d.sessions, d.lastAt))
        all = all.concat(d.records)
      }
      if (parts.dsh === undefined) {
        sources.push(sourceEntry('dsh', 'DSH(本 harness)', dshFiles > 0 ? 'pending' : 'missing', dshFiles + ' 个会话文件', dshFiles, 0, 0, 0))
      } else if (parts.dsh.error !== null && parts.dsh.error !== undefined) {
        sources.push(sourceEntry('dsh', 'DSH(本 harness)', 'error', '解析失败', dshFiles, 0, 0, 0, parts.dsh.error))
      } else {
        const d = parts.dsh.data
        sources.push(sourceEntry('dsh', 'DSH(本 harness)', dshFiles === 0 ? 'missing' : 'ok', dshFiles + ' 个文件 · ' + d.sessions + ' 个会话 · ' + d.records.length + ' 条模型响应', dshFiles, d.records.length, d.sessions, d.lastAt))
        all = all.concat(d.records)
      }
      sources.push(parsedSource('openclaw', 'OpenClaw(含 autoclaw)', parts.clawOpen, clawFiles, '条零 token'))
      take(parts.clawOpen)
      sources.push(parsedSource('qclaw', 'QClaw', parts.clawQ, clawFiles, '条零 token'))
      take(parts.clawQ)
      if (parts.codewhale === undefined) {
        sources.push(sourceEntry('codewhale', 'CodeWhale', cwFiles > 0 ? 'pending' : 'missing', cwFiles + ' 个会话摘要', cwFiles, 0, 0, 0))
      } else if (parts.codewhale.error !== null && parts.codewhale.error !== undefined) {
        sources.push(sourceEntry('codewhale', 'CodeWhale', 'error', '解析失败', cwFiles, 0, 0, 0, parts.codewhale.error))
      } else {
        const d = parts.codewhale.data
        sources.push(sourceEntry('codewhale', 'CodeWhale', cwFiles === 0 ? 'missing' : 'ok', d.records.length + ' 个会话摘要 · 仅会话级总量(无输入/输出/缓存拆分)', cwFiles, d.records.length, d.sessions, d.lastAt))
        all = all.concat(d.records)
      }
      sources.push(parsedSource('workbuddy', 'WorkBuddy', parts.workbuddy, wbFiles, '条零 token'))
      take(parts.workbuddy)

      if (cursorIdeMissing) {
        sources.push(sourceEntry('cursor', 'Cursor', cursorChats > 0 ? 'no-data' : 'missing', cursorChats > 0 ? cursorChats + ' 个 CLI 对话库 · 无 token 用量' : '未找到本地对话记录', cursorChats, 0, 0, 0))
      } else if (parts.cursoride === undefined) {
        sources.push(sourceEntry('cursor', 'Cursor(IDE)', 'pending', '等待解析(库较大,首扫约 2 分钟)', 1, 0, 0, 0))
      } else if (parts.cursoride.error !== null && parts.cursoride.error !== undefined) {
        sources.push(sourceEntry('cursor', 'Cursor(IDE)', 'error', '查询失败', 1, 0, 0, 0, parts.cursoride.error))
      } else {
        const d = parts.cursoride.data
        let detail = d.sessions + ' 个 IDE 会话 · 请求数/换算费用 + 真实 token 明细(' + d.withTokens + ' 个会话有记录)'
        if (cursorChats > 0) detail += ' · 另 ' + cursorChats + ' 个 CLI 库无用量'
        sources.push(sourceEntry('cursor', 'Cursor(IDE)', 'ok', detail, 1, d.records.length, d.sessions, d.lastAt))
        all = all.concat(d.records)
      }

      if (codexFiles === 0) {
        sources.push(sourceEntry('codex', 'Codex CLI', 'missing', '未找到 ~/.codex/sessions(产生会话后自动接入)', 0, 0, 0, 0))
      } else if (parts.codex === undefined) {
        sources.push(sourceEntry('codex', 'Codex CLI', 'pending', codexFiles + ' 个会话文件', codexFiles, 0, 0, 0))
      } else if (parts.codex.error !== null && parts.codex.error !== undefined) {
        sources.push(sourceEntry('codex', 'Codex CLI', 'error', '解析失败', codexFiles, 0, 0, 0, parts.codex.error))
      } else {
        const d = parts.codex.data
        sources.push(sourceEntry('codex', 'Codex CLI', 'ok', codexFiles + ' 个会话 · 会话级累计用量(token_count 快照,按会话起始日归属)', codexFiles, d.records.length, d.sessions, d.lastAt))
        all = all.concat(d.records)
      }

      if (geminiFiles === 0) {
        sources.push(sourceEntry('gemini', 'Gemini CLI', 'missing', '未找到 ~/.gemini(产生记录后自动接入)', 0, 0, 0, 0))
      } else if (parts.gemini === undefined) {
        sources.push(sourceEntry('gemini', 'Gemini CLI', 'pending', geminiFiles + ' 个数据文件', geminiFiles, 0, 0, 0))
      } else if (parts.gemini.error !== null && parts.gemini.error !== undefined) {
        sources.push(sourceEntry('gemini', 'Gemini CLI', 'error', '解析失败', geminiFiles, 0, 0, 0, parts.gemini.error))
      } else {
        const d = parts.gemini.data
        sources.push(sourceEntry('gemini', 'Gemini CLI', d.records.length > 0 ? 'ok' : 'no-data', d.records.length > 0 ? d.records.length + ' 条用量记录(尽力解析,格式随版本变化)' : geminiFiles + ' 个数据文件 · 未发现 token 字段', geminiFiles, d.records.length, 0, d.lastAt))
        all = all.concat(d.records)
      }

      if (clineFiles === 0) {
        sources.push(sourceEntry('cline', 'Cline / Roo Code', 'missing', '未找到 VS Code Cline/Roo 任务数据(安装使用后自动接入)', 0, 0, 0, 0))
      } else if (parts.cline === undefined) {
        sources.push(sourceEntry('cline', 'Cline / Roo Code', 'pending', clineFiles + ' 个任务历史', clineFiles, 0, 0, 0))
      } else if (parts.cline.error !== null && parts.cline.error !== undefined) {
        sources.push(sourceEntry('cline', 'Cline / Roo Code', 'error', '解析失败', clineFiles, 0, 0, 0, parts.cline.error))
      } else {
        const d = parts.cline.data
        sources.push(sourceEntry('cline', 'Cline / Roo Code', 'ok', clineFiles + ' 个任务 · ' + d.records.length + ' 条模型响应(日期取文件时间)', clineFiles, d.records.length, clineFiles, d.lastAt))
        all = all.concat(d.records)
      }

      sources.push(sourceEntry('trae', 'Trae', traeFiles > 0 ? 'no-data' : 'missing', traeFiles > 0 ? traeFiles + ' 个本地库 · 未记录 token 用量' : '未找到 Trae 数据', traeFiles, 0, 0, 0))
      if (!hermesDbExists && hermesFiles === 0) {
        sources.push(sourceEntry('hermes', 'Hermes Agent', 'missing', '未找到 ~/.hermes', 0, 0, 0, 0))
      } else if (parts.hermes === undefined) {
        sources.push(sourceEntry('hermes', 'Hermes Agent', hermesDbExists ? 'pending' : 'no-data', hermesDbExists ? '等待解析' : hermesFiles + ' 个会话文件 · 无 state.db', hermesFiles, 0, 0, 0))
      } else if (parts.hermes.error !== null && parts.hermes.error !== undefined) {
        sources.push(sourceEntry('hermes', 'Hermes Agent', 'error', '查询失败', hermesFiles, 0, 0, 0, parts.hermes.error))
      } else {
        const d = parts.hermes.data
        let detail = d.sessions + ' 个会话(state.db)· ' + d.records.length + ' 条模型记录'
        if (d.withTokens === 0 && d.records.length > 0) detail += ' · token 全为 0(免费模型网关未回传 usage,有数据后自动入账)'
        sources.push(sourceEntry('hermes', 'Hermes Agent', 'ok', detail, hermesFiles, d.records.length, d.sessions, d.lastAt))
        all = all.concat(d.records)
      }
      sources.push(sourceEntry('ollama-app', 'Ollama 桌面版', ollamaDb ? 'no-data' : 'missing', ollamaDb ? '有本地聊天记录 · 消息表无 token 字段' : '未找到聊天数据库', ollamaDb ? 1 : 0, 0, 0, 0))
      sources.push(sourceEntry('aionui', 'AionUi', aionuiDb ? 'no-data' : 'missing', aionuiDb ? '有本地消息库 · 未记录 token 用量' : '未找到 AionUi 数据', aionuiDb ? 1 : 0, 0, 0, 0))
      if (parts.lingma !== undefined && parts.lingma.error === null && parts.lingma.data !== null && parts.lingma.data !== undefined) {
        const d = parts.lingma.data
        sources.push(sourceEntry('lingma', '通义灵码(Lingma)', 'no-data', d.sessions + ' 个会话 · ' + d.requests + ' 次请求 · 聊天内容加密存储,无法读取 token', 1, 0, d.sessions, d.lastAt))
      } else if (lingmaDbExists) {
        sources.push(sourceEntry('lingma', '通义灵码(Lingma)', parts.lingma !== undefined ? 'error' : 'pending', parts.lingma !== undefined ? '查询失败' : '等待查询', 1, 0, 0, 0))
      }
      if (codegeexExists) {
        const cgParts = String(sig.codegeex).split(' ')
        const cgSize = cgParts.length > 1 ? parseInt(cgParts[1], 10) || 0 : 0
        sources.push(sourceEntry('codegeex', 'CodeGeeX', 'no-data', cgSize > 2 ? 'VS Code 扩展已安装 · agent 历史存在但未发现 token 字段' : 'VS Code 扩展已安装 · agent 历史为空', 1, 0, 0, 0))
      }
      if (piFiles === 0) {
        if (piInstalled) sources.push(sourceEntry('pi', 'Pi', 'no-data', '已安装(仅登录凭据)· 产生会话后自动接入', 0, 0, 0, 0))
      } else if (parts.pi === undefined) {
        sources.push(sourceEntry('pi', 'Pi', 'pending', piFiles + ' 个会话文件', piFiles, 0, 0, 0))
      } else if (parts.pi.error !== null && parts.pi.error !== undefined) {
        sources.push(sourceEntry('pi', 'Pi', 'error', '解析失败', piFiles, 0, 0, 0, parts.pi.error))
      } else {
        const d = parts.pi.data
        sources.push(sourceEntry('pi', 'Pi', 'ok', piFiles + ' 个会话文件 · ' + d.records.length + ' 条模型响应', piFiles, d.records.length, 0, d.lastAt))
        all = all.concat(d.records)
      }
      if (comateExists) {
        sources.push(sourceEntry('comate', '百度 Comate', 'no-data', '仅有代码编写指标(CODE_WRITTEN_METRIC),无 token 用量', 1, 0, 0, 0))
      }
      sources.push(sourceEntry('copilot', 'GitHub Copilot', copilotDir ? 'no-data' : 'missing', copilotDir ? '用量存于 GitHub 服务器,本地无记录' : '未找到 Copilot Chat 数据', copilotDir ? 1 : 0, 0, 0, 0))

      const nowMs = Date.now()
      function sigSecondMs(raw) {
        if (raw === undefined) return 0
        const v = parseInt(String(raw).split('|')[1], 10)
        return Number.isFinite(v) && v > 0 ? v * 1000 : 0
      }
      function sigStatMs(raw) {
        if (raw === undefined) return 0
        let best = 0
        const lines = String(raw).split('|')
        for (let li = 0; li < lines.length; li++) {
          const v = parseInt(String(lines[li]).split(' ')[0], 10)
          if (Number.isFinite(v) && v * 1000 > best) best = v * 1000
        }
        return best
      }
      const driftMtimes = {
        'claude-code': sigSecondMs(sig.claude),
        'wps-claude': sigSecondMs(sig.wpsclaude),
        'dsh': sigSecondMs(sig.dsh),
        'openclaw': sigSecondMs(sig.claw),
        'qclaw': sigSecondMs(sig.claw),
        'codewhale': sigSecondMs(sig.codewhale),
        'workbuddy': sigSecondMs(sig.workbuddy),
        'opencode': sigStatMs(sig.opencode),
        'cursor': sigStatMs(sig.cursoride),
        'codex': sigSecondMs(sig.codex),
        'gemini': sigSecondMs(sig.gemini),
        'hermes': sigStatMs(sig.hermesdb),
        'lingma': sigStatMs(sig.lingma)
      }
      for (let di = 0; di < sources.length; di++) {
        const sd = sources[di]
        const fm = driftMtimes[sd.id] !== undefined ? driftMtimes[sd.id] : 0
        sd.fileMtimeMs = fm
        sd.drift = sd.status === 'ok' && sd.records > 0 && fm > 0 && (nowMs - fm) < 259200000 && sd.lastActivityAt > 0 && sd.lastActivityAt < fm - 172800000
      }

      const scanRows = aggregateRows(all)
      const scanProjects = aggregateProjects(all)

      if (state.ledger === null) state.ledger = await loadLedger()
      const ledger = state.ledger
      mergeRows(ledger, scanRows)
      mergeProjects(ledger, scanProjects)
      mergeSources(ledger, sources)

      let persisted = false
      let persistError = null
      try {
        await saveLedger(ledger)
        persisted = true
      } catch (e) {
        persistError = String((e && e.message) || e)
        console.error('agent-token-stats ledger save failed: ' + persistError)
      }

      for (let idx = 0; idx < sources.length; idx++) {
        const s = sources[idx]
        const e = ledger.sources[s.id]
        if (s.status === 'missing' && e !== undefined && e.everOk === true && num(e.records) > 0) {
          s.status = 'archived'
          s.detail = '源日志已删除/移动 · 台账留存峰值 ' + e.records + ' 条记录'
          s.records = num(e.records)
          s.sessions = num(e.sessions)
          s.lastActivityAt = num(e.lastActivityAt)
        }
      }

      const todayStr = localDay(Date.now())
      const monthPrefix = todayStr.slice(0, 7)
      const budgetUse = { dayTokens: 0, dayCost: 0, monthTokens: 0, monthCost: 0 }
      const blkeys = Object.keys(ledger.rows)
      for (let bi = 0; bi < blkeys.length; bi++) {
        const be = ledger.rows[blkeys[bi]]
        if (typeof be.d !== 'string' || be.d === '') continue
        const btk = num(be.i) + num(be.o) + num(be.r) + num(be.cr) + num(be.cw) + num(be.tt)
        const bcst = num(be.c) + (num(be.c) > 0 ? 0 : estimateCost(be.m, num(be.i), num(be.o), num(be.cr), num(be.cw)))
        if (be.d === todayStr) {
          budgetUse.dayTokens += btk
          budgetUse.dayCost += bcst
        }
        if (be.d.slice(0, 7) === monthPrefix) {
          budgetUse.monthTokens += btk
          budgetUse.monthCost += bcst
        }
      }

      const result = {
        generatedAt: Date.now(),
        sources: sources,
        rows: ledgerRows(ledger),
        projects: ledgerProjects(ledger),
        budget: {
          config: BUDGETS,
          use: {
            dayTokens: budgetUse.dayTokens,
            dayCost: Math.round(budgetUse.dayCost * 1000000) / 1000000,
            monthTokens: budgetUse.monthTokens,
            monthCost: Math.round(budgetUse.monthCost * 1000000) / 1000000
          }
        },
        ledger: {
          path: '~/.agent-token-stats/ledger.json',
          savedAt: ledger.updatedAt,
          persisted: persisted,
          error: persistError
        }
      }
      state.result = result
      return result
    }

    function sendJson(res, code, obj) {
      const body = JSON.stringify(obj)
      res.statusCode = code
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(body)
    }

    function originOk(req) {
      const origin = req.headers ? req.headers.origin : undefined
      if (!origin) return true
      try {
        return new URL(String(origin)).host === String((req.headers && req.headers.host) || '')
      } catch (e) {
        return false
      }
    }

    ctx.effect(function () {
      return ctx.webServer.register({
        kind: 'exact',
        path: '/agent-token-stats/data',
        handler: async function (req, res) {
          if (!originOk(req)) { sendJson(res, 403, { error: 'origin rejected' }); return }
          if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return }
          let force = false
          try {
            force = new URL(String(req.url), 'http://localhost').searchParams.get('refresh') === '1'
          } catch (e) {
            force = false
          }
          let p = state.inflight
          if (p === null) {
            p = build(force)
            state.inflight = p
          }
          try {
            sendJson(res, 200, await p)
          } catch (e) {
            sendJson(res, 500, { error: String((e && e.message) || e) })
          } finally {
            if (state.inflight === p) state.inflight = null
          }
        }
      })
    }, 'agent-token-stats data route')

    ctx.effect(function () {
      return ctx.webServer.register({
        kind: 'exact',
        path: '/agent-token-stats/export',
        handler: async function (req, res) {
          if (!originOk(req)) { sendJson(res, 403, { error: 'origin rejected' }); return }
          try {
        const ledger = state.ledger !== null ? state.ledger : await loadLedger()
        const rows = ledgerRows(ledger)
        const lines = ['agent,provider,vendor,model,day,requests,input,output,reasoning,cache_read,cache_write,total_only,cost_usd,est_cost_usd']
        for (let idx = 0; idx < rows.length; idx++) {
          const r = rows[idx]
          lines.push([csvCell(r.a), csvCell(r.p), csvCell(r.v), csvCell(r.m), csvCell(r.d), r.n, r.i, r.o, r.r, r.cr, r.cw, r.tt, r.c, r.ec].join(','))
        }
        const csv = lines.join('\n') + '\n'
        const d = new Date()
        const stamp = '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds())
        const file = 'export-' + stamp + '.csv'
        const cmd = 'mkdir -p "$HOME/.agent-token-stats" && cat > "$HOME/.agent-token-stats/' + file + '"'
        const spec = resolveSpec({ command: cmd, timeoutMs: 60000, stdin: csv })
        const shellRes = await shellStart(spec)
        if (!shellRes || shellRes.exitCode !== 0) throw new Error('csv export failed')
        sendJson(res, 200, { path: '~/.agent-token-stats/' + file, rows: rows.length })
          } catch (e) {
            sendJson(res, 500, { error: String((e && e.message) || e) })
          }
        }
      })
    }, 'agent-token-stats export route')

    let cursorSessionsCache = null

    async function queryOpencodeSessions(limit) {
      const tablesOut = await runShell(OC_TABLES_CMD, 60000)
      const tables = String(tablesOut).trim().split(',')
      const tbl = tables.indexOf('session_v2') >= 0 ? 'session_v2' : (tables.indexOf('session') >= 0 ? 'session' : null)
      if (tbl === null) return []
      const lim = Math.min(200, Math.max(1, limit))
      const out = await runShell(`sqlite3 -readonly -json "$HOME/.local/share/opencode/opencode.db" "SELECT id, title, directory, model, coalesce(tokens_input,0) AS i, coalesce(tokens_output,0) AS o, coalesce(tokens_reasoning,0) AS r, coalesce(tokens_cache_read,0) AS cr, coalesce(tokens_cache_write,0) AS cw, coalesce(cost,0) AS c, time_created AS ca, time_updated AS ua FROM ${tbl} ORDER BY time_updated DESC LIMIT ${lim};" 2>/dev/null`, 120000)
      let rows = []
      if (out.trim() !== '') {
        try { rows = JSON.parse(out) } catch (e) { rows = [] }
      }
      if (!Array.isArray(rows)) rows = []
      const outRows = []
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (row === null || typeof row !== 'object') continue
        let model = row.model
        if (typeof model === 'string' && model !== '') {
          try {
            const mj = JSON.parse(model)
            if (mj !== null && typeof mj === 'object' && mj.id) model = mj.id
          } catch (e) {
            // model 本身就是字符串 id
          }
        }
        outRows.push({
          agent: 'opencode',
          id: String(row.id === null || row.id === undefined ? '' : row.id),
          title: typeof row.title === 'string' ? row.title : '',
          project: typeof row.directory === 'string' ? row.directory : '',
          model: typeof model === 'string' && model !== '' ? model : 'unknown',
          i: num(row.i), o: num(row.o), r: num(row.r), cr: num(row.cr), cw: num(row.cw), tt: 0,
          c: num(row.c),
          n: 0,
          createdAt: num(row.ca),
          updatedAt: num(row.ua)
        })
      }
      return outRows
    }

    async function queryCodewhaleSessions(limit) {
      const out = await runShell(`find "$HOME/.codewhale/sessions" -maxdepth 1 -type f -name "*.json" 2>/dev/null | while IFS= read -r f; do jq -c '[.. | objects | select(has("total_tokens") and has("model"))] | .[0] // empty | {id:(.id // null), name:((.name // .title // null)), tt:((.total_tokens) // 0), n:((.message_count) // 0), m:(.model // null), w:(.workspace // null), u:(.updated_at // .created_at // null), c:(((.cost // {}).session_cost_usd) // 0)}' "$f" 2>/dev/null; done`, 120000)
      const rows = []
      const lines = out.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') continue
        let d
        try { d = JSON.parse(lines[i]) } catch (e) { continue }
        let ms = 0
        if (typeof d.u === 'string') {
          const pp = Date.parse(d.u)
          if (Number.isFinite(pp) && pp > 0) ms = pp
        }
        rows.push({
          agent: 'codewhale',
          id: String(d.id === null || d.id === undefined ? '' : d.id),
          title: typeof d.name === 'string' && d.name !== '' ? d.name : String(d.id === null || d.id === undefined ? '(会话)' : d.id).slice(0, 8),
          project: typeof d.w === 'string' ? d.w : '',
          model: typeof d.m === 'string' && d.m !== '' ? d.m : 'unknown',
          i: 0, o: 0, r: 0, cr: 0, cw: 0,
          tt: num(d.tt),
          c: num(d.c),
          n: num(d.n),
          createdAt: 0,
          updatedAt: ms
        })
      }
      rows.sort(function (a, b) { return b.updatedAt - a.updatedAt })
      return rows.slice(0, Math.min(200, Math.max(1, limit)))
    }

    async function queryCursorSessions(limit) {
      if (cursorSessionsCache !== null && Date.now() - cursorSessionsCache.at < 1800000) {
        return cursorSessionsCache.rows.slice(0, Math.min(200, Math.max(1, limit)))
      }
      const out = await runShell(`DB="$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb"; if [ -f "$DB" ]; then sqlite3 -readonly -json "$DB" "SELECT substr(key,14,36) AS cid, json_extract(value,'$.name') AS nm, json_extract(value,'$.createdAt') AS ca, json_extract(value,'$.modelConfig.modelName') AS mn, json_extract(value,'$.usageData') AS ud FROM cursorDiskKV WHERE key LIKE 'composerData:%';"; fi`, 600000)
      let rows = []
      if (out.trim() !== '') {
        try { rows = JSON.parse(out) } catch (e) { rows = [] }
      }
      if (!Array.isArray(rows)) rows = []
      const outRows = []
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (row === null || typeof row !== 'object') continue
        let ud = row.ud
        if (typeof ud === 'string' && ud !== '') {
          try { ud = JSON.parse(ud) } catch (e) { ud = null }
        }
        let amount = 0
        let cents = 0
        if (ud !== null && typeof ud === 'object') {
          const slugs = Object.keys(ud)
          for (let si = 0; si < slugs.length; si++) {
            const v = ud[slugs[si]]
            if (v !== null && typeof v === 'object') {
              amount += num(v.amount)
              cents += num(v.costInCents)
            }
          }
        }
        outRows.push({
          agent: 'cursor',
          id: String(row.cid === null || row.cid === undefined ? '' : row.cid),
          title: typeof row.nm === 'string' && row.nm !== '' ? row.nm : '(未命名对话)',
          project: '(Cursor IDE)',
          model: typeof row.mn === 'string' && row.mn !== '' ? row.mn : 'unknown',
          i: 0, o: 0, r: 0, cr: 0, cw: 0, tt: 0,
          c: cents / 100,
          n: amount,
          createdAt: num(row.ca),
          updatedAt: num(row.ca)
        })
      }
      outRows.sort(function (a, b) { return b.updatedAt - a.updatedAt })
      cursorSessionsCache = { at: Date.now(), rows: outRows }
      return outRows.slice(0, Math.min(200, Math.max(1, limit)))
    }

    ctx.effect(function () {
      return ctx.webServer.register({
        kind: 'exact',
        path: '/agent-token-stats/sessions',
        handler: async function (req, res) {
          if (!originOk(req)) { sendJson(res, 403, { error: 'origin rejected' }); return }
          if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return }
          try {
            const url = new URL(String(req.url), 'http://localhost')
            const agent = url.searchParams.get('agent') || 'opencode'
            const limit = parseInt(url.searchParams.get('limit'), 10) || 80
            let sessions = []
            if (agent === 'opencode') sessions = await queryOpencodeSessions(limit)
            else if (agent === 'codewhale') sessions = await queryCodewhaleSessions(limit)
            else if (agent === 'cursor') sessions = await queryCursorSessions(limit)
            else if (agent === 'all') {
              const both = await Promise.all([
                queryOpencodeSessions(limit).catch(function () { return [] }),
                queryCodewhaleSessions(limit).catch(function () { return [] })
              ])
              sessions = both[0].concat(both[1])
              sessions.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0) })
              sessions = sessions.slice(0, limit)
            }
            sendJson(res, 200, { agent: agent, sessions: sessions })
          } catch (e) {
            sendJson(res, 500, { error: String((e && e.message) || e) })
          }
        }
      })
    }, 'agent-token-stats sessions route')

    function aggregatePeriod(rows, startDay, endDay) {
      const agg = { n: 0, i: 0, o: 0, r: 0, cr: 0, cw: 0, tt: 0, c: 0, ec: 0, total: 0, byAgent: new Map(), byVendor: new Map(), byModel: new Map() }
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        if (r.d === '' || r.d < startDay || r.d > endDay) continue
        const t = r.i + r.o + r.r + r.cr + r.cw + r.tt
        agg.n += r.n; agg.i += r.i; agg.o += r.o; agg.r += r.r; agg.cr += r.cr; agg.cw += r.cw; agg.tt += r.tt; agg.c += r.c; agg.ec += r.ec; agg.total += t
        const ag = agg.byAgent.get(r.a) || { n: 0, total: 0, cr: 0, prompt: 0, c: 0, ec: 0 }
        ag.n += r.n; ag.total += t; ag.cr += r.cr; ag.prompt += r.i + r.cr + r.cw; ag.c += r.c; ag.ec += r.ec
        agg.byAgent.set(r.a, ag)
        const vd = agg.byVendor.get(r.v) || { n: 0, total: 0, cr: 0, prompt: 0 }
        vd.n += r.n; vd.total += t; vd.cr += r.cr; vd.prompt += r.i + r.cr + r.cw
        agg.byVendor.set(r.v, vd)
        const mk = r.m
        const md = agg.byModel.get(mk) || { n: 0, total: 0 }
        md.n += r.n; md.total += t
        agg.byModel.set(mk, md)
      }
      return agg
    }

    function pctDelta(cur, prev) {
      if (!(prev > 0)) return cur > 0 ? '新增' : '—'
      const p = (cur - prev) / prev * 100
      return (p >= 0 ? '+' : '') + p.toFixed(1) + '%'
    }

    function buildReport(gran) {
      if (state.ledger === null) return null
      const rows = ledgerRows(state.ledger)
      const now = new Date()
      let startDay, prevStartDay, prevEndDay, label
      if (gran === 'month') {
        const y = now.getFullYear()
        const mo = now.getMonth()
        startDay = y + '-' + pad2(mo + 1) + '-01'
        const pm = new Date(y, mo - 1, 1)
        prevStartDay = pm.getFullYear() + '-' + pad2(pm.getMonth() + 1) + '-01'
        const lp = new Date(y, mo, 0)
        prevEndDay = lp.getFullYear() + '-' + pad2(lp.getMonth() + 1) + '-' + pad2(lp.getDate())
        label = y + '-' + pad2(mo + 1)
      } else {
        startDay = localDay(now.getTime() - 6 * 86400000)
        prevEndDay = localDay(now.getTime() - 7 * 86400000)
        prevStartDay = localDay(now.getTime() - 13 * 86400000)
        label = startDay + ' ~ ' + localDay(now.getTime())
      }
      const endDay = localDay(now.getTime())
      const cur = aggregatePeriod(rows, startDay, endDay)
      const prev = aggregatePeriod(rows, prevStartDay, prevEndDay)
      const hit = cur.prompt > 0 ? (cur.cr / cur.prompt * 100).toFixed(1) + '%' : '—'
      const L = []
      L.push('# Agent Token 用量' + (gran === 'month' ? '月报' : '周报') + '(' + label + ')')
      L.push('')
      L.push('生成时间: ' + new Date().toLocaleString() + ' · 数据源: dsh-agent-token-stats 台账(~/.agent-token-stats/ledger.json)')
      L.push('')
      L.push('## 总览')
      L.push('')
      L.push('| 指标 | 本期 | 上期 | 环比 |')
      L.push('| --- | ---: | ---: | ---: |')
      L.push('| 总 Tokens | ' + cur.total.toLocaleString() + ' | ' + prev.total.toLocaleString() + ' | ' + pctDelta(cur.total, prev.total) + ' |')
      L.push('| 请求数 | ' + cur.n.toLocaleString() + ' | ' + prev.n.toLocaleString() + ' | ' + pctDelta(cur.n, prev.n) + ' |')
      L.push('| 输入(未缓存) | ' + cur.i.toLocaleString() + ' | ' + prev.i.toLocaleString() + ' | ' + pctDelta(cur.i, prev.i) + ' |')
      L.push('| 输出 | ' + cur.o.toLocaleString() + ' | ' + prev.o.toLocaleString() + ' | ' + pctDelta(cur.o, prev.o) + ' |')
      L.push('| 缓存读 | ' + cur.cr.toLocaleString() + ' | ' + prev.cr.toLocaleString() + ' | ' + pctDelta(cur.cr, prev.cr) + ' |')
      L.push('| 缓存命中率 | ' + hit + ' | ' + (prev.prompt > 0 ? (prev.cr / prev.prompt * 100).toFixed(1) + '%' : '—') + ' | — |')
      L.push('| 费用(上报) | $' + cur.c.toFixed(2) + ' | $' + prev.c.toFixed(2) + ' | ' + pctDelta(cur.c, prev.c) + ' |')
      L.push('| 费用(估算) | $' + cur.ec.toFixed(2) + ' | $' + prev.ec.toFixed(2) + ' | ' + pctDelta(cur.ec, prev.ec) + ' |')
      L.push('')
      L.push('## 按 Agent')
      L.push('')
      L.push('| Agent | 请求 | 总 Tokens | 命中率 | 上报费用 | 估算费用 |')
      L.push('| --- | ---: | ---: | ---: | ---: | ---: |')
      const ags = []
      cur.byAgent.forEach(function (v, k) { ags.push([k, v]) })
      ags.sort(function (a, b) { return b[1].total - a[1].total })
      for (let i = 0; i < ags.length; i++) {
        const a = ags[i][1]
        L.push('| ' + ags[i][0] + ' | ' + a.n.toLocaleString() + ' | ' + a.total.toLocaleString() + ' | ' + (a.prompt > 0 ? (a.cr / a.prompt * 100).toFixed(1) + '%' : '—') + ' | $' + a.c.toFixed(2) + ' | $' + a.ec.toFixed(2) + ' |')
      }
      L.push('')
      L.push('## 按厂商')
      L.push('')
      L.push('| 厂商 | 总 Tokens | 占比 | 命中率 |')
      L.push('| --- | ---: | ---: | ---: |')
      const vds = []
      cur.byVendor.forEach(function (v, k) { vds.push([k, v]) })
      vds.sort(function (a, b) { return b[1].total - a[1].total })
      for (let i = 0; i < vds.length; i++) {
        const v = vds[i][1]
        L.push('| ' + vds[i][0] + ' | ' + v.total.toLocaleString() + ' | ' + (cur.total > 0 ? (v.total / cur.total * 100).toFixed(1) + '%' : '—') + ' | ' + (v.prompt > 0 ? (v.cr / v.prompt * 100).toFixed(1) + '%' : '—') + ' |')
      }
      L.push('')
      L.push('## Top 10 模型')
      L.push('')
      L.push('| 模型 | 请求 | 总 Tokens |')
      L.push('| --- | ---: | ---: |')
      const mds = []
      cur.byModel.forEach(function (v, k) { mds.push([k, v]) })
      mds.sort(function (a, b) { return b[1].total - a[1].total })
      for (let i = 0; i < Math.min(10, mds.length); i++) {
        L.push('| ' + mds[i][0] + ' | ' + mds[i][1].n.toLocaleString() + ' | ' + mds[i][1].total.toLocaleString() + ' |')
      }
      L.push('')
      L.push('---')
      L.push('口径: 合计 = 输入 + 输出 + 推理 + 缓存读 + 缓存写 + 仅总量;命中率 = 缓存读 ÷ (输入 + 缓存读 + 缓存写);估算费用按内置/用户参考价目表计算,与上报费用分列。')
      const stamp = '' + now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate())
      return { markdown: L.join('\n'), filename: 'token-report-' + gran + '-' + stamp + '.md' }
    }

    ctx.effect(function () {
      return ctx.webServer.register({
        kind: 'exact',
        path: '/agent-token-stats/report',
        handler: async function (req, res) {
          if (!originOk(req)) { sendJson(res, 403, { error: 'origin rejected' }); return }
          if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return }
          try {
            const url = new URL(String(req.url), 'http://localhost')
            const gran = url.searchParams.get('gran') === 'month' ? 'month' : 'week'
            if (state.ledger === null) state.ledger = await loadLedger()
            const report = buildReport(gran)
            if (report === null) { sendJson(res, 503, { error: 'ledger not ready' }); return }
            sendJson(res, 200, report)
          } catch (e) {
            sendJson(res, 500, { error: String((e && e.message) || e) })
          }
        }
      })
    }, 'agent-token-stats report route')

    async function fetchJsonWithTimeout(urlStr, headers, timeoutMs) {
      const ctrl = new AbortController()
      const timer = setTimeout(function () { ctrl.abort() }, timeoutMs || 8000)
      try {
        const r = await fetch(urlStr, { headers: headers, signal: ctrl.signal })
        const text = await r.text()
        let j = null
        try { j = JSON.parse(text) } catch (e) { j = null }
        return { ok: r.ok, status: r.status, json: j, text: text.slice(0, 200) }
      } finally {
        clearTimeout(timer)
      }
    }

    ctx.effect(function () {
      return ctx.webServer.register({
        kind: 'exact',
        path: '/agent-token-stats/quota',
        handler: async function (req, res) {
          if (!originOk(req)) { sendJson(res, 403, { error: 'origin rejected' }); return }
          if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return }
          try {
            let cfg = {}
            try {
              const cfgOut = await runShell('cat "$HOME/.agent-token-stats/quota.json" 2>/dev/null || true', 30000)
              if (cfgOut.trim() !== '') {
                const parsed = JSON.parse(cfgOut)
                if (parsed !== null && typeof parsed === 'object') cfg = parsed
              }
            } catch (e) {
              cfg = {}
            }
            const dsKey = (cfg.deepseek && typeof cfg.deepseek.apiKey === 'string' && cfg.deepseek.apiKey !== '') ? cfg.deepseek.apiKey : (process.env.DEEPSEEK_API_KEY || null)
            const kimiKey = (cfg.kimi && typeof cfg.kimi.apiKey === 'string' && cfg.kimi.apiKey !== '') ? cfg.kimi.apiKey : (process.env.MOONSHOT_API_KEY || null)
            const results = []
            if (dsKey !== null) {
              try {
                const r = await fetchJsonWithTimeout('https://api.deepseek.com/user/balance', { authorization: 'Bearer ' + dsKey, accept: 'application/json' }, 8000)
                if (r.ok && r.json !== null && Array.isArray(r.json.balances) && r.json.balances.length > 0) {
                  results.push({ provider: 'deepseek', ok: true, currency: r.json.balances[0].currency || 'CNY', available: r.json.balances[0].available_balance, total: r.json.balances[0].total_balance })
                } else {
                  results.push({ provider: 'deepseek', ok: false, error: 'HTTP ' + r.status })
                }
              } catch (e) {
                results.push({ provider: 'deepseek', ok: false, error: String((e && e.message) || e).slice(0, 120) })
              }
            } else {
              results.push({ provider: 'deepseek', ok: false, unconfigured: true })
            }
            if (kimiKey !== null) {
              try {
                const r = await fetchJsonWithTimeout('https://api.moonshot.cn/v1/users/me/balance', { authorization: 'Bearer ' + kimiKey, accept: 'application/json' }, 8000)
                if (r.ok && r.json !== null) {
                  const avail = r.json.available !== undefined ? r.json.available : (r.json.balance !== undefined ? r.json.balance : null)
                  results.push({ provider: 'kimi', ok: true, currency: 'CNY', available: avail, total: null })
                } else {
                  results.push({ provider: 'kimi', ok: false, error: 'HTTP ' + r.status })
                }
              } catch (e) {
                results.push({ provider: 'kimi', ok: false, error: String((e && e.message) || e).slice(0, 120) })
              }
            } else {
              results.push({ provider: 'kimi', ok: false, unconfigured: true })
            }
            sendJson(res, 200, { quotas: results, checkedAt: Date.now() })
          } catch (e) {
            sendJson(res, 500, { error: String((e && e.message) || e) })
          }
        }
      })
    }, 'agent-token-stats quota route')

    ctx.effect(function () {
      build(false).catch(function (e) {
        console.error('agent-token-stats initial scan failed: ' + String((e && e.message) || e))
      })
    }, 'agent-token-stats warmup')
}
