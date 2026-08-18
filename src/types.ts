import type { TruthLevel } from './truth-level.js'

/** Visibility of one tool in the runtime (from request/header.tools or a cordis registration). */
export interface ToolVisibility {
  name: string
  /** Truth level: `fact` from request/header, `derived` from cordis_define. */
  level: 'fact' | 'derived'
}

/** One node in the runtime topology: a plugin or service. */
export interface RuntimeNode {
  id: string
  kind: 'plugin' | 'service' | 'tool'
  /** `static` from cordis.yml, `dynamic` from a cordis tool/call. */
  origin: 'static' | 'dynamic'
  name: string
}

/** A runtime topology snapshot at one revision. */
export interface RuntimeSnapshot {
  revision: number
  nodes: RuntimeNode[]
  toolCount: number
}

/** The change between two snapshots, git-diff style. */
export interface RuntimeDiff {
  from: number
  to: number
  added: RuntimeNode[]
  removed: RuntimeNode[]
  toolCountDelta: number
}

/** One context contribution: how many tokens some component occupies. */
export interface ContextContribution {
  category: 'system' | 'messages' | 'tool-result' | 'tool-schema'
  tokens: number
  level: TruthLevel
  sourceId?: string
}

/** A context snapshot: total plus per-category contributions. */
export interface ContextSnapshot {
  totalTokens: number
  contributions: ContextContribution[]
}
