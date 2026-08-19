# Agent Doctor — Phase 1: Real Token Attribution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 context attribution 从"纯字符估算"升级为"锚定 DSH 真实报告的 token 总量（fact）+ 按比例分摊的语义分项（derived）"，让"context 为什么这么大"这条核心差异化从"可看趋势"升级到"可信量级"。

**Architecture:** 读 DSH 真实落盘格式里 `assistant/message.data.usage`（DSH/provider 直接报告的 fact），取 billed input = `inputTokens + cacheReadTokens + cacheWriteTokens`，作为 context 的**权威总量**。语义分项（system/messages/tool-result/tool-schema）仍然只能按内容长度比例分摊（derived），因为 DSH 落盘 log 里没有语义分项，只有总量——所以 `totalTokens`（fact）和分项之和（derived）**允许不严格相等**，UI 必须诚实展示这个边界。

**Tech Stack:** TypeScript + Node 18+，vitest。

## Global Constraints

- **唯一事实源 / 只读**：只读 session JSONL，不 hook token-meter runtime 服务、不依赖 DSH 内部包（保持零耦合、DSH 升级不破坏）。
- **Truthfulness 分层**：
  - `usage` 里的 token 总量是 **fact**（DSH/provider 直接报告）。
  - 语义分项是 **derived**（按内容长度比例分摊，无 log 支撑精确分类）。
  - fact 总量 ≠ derived 分项之和时，**明确标注这个差异**，绝不伪造"它们相等"。
  - 占位符（`{{system}}`/`{{tools}}`）一律不产生贡献。
- **全英文**：注释、测试、commit、demo 输出。
- **数据驱动**：cordis 动词映射不写死（Phase 0.5 已做，本阶段不重复改）。

## 已核实的事实（计划依据）

- `TokenUsage` 定义（`packages/llm/llm/src/types.ts`）：`inputTokens`（**未缓存输入**）、`outputTokens`、`cacheReadTokens?`、`cacheWriteTokens?`、`reasoningTokens?`。**billed input = inputTokens + cacheReadTokens + cacheWriteTokens**（注释原文："billed input = sum of the three"）。
- `assistant/message.data.usage` 就是 DSH 报告的 fact，直接落盘在 JSONL 里。
- 真实 usage 的 fixture：`code-mode-turn`（**fact anchor = 6389**，见下）、`both-mode-turn`（10400, 有同样两个文件）。
- **`code-mode-turn` 有 2 个 `assistant/message` 事件**：seq 188（step 1）usage = `{inputTokens:6152, cacheReadTokens:0}`，seq 252（step 2，最后一个）usage = `{inputTokens:117, cacheReadTokens:6272}`。billed = inputTokens + cacheReadTokens + cacheWriteTokens，所以 fact 总量锚定值是 **6389**（117 + 6272 + 0），**不是** 6152（那是第一个 message 的 billed）。
- `tool-schemas.expected.json` 是对象 `{initial: [...], changes: []}`，**不是裸数组**；de-redact 时 splice 的是 `sidecar['initial']`，不是整个文件内容。`system-prompt.expected.md` 里也含一个 `{{cwd}}` 占位符，同样要替换。
- `bash-tool-turn` 有真实 usage 但**无**配套 de-redacted 文件（只有 input.json + stdout），不选它。
- 语义分项在落盘 log 里**不存在**（只有 token-meter 运行时服务能算，但那是 runtime-only，不接）。

---

### Task 1: 引入 fact 总量（usage）到 ContextSnapshot

**Files:**
- Modify: `src/types.ts`
- Modify: `src/context-attribution.ts`
- Modify: `test/context-attribution.test.ts`

**Interfaces:**
- Consumes: `parseSessionLog`（已有）
- Produces: `ContextSnapshot` 增加 `factTotalTokens?: number` 字段；`attributeContext` 从最后一个 `assistant/message` 的 `usage` 提取 billed input 作为 fact 总量。

