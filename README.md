# Agent Doctor

**`git` for your agent** — a diagnostic tool for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that translates its strong observability from *"can see"* into *"can understand"*.

Self-modifying agents change their own runtime — registering plugins, tools, listeners, and prompt contributions on the fly. When one of those changes makes the agent slower, dumber, or more expensive, nothing today tells you *what changed* or *why your context exploded*. Agent Doctor rebuilds that story from the agent's own session log, the way `git log` and `git diff` reconstruct a codebase's history.

```
$ npm run demo

╔══════════════════════════════════════╗
║  Agent Doctor — demo (SAMPLE DATA)   ║
╚══════════════════════════════════════╝

Session: 11111111-1111-4111-8111-111111111111
Events:  75

── Runtime snapshots ──
3 snapshots (revision 0 → 2)

rev 0 → 1
  + Snapshot Marker (dynamic)

rev 1 → 2
  - Snapshot Marker (dynamic)

── Context attribution (estimate) ──
total ~51256 tokens (estimated)
  system         ~30048 (derived)
  tool-schema    ~19396 (derived)
  tool-result    ~774 (derived)
  messages       ~1038 (derived)
```

## Why this exists

DeepSeek Harness is remarkable for how *observable* it is: every turn, step, tool call, and runtime mutation is already recorded in an event-sourced session log. But observability is the raw material, not the answer. When an agent regresses, the existing tools show you the data and leave you to stare at it.

Agent Doctor is the layer that answers the actual questions:

- **What changed?** — `runtime diff` rebuilds the agent's runtime topology over time, showing each plugin/tool added or removed as a `git diff`-style change.
- **Why is my context this large?** — `context attribution` breaks the context down into system, tool-schema, tool-result, and messages, so the one oversized browser result doesn't hide inside a single "176K" number.

## Design principles

These are non-negotiable — they're what makes the tool *trustworthy* rather than merely pretty:

1. **Diagnosis-first, not dashboard-first.** Every feature exists to answer a concrete question. If something can only be *drawn* but can't help you *understand*, it doesn't ship.
2. **The session log is the single source of truth.** Agent Doctor never writes to it, never invents events, and every conclusion can be reconstructed from it.
3. **Truthfulness over confidence.** Every number is tagged with a truth level — `fact`, `derived`, `hypothesis`, or `unknown`. Estimates are labeled `~estimated`, never presented as exact. If the data can't answer, the answer is *Unknown*, not a guess dressed up as a number.
4. **Evidence-first.** Every diagnosis links to the raw evidence behind it, so you can always verify the tool instead of trusting it.

The full rationale, data-source map, and product loop live in [DESIGN.md](DESIGN.md).

## Quick start

```bash
npm install
npm run demo   # print a sample runtime diff + context attribution
npm test       # run the unit test suite
```

> **Requires Node 18+** (ESM, `Array.prototype.at`, `tsx` + `vitest` 2.x).

## What works today (Phase 0)

This is a **spike**, not a product. It proves the two hardest, highest-value capabilities on real DeepSeek Harness data:

| Capability | Status | What it does |
| --- | --- | --- |
| **runtime diff** | ✅ | Rebuilds runtime snapshots from `cordis_*` tool calls and diffs them (`+`/`-` nodes) |
| **context attribution** | ✅ | Breaks context into system / tool-schema / tool-result / messages, all labeled as estimates |
| Session log parser | ✅ | Reads DSH's JSONL session format, fault-tolerant and read-only |
| Cordis verb normalization | ✅ | Data-driven mapping of DSH's self-modification verbs (`cordis_mount`/`unmount` legacy ↔ `cordis_define`/`run`/`stop`/`undefine` current) |

## What's deliberately not here yet

- **Real token counts.** Context attribution currently estimates tokens from content length (`chars / 1.5`). Wiring DSH's `tokenMeter` for authoritative `totalTokens` is the next milestone.
- **A UI.** The output is terminal text today. A git-diff-style visual interface is planned.
- **Doctor Chat / natural-language Q&A.** The data layer comes first; an LLM that explains it comes after, and will never be the source of truth.
- **Compilation to a published binary.** `npm run demo` runs via `tsx`; the `bin` entry points at `lib/demo.js`, which isn't built yet.

## Honesty about the numbers

The demo's `~30048` system tokens are an *estimate*, not what DeepSeek's token meter reported. They're trustworthy for **magnitude and trend** — "the system prompt is the largest contributor, by far" — but not for **fine-grained comparison** ("this tool result is 1 token larger than that one"). When two estimates are close, the honest answer is "roughly equal," not a forced ranking.

## Repository layout

```
src/
  session-log.ts          # parse DSH session JSONL → events
  cordis-verbs.ts         # data-driven normalization of cordis self-modification verbs
  runtime-snapshot.ts     # rebuild runtime topology snapshots
  runtime-diff.ts         # git-style diff between snapshots
  context-attribution.ts  # attribute context composition (system/messages/tool-result/tool-schema)
  truth-level.ts          # the fact/derived/hypothesis/unknown taxonomy
  types.ts                # core domain types
  demo.ts                 # the demo entry point
test/
  fixtures/               # real DSH session logs (de-redacted)
```

## Status

Phase 0 spike. Not yet a stable API — interfaces may change as real token data and the UI land. Contributions and feedback welcome; open an issue first to align on scope.

## License

MIT
