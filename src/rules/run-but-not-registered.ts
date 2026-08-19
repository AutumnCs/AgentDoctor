import type { ParsedSession } from '../session-log.js'
import type { Finding, DiagnosisRule } from '../types.js'
import {
  parseArgs,
  extractToolNames,
  collectToolSnapshots,
  collectStopSeqs,
  effectiveSnapshotAfter,
} from '../cordis-tools.js'

/**
 * run-but-not-registered: flags a cordis_run whose plugin declared a model-visible
 * tool (via `harness.defineTool({ name: '...' })` in its code) that is absent from the
 * tool list immediately after activation — i.e. the plugin ran but its tool was not
 * visible. This is the failure mode a developer actually hits (and the agent itself
 * had to debug), unlike the low-value "still running at session end".
 *
 * Truthfulness: the tool name is extracted from the define's code with a DSH-DSL-shaped
 * heuristic (`defineTool` + `name:` literal), so the conclusion is `derived`, not `fact`.
 * A tool being absent from one listTools snapshot only supports "not visible then",
 * never a definitive "failed to register" — the wording keeps that distinction.
 */
export const runButNotRegisteredRule: DiagnosisRule = {
  id: 'run-but-not-registered',
  title: 'Run activated but tool did not register',
  description: 'Flags a cordis_run whose declared model-visible tool is missing from the tool list immediately after activation — the plugin ran but its tool was not visible.',
  analyze(parsed: ParsedSession): Finding[] {
    const events = parsed.events
    const snapshots = collectToolSnapshots(parsed)
    const stopSeq = collectStopSeqs(parsed)

    // 1. Record each define's declared tool names with its result seq, so a run is
    //    always checked against the declaration in force at that time (not a later
    //    redefinition). Declarations keyed by pluginId: array of { seq, names }.
    const declaredByName = new Map<string, Array<{ seq: number; names: string[] }>>()
    const defineCallByCallId = new Map<string, { code: string }>()
    for (const e of events) {
      if (e.type !== 'tool/call') continue
      const d = e.data as any
      if (d?.name !== 'cordis_define') continue
      const callId = d?.callId
      if (typeof callId !== 'string') continue
      const args = parseArgs(d)
      const code = typeof args?.code === 'object' && args.code !== null
        ? String((args.code as any).host ?? '')
        : ''
      defineCallByCallId.set(callId, { code })
    }
    for (const e of events) {
      if (e.type !== 'tool/result') continue
      const d = e.data as any
      const callId = d?.message?.content?.[0]?.toolCallId
      const pluginId = d?.meta?.pluginId
      if (typeof callId !== 'string' || typeof pluginId !== 'string') continue
      const def = defineCallByCallId.get(callId)
      if (!def) continue
      const names = extractToolNames(def.code)
      const list = declaredByName.get(pluginId) ?? []
      list.push({ seq: e.seq, names })
      declaredByName.set(pluginId, list)
    }

    // 2. For each run, find the first listTools after it that is still before any later
    //    stop/undefine of the same plugin — otherwise the tool's absence is explained by
    //    the plugin having been removed, not by a registration failure.
    const findings: Finding[] = []
    for (const e of events) {
      if (e.type !== 'tool/call') continue
      const d = e.data as any
      if (d?.name !== 'cordis_run') continue
      const args = parseArgs(d)
      const pluginId = typeof args?.pluginId === 'string' ? args.pluginId : undefined
      if (!pluginId) continue

      // The declaration in force at this run: the latest define whose seq < run.seq.
      const decls = (declaredByName.get(pluginId) ?? []).filter(dc => dc.seq < e.seq)
      if (decls.length === 0) continue
      const declared = decls[decls.length - 1].names
      if (declared.length === 0) continue

      const next = effectiveSnapshotAfter(snapshots, stopSeq, e.seq, pluginId)
      if (!next) continue

      const missing = declared.filter(t => !next.names.has(t))
      if (missing.length === 0) continue

      findings.push({
        ruleId: 'run-but-not-registered',
        title: 'Run activated but tool did not register',
        severity: 'warning',
        truthLevel: 'derived',
        diagnosis: `Plugin '${pluginId}' was run, but its declared tool(s) ${missing.map(t => `'${t}'`).join(', ')} did not appear in the tool list immediately after activation — the tool was not visible then (registration may have failed or been reverted).`,
        evidence: [
          { seq: e.seq, eventType: 'tool/call', summary: `cordis_run of '${pluginId}'` },
          { seq: next.seq, eventType: 'tool/result', summary: `tool list after run is missing ${missing.map(t => `'${t}'`).join(', ')}` },
        ],
      })
    }

    return findings
  },
}
