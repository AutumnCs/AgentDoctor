# Agent Doctor — Phase 0 Spike 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 证明 Agent Doctor 能从一份真实 DSH session log（JSONL）+ cordis.yml 中，重建出 runtime 拓扑变化（"agent 改了什么"）和 context 归因（"context 为什么这么大"），产出一份 git 风格的 diff，并跑通 `npx agent-doctor demo`。

**Architecture:** 一个独立的 TypeScript 工程（不在 DSH monorepo 内），只读 DSH 的两种真实数据源——session log JSONL（含 `tool/call` 事件，其中 cordis 动词记录 runtime 变化）和 `cordis.yml`（静态拓扑基线）——把它们归一化成统一的 RuntimeSnapshot / ContextContribution，再输出 git 风格的 diff 和归因。全程只读、DSH 是唯一事实源、不 hack 私有实现。

**Tech Stack:** TypeScript + Node 22+，vitest（测试），SQLite（better-sqlite3，仅作为可选索引，Phase 0 可先内存 Map 存储）。不依赖 DSH 内部包（只读其文件格式，格式已在 [DESIGN.md](../../../DESIGN.md) 中冻结）。

## Global Constraints

- **Node 版本**：`^22.19.0 || >=24.0.0`（与 dsh-observe 的 engines 对齐，复用其生态假设）。
- **唯一事实源**：任何诊断必须能从 DSH session log + cordis.yml 重建；本项目 SQLite/内存结构只是索引。
- **Truthfulness**：所有 token 数值分四级 `fact | derived | hypothesis | unknown`，estimate 必须显式标注（`~` 前缀或 `estimated: true`），禁止伪造精度。
- **cordis 动词识别必须数据驱动**：fixture 中是 `cordis_mount/unmount`，README 是 `cordis_define/run/stop/undefine`，存在版本漂移，故动词映射表放配置里，不写死。
- **语言**：全部英文（用户已拍板）——源码注释、commit message、README、demo 输出一律英文。
- **禁止**：hook cordis 内部事件、自建 collector、依赖私有未导出 API。只消费 DSH 公开的 session log 格式。

---

## File Structure

```
G:\AgentDoctor\
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── DESIGN.md                          (已存在)
├── src\
│   ├── types.ts                        # 核心领域类型：RuntimeSnapshot, RuntimeDiff, ContextContribution
│   ├── session-log.ts                  # 解析 session JSONL → SessionEvent[]（只读、容错）
│   ├── cordis-verbs.ts                 # cordis 动词识别表（数据驱动）
│   ├── runtime-snapshot.ts             # 从 cordis.yml + cordis tool/call 重建 RuntimeSnapshot
│   ├── runtime-diff.ts                 # 两个 RuntimeSnapshot → git 风格 diff
│   ├── context-attribution.ts          # 从 request/header + tool/result 归因 context
│   ├── truth-level.ts                  # fact/derived/hypothesis/unknown 四级 + estimate 标注
│   └── demo.ts                         # `agent-doctor demo` 入口，输出 SAMPLE 归因 + diff
├── test\
│   ├── session-log.test.ts
│   ├── runtime-diff.test.ts
│   ├── context-attribution.test.ts
│   └── fixtures\
│       ├── cordis-tool-round.jsonl     (从 DSH 复制并替换模板占位符)
│       └── sample-cordis.yml
└── docs\
    └── superpowers\plans\              (本文件)
```

---

### Task 1: 工程脚手架 + 领域类型

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types.ts`
- Create: `src/truth-level.ts`

**Interfaces:**
- Produces:
  - `src/types.ts` 导出：`RuntimeSnapshot`, `RuntimeNode`, `RuntimeDiff`, `ContextContribution`, `ContextSnapshot`, `ToolVisibility`
  - `src/truth-level.ts` 导出：`TruthLevel = 'fact' | 'derived' | 'hypothesis' | 'unknown'`，`estimate(value: number): Estimated`

- [ ] **Step 1: 初始化 package.json**

```json
{
  "name": "agent-doctor",
  "version": "0.1.0",
  "type": "module",
  "bin": { "agent-doctor": "lib/demo.js" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "demo": "tsx src/demo.ts"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 2: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "lib",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 写 vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
})
```

- [ ] **Step 4: 写领域类型 src/types.ts**

```ts
/** Visibility of one tool in the runtime (from request/header.tools or a cordis registration). */
export interface ToolVisibility {
  name: string
  /** Truth level: `fact` from request/header, `derived` from cordis_define. */
  level: 'fact' | 'derived'
}

