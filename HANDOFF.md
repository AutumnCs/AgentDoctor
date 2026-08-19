# Agent Doctor — 交接文档（Handoff）

> 用途：让一个新对话无缝接手本项目。读完这份文档 + 文末列出的关键文件，即可继续工作，无需回看历史对话。

---

## 一、项目是什么（一句话 + 北极星）

**Agent Doctor = "git for your agent"** —— 面向 DeepSeek Harness（DSH）开发者的诊断型 DevTool，把 DSH 的强可观测性从「能看到」翻译成「能看懂」。

核心差异化在**诊断层**（deterministic rules → diagnosis → evidence → explain），不是 dashboard、不是数据搬运。它回答真实问题：*为什么 agent 变慢/失败/context 爆炸？哪次 runtime 改动后退化？证据是什么？怎么改回来？*

三条不可违背的底线：
1. **宁可 Unknown，不伪造确定性**（truthfulness 分级：fact / derived / hypothesis / unknown）。
2. **证据优先**（每个诊断都能点到原始证据）。
3. **稳且长期**（DSH 是唯一事实源，Agent Doctor 只读、零耦合、可重建）。

完整设计见 [DESIGN.md](DESIGN.md)。

---

## 二、当前代码状态（已提交，14 个测试全过）

**项目位置**：`G:\AgentDoctor`（独立 TypeScript 工程，不碰 DSH monorepo `G:\deepseek-harness`，两者分离保证"稳"）。

**已实现的能力**（Phase 0 + Phase 0.5 完成）：
- `src/session-log.ts` — 解析 DSH session JSONL（真实落盘格式）→ 事件流
- `src/cordis-verbs.ts` — 数据驱动映射 cordis 自进化动词（`cordis_mount/unmount` 旧 ↔ `cordis_define/run/stop/undefine` 新，含 `inspect_self/query` 变体）
- `src/runtime-snapshot.ts` + `runtime-diff.ts` — 从 cordis tool/call 重建 runtime 拓扑快照并做 git 风格 diff
- `src/context-attribution.ts` — 归因 context 构成（system / messages / tool-result / tool-schema 四类）
- `src/truth-level.ts` + `types.ts` — 唯一 TruthLevel 类型 + 核心领域类型
- `src/demo.ts` — `npm run demo` 入口

**测试**：`test/` 下 14 个测试全过，`npx tsc --noEmit` 无错。fixture 在 `test/fixtures/`（`advanced-toolchain.jsonl` 是当前 demo 用的真实 DSH 落盘格式数据）。

**仓库**：已推到 `https://github.com/AutumnCs/AgentDoctor`，main 分支。README 已按开源风格重写（含真实 demo 输出、诚实标注、MIT LICENSE）。

---

## 三、正在做的事（被中断的位置——最重要）

### Phase 1：Real Token Attribution（真 token 归因）

**目标**：把 context attribution 从"纯 `chars/1.5` 估算"升级为"锚定 DSH 真实报告的 fact 总量 + 按比例分摊的 derived 分项"。

**计划**：`docs/superpowers/plans/2026-08-19-phase1-real-token.md`（已提交，commit `a1db239`）

**SDD 进度**：Subagent-Driven Development 进行中，ledger 在 `.superpowers/sdd/2026-08-19-phase1-real-token/progress.md`（但 `.superpowers/` 在 .gitignore 里，不提交，需注意它可能已随磁盘清理丢失——见下文）。

**Task 1（fact 总量 + fixture）状态：IN PROGRESS，被中断。**
- 已派出的子 agent 被 kill（因 C 盘满）。
- **未提交的半成品**：`test/fixtures/code-mode-turn.jsonl` 已复制（64 行、无 `{{` 占位符），但 **de-redaction 未完成**——最后一行 JSON 解析失败，是坏文件，需要重做。
- `src/types.ts` / `src/context-attribution.ts` / `test/context-attribution.test.ts` **尚未改动**（子 agent 在满盘前还没提交）。

### 子 agent 被 kill 前留下的两个关键发现（必须记住，否则又会踩坑）

1. **`code-mode-turn` 有 2 个 assistant/message 事件，不是 1 个**：
   - seq 188（step 1）：`inputTokens: 6152, cacheReadTokens: 0` → billed = 6152
   - seq 252（step 2，最后）：`inputTokens: 117, cacheReadTokens: 6272` → billed = **6389**
   - 所以 fact 总量锚定值是 **6389**，不是计划里写的 6152（6152 是第一个 message）。
   - **billed input = inputTokens + cacheReadTokens + cacheWriteTokens**（DSH 源码注释明确：inputTokens 是"未缓存输入"，要加 cache 才是计费输入）。

