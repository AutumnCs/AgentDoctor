import type { ParsedSession } from './session-log.js'
import {
  parseArgs,
  extractToolNames,
  collectToolSnapshots,
  collectStopSeqs,
  effectiveSnapshotAfter,
} from './cordis-tools.js'

/** A cordis self-modification the agent declared (define or run). */
export interface DeclaredChange {
  seq: number
  kind: 'define' | 'run'
  pluginId?: string
  packageId?: string
  declaredToolNames: string[]
}

/** One rendered outcome of a run: whether each declared tool was observed or not. */
export interface EvolutionStep {
  change: DeclaredChange
  /** The snapshot observed after the run, if any usable one exists. */
  snapshotSeq?: number
  /** Tools that were observed in that snapshot. */
  observed: string[]
  /** Tools that were declared but NOT observed (the gap). */
  missing: string[]
  /** True when no usable snapshot followed the run (outcome unobserved). */
  unobserved: boolean
}

/**
 * Compute the agent's tool-surface evolution as a declared-vs-observed sequence.
 * This is the single source of truth shared by the text renderer and the HTML renderer
 * — so the two can never drift. Pure function over the parsed session.
 *
 * Truthfulness: a tool being absent from one snapshot only supports "not visible then",
 * never a ranked cause. A run with no usable following snapshot (e.g. bounded by a later
 * stop/undefine) is marked unobserved rather than flagged.
 */
export function computeEvolution(parsed: ParsedSession): EvolutionStep[] {
  const events = parsed.events
  const snapshots = collectToolSnapshots(parsed)
  const stopSeq = collectStopSeqs(parsed)

  // Resolve each cordis_define's pluginId/packageId (from paired result meta) and
  // declared tool names (from its code).
  const defineByCallId = new Map<string, { code: string }>()
  const idsByCallId = new Map<string, { pluginId: string; packageId?: string }>()
  for (const e of events) {
    if (e.type === 'tool/call') {
      const d = e.data as any
      if (d?.name !== 'cordis_define') continue
      const callId = d?.callId
      if (typeof callId !== 'string') continue
      const args = parseArgs(d)
      const code = typeof args?.code === 'object' && args.code !== null
        ? String((args.code as any).host ?? '')
        : ''
      defineByCallId.set(callId, { code })
    } else if (e.type === 'tool/result') {
      const d = e.data as any
      const callId = d?.message?.content?.[0]?.toolCallId
      const pluginId = d?.meta?.pluginId
      const packageId = d?.meta?.packageId
      if (typeof callId === 'string' && typeof pluginId === 'string') {
        idsByCallId.set(callId, { pluginId, packageId: typeof packageId === 'string' ? packageId : undefined })
      }
    }
  }

  // Build the ordered list of declared changes. A `run` carries the tool names from the
  // most recent `define` of the SAME (pluginId, packageId); keying by both avoids
  // mis-attributing a later package's tools to an earlier run.
  const changes: DeclaredChange[] = []
  const lastDeclaredByKey = new Map<string, string[]>()
  for (const e of events) {
    if (e.type !== 'tool/call') continue
    const d = e.data as any
    const name = d?.name
    if (name !== 'cordis_define' && name !== 'cordis_run') continue
    const args = parseArgs(d)
    const callId = typeof d?.callId === 'string' ? d?.callId : undefined

    let pluginId: string | undefined
    let packageId: string | undefined
    if (name === 'cordis_define') {
      const ids = callId ? idsByCallId.get(callId) : undefined
      pluginId = ids?.pluginId
      packageId = ids?.packageId
    } else {
      pluginId = args?.pluginId !== undefined ? String(args.pluginId) : undefined
      packageId = args?.packageId !== undefined ? String(args.packageId) : undefined
    }
    const key = pluginId ? `${pluginId}${packageId ? '/' + packageId : ''}` : undefined

    if (name === 'cordis_define') {
      const declaredToolNames = callId
        ? extractToolNames(defineByCallId.get(callId)?.code ?? '')
        : []
      if (key) lastDeclaredByKey.set(key, declaredToolNames) // record even empty, to clear stale
      changes.push({ seq: e.seq, kind: 'define', pluginId, packageId, declaredToolNames })
    } else {
      const declaredToolNames = key ? (lastDeclaredByKey.get(key) ?? []) : []
      changes.push({ seq: e.seq, kind: 'run', pluginId, packageId, declaredToolNames })
    }
  }

  // Compute the outcome for each run.
  const steps: EvolutionStep[] = []
  for (const c of changes) {
    if (c.kind === 'define') {
      steps.push({ change: c, observed: [], missing: [], unobserved: false })
      continue
    }
    // c.kind === 'run'
    if (c.declaredToolNames.length === 0) {
      steps.push({ change: c, observed: [], missing: [], unobserved: false })
      continue
    }
    const after = c.pluginId
      ? effectiveSnapshotAfter(snapshots, stopSeq, c.seq, c.pluginId)
      : undefined
    if (after === undefined) {
      steps.push({ change: c, observed: [], missing: [], unobserved: true })
      continue
    }
    const observed = c.declaredToolNames.filter(t => after.names.has(t))
    const missing = c.declaredToolNames.filter(t => !after.names.has(t))
    steps.push({ change: c, snapshotSeq: after.seq, observed, missing, unobserved: false })
  }
  return steps
}

/**
 * Render the evolution as terminal text (git-diff style). Keep in sync with the HTML
 * renderer by sharing computeEvolution.
 */
export function renderEvolution(parsed: ParsedSession): string {
  const steps = computeEvolution(parsed)
  const lines: string[] = []
  lines.push('Agent tool-surface evolution (declared vs observed)')
  lines.push('')
  for (const s of steps) {
    const c = s.change
    if (c.kind === 'define') {
      lines.push(`rev ${c.seq}  define  plugin=${c.pluginId ?? '?'}`)
      if (c.declaredToolNames.length > 0) {
        lines.push(`          declares tool(s): ${c.declaredToolNames.map(t => `'${t}'`).join(', ')}`)
      }
      continue
    }
    const id = `${c.pluginId ?? '?'}${c.packageId ? '/' + c.packageId : ''}`
    lines.push(`rev ${c.seq}  run     plugin=${id}`)
    if (c.declaredToolNames.length === 0) {
      lines.push(`          (no tool declared by this plugin)`)
      continue
    }
    if (s.unobserved) {
      lines.push(`          (no tool-list snapshot after this run — registration outcome not observed)`)
      continue
    }
    for (const t of s.observed) {
      lines.push(`          + tool '${t}'  (observed in snapshot @${s.snapshotSeq})`)
    }
    for (const t of s.missing) {
      lines.push(`          ~ tool '${t}'  declared but not visible in snapshot @${s.snapshotSeq} (may have failed to register, been reverted, or not been a DSL-shaped tool)`)
    }
  }
  if (steps.length === 0) {
    lines.push('(no cordis self-modification in this session)')
  }
  return lines.join('\n')
}