/** One node in the runtime topology: a plugin or service. */
export interface RuntimeNode {
  id: string
  kind: 'plugin' | 'service' | 'tool'
  /** `static` from cordis.yml, `dynamic` from a cordis tool/call. */
  origin: 'static' | 'dynamic'
  name: string
}

/** A runtime topology snapshot at one revision. */
export interface RuntimeSnapshot {
  revision: number
  nodes: RuntimeNode[]
  toolCount: number
}

/** The change between two snapshots, git-diff style. */
export interface RuntimeDiff {
  from: number
  to: number
  added: RuntimeNode[]
  removed: RuntimeNode[]
  toolCountDelta: number
}

/** One context contribution: how many tokens some component occupies. */
export interface ContextContribution {
  category: 'system' | 'messages' | 'tool-result' | 'tool-schema'
  tokens: number
  level: 'fact' | 'derived' | 'unknown'
  sourceId?: string
}

/** A context snapshot: total plus per-category contributions. */
export interface ContextSnapshot {
  totalTokens: number
  contributions: ContextContribution[]
}
```

- [ ] **Step 5: 写 src/truth-level.ts**

```ts
export type TruthLevel = 'fact' | 'derived' | 'hypothesis' | 'unknown'

/** An estimated value: must be labeled explicitly, never presented with fake precision. */
export interface Estimated {
  value: number
  estimated: true
  level: TruthLevel
}

/** Wrap an estimated value. Callers must know this is an estimate, not a fact. */
export function estimate(value: number, level: TruthLevel = 'derived'): Estimated {
  return { value, estimated: true, level }
}
```

- [ ] **Step 6: 安装依赖并跑空测试确认脚手架可用**

Run: `cd /g/AgentDoctor && npm install`
Expected: 安装成功，无报错。

- [ ] **Step 7: Commit**

```bash
git init
git add package.json tsconfig.json vitest.config.ts src/types.ts src/truth-level.ts
git commit -m "chore: scaffold agent-doctor with core domain types"
```

---

### Task 2: Session JSONL 解析器

**Files:**
- Create: `src/session-log.ts`
- Create: `test/session-log.test.ts`
- Create: `test/fixtures/cordis-tool-round.jsonl`
- Test: `test/session-log.test.ts`

**Interfaces:**
- Produces: `parseSessionLog(text: string): ParsedSession`，其中
  `ParsedSession = { header: SessionHeaderLine, events: SessionEvent[] }`，
  `SessionEvent = { type: string, seq: number, time: number, data: Record<string, unknown> }`。

- [ ] **Step 1: 从 DSH 复制真实 fixture 并替换模板占位符**

先复制原始 fixture：
```bash
cp /g/deepseek-harness/apps/web/tests/snapshots/cordis-tool-round/session.jsonl /g/AgentDoctor/test/fixtures/cordis-tool-round.jsonl
```
然后用 **JSON-aware 的 Python 替换**（不能用 sed——fixture 里 `"tools":"{{tools}}"` 和 `"system":"{{system}}"` 是**带引号的字符串占位符**，sed 替换会产出非法 JSON 或把 `tools` 变成字符串 `"[]"` 而非数组）：

```bash
cd /g/AgentDoctor
python - <<'PY'
import io
p = 'test/fixtures/cordis-tool-round.jsonl'
text = open(p, encoding='utf-8').read()
# 注意顺序：先处理带引号的数组占位符（去掉引号变成真数组），再处理字符串占位符
text = text.replace('"{{tools}}"', '[]')          # -> 真数组
text = text.replace('{{sessionId}}', 'sess-0001')
text = text.replace('{{cwd}}', 'G:/AgentDoctor')
text = text.replace('{{rpcId}}', 'rpc-0001')
text = text.replace('{{system}}', '')             # -> 空字符串 ""
text = text.replace('{{messagePrefix}}', '')
open(p, 'w', encoding='utf-8').write(text)
PY
```
验证替换后每行是合法 JSON：
```bash
python -c "import json; [json.loads(l) for l in open('test/fixtures/cordis-tool-round.jsonl', encoding='utf-8')]"
```
Expected: 无输出（无异常），所有行都合法。

- [ ] **Step 2: 写失败测试 test/session-log.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSessionLog } from '../src/session-log.js'

describe('parseSessionLog', () => {
  it('parses the first line as the session header', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const parsed = parseSessionLog(text)
    expect(parsed.header.type).toBe('session')
    expect(parsed.header.id).toBe('sess-0001')
  })

  it('parses all events and preserves seq order', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const parsed = parseSessionLog(text)
    expect(parsed.events.length).toBeGreaterThan(0)
    const seqs = parsed.events.map(e => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
  })

  it('extracts cordis tool/call events', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const parsed = parseSessionLog(text)
    const cordisCalls = parsed.events.filter(e =>
      e.type === 'tool/call' && String(e.data.name).startsWith('cordis_'))
    expect(cordisCalls.length).toBeGreaterThan(0)
    expect(cordisCalls.map(c => c.data.name)).toContain('cordis_inspect')
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /g/AgentDoctor && npx vitest run test/session-log.test.ts`
Expected: FAIL — `Cannot find module '../src/session-log.js'`

