# Agent Doctor

**Agent Doctor** is an experimental, read-only diagnostic tool for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). It turns selected session-log evidence about self-modifying plugins into findings a developer can inspect and verify.

Self-modifying agents change their own runtime — registering plugins, tools, and listeners on the fly. When one of those changes goes wrong, Agent Doctor can reconstruct a small, evidence-backed part of that story from the agent's session log. It is closer to a DSH session linter/forensic helper than a general-purpose debugging platform.

## The core idea

Most agent tools give you *more data* or *an LLM's summary*. Agent Doctor gives you neither. It gives you **deterministic, evidence-backed findings**:

- It **never invents** an explanation. It reports only what the log says.
- Every conclusion is tagged with a truth level (`fact` / `derived` / `hypothesis` / `unknown`).
- When the log can't answer, the answer is *"unknown"* — not a confident-sounding guess.

The point is to support a developer's **judgment** over an agent that is modifying itself. Each finding includes the event sequence (`seq`) behind it. The current HTML view displays those pointers; it does not yet open the raw event inline.

## What it catches (real example)

In a real DSH session, an agent set out to register a new tool called `greet`. It ran the plugin, then spent six steps debugging why the tool never showed up. The bug: `ctx.effect(() => dispose())` runs `dispose()` immediately, so the tool was unregistered the instant it registered.

Agent Doctor surfaces that in one line, with evidence:

```bash
$ npx tsx src/cli.ts diagnose session.jsonl

[warning] [derived] Run activated but tool did not register
  Plugin 'grx-1' was run, but its declared tool(s) 'greet' did not appear in
  the tool list immediately after activation — the tool was not visible then
  (registration may have failed or been reverted).
  evidence: seq 6525 (tool/call) — cordis_run of 'grx-1'
  evidence: seq 6621 (tool/result) — tool list after run is missing 'greet'
```

And it shows the full evolution as a `git diff`-style story:

```bash
$ npx tsx src/cli.ts evolve session.jsonl

Agent tool-surface evolution (declared vs observed)

rev 6437  define  grx-1
          declares tool(s): 'greet'
rev 6525  run     grx-1/pkg-1
          ~ tool 'greet'  declared but not visible in snapshot @6621 (may have failed to register, been reverted, or not been a DSL-shaped tool)
rev 11498 define  grx-1
          declares tool(s): 'greet'
rev 11578 run     grx-1/pkg-2
          + tool 'greet'  (observed in snapshot @11634)
```

The `~` line is the finding: the agent *claimed* to add `greet`, but the tool list that followed showed it absent.

## Quick start

```bash
npm install

# Diagnose a session (run all rules, print findings with evidence)
npx tsx src/cli.ts diagnose <session.jsonl>

# Show the agent's tool-surface evolution, declared vs observed
npx tsx src/cli.ts evolve <session.jsonl>

# Write a self-contained HTML version of the evolution view
npx tsx src/cli.ts view <session.jsonl> [out.html]

# List registered rules
npx tsx src/cli.ts rules

npm test   # run the unit test suite (32 tests)
```

> **Requires Node 18+.** DSH stores sessions as zstd-compressed JSONL (`*.jsonl.zstd`); decompress with `zstd -d` before passing the `.jsonl` to the CLI.

## Design principles

These are non-negotiable — they're what makes the tool *trustworthy* rather than merely pretty:

1. **Diagnosis-first, not dashboard-first.** Every feature answers a concrete question. If something can only be *drawn* but can't help you *understand*, it doesn't ship.
2. **The session log is the single source of truth.** Agent Doctor never writes to it, never invents events, and every conclusion can be reconstructed from it.
3. **Truthfulness over confidence.** Every number and claim is tagged with a truth level. Estimates are labeled, never presented as exact. If the data can't answer, the answer is *Unknown*.
4. **Evidence-first.** Every finding links to the raw event (`seq`) behind it, so you can always verify the tool instead of trusting it.

## What works today

| Capability | Status | What it does |
| --- | --- | --- |
| **`diagnose`** | ✅ | Runs rules and prints findings with evidence, tagged by truth level |
| **`evolve`** | ✅ | Rebuilds the agent's tool-surface evolution as declared-vs-observed diffs |
| **`view`** | ✅ | Writes a self-contained HTML rendering of the evolution view |
| `run-but-not-registered` rule | ✅ | Flags a run whose declared tool never appeared (validated on a real session) |
| `runtime-mutation-risk` rule | ✅ | Flags stop/undefine on a plugin never defined/run this session |
| Session log parser | ✅ | Reads DSH JSONL text, read-only and fault-tolerant; decompress `.jsonl.zstd` before passing it to the CLI |
| Context attribution | ✅ | Breaks context into system/tool-schema/tool-result/messages; `factTotalTokens` anchored on DSH-reported usage |

## Honest boundaries

This tool is honest about what the data *can't* tell you:

- **The on-disk log has no tool-level topology.** It records plugin-level lifecycle (`define`/`run`/`stop`/`undefine`), but not "which specific tools a plugin registered." Tool names are therefore **recovered heuristically** from the plugin's `defineTool({ name: ... })` code (DSH's DSL shape), not parsed from the real runtime. A tool registered any other way is missed — that's under-reporting, never wrong-reporting.
- **"Not visible in the snapshot" ≠ "failed to register."** The wording deliberately hedges: a tool absent from one `listTools` snapshot could have failed, been reverted, or been mistimed. The finding says "may have", never "did".
- **These are `derived` findings, not `fact`.** Only the raw `usage` totals from DSH's `assistant/message` events are `fact`; everything reconstructed from the log is `derived`.

## Current scope and limits

- **A full visual debugger.** `view` is a small self-contained HTML rendering of the same evolution data; it is not an interactive raw-event browser.
- **Doctor Chat / natural-language Q&A.** An LLM that explains findings may come later, but it will **never** be the source of truth — it would only rephrase what the deterministic rules already established.
- **More rules.** The existing rules came from a small number of real or known-truth sessions. New rules need more real failure sessions to mine — no synthetic scenarios.

## Repository layout

```
src/
  session-log.ts          # parse DSH session JSONL → events
  cordis-verbs.ts         # data-driven normalization of cordis self-modification verbs
  cordis-tools.ts         # shared helpers: declare/observe, tool-name extraction, snapshots
  rules/                  # one file per diagnosis rule
    runtime-mutation-risk.ts
    run-but-not-registered.ts
  diagnosis.ts            # rule registry + runDiagnosis
  evolution.ts            # declared-vs-observed tool-surface rendering
  context-attribution.ts  # context composition (fact total + derived categories)
  cli.ts                  # diagnose / evolve / rules entry point
  truth-level.ts          # the fact/derived/hypothesis/unknown taxonomy
  types.ts                # core domain types
test/
  fixtures/               # real DSH session logs (de-redacted)
```

## Status

Early experimental software: the core capability — catching one real self-modification bug with evidence — is validated against a DeepSeek Harness session. The public API (finding shapes, rule interface, and CLI packaging) may still change. It is currently aimed at DSH developers who already have a session log, not at first-time agent users.

## License

MIT