2. **`tool-schemas.expected.json` 是对象 `{initial: [...], changes: []}`，不是裸数组**。de-redact 时必须用 `json.dumps(sidecar['initial'])`，不能直接 splice 整个文件（会破坏 JSONL）。

### Task 2（demo 展示 fact vs derived）状态：pending，未开始。

---

## 四、已锁定的关键决策（用户拍板，不要推翻）

1. **数据源 = 真实 DSH 落盘格式**（`data.message` 嵌套），不是 web 投影格式（`data.content`）。这条是用户明确拍板的。
2. **全英文**：源码注释、commit message、README、demo 输出全部英文。
3. **totalTokens 修复 = 真归因 messages**（Option A），不是改名降级。
4. **执行方式 = Subagent-Driven Development**（每 task 派 fresh subagent + 逐 task 审查 + final review）。
5. **token 归因只走路径 A**（只读 log 锚定 fact），**不接 DSH token-meter 运行时服务**（避免破坏零耦合架构、避免 DSH 版本耦合）。

---

## 五、真实 DSH 数据格式（已实测验证，写代码的依据）

| 事件 | 字段路径 |
|---|---|
| `tool/result` | `data.message.content[0].content`（嵌套：message → tool-result block → inner content 数组）|
| `assistant/message` | `data.message.content`（有 message 包装）+ `data.usage`（fact token）|
| `user/message` | `data.content`（**无** message 包装，与 assistant 不对称！）|
| `request/header` | `data.header.{config, system, tools}`，`tools` 是 **ToolSchema[] 数组**（不是 string）|

- `TokenUsage`：`inputTokens`（未缓存输入）、`outputTokens`、`cacheReadTokens?`、`cacheWriteTokens?`、`reasoningTokens?`。
- 语义分项（system/skill/tool 各占多少 token）**在落盘 log 里不存在**，只有总量；语义分项只能 derived 估算，这是数据源的固有边界，不假装精确。

---

## 六、诚实标注：当前 estimate 的边界

- 当前 `~51256` 等数字是 `chars/1.5` 估算，**只可信量级趋势，不可信精细比较**。
- 真实 usage fixture（code-mode-turn 等）的 token 值也可能是 snapshot 测试的 mock 值，证明"锚定逻辑正确"，不证明"数值是生产级"。
- fact 总量来自**最后一个** assistant/message 的 usage，是"当前" context 的最佳近似，不是全程总和。

---

## 七、重启后的下一步（建议顺序）

1. **先读** [DESIGN.md](DESIGN.md)、`docs/superpowers/plans/2026-08-19-phase1-real-token.md`、本 handoff。
2. **清理**：删除坏掉的半成品 `test/fixtures/code-mode-turn.jsonl`（未完成 de-redaction），重做 Task 1。
3. **修正计划里的两个错误**（第六节发现）：
   - fact 总量锚定值从 6152 改为 6389。
   - de-redact 用 `json.dumps(sidecar['initial'])`。
4. **继续 Phase 1 Task 1**（fact 总量 + fixture），用 Subagent-Driven 流程。
5. 完成后做 Task 2，然后 Phase 1 的 final review。
6. **回到主线**：Phase 1 只是深化"context 为什么这么大"这一条 killer，做完就回到诊断规则（repeated tool failure / compaction thrashing / runtime mutation risk 等）——那是最初目标的核心。

---

## 八、需要留意的环境问题

- **C 盘曾 100% 满**，已由用户释放（`powercfg /h off` 删了 hiberfil.sys）。真正的元凶是系统文件（hiberfil.sys 13.3GB + swapfile.sys），**不是 Claude（只占 ~337M）**。
- 如果再次遇到命令输出 `No space left on device`，把结果写到 G 盘文件再读（`cmd > /g/...`）。
- `.superpowers/sdd/` 里的 ledger 是 SDD 的进度记录，但它在 .gitignore 里，**磁盘清理时可能已丢失**。如果丢了，从 `git log` 恢复：最后一个提交是 `a1db239 docs: add Phase 1 real-token attribution plan`，Task 1 未完成。

---

## 九、关键文件清单

- [DESIGN.md](DESIGN.md) — 完整设计 + 数据源地图 + 所有调研结论
- [README.md](README.md) — 已重写的开源风格 README
- `docs/superpowers/plans/2026-08-18-phase0-spike.md` — Phase 0 计划（已完成）
- `docs/superpowers/plans/2026-08-18-phase0.5-attribution-fix.md` — Phase 0.5 计划（已完成）
- `docs/superpowers/plans/2026-08-19-phase1-real-token.md` — **Phase 1 计划（进行中，需修正）**
- `src/` — 8 个核心模块
- `test/` — 14 个测试 + fixtures