- [ ] **Step 4: 写 src/session-log.ts 实现**

```ts
export interface SessionHeaderLine {
  type: 'session'
  version: number
  id: string
  createdAt: number
  cwd?: string
  [key: string]: unknown
}

export interface SessionEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
}

export interface ParsedSession {
  header: SessionHeaderLine
  events: SessionEvent[]
}

/**
 * Parse a DSH session JSONL: the first line is the session header, each
 * subsequent line is an event. Read-only and fault-tolerant: skip a
 * non-JSON line with a warning instead of throwing.
 * See DESIGN.md section 3 "single source of truth".
 */
export function parseSessionLog(text: string): ParsedSession {
  const lines = text.split('\n').filter(line => line.trim().length > 0)
  let header: SessionHeaderLine | null = null
  const events: SessionEvent[] = []

  for (const line of lines) {
    let record: any
    try {
      record = JSON.parse(line)
    } catch {
      console.warn('session-log: skip invalid JSON line')
      continue
    }
    if (record.type === 'session') {
      header = record
    } else {
      events.push({
        type: record.type,
        seq: record.seq,
        time: record.time,
        data: record.data ?? {},
      })
    }
  }

  if (header === null) {
    throw new Error('session-log: missing session header line')
  }
  return { header, events }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /g/AgentDoctor && npx vitest run test/session-log.test.ts`
Expected: PASS — 3 个测试全过。

- [ ] **Step 6: Commit**

```bash
git add src/session-log.ts test/session-log.test.ts test/fixtures/cordis-tool-round.jsonl
git commit -m "feat: parse DSH session JSONL into header + events"
```

---

### Task 3: cordis 动词识别（数据驱动）

**Files:**
- Create: `src/cordis-verbs.ts`
- Test: `test/runtime-diff.test.ts`（先写 cordis 动词部分）

**Interfaces:**
- Consumes: `parseSessionLog`（Task 2）
- Produces: `classifyCordisCall(name: string): CordisVerb | null`，其中
  `CordisVerb = 'inspect' | 'define' | 'run' | 'stop' | 'undefine'`，
  以及 `CORDIS_VERB_MAP: Record<string, CordisVerb>`（可配置、数据驱动）。

- [ ] **Step 1: 写失败测试（识别 mount/unmount 与 run/stop 两套命名）**

在 `test/runtime-diff.test.ts` 里写：

