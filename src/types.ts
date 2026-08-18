/** 一个工具在 runtime 里的可见性（来源：request/header.tools 或 cordis 注册）。 */
export interface ToolVisibility {
  name: string
  /** 事实级别：来自 request/header 是 fact，来自 cordis_define 是 derived。 */
  level: 'fact' | 'derived'
}

/** runtime 拓扑里的一个节点：插件或服务。 */
export interface RuntimeNode {
  id: string
  kind: 'plugin' | 'service' | 'tool'
  /** cordis.yml 里是静态，cordis tool/call 里是动态。 */
  origin: 'static' | 'dynamic'
  name: string
}

/** 某个时刻的 runtime 拓扑快照。 */
export interface RuntimeSnapshot {
  revision: number
  nodes: RuntimeNode[]
  toolCount: number
}

/** 两个快照之间的变化，git diff 风格。 */
export interface RuntimeDiff {
  from: number
  to: number
  added: RuntimeNode[]
  removed: RuntimeNode[]
  toolCountDelta: number
}

/** 一条 context 贡献：某个东西占了多少 token。 */
export interface ContextContribution {
  category: 'system' | 'messages' | 'tool-result' | 'tool-schema'
  tokens: number
  level: 'fact' | 'derived' | 'unknown'
  sourceId?: string
}

/** context 快照：总量 + 分项贡献。 */
export interface ContextSnapshot {
  totalTokens: number
  contributions: ContextContribution[]
}
