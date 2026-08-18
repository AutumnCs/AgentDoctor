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