```ts
import { describe, it, expect } from 'vitest'
import { classifyCordisCall, CORDIS_VERB_MAP } from '../src/cordis-verbs.js'

describe('classifyCordisCall', () => {
  it('recognizes legacy cordis_mount / cordis_unmount', () => {
    expect(classifyCordisCall('cordis_mount')).toBe('run')
    expect(classifyCordisCall('cordis_unmount')).toBe('stop')
  })

  it('recognizes current cordis_run / cordis_stop / cordis_undefine', () => {
    expect(classifyCordisCall('cordis_run')).toBe('run')
    expect(classifyCordisCall('cordis_stop')).toBe('stop')
    expect(classifyCordisCall('cordis_undefine')).toBe('undefine')
  })

  it('returns null for non-cordis tools', () => {
    expect(classifyCordisCall('bash')).toBe(null)
    expect(classifyCordisCall('inspect_pr')).toBe(null)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /g/AgentDoctor && npx vitest run test/runtime-diff.test.ts`
Expected: FAIL — `Cannot find module '../src/cordis-verbs.js'`

- [ ] **Step 3: 写 src/cordis-verbs.ts 实现**

```ts
/** The cordis self-modification tool verb semantics (normalized). */
export type CordisVerb = 'inspect' | 'define' | 'run' | 'stop' | 'undefine'

/**
 * cordis verb mapping table. Data-driven and configurable: DSH itself drifts
 * between cordis_mount/unmount (legacy) and cordis_define/run/stop/undefine
 * (current), so do not hard-code — normalize both to the semantic verbs.
 */
export const CORDIS_VERB_MAP: Record<string, CordisVerb> = {
  cordis_inspect: 'inspect',
  cordis_define: 'define',
  cordis_mount: 'run',     // legacy name, equivalent to run
  cordis_run: 'run',
  cordis_stop: 'stop',
  cordis_unmount: 'stop',  // legacy name, equivalent to stop
  cordis_undefine: 'undefine',
}

/** Classify a tool name into a cordis verb; return null for non-cordis tools. */
export function classifyCordisCall(name: string): CordisVerb | null {
  return CORDIS_VERB_MAP[name] ?? null
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /g/AgentDoctor && npx vitest run test/runtime-diff.test.ts`
Expected: PASS — 3 个测试全过。

- [ ] **Step 5: Commit**

```bash
git add src/cordis-verbs.ts test/runtime-diff.test.ts
git commit -m "feat: data-driven cordis verb classification (mount/unmount vs run/stop)"
```

---

### Task 4: Runtime Snapshot + Diff

**Files:**
- Create: `src/runtime-snapshot.ts`
- Create: `src/runtime-diff.ts`
- Test: `test/runtime-diff.test.ts`（补充 snapshot + diff 部分）

**Interfaces:**
- Consumes: `parseSessionLog`, `classifyCordisCall`, `RuntimeSnapshot`, `RuntimeDiff`（Task 1）
- Produces:
  - `buildRuntimeSnapshots(parsed: ParsedSession): RuntimeSnapshot[]` —— 从 session log 里的 cordis tool/call 重建快照序列
  - `diffRuntime(a: RuntimeSnapshot, b: RuntimeSnapshot): RuntimeDiff`

- [ ] **Step 1: 写失败测试（从 fixture 重建快照并 diff）**

在 `test/runtime-diff.test.ts` 追加：

```ts
import { readFileSync } from 'node:fs'
import { parseSessionLog } from '../src/session-log.js'
import { buildRuntimeSnapshots } from '../src/runtime-snapshot.js'
import { diffRuntime } from '../src/runtime-diff.js'

describe('runtime snapshot + diff', () => {
  it('rebuilds at least two runtime snapshots from the session log', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const snapshots = buildRuntimeSnapshots(parseSessionLog(text))
    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    expect(snapshots[0].revision).toBeLessThan(snapshots[snapshots.length - 1].revision)
  })

  it('diffs the node added by cordis_mount', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const snapshots = buildRuntimeSnapshots(parseSessionLog(text))
    // find the snapshots before/after mount
    const diff = diffRuntime(snapshots[0], snapshots[1])
    expect(diff.added.length).toBeGreaterThan(0)
    expect(diff.added.some(n => n.origin === 'dynamic')).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /g/AgentDoctor && npx vitest run test/runtime-diff.test.ts`
