# Diagnosis Core + CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first diagnosis rule (runtime mutation risk) plus a minimal `diagnose`/`rules` CLI, end-to-end on a self-manufactured "known-truth" bad session, proving the diagnosis layer works — deterministic rules → diagnosis → evidence → explain.

**Architecture:** Three layers, one-way dependency `cli → diagnosis → rules → (session-log, types)`. Rules read the event stream directly (not `runtime-snapshot`, which drops `seq` and real `pluginId`). Identity is DSH's `pluginId` model: `cordis_define` returns `pluginId` in its `tool/result` `data.meta.pluginId`; `cordis_run`/`cordis_stop`/`cordis_undefine` carry `pluginId` in `tool/call` args; legacy `cordis_mount`/`cordis_unmount` have no stable id and are ignored.

**Tech Stack:** TypeScript (ESM, NodeNext, `.js` import extensions, strict), vitest. No new dependencies.

## Global Constraints

- **全英文**：comments, test names, commit messages, CLI output — all English.
- **Truthfulness**: a finding's `diagnosis` sentence must separate fact from inference in plain English (the `truthLevel` tag is redundant, not the only honesty signal). Never read more certain than its `truthLevel`. This rule only emits `derived`.
- **Evidence-first**: every `Finding.evidence` array must be non-empty; each `Evidence.seq` points at the original event.
- **Read-only / zero-coupling**: only read session JSONL; no new runtime deps; no DSH-internal imports.
- **Module system**: ESM, `"type": "module"`, `NodeNext` — relative imports MUST use `.js` extensions (e.g. `import { x } from './types.js'`).
- **TypeScript strict**: `tsc --noEmit` must pass with zero errors.

---

### Task 1: Domain types for findings

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: `TruthLevel` (already imported in `types.ts` from `./truth-level.js`); `ParsedSession` (from `./session-log.js` — new import).
- Produces: `Evidence`, `Finding`, `DiagnosisRule` — consumed by Task 2 (the rule) and Task 3 (the engine).

- [ ] **Step 1: Add the import and three types to `src/types.ts`**

At the top of `src/types.ts`, the existing first line is:
```ts
import type { TruthLevel } from './truth-level.js'
```
Change it to add a second import:
```ts
import type { TruthLevel } from './truth-level.js'
import type { ParsedSession } from './session-log.js'
```

Append the following three interfaces to the end of `src/types.ts`:
```ts
/** One piece of evidence backing a finding: a pointer to the original event. */
export interface Evidence {
  seq: number
  eventType: string
  summary: string
}

/** A diagnosis produced by a rule: a conclusion plus the evidence that supports it. */
export interface Finding {
  ruleId: string
  title: string
  severity: 'info' | 'warning' | 'critical'
  diagnosis: string
  truthLevel: TruthLevel
  evidence: Evidence[]
}

/** A self-contained, deterministic diagnosis rule over a parsed session log. */
export interface DiagnosisRule {
  id: string
  title: string
  description: string
  analyze(parsed: ParsedSession): Finding[]
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (types resolve; no runtime behavior yet, so no unit test).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add finding/evidence/diagnosis-rule domain types"
```

---

### Task 2: runtime-mutation-risk rule + known-truth fixture + tests

**Files:**
- Create: `src/rules/runtime-mutation-risk.ts`
- Create: `test/fixtures/runtime-mutation-risk.jsonl`
- Create: `test/runtime-mutation-risk.test.ts`

**Interfaces:**
- Consumes: `ParsedSession`, `SessionEvent` (from `../session-log.js`); `Finding`, `DiagnosisRule` (from `../types.js`).
- Produces: `runtimeMutationRiskRule: DiagnosisRule` — consumed by Task 3 (the engine).

- [ ] **Step 1: Create the known-truth fixture**

Write the file `test/fixtures/runtime-mutation-risk.jsonl` with exactly this content (verbatim — the escaping in the `arguments` strings is intentional and must be preserved):

