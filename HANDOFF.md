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

## 二、当前代码状态（已提交，16 个测试全过）

**项目位置**：`G:\AgentDoctor`（独立 TypeScript 工程，不碰 DSH monorepo `G:\deepseek-harness`，两者分离保证"稳"）。

**已实现的能力**（Phase 0 + Phase 0.5 + **Phase 1** 完成）：
- `src/session-log.ts` — 解析 DSH session JSONL（真实落盘格式）→ 事件流
- `src/cordis-verbs.ts` — 数据驱动映射 cordis 自进化动词（`cordis_mount/unmount` 旧 ↔ `cordis_define/run/stop/undefine` 新，含 `inspect_self/query` 变体）
- `src/runtime-snapshot.ts` + `runtime-diff.ts` — 从 cordis tool/call 重建 runtime 拓扑快照并做 git 风格 diff
- `src/context-attribution.ts` — 归因 context 构成（system / messages / tool-result / tool-schema 四类），**Phase 1 起同时锚定 fact 总量（`factTotalTokens`，来自 usage）**
- `src/truth-level.ts` + `types.ts` — 唯一 TruthLevel 类型 + 核心领域类型
- `src/demo.ts` — `npm run demo` 入口（Phase 1 起展示 fact vs derived 对比）

**测试**：`test/` 下 16 个测试全过，`npx tsc --noEmit` 无错。fixture 在 `test/fixtures/`（`advanced-toolchain.jsonl` 是 Phase 0 用的，`code-mode-turn.jsonl` 是 Phase 1 新增的真实 usage 数据，fact anchor = 6389）。

**仓库**：已推到 `https://github.com/AutumnCs/AgentDoctor`，main 分支。README 已按开源风格重写（含真实 demo 输出、诚实标注、MIT LICENSE）。

---

## 三、Phase 1 已完成（Real Token Attribution）✅

**Phase 1：Real Token Attribution（真 token 归因）已完成并提交**，最终 review 通过（`16/16` 测试 + `tsc --noEmit` 干净 + 工作树干净）。

**目标**：把 context attribution 从"纯 `chars/1.5` 估算"升级为"锚定 DSH 真实报告的 fact 总量 + 按比例分摊的 derived 分项"。

**落地内容**：
- `src/types.ts` — `ContextSnapshot` 增加可选 `factTotalTokens?: number`
- `src/context-attribution.ts` — `attributeContext` 从**最后一个** `assistant/message` 的 `usage` 提取 billed input（`inputTokens + cacheReadTokens + cacheWriteTokens`），只在有 usage 时出现该字段
- `src/demo.ts` — 输出 fact total（DSH reported）+ derived total（chars/1.5 estimate）+ 四类 derived 分项 + fact≠derived 时的差异说明
- `test/context-attribution.test.ts` — 新增真实 usage fixture 的断言（factTotalTokens === 6389）
- `test/fixtures/code-mode-turn.jsonl` — 新 fixture（38 行、已 de-redact、无 `{{}}` 占位符）

**关键事实（别再踩坑）**：
- `code-mode-turn` 有 2 个 assistant/message：seq 188 billed=6152（第一个），seq 252 billed=**6389**（最后一个，即 fact 锚定值 = 117 + 6272 + 0）。
- **billed input = inputTokens + cacheReadTokens + cacheWriteTokens**（inputTokens 只是"未缓存输入"）。
- `tool-schemas.expected.json` 是对象 `{initial: [...], changes: []}`，de-redact 用 `json.dumps(sidecar['initial'])`；`system-prompt.expected.md` 里也含一个 `{{cwd}}` 占位符要替换。
- de-redact 脚本里 Python `open()` 要用 Windows 路径 `G:/...`（不是 Git Bash 的 `/g/...` mount，Python 不认识）。

**计划文件**：`docs/superpowers/plans/2026-08-19-phase1-real-token.md`（已修正上述两处错误并提交）。

**SDD ledger**：`.superpowers/sdd/2026-08-19-phase1-real-token/progress.md`（在 .gitignore 里，可能随磁盘清理丢失——但工作已全部落 git，见 commit 列表）。

**Phase 1 commits**：`7997ea1`（计划修正）、`ad49eed`（路径修正）、`a111be7`（Task 1 实现）、`86581c7`（Task 2 实现）。

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

## 七、下一步（建议顺序）

1. **Phase 1 已做完**，无需再续。当前停在"context 为什么这么大"这条 killer 已被强化（fact 总量 + derived 分项）。
2. **回到主线**（最初目标的核心）：Phase 1 只是深化了 context 归因这一条，现在回到**诊断规则**——
   - repeated tool failure（同一工具反复失败）
   - compaction thrashing（压缩抖动）
   - runtime mutation risk（runtime 拓扑突变风险）
   - 其他 DESIGN.md 里规划的诊断规则
3. 每条诊断规则都遵循同一模式：deterministic rules → diagnosis → evidence → explain（见 DESIGN.md 核心差异化）。

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
