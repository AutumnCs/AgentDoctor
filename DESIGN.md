# Agent Doctor — V1 起点

> 一句话定位：**"git for your agent"** —— 给 DSH 开发者一个 `log` / `diff` / `blame`，
> 把 DSH 的强可观测性从"能看到"翻译成"能看懂"。

---

## 1. 核心洞见：token 是第一信号，不是附属指标

开发者唯一不用解释就秒懂的东西是 token / cost。
他可能不在乎 "runtime revision 41→42"，但**瞬间**在乎 "这个插件让每次请求 +4.2K tokens / +$0.04"。

因此 token 不是"顺便观测"，而是把 DSH 黑箱翻译成开发者母语的**入口跳板**。

**结论：每一次 runtime diff 都像 `git diff` 显示 `+lines/-lines` 一样，同时显示 `+tools/-tools` 和 `+context/+cost`。**

---

## 2. 那个 demo（就是整个项目的 pitch，一张 GIF 三帧）

> 这是 star 的唯一来源：10 秒看懂、看完想转发。它决定 V1 建什么，而不是反过来。

**Frame 1 — 钩子（git log）**
> 你的 agent 本次 session runtime 变了 13 次。这一次很可疑。

**Frame 2 — diff（git diff，带成本列）**
```
Runtime rev 41            Runtime rev 42
Tools       18      →     20
Context     82K     →     86.2K   (+4.2K)
Cost/req     $0.42   →     $0.46   (+$0.04)

+ repo-reviewer
+ inspect_pr
+ review_diff
SOURCE: cordis_run  turn 17 / step 2
```

**Frame 3 — 答案（git bisect）**
> 新增 repo-reviewer 后，11/13 条慢 trace 都用到了它。
> Fork → 禁用 → 重跑 → 对比。

**诚实标注**：Frame 3 的"关联"用真数据；"因果"只写 Associated，不写 Caused。
demo 里至少一次用**真实踩过的坏 session**，其余可用 SAMPLE（明确标 SAMPLE）。

---

## 3. 最小真实版本（让上面 demo 变真，week 1）

不要 23 项 P0。只建 demo 需要的那几块：

**核实结论（已读 dsh-observe / dsh-observability 源码，字段级）**

| 能力 | 现有包能直接给吗 |
|------|------|
| 执行时间线 turn/step/tool/llm | ✅ 直接接 |
| token usage（input/output/cache/reasoning）+ cost | ✅ 直接接 |
| tool retry 推导 | ✅ 直接接（tool.attempt / tool.retries）|
| context 总 token | ⚠️ 只有 gauge，`observe.context_tokens` 只给 totalTokens，无归因 |
| **runtime/Cordis 拓扑变化** | ❌ **完全缺失**（collector default 分支直接 break，span 只有 4 种 kind）|
| **context 语义归因**（哪个 tool result 占多少 token） | ❌ 缺失 |
| **compaction 事件** | ❌ 缺失 |

**含义**：现有包只做了"执行层搬运"，完全没碰"进化层"。runtime diff 的数据源
（plugin/service/tool visibility/dynamic package/listener 注册）没有任何现成导出，
**必须自己从 DSH session / cordis 层采**。这反而是好消息——核心差异化没被占。

1. **复用 dsh-observe 的执行层导出**（turn/step/tool/llm + token usage + cost + retry）。
2. **自己采 runtime 拓扑变化**（这是 Phase 0 spike 唯一真正的去风险点）。
3. **runtime snapshot 存储**（SQLite）—— 每次 runtime 变动的快照。
4. **diff 计算**（git 风格）：+tools / -tools / +context / +cost。
5. **两条 killer rule**（就两条，先不贪多）：
   - context attribution：为什么 context 这么大（手工算不出来，最大差异化）
   - runtime diff：agent 到底改了什么 + blast radius
6. **token 归因**：焊在 diff 和 context 两个视图里。

**Phase 0 spike 的唯一验收标准**：能不能从 DSH session / cordis 层采到
"runtime 拓扑变化"事件流。其余（turn/step/context/tool 可观测性）已被证明，不算数。

**自然语言（Doctor Chat）不进 V1。** 开发者能读 diff；NL 是"省事"不是"理解"，fast-follow 的第二层。

---

## 4. 吸收而非重造（取其精华，弃其糟粕）