```
{"type":"session","version":0,"id":"mut-risk-0001","createdAt":1786550000000,"cwd":"G:/AgentDoctor"}
{"type":"tool/call","seq":100,"time":1786550000100,"data":{"turn":1,"step":1,"callId":"def-repo","name":"cordis_define","arguments":"{\"plugin\":{\"kind\":\"new\",\"idPrefix\":\"repo\"},\"name\":\"Repo Reviewer\",\"purpose\":\"Review repository state.\",\"code\":{\"host\":\"return { apply() {} }\"}}"}}
{"type":"tool/result","seq":101,"time":1786550000200,"data":{"turn":1,"step":1,"message":{"source":{"kind":"tool","callId":"def-repo"},"content":[{"type":"tool-result","toolCallId":"def-repo","content":[{"type":"text","text":"Defined repo-1/pkg-1 (Repo Reviewer); it is not running yet. Use cordis_run to activate this Package."}],"isError":false}],"role":"user","id":"r101"},"meta":{"pluginId":"repo-1","packageId":"pkg-1"}}}
{"type":"tool/call","seq":102,"time":1786550000300,"data":{"turn":1,"step":2,"callId":"run-repo","name":"cordis_run","arguments":"{\"pluginId\":\"repo-1\",\"packageId\":\"pkg-1\",\"mode\":\"run\"}"}}
{"type":"tool/result","seq":103,"time":1786550000400,"data":{"turn":1,"step":2,"message":{"source":{"kind":"tool","callId":"run-repo"},"content":[{"type":"tool-result","toolCallId":"run-repo","content":[{"type":"text","text":"repo-1/pkg-1 is running (run-1)."}],"isError":false}],"role":"user","id":"r103"}}}
{"type":"tool/call","seq":110,"time":1786550000500,"data":{"turn":1,"step":3,"callId":"stop-ghost","name":"cordis_stop","arguments":"{\"pluginId\":\"ghost-1\"}"}}
{"type":"tool/result","seq":111,"time":1786550000600,"data":{"turn":1,"step":3,"message":{"source":{"kind":"tool","callId":"stop-ghost"},"content":[{"type":"tool-result","toolCallId":"stop-ghost","content":[{"type":"text","text":"Dynamic Plugin ghost-1 is stopped; its definition and versions remain."}],"isError":false}],"role":"user","id":"r111"}}}
{"type":"tool/call","seq":120,"time":1786550000700,"data":{"turn":1,"step":4,"callId":"def-insp","name":"cordis_define","arguments":"{\"plugin\":{\"kind\":\"new\",\"idPrefix\":\"insp\"},\"name\":\"Inspect PR\",\"purpose\":\"Inspect a pull request.\",\"code\":{\"host\":\"return { apply() {} }\"}}"}}
{"type":"tool/result","seq":121,"time":1786550000800,"data":{"turn":1,"step":4,"message":{"source":{"kind":"tool","callId":"def-insp"},"content":[{"type":"tool-result","toolCallId":"def-insp","content":[{"type":"text","text":"Defined insp-1/pkg-1 (Inspect PR); it is not running yet. Use cordis_run to activate this Package."}],"isError":false}],"role":"user","id":"r121"},"meta":{"pluginId":"insp-1","packageId":"pkg-1"}}}
{"type":"tool/call","seq":122,"time":1786550000900,"data":{"turn":1,"step":5,"callId":"run-insp","name":"cordis_run","arguments":"{\"pluginId\":\"insp-1\",\"packageId\":\"pkg-1\",\"mode\":\"run\"}"}}
{"type":"tool/result","seq":123,"time":1786550001000,"data":{"turn":1,"step":5,"message":{"source":{"kind":"tool","callId":"run-insp"},"content":[{"type":"tool-result","toolCallId":"run-insp","content":[{"type":"text","text":"insp-1/pkg-1 is running (run-1)."}],"isError":false}],"role":"user","id":"r123"}}}
{"type":"tool/call","seq":124,"time":1786550001100,"data":{"turn":1,"step":6,"callId":"stop-insp","name":"cordis_stop","arguments":"{\"pluginId\":\"insp-1\"}"}}
{"type":"tool/result","seq":125,"time":1786550001200,"data":{"turn":1,"step":6,"message":{"source":{"kind":"tool","callId":"stop-insp"},"content":[{"type":"tool-result","toolCallId":"stop-insp","content":[{"type":"text","text":"Dynamic Plugin insp-1 is stopped; its definition and versions remain."}],"isError":false}],"role":"user","id":"r125"}}}
```

