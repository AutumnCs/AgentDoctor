import type { TruthLevel } from './truth-level.js'
import type { ParsedSession } from './session-log.js'

/** One context contribution: how many tokens some component occupies. */
export interface ContextContribution {
  category: 'system' | 'messages' | 'tool-result' | 'tool-schema'
  tokens: number
  level: TruthLevel
  sourceId?: string
}

/** A context snapshot: total plus per-category contributions. */
export interface ContextSnapshot {
  /** Derived sum of per-category estimates (chars/1.5 proportion). */
  totalTokens: number
  /** FACT: billed input reported by DSH/provider (inputTokens + cacheReadTokens + cacheWriteTokens). Absent when no usage recorded. */
  factTotalTokens?: number
  contributions: ContextContribution[]
}

/** One piece of evidence backing a finding: a pointer to the original event. */
export interface Evidence {
  seq: number
  eventType: string
  summary: string
}

/** A diagnosis produced by a rule: a conclusion plus the evidence that supports it. */
export interface Finding {
  ruleId: string
  title: string
  severity: 'info' | 'warning' | 'critical'
  diagnosis: string
  truthLevel: TruthLevel
  evidence: Evidence[]
}

/** A self-contained, deterministic diagnosis rule over a parsed session log. */
export interface DiagnosisRule {
  id: string
  title: string
  description: string
  analyze(parsed: ParsedSession): Finding[]
}