Expected: FAIL — `Cannot find module '../src/runtime-snapshot.js'`

- [ ] **Step 3: 写 src/runtime-snapshot.ts**

```ts
import type { ParsedSession } from './session-log.js'
import type { RuntimeSnapshot, RuntimeNode } from './types.js'
import { classifyCordisCall } from './cordis-verbs.js'

/**
 * Rebuild the runtime snapshot sequence from the session log.
 * Static baseline (cordis.yml) is an empty baseline in Phase 0; dynamic
 * changes come from cordis tool/call events.
 * See DESIGN.md "DSH self-evolution is 5 enumerable verbs".
 *
 * Only mutating verbs (run/define/stop/undefine) advance a revision; the
 * read-only `inspect` verb is skipped (it produces no topology change).
 */
export function buildRuntimeSnapshots(parsed: ParsedSession): RuntimeSnapshot[] {
  const snapshots: RuntimeSnapshot[] = []
  let revision = 0
  let nodes: RuntimeNode[] = []

  // initial snapshot
  snapshots.push({ revision, nodes: [...nodes], toolCount: nodes.filter(n => n.kind === 'tool').length })

  for (const event of parsed.events) {
    if (event.type !== 'tool/call') continue
    const name = String(event.data.name)
    const verb = classifyCordisCall(name)
    if (verb === null || verb === 'inspect') continue

    revision++
    if (verb === 'run' || verb === 'define') {
      // cordis_mount / cordis_run: parse the package name, record a dynamic node
      const args = JSON.parse(String(event.data.arguments ?? '{}'))
      const pkgName = String(args.name ?? args.code ?? `dyn-${revision}`)
      nodes.push({ id: `dyn-${revision}`, kind: 'plugin', origin: 'dynamic', name: pkgName })
    } else if (verb === 'stop' || verb === 'undefine') {
      // unmount: remove the matching dynamic node (simplified: remove the last dynamic)
      const idx = nodes.findIndex(n => n.origin === 'dynamic')
      if (idx >= 0) nodes = nodes.filter((_, i) => i !== idx)
    }
    snapshots.push({ revision, nodes: [...nodes], toolCount: nodes.filter(n => n.kind === 'tool').length })
  }

  return snapshots
}
```

- [ ] **Step 4: 写 src/runtime-diff.ts**

```ts
import type { RuntimeSnapshot, RuntimeDiff, RuntimeNode } from './types.js'

/** Compute a git-style diff between two snapshots. */
export function diffRuntime(a: RuntimeSnapshot, b: RuntimeSnapshot): RuntimeDiff {
  const aIds = new Set(a.nodes.map(n => n.id))
  const bIds = new Set(b.nodes.map(n => n.id))
  const added: RuntimeNode[] = b.nodes.filter(n => !aIds.has(n.id))
  const removed: RuntimeNode[] = a.nodes.filter(n => !bIds.has(n.id))
  return {
    from: a.revision,
    to: b.revision,
    added,
    removed,
    toolCountDelta: b.toolCount - a.toolCount,
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /g/AgentDoctor && npx vitest run test/runtime-diff.test.ts`
Expected: PASS — 5 个测试全过。

- [ ] **Step 6: Commit**

```bash
git add src/runtime-snapshot.ts src/runtime-diff.ts test/runtime-diff.test.ts
git commit -m "feat: rebuild runtime snapshots and diff from cordis tool calls"
```

---

### Task 5: Context 归因

**Files:**
- Create: `src/context-attribution.ts`
- Test: `test/context-attribution.test.ts`

**Interfaces:**
- Consumes: `parseSessionLog`, `ContextSnapshot`, `ContextContribution`, `estimate`（Task 1）
- Produces: `attributeContext(parsed: ParsedSession): ContextSnapshot`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSessionLog } from '../src/session-log.js'
import { attributeContext } from '../src/context-attribution.js'