Verify it parses as valid JSONL:
```bash
python -c "import json; [json.loads(l) for l in open('test/fixtures/runtime-mutation-risk.jsonl', encoding='utf-8') if l.strip()]; print('VALID')"
```
Expected: `VALID`.

- [ ] **Step 2: Write the failing test**

Create `test/runtime-mutation-risk.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSessionLog } from '../src/session-log.js'
import { runtimeMutationRiskRule } from '../src/rules/runtime-mutation-risk.js'

describe('runtime mutation risk rule', () => {
  const bad = runtimeMutationRiskRule.analyze(parseSessionLog(
    readFileSync('test/fixtures/runtime-mutation-risk.jsonl', 'utf-8')))

  it('reports exactly two findings', () => {
    expect(bad).toHaveLength(2)
  })

  it('flags a rollback on a plugin never defined or run this session (ghost-1)', () => {
    const ghosts = bad.filter(f => f.title === 'rollback on unregistered plugin')
    expect(ghosts).toHaveLength(1)
    expect(ghosts[0].severity).toBe('warning')
    expect(ghosts[0].truthLevel).toBe('derived')
    expect(ghosts[0].evidence.some(e => e.seq === 110)).toBe(true)
    expect(ghosts[0].evidence.some(e => e.summary.includes('ghost-1'))).toBe(true)
  })

  it('flags a mutation left running at session end (repo-1)', () => {
    const unclosed = bad.filter(f => f.title === 'unclosed mutation')
    expect(unclosed).toHaveLength(1)
    expect(unclosed[0].severity).toBe('info')
    expect(unclosed[0].truthLevel).toBe('derived')
    expect(unclosed[0].evidence.some(e => e.seq === 102)).toBe(true)
    expect(unclosed[0].evidence.some(e => e.summary.includes('repo-1'))).toBe(true)
  })

  it('does not flag the balanced run-then-stop of insp-1', () => {
    const mentions = bad.filter(f =>
      f.diagnosis.includes('insp-1') || f.evidence.some(e => e.summary.includes('insp-1')))
    expect(mentions).toHaveLength(0)
  })

  it('produces no findings on a clean session with no cordis mutation', () => {
    const clean = runtimeMutationRiskRule.analyze(parseSessionLog(
      readFileSync('test/fixtures/code-mode-turn.jsonl', 'utf-8')))
    expect(clean).toEqual([])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/runtime-mutation-risk.test.ts`
Expected: FAIL — `Cannot find module '../src/rules/runtime-mutation-risk.js'`.

- [ ] **Step 4: Write the rule**

Create `src/rules/runtime-mutation-risk.ts`:

