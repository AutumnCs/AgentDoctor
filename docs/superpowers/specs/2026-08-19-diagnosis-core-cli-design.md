# Agent Doctor — Diagnosis Core + CLI (First Brick)

> Status: approved. Scope: the first diagnosis rule + a minimal CLI, end-to-end, on a
> self-manufactured "known-truth" bad session. This is the de-risking slice: prove the
> *diagnosis layer* works, not just the data plumbing already proven in Phase 0/1.

## 1. Goal

Ship the smallest thing that proves Agent Doctor's core claim — deterministic rules →
diagnosis → evidence → explain — on a session whose root cause we already know. The
deliverable is a `diagnose` command that, given a session JSONL, prints findings that
point at the exact events that prove them.

Non-goals (explicitly deferred, to avoid bloat):
- Plugin system / auto-discovery of rules
- `git log/diff/blame` views
- Web UI / dashboard panels
- A real compiled `bin`, packaging
- `hypothesis`-level findings that correlate mutations to slowdowns (needs data we do
  not yet collect)

## 2. Architecture

Three layers, one-way dependency: `cli → diagnosis → rules → (session-log, cordis-verbs, types)`.

```
src/types.ts          # add Finding / Evidence / DiagnosisRule (next to existing domain types)
src/rules/            # one file per rule; first version has exactly one
src/diagnosis.ts      # engine: runDiagnosis(parsed) = run all rules, collect findings
src/cli.ts            # CLI entry: `diagnose` + `rules` subcommands
```

Rules do **not** depend on `runtime-snapshot`/`runtime-diff`. Phase 0's snapshot discards
`seq` and the real package name (it labels nodes `dyn-${revision}`), but diagnosis evidence
must point back to the original event `seq` and the real tool/package name. Rules read the
event stream directly via `classifyCordisCall`. `runtime-snapshot`/`runtime-diff` stay as
the substrate for a future `git log/diff` view (a different slice, not this one).

## 3. Finding / evidence model

```ts
interface Evidence {
  seq: number          // points at the original event
  eventType: string    // e.g. 'tool/call'
  summary: string      // one line: what this evidence shows
}

interface Finding {
  ruleId: string
  title: string        // e.g. "rollback on unregistered tool"
  severity: 'info' | 'warning' | 'critical'
  diagnosis: string    // conclusion, one sentence
  truthLevel: TruthLevel   // fact | derived | hypothesis | unknown
  evidence: Evidence[]     // MUST be non-empty (evidence-first)
}

interface DiagnosisRule {
  id: string
  title: string
  description: string  // feeds CLI `rules` and future Web UI panels
  analyze(parsed: ParsedSession): Finding[]
}
```

**`severity` and `truthLevel` are orthogonal.** `severity` = "how bad, if true";
`truthLevel` = "how certain the conclusion is". Keeping them separate is how
"prefer Unknown over fake certainty" lands in code: a finding can be
`truthLevel: derived, severity: warning` without pretending the derivation is a fact.

**Presentation contract (never mislead):** the `diagnosis` sentence must state, in plain
English, what is fact and what is inferred — the `truthLevel` tag is a redundant marker,
not the only honesty signal. A finding must never read as more certain than its
truthLevel. For a `derived` finding the sentence names the known part and the inferred
part separately, e.g. "Stopped plugin 'ghost-1', which was never defined or run in this
session — it may not exist (possibly cross-session state)."

## 4. First rule: runtime mutation risk

Only `fact`/`derived` truth levels for now — no `hypothesis` (that would require
correlation data like "which tool the slow traces used", which we do not collect).

### Identity model (verified against DSH source + snapshots)

The rule must key on `pluginId`, not a package name. Real DSH identity, per verb
(`packages/extensions/tool-cordis/src/index.ts` + `examples/.../advanced-toolchain/session.jsonl`):

| Verb | `tool/call` args | identity source |
|---|---|---|
| `cordis_define` | `{plugin:{kind:"new",idPrefix} \| {kind:"existing",pluginId}, name, code}` | `pluginId` returned in the matching `tool/result` `data.meta.pluginId` (e.g. `"snap-1"`), derived from `idPrefix` + counter |
| `cordis_run` | `{pluginId, packageId, mode:"run"\|"update"}` | `pluginId` in args |
| `cordis_stop` | `{pluginId}` | `pluginId` in args |
| `cordis_undefine` | `{pluginId}` | `pluginId` in args |
| `cordis_mount` (legacy) | `{code}` (no id) | **no stable id** — "temporary plugin" |
| `cordis_unmount` (legacy) | `{id:"dyn-1"}` | `id` in args |

Consequence: `cordis_mount`/`cordis_unmount` (legacy, temporary plugins) have no stable
identity and are **excluded** from this rule — they are a different, weaker lifecycle
("disappear on restart") and force-guessing them would fabricate. The rule covers only the
stable `pluginId`-based verbs (`define`/`run`/`stop`/`undefine`).