| 来源 | 吸什么 | 弃什么 |
|------|--------|--------|
| dsh-observe | 采集/导出管道 | — |
| git | log/diff/blame/bisect 的词汇与直觉 | 不做 git 克隆 |
| Langfuse | trace/span 树数据模型 | "dashboard 当产品、只展示不判断" |
| DSH tokenMeter | 原始 token 信号 | 在其上做语义归因（DSH 不直接给） |
| — | — | LLM 读全量日志（死法） |
| — | — | 假因果（Caused）/ 假精度（9412 tokens） |

---

## 5. 撞车排除 + 数据源地图（已读 DSH 源码）

**DSH 自己的 `runtime-diagnostics`（`dsh-invariants`）不是诊断工具**，是运行时
不变量断言服务：面向 DSH 包开发者，验证包间契约（goal revision 生命周期、compaction
元数据、session 事件封装等），违反就 `throw InvariantError`——fail-fast 的 assert，
不是 explain。**与 Agent Doctor 不撞车。**

但它反而给了我们一张"进化层数据在哪"的地图，印证了数据确实结构化存在：

| DSH 包 | Agent Doctor 采集对象 |
|---|---|
| `dsh-scope` | runtime 拓扑 scope（文档里的 Scope 0x…）|
| `dsh-goal` | Goal revision / 生命周期 / 回合推进 |
| `dsh-compaction` | compaction 元数据 |
| `dsh-session` | 事件序列本身 |
| `dsh-tools` | tool pipeline 阶段、可见性 |
| `dsh-agent` | agent status 状态转移 |

**本地环境**：`G:\deepseek-harness` 是 DSH 完整 monorepo，`packages/` 下 cordis /
session / compaction / goal / scope / skill 等核心包全在，可直接作为采集的源码参照
与真实数据源。

**关键发现：runtime 拓扑变化有官方观测点（已读 `vendor/cordis/src/events.ts`）。**

Cordis 内建了四个专门观测 runtime 拓扑变化的事件，无需 hack / monkey-patch：

| 事件 | 观测到 | 对应概念 |
|------|--------|---------|
| `internal/plugin(fiber)` | 插件 fiber 创建/卸载 | plugin 注册 |
| `internal/status(fiber, oldValue)` | fiber 生命周期状态转移 | runtime 状态变化 |
| `internal/service(name, value)` | 服务绑定 | service 注册 |
| `internal/dispatch(mode, name, args)` | 事件分发诊断 | 事件流 |

`Service` 构造器统一走 `ctx.reflect.provide(name, self, ...)` 注册，service 注册在
runtime 里可枚举。**含义**：采集建立在官方稳定的 internal 事件系统上，而非逆向私有
实现——这是"稳且长期"的技术地基，DSH 升级时这些事件的语义比私有结构稳定得多。

**关键发现：DSH 的"自进化"是 5 个可枚举动词（已读 `dsh-tool-cordis`）。**

`@deepseek-ai/dsh-tool-cordis` 是 agent 运行时自修改自己的工具集，恰好 5 个动词：

| 动词 | 语义 | 对应概念 |
|------|------|---------|
| `cordis_inspect` | 只读报告 services/插件/tools/动态包 | Runtime Snapshot |
| `cordis_define` | 记录包（name+code），不运行 | 定义 |
| `cordis_run` | 沙箱跑 host 半边，注册 tools/prompt/listener | Runtime Mutation |
| `cordis_stop` | 卸载，定义保留可再跑 | 回滚（Strong）|
| `cordis_undefine` | 停止 + 遗忘定义 | 完全撤销 |

其语义与原文档 6.7/6.8 几乎逐字对应：动态包 Runtime only（不写文件不改配置、
不重启持久）、`cordis_stop` 有明确 disposer（Rollback guarantee Strong）、`cordis_run`
会注册 tools/prompt/listener 改变后续请求、沙箱非安全边界（等同 bash，可触达
filesystem/shell/network）。

**工程结论（决定采集方案）**：无需 hook cordis 内部、无需自建 collector。

- runtime **静态初始拓扑** = `cordis.yml`
- runtime **动态变化** = session log 里的 `cordis_define/run/stop/undefine` 这 5 类
  tool call（本身就是标准 session 事件）
- 二者结合 → 完整 runtime 拓扑随时间的变化，全程只读、可重建、DSH 是唯一事实源

这满足"稳且长期、靠谱"的全部要求：不 hack、不逆私有实现、建立在 DSH 自己暴露的
tool 语义上。

---

## 6. V1 明确不做

Doctor Chat、Goal 可视化、timeline 动画、8 条 rule 全做、SaaS/RBAC/ClickHouse、
LLM 自动改 agent、自动删 tools、玄学 Health Score。

**遇任何功能争议时问一句：它是在帮用户诊断问题，还是只是因为我们"能画出来"？**