```ts
import type { ParsedSession } from '../session-log.js'
import type { Finding, DiagnosisRule } from '../types.js'

/** The four current-vocabulary cordis verbs that mutate a stable pluginId. */
const MUTATION_VERBS = new Set(['cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine'])

/** Parse a tool/call `arguments` JSON string into an object, or null if absent/malformed. */
function parseArgs(data: Record<string, unknown>): Record<string, unknown> | null {
  const raw = data.arguments
  if (typeof raw !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

/** Read a string field from a tool/call event data record, or undefined. */
function strField(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key]
  return typeof v === 'string' ? v : undefined
}

/**
 * Runtime mutation risk: flags cordis self-modification hazards over a session.
 * Identity is DSH's pluginId: define returns it in the tool/result meta; run/stop/
 * undefine carry it in call args. Legacy mount/unmount (temporary plugins, no stable
 * id) are excluded. Emits only `derived` findings.
 */
export const runtimeMutationRiskRule: DiagnosisRule = {
  id: 'runtime-mutation-risk',
  title: 'Runtime mutation risk',
  description: 'Flags cordis self-modification hazards: rollbacks on plugins never defined or run this session, and mutations left running at session end.',
  analyze(parsed: ParsedSession): Finding[] {
    // First pass: resolve each cordis_define's pluginId from its paired tool/result meta.
    const defineResultPluginIds = new Map<string, string>()
    for (const e of parsed.events) {
      if (e.type !== 'tool/result') continue
      const d = e.data as any
      const callId = d?.message?.content?.[0]?.toolCallId
      const pluginId = d?.meta?.pluginId
      if (typeof callId === 'string' && typeof pluginId === 'string') {
        defineResultPluginIds.set(callId, pluginId)
      }
    }

    const calls = parsed.events.filter(e =>
      e.type === 'tool/call' && MUTATION_VERBS.has(String(e.data.name)))

    const findings: Finding[] = []
    const exists = new Set<string>()          // pluginIds seen this session (define result or run args)
    const running = new Map<string, number>() // pluginId -> latest run seq, cleared by stop/undefine

    for (const e of calls) {
      const name = String(e.data.name)
      const args = parseArgs(e.data)

      if (name === 'cordis_define') {
        const callId = strField(e.data, 'callId') ?? ''
        const pluginId = defineResultPluginIds.get(callId)
        if (pluginId) exists.add(pluginId)
        // record-only: no finding on its own
      } else if (name === 'cordis_run') {
        const pluginId = args && typeof args.pluginId === 'string' ? args.pluginId : undefined
        if (pluginId) {
          exists.add(pluginId)
          running.set(pluginId, e.seq)
        }
      } else { // cordis_stop | cordis_undefine
        const pluginId = args && typeof args.pluginId === 'string' ? args.pluginId : undefined
        if (pluginId) {
          if (!exists.has(pluginId)) {
            const action = name === 'cordis_stop' ? 'Stopped' : 'Removed'
            findings.push({
              ruleId: 'runtime-mutation-risk',
              title: 'rollback on unregistered plugin',
              severity: 'warning',
              truthLevel: 'derived',
              diagnosis: `${action} plugin '${pluginId}', which was never defined or run in this session — it may not exist (possibly cross-session state).`,
              evidence: [{
                seq: e.seq,
                eventType: 'tool/call',
                summary: `${name} targeting plugin '${pluginId}' with no prior define/run in this session`,
              }],
            })
          }
          running.delete(pluginId)
        }
      }
    }

    // Any plugin still running at session end is an unclosed mutation.
    for (const [pluginId, seq] of running) {
      findings.push({
        ruleId: 'runtime-mutation-risk',
        title: 'unclosed mutation',
        severity: 'info',
        truthLevel: 'derived',
        diagnosis: `Plugin '${pluginId}' was run and never stopped or removed in this session — still running at session end (may be intentional persistence).`,
        evidence: [{
          seq,
          eventType: 'tool/call',
          summary: `cordis_run of '${pluginId}' with no later stop/undefine in this session`,
        }],
      })
    }

    return findings
  },
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/runtime-mutation-risk.test.ts`
Expected: PASS — 5/5.

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all existing tests (16) + new tests (5) pass; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/rules/runtime-mutation-risk.ts test/fixtures/runtime-mutation-risk.jsonl test/runtime-mutation-risk.test.ts
git commit -m "feat: add runtime-mutation-risk rule with known-truth fixture and tests"
```

---

### Task 3: diagnosis engine + CLI

**Files:**
- Create: `src/diagnosis.ts`
- Create: `src/cli.ts`

**Interfaces:**
- Consumes: `ParsedSession` (from `./session-log.js`); `Finding`, `DiagnosisRule` (from `./types.js`); `runtimeMutationRiskRule` (from `./rules/runtime-mutation-risk.js`).
- Produces: `RULES: DiagnosisRule[]`, `runDiagnosis(parsed): Finding[]` — the public entry point the CLI uses.

- [ ] **Step 1: Write the engine**

Create `src/diagnosis.ts`:

```ts
import type { ParsedSession } from './session-log.js'
import type { Finding, DiagnosisRule } from './types.js'
import { runtimeMutationRiskRule } from './rules/runtime-mutation-risk.js'

/** All registered diagnosis rules. Add a rule here to enable it. */
export const RULES: DiagnosisRule[] = [
  runtimeMutationRiskRule,
]

