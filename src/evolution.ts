import type { ParsedSession } from './session-log.js'
import {
  parseArgs,
  extractToolNames,
  collectToolSnapshots,
  collectStopSeqs,
  effectiveSnapshotAfter,
} from './cordis-tools.js'

/** A cordis self-modification the agent declared (define or run). */
interface DeclaredChange {
  seq: number
  kind: 'define' | 'run'
  pluginId?: string
  packageId?: string
  declaredToolNames: string[]
}

/**
 * Render the "evolution" of the agent's tool surface as a git-diff-style story:
 * each declared change (define/run) is paired against the tool-set snapshot that
 * actually follows it, so a declared tool that never appeared is made visible as the
 * gap it is. This is the "declared vs observed" distinction — the agent CLAIMS a
 * change, the snapshot is the FACT.
 *
 * Truthfulness: this renders only what the log says. A tool being absent from one
 * snapshot supports "not visible then", never a ranked cause — the wording keeps that
 * distinction, and a run with no usable following snapshot is marked as unobserved
 * rather than flagged.
 */
export function renderEvolution(parsed: ParsedSession): string {
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

    // For define, pluginId/packageId come from the paired result meta (the define call
    // args carry neither). For run, they come from the call args.
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

  // Render.
  const lines: string[] = []
  lines.push('Agent tool-surface evolution (declared vs observed)')
  lines.push('')
  for (const c of changes) {
    if (c.kind === 'define') {
      lines.push(`rev ${c.seq}  define  plugin=${c.pluginId ?? '?'}`)
      if (c.declaredToolNames.length > 0) {
        lines.push(`          declares tool(s): ${c.declaredToolNames.map(t => `'${t}'`).join(', ')}`)
      }
      continue
    }

    // c.kind === 'run'
    const id = `${c.pluginId ?? '?'}${c.packageId ? '/' + c.packageId : ''}`
    lines.push(`rev ${c.seq}  run     plugin=${id}`)
    if (c.declaredToolNames.length === 0) {
      lines.push(`          (no tool declared by this plugin)`)
      continue
    }

    const after = c.pluginId
      ? effectiveSnapshotAfter(snapshots, stopSeq, c.seq, c.pluginId)
      : undefined
    if (after === undefined) {
      lines.push(`          (no tool-list snapshot after this run — registration outcome not observed)`)
      continue
    }

    const present = c.declaredToolNames.filter(t => after.names.has(t))
    const missing = c.declaredToolNames.filter(t => !after.names.has(t))
    for (const t of present) {
      lines.push(`          + tool '${t}'  (observed in snapshot @${after.seq})`)
    }
    for (const t of missing) {
      lines.push(`          ~ tool '${t}'  declared but not visible in snapshot @${after.seq} (may have failed to register, been reverted, or not been a DSL-shaped tool)`)
    }
  }

  if (changes.length === 0) {
    lines.push('(no cordis self-modification in this session)')
  }
  return lines.join('\n')
}