### The rule

The rule scans `cordis_*` tool/call events, normalizes verbs via `classifyCordisCall`,
resolves each `define`'s `pluginId` from its paired `tool/result` (match by `callId`, then
read `data.meta.pluginId`), and emits two kinds of findings:

- **A. rollback on ghost** — a `cordis_stop`/`cordis_undefine` whose `pluginId` was never
  `define`d in this session. `truthLevel: derived` ("never defined this session" is fact;
  "does not exist" is derived — it may come from a prior session), `severity: warning`.
  Strongest deterministic error signal. **Wording must distinguish the fact from the
  inference** (see presentation contract): the sentence asserts the fact ("was never
  defined in this session") and hedges the inference ("may not exist").
- **B. unclosed mutation** — a `cordis_run` with no matching `stop`/`undefine` for the same
  `pluginId` later in the session, i.e. still running at session end. `truthLevel: derived`,
  `severity: info`, wording honestly notes "may be intentional persistence" and that the
  signal is "still running at session end", not "leaked" (we do not know intent).

`cordis_define` alone does not raise a finding (record-only, small blast radius), but it
contributes to the "defined this session" set used by A. `cordis_stop`/`cordis_undefine`
also clear the "unclosed" set for B. The rule never emits "this mutation caused a
slowdown" — that is the Caused fake-causality DESIGN.md forbids.

### Identity-resolution edge case

If a `cordis_define` has no paired `tool/result` carrying `meta.pluginId` (missing or
malformed), that define contributes no `pluginId` to the "defined" set — a later
`stop`/`undefine` of an unknown id still raises A (honest: we did not see it defined), and
this is not a crash.

## 5. Self-manufactured bad session (known truth)

New fixture `test/fixtures/runtime-mutation-risk.jsonl`, hand-written with a known answer,
using the **real** DSH `pluginId`-based identity model (mirrors the committed
`advanced-toolchain.jsonl` shape exactly):
- `cordis_define {plugin:{kind:"new",idPrefix:"repo"}}` → result `meta.pluginId:"repo-1"`
- `cordis_run {pluginId:"repo-1", packageId:"pkg-1", mode:"run"}` then no stop → must hit B
- `cordis_stop {pluginId:"ghost-1"}` (never defined) → must hit A
- `cordis_define {plugin:{kind:"new",idPrefix:"insp"}}` → `"insp-1"`; `cordis_run {pluginId:"insp-1",...}` then `cordis_stop {pluginId:"insp-1"}` (balanced, clean) → must produce NO finding (the key false-positive guard)

Test asserts the findings contain **exactly** A (evidence pointing at ghost-1's stop seq)
and B (evidence pointing at repo-1's run seq), and nothing for insp-1.

**Honest boundary:** this proves the rule's *logic* is correct — it finds the patterns we
deliberately planted and does not false-positive on the clean case. It does **not** prove
those patterns are real-world DSH failure modes worth surfacing. The `ghost-1` /
`unclosed repo-1` scenarios are our hypotheses about what a bad session looks like;
validating them against a real, human-verified bad session remains open (no such session
exists yet). The design claims correctness of mechanism, not proven production usefulness.

## 6. CLI

Reuses git vocabulary but only two minimal subcommands, parsed from `process.argv`
(no argument-parsing dependency):
- `npx tsx src/cli.ts diagnose <session.jsonl>` — run all rules, print findings grouped by
  severity, each with a `[derived]` truth-level tag and evidence seqs
- `npx tsx src/cli.ts rules` — list rules (id / title / description)

Output is all English. No `log/diff/blame`, no `bin`, no build packaging — deferred.

## 7. Error handling

- No cordis events → no error, print "no findings" (honest, don't force a result)
- `JSON.parse` of a tool-call argument fails inside a rule → treat as `unknown`, skip,
  don't crash (don't fabricate)
- Missing session header → `parseSessionLog` already throws; CLI catches, prints a clean
  error, exits 1

## 8. Testing

- Rule unit tests on the bad fixture → exactly A + B, and no insp-1 finding
- Clean fixture (`code-mode-turn.jsonl`, no cordis events) → empty findings
- CLI smoke: `diagnose` on the bad fixture runs and prints without crashing

## 9. Self-review notes

- Placeholders: none — every interface and behavior is concrete.
- Consistency: rules read events + `classifyCordisCall` directly; the engine only
  aggregates. No hidden coupling to snapshot/diff.
- Scope: one rule, two finding kinds, two CLI subcommands, one fixture — a single
  implementation plan.
- Ambiguity: "unclosed" is defined as "run with no later stop/undefine in the same
  session", stated explicitly so it cannot be misread as cross-session.