- [ ] **Step 1: 改 types.ts，给 ContextSnapshot 加 fact 总量字段**

```ts
/** A context snapshot: total plus per-category contributions. */
export interface ContextSnapshot {
  /** Derived sum of per-category estimates (chars/1.5 proportion). */
  totalTokens: number
  /** FACT: billed input reported by DSH/provider (inputTokens + cacheReadTokens + cacheWriteTokens). Absent when no usage recorded. */
  factTotalTokens?: number
  contributions: ContextContribution[]
}
```

- [ ] **Step 2: 改 context-attribution.ts，提取 fact 总量**

在 `attributeContext` 末尾提取最后一个 `assistant/message` 的 usage：

```ts
  // FACT total: billed input from the last assistant/message usage (DSH/provider reported)
  let factTotalTokens: number | undefined
  for (let i = parsed.events.length - 1; i >= 0; i--) {
    const e = parsed.events[i]
    if (e.type !== 'assistant/message') continue
    const usage = (e.data as any).usage
    if (usage && typeof usage.inputTokens === 'number') {
      factTotalTokens = (usage.inputTokens ?? 0)
        + (usage.cacheReadTokens ?? 0)
        + (usage.cacheWriteTokens ?? 0)
      break
    }
  }

  return { totalTokens: total, ...(factTotalTokens !== undefined ? { factTotalTokens } : {}), contributions }
```

- [ ] **Step 3: 复制 + de-redact code-mode-turn fixture**

```bash
cp /g/deepseek-harness/examples/acp-agent/tests/snapshots/code-mode-turn/session.jsonl /g/AgentDoctor/test/fixtures/code-mode-turn.jsonl
cd /g/AgentDoctor
python - <<'PY'
import json
p = 'test/fixtures/code-mode-turn.jsonl'
lines = open(p, encoding='utf-8').read().split('\n')
sidecar = '/g/deepseek-harness/examples/acp-agent/tests/snapshots/code-mode-turn'
sys_prompt = open(sidecar + '/system-prompt.expected.md', encoding='utf-8').read()
tools = json.load(open(sidecar + '/tool-schemas.expected.json', encoding='utf-8'))
tools_json = json.dumps(tools['initial'])  # tool-schemas.expected.json is {initial: [...], changes: []}, NOT a raw array
out = []
for line in lines:
    if '"{{system}}"' in line:
        line = line.replace('"{{system}}"', json.dumps(sys_prompt))
    if '"{{tools}}"' in line:
        line = line.replace('"{{tools}}"', tools_json)
    line = line.replace('{{cwd}}', 'G:/AgentDoctor')  # also hits the one {{cwd}} inside system_prompt
    out.append(line)
open(p, 'w', encoding='utf-8').write('\n'.join(out))
PY
python -c "import json; [json.loads(l) for l in open('test/fixtures/code-mode-turn.jsonl', encoding='utf-8') if l.strip()]"
```
Expected: 无异常，无 `{{` 残留，所有行合法 JSON，最后一行 `assistant/message` 的 billed = 6389。

- [ ] **Step 4: 写失败测试（断言 fact 总量在真实 usage fixture 上正确）**

在 `test/context-attribution.test.ts` 顶部加 `import { readFileSync } from 'node:fs'`（若已有则跳过），并新增一个 describe：

```ts
describe('attributeContext on real-usage fixture', () => {
  const text = readFileSync('test/fixtures/code-mode-turn.jsonl', 'utf-8')
  const snapshot = attributeContext(parseSessionLog(text))

  it('anchors a non-trivial FACT total from real usage', () => {
    expect(snapshot.factTotalTokens).toBeDefined()
    // code-mode-turn's LAST assistant/message (seq 252, step 2): inputTokens 117 + cacheRead 6272 + cacheWrite 0
    expect(snapshot.factTotalTokens).toBe(6389)
  })

  it('keeps the derived total honest (does not claim to equal the fact total)', () => {
    expect(snapshot.totalTokens).toBeGreaterThan(0)
    expect(snapshot.totalTokens).not.toBe(snapshot.factTotalTokens)
  })
})
```