/** Run every registered rule over a parsed session and collect all findings. */
export function runDiagnosis(parsed: ParsedSession): Finding[] {
  const findings: Finding[] = []
  for (const rule of RULES) {
    findings.push(...rule.analyze(parsed))
  }
  return findings
}
```

- [ ] **Step 2: Write the CLI**

Create `src/cli.ts`:

```ts
import { readFileSync } from 'node:fs'
import { parseSessionLog } from './session-log.js'
import { RULES, runDiagnosis } from './diagnosis.js'
import type { Finding } from './types.js'

const SEVERITY_ORDER: Record<Finding['severity'], number> = { critical: 0, warning: 1, info: 2 }

function printFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log('no findings')
    return
  }
  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  for (const f of sorted) {
    console.log(`\n[${f.severity}] [${f.truthLevel}] ${f.title}`)
    console.log(`  ${f.diagnosis}`)
    for (const ev of f.evidence) {
      console.log(`  evidence: seq ${ev.seq} (${ev.eventType}) — ${ev.summary}`)
    }
  }
}

function main(): void {
  const [cmd, arg] = process.argv.slice(2)

  if (cmd === 'rules') {
    for (const r of RULES) {
      console.log(`${r.id} — ${r.title}`)
      console.log(`  ${r.description}`)
    }
    return
  }

  if (cmd === 'diagnose') {
    if (!arg) {
      console.error('usage: npx tsx src/cli.ts diagnose <session.jsonl>')
      process.exit(1)
    }
    let text: string
    try {
      text = readFileSync(arg, 'utf-8')
    } catch {
      console.error(`error: cannot read ${arg}`)
      process.exit(1)
    }
    try {
      const parsed = parseSessionLog(text)
      printFindings(runDiagnosis(parsed))
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
    return
  }

  console.error('usage: npx tsx src/cli.ts <diagnose <session.jsonl> | rules>')
  process.exit(1)
}

main()
```

- [ ] **Step 3: Smoke test the CLI**

Run: `npx tsx src/cli.ts diagnose test/fixtures/runtime-mutation-risk.jsonl`
Expected: prints two findings — `[warning] [derived] rollback on unregistered plugin` (evidence seq 110) and `[info] [derived] unclosed mutation` (evidence seq 102) — and exits 0.

Run: `npx tsx src/cli.ts diagnose test/fixtures/code-mode-turn.jsonl`
Expected: prints `no findings` and exits 0.

Run: `npx tsx src/cli.ts rules`
Expected: prints the `runtime-mutation-risk` rule id, title, and description.

- [ ] **Step 4: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all 21 tests pass; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/diagnosis.ts src/cli.ts
git commit -m "feat: add diagnosis engine and CLI"
```

---

## Self-Review

**Spec coverage:**
- Types `Finding`/`Evidence`/`DiagnosisRule` → Task 1.
- Runtime-mutation-risk rule (pluginId identity, exists/running sets, two findings) → Task 2.
- Known-truth fixture (repo-1 unclosed, ghost-1 rollback, insp-1 clean) → Task 2 Step 1.
- Rule unit tests incl. clean-session test → Task 2 Step 2.
- Diagnosis engine `runDiagnosis` + `RULES` → Task 3 Step 1.
- CLI `diagnose` + `rules` subcommands → Task 3 Steps 2–3.
- Error handling (unreadable file, bad parse) → Task 3 Step 2 CLI `try/catch`.

**Placeholder scan:** none — every task has full code and exact commands.

**Type consistency:** `runtimeMutationRiskRule` exported from `src/rules/runtime-mutation-risk.ts` (Task 2) and imported as the same name in `src/diagnosis.ts` (Task 3). `Finding.severity` values `'info'|'warning'|'critical'` and `Finding.truthLevel: TruthLevel` match the types added in Task 1. Finding titles `'rollback on unregistered plugin'` and `'unclosed mutation'` are identical between the rule (Task 2 Step 4) and the tests (Task 2 Step 2).

**Note on finding titles:** the spec's §3 interface example says `"rollback on unregistered tool"`; the §4 heading says `"rollback on ghost"`. This plan uses the corrected, developer-facing title `"rollback on unregistered plugin"` (the DSH term is "plugin", not "tool"; "ghost" is internal jargon). The §4 identity-model section is the normative source.