describe('attributeContext', () => {
  it('extracts system and tool-schema contributions from request/header', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const snapshot = attributeContext(parseSessionLog(text))
    const cats = snapshot.contributions.map(c => c.category)
    expect(cats).toContain('system')
    expect(cats).toContain('tool-schema')
  })

  it('labels tool-schema contribution as an estimate, not exact', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const snapshot = attributeContext(parseSessionLog(text))
    const schema = snapshot.contributions.find(c => c.category === 'tool-schema')
    expect(schema?.level).toBe('derived')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /g/AgentDoctor && npx vitest run test/context-attribution.test.ts`
Expected: FAIL — `Cannot find module '../src/context-attribution.js'`

- [ ] **Step 3: 写 src/context-attribution.ts**

```ts
import type { ParsedSession } from './session-log.js'
import type { ContextSnapshot, ContextContribution } from './types.js'

/** Rough token estimate: chars / 1.5, as a derived estimate. */
function roughTokens(text: string): number {
  return Math.round(text.length / 1.5)
}

/**
 * Attribute context composition from request/header + tool/result.
 * Important: all token attribution is an estimate (DSH tokenMeter gives only
 * a total, not semantic breakdown), so label it level: 'derived' — never
 * present fake precision. See DESIGN.md section 9.
 */
export function attributeContext(parsed: ParsedSession): ContextSnapshot {
  const contributions: ContextContribution[] = []
  let total = 0

  const header = parsed.events.filter(e => e.type === 'request/header').at(-1)
  if (header) {
    const h = header.data.header as any
    if (typeof h?.system === 'string') {
      const t = roughTokens(h.system)
      contributions.push({ category: 'system', tokens: t, level: 'derived' })
      total += t
    }
    if (Array.isArray(h?.tools)) {
      const t = roughTokens(JSON.stringify(h.tools))
      contributions.push({ category: 'tool-schema', tokens: t, level: 'derived' })
      total += t
    }
  }

  for (const e of parsed.events) {
    if (e.type === 'tool/result') {
      const content = (e.data.message as any)?.content
      const t = roughTokens(JSON.stringify(content ?? ''))
      contributions.push({ category: 'tool-result', tokens: t, level: 'derived', sourceId: String(e.seq) })
      total += t
    }
  }

  return { totalTokens: total, contributions }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /g/AgentDoctor && npx vitest run test/context-attribution.test.ts`
Expected: PASS — 2 个测试全过。

- [ ] **Step 5: Commit**

```bash
git add src/context-attribution.ts test/context-attribution.test.ts
git commit -m "feat: context attribution from header + tool results (derived estimates)"
```

---

### Task 6: demo 入口（`agent-doctor demo`）

**Files:**
- Create: `src/demo.ts`
- Create: `README.md`

**Interfaces:**
- Consumes: `parseSessionLog`, `buildRuntimeSnapshots`, `diffRuntime`, `attributeContext`（Task 2/4/5）
- Produces: a runnable `npm run demo` that prints a SAMPLE attribution + runtime diff.

- [ ] **Step 1: 写 src/demo.ts**

```ts
import { readFileSync } from 'node:fs'
import { parseSessionLog } from './session-log.js'
import { buildRuntimeSnapshots } from './runtime-snapshot.js'
import { diffRuntime } from './runtime-diff.js'
import { attributeContext } from './context-attribution.js'

function main(): void {
  const path = process.argv[2] ?? 'test/fixtures/cordis-tool-round.jsonl'
  console.log('╔══════════════════════════════════════╗')
  console.log('║  Agent Doctor — demo (SAMPLE DATA)   ║')
  console.log('╚══════════════════════════════════════╝')

  const parsed = parseSessionLog(readFileSync(path, 'utf-8'))
  console.log(`\nSession: ${parsed.header.id}`)
  console.log(`Events:  ${parsed.events.length}`)

  const snapshots = buildRuntimeSnapshots(parsed)
  console.log(`\n── Runtime snapshots ──`)
  console.log(`${snapshots.length} snapshots (revision 0 → ${snapshots[snapshots.length - 1].revision})`)

  for (let i = 1; i < snapshots.length; i++) {
    const d = diffRuntime(snapshots[i - 1], snapshots[i])
    console.log(`\nrev ${d.from} → ${d.to}`)
    for (const n of d.added) console.log(`  + ${n.name} (${n.origin})`)
    for (const n of d.removed) console.log(`  - ${n.name} (${n.origin})`)
    console.log(`  tools: ${d.toolCountDelta >= 0 ? '+' : ''}${d.toolCountDelta}`)
  }

  const ctx = attributeContext(parsed)
  console.log(`\n── Context attribution (estimate) ──`)
  console.log(`total ~${ctx.totalTokens} tokens (estimated)`)
  for (const c of ctx.contributions) {
    console.log(`  ${c.category.padEnd(14)} ~${c.tokens} (${c.level})`)
  }
}

main()
```

- [ ] **Step 2: 跑 demo 确认能输出**

Run: `cd /g/AgentDoctor && npx tsx src/demo.ts`
Expected: no error; prints session, runtime snapshots, context attribution.

- [ ] **Step 3: 写 README.md（英文，明确 SAMPLE 标注）**

```markdown
# Agent Doctor

**git for your agent** — translate DeepSeek Harness's strong observability
from "can see" to "can understand".

> ⚠️ Current status: **Phase 0 spike**. The demo output is based on
> **SAMPLE DATA** in `test/fixtures/` — it validates core capability, not
> real run data.

## Quick start

```bash
npm install
npm run demo   # print a SAMPLE attribution + runtime diff
npm test       # run all unit tests
```

## Core capability (V1 scope)

1. **runtime diff**: rebuild "what the agent changed" from cordis verbs (mount/unmount/run/stop).
2. **context attribution**: answer "why is my context this large" (all tokens are estimates, explicitly labeled).

See [DESIGN.md](DESIGN.md).
```

- [ ] **Step 4: 全量测试 + typecheck**

Run: `cd /g/AgentDoctor && npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS，无类型错误。

- [ ] **Step 5: Commit**

```bash
git add src/demo.ts README.md
git commit -m "feat: demo entry that renders sample runtime diff + context attribution"
```

---

## Self-Review 结果

**1. Spec coverage（对照 DESIGN.md）：**
- ✅ context attribution → Task 5
- ✅ runtime diff → Task 4
- ✅ 数据驱动 cordis 动词（版本漂移）→ Task 3
- ✅ 唯一事实源 / 只读 → 全局约束 + Task 2（纯解析，不写入）
- ✅ estimate 显式标注 → Task 1 truth-level + Task 5 level:'derived'
- ⚠️ `npx agent-doctor demo` 的 bin 入口：package.json 里声明了 bin，但 demo.ts 目前是 `npm run demo`（tsx 直跑）。bin 指向 `lib/demo.js` 需要编译产物，Phase 0 用 `npm run demo` 替代，正式发布再补编译。这是**有意延迟**，不是遗漏。

**2. Placeholder scan：** 无 TBD/TODO，所有代码步骤含完整实现。

**3. Type consistency：** 检查通过——`parseSessionLog` 返回 `ParsedSession`，`buildRuntimeSnapshots(parsed)` 与 `attributeContext(parsed)` 均消费同一类型；`RuntimeSnapshot` / `RuntimeDiff` / `ContextSnapshot` 在 Task 1 定义、Task 4/5 消费，命名一致。

**已知简化（Phase 0 有意为之，记录在案）：**
1. cordis 卸载逻辑「移除最后一个 dynamic 节点」是简化，正式版需按 `id` 精确匹配（`cordis_unmount` 的 arguments 里有 `id: "dyn-1"`）。
2. token 归因用 `roughTokens`（字符数/1.5）是粗估，正式版需接入 DSH tokenMeter 的 `totalTokens` 做校准。
3. cordis.yml 静态基线暂用空基线，正式版需解析 cordis.yml 合并。
4. fixture 的 `{{tools}}`/`{{system}}` 被替换成 `[]`/`""`，丢失了真实 tool schema，正式版需用含真实 tools 的 fixture。