Run: `cd /g/AgentDoctor && npx vitest run test/context-attribution.test.ts`
Expected: FAIL — `snapshot.factTotalTokens` is undefined (field doesn't exist yet).

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /g/AgentDoctor && npx vitest run test/context-attribution.test.ts`
Expected: PASS — factTotalTokens === 6389 on the real fixture; the advanced-toolchain tests still pass (factTotalTokens === 3).

- [ ] **Step 6: 跑全量 + typecheck + commit**

Run: `cd /g/AgentDoctor && npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS。

```bash
git add src/types.ts src/context-attribution.ts test/context-attribution.test.ts test/fixtures/code-mode-turn.jsonl
git commit -m "feat: anchor FACT token total from usage; add real-usage fixture"
```

---

### Task 2: demo 展示 fact 总量 + 诚实标注差异

**Files:**
- Modify: `src/demo.ts`

**Interfaces:**
- Consumes: `attributeContext` 返回带 `factTotalTokens?` 的 `ContextSnapshot`

- [ ] **Step 1: demo 输出 fact 总量 + derived 分项 + 差异说明**

改 `src/demo.ts` 的 context attribution 输出段：

```ts
  const ctx = attributeContext(parsed)
  console.log(`\n── Context attribution ──`)
  if (ctx.factTotalTokens !== undefined) {
    console.log(`fact total   ~${ctx.factTotalTokens} tokens (DSH reported)`)
  }
  console.log(`derived total ~${ctx.totalTokens} tokens (chars/1.5 estimate)`)
  // aggregate per-category for readability
  const byCategory = new Map<string, number>()
  for (const c of ctx.contributions) {
    byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + c.tokens)
  }
  for (const [category, tokens] of byCategory) {
    console.log(`  ${category.padEnd(14)} ~${tokens} (derived)`)
  }
  if (ctx.factTotalTokens !== undefined && ctx.factTotalTokens !== ctx.totalTokens) {
    console.log(`\nnote: fact total (DSH) and derived sum differ — semantic breakdown is estimated`)
  }
```

- [ ] **Step 2: 跑 demo 验证输出**

Run: `cd /g/AgentDoctor && npx tsx src/demo.ts test/fixtures/code-mode-turn.jsonl`
Expected: 输出 fact total 6389、derived total（不同于 6389）、四类 derived 分项、以及差异说明。

- [ ] **Step 3: 跑全量 + commit**

```bash
git add src/demo.ts
git commit -m "feat: show FACT vs derived token total in demo"
```

---

## Self-Review

**Spec coverage：**
- fact 总量 + 真实 usage fixture → Task 1（`factTotalTokens` 字段 + 提取逻辑 + code-mode-turn fixture）
- demo 诚实展示 → Task 2（fact vs derived 差异标注）

**Placeholder scan：** 无 TBD/TODO，代码完整。

**Type consistency：** `ContextSnapshot.factTotalTokens?: number` 在 Task 1 定义，Task 2 消费；`attributeContext` 返回值签名向后兼容（旧调用方忽略新增可选字段）。

**已知边界（诚实记录）：**
1. fact 总量来自**最后一个** assistant/message 的 usage——这是"当前" context 的最佳近似，但不是全程总和。若未来要精确到每一步，需存所有 usage 时间序列（超出 Phase 1）。
2. 语义分项仍是 chars/1.5 比例分摊，truth level 是 derived——这是 DSH 落盘 log 的固有边界（语义分项只在 runtime token-meter 服务里，不落盘），不假装精确。
3. `code-mode-turn` 的 usage 可能是 snapshot 测试的 mock 值（6152 不一定等于真实 provider 返回）——它证明"锚定逻辑正确"，不证明"数值是生产级"。
