import type { ParsedSession } from '../session-log.js'
import type { Finding, DiagnosisRule } from '../types.js'

/** The four current-vocabulary cordis verbs that mutate a stable pluginId. */
const MUTATION_VERBS = new Set(['cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine'])

/** Parse a tool/call `arguments` JSON string into an object, or null if absent/malformed. */
function parseArgs(data: Record<string, unknown>): Record<string, unknown> | null {
  const raw = data.arguments
  if (typeof raw !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

/** Read a string field from a tool/call event data record, or undefined. */
function strField(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key]
  return typeof v === 'string' ? v : undefined
}

/**
 * Runtime mutation risk: flags cordis self-modification hazards over a session.
 * Identity is DSH's pluginId: define returns it in the tool/result meta; run/stop/
 * undefine carry it in call args. Legacy mount/unmount (temporary plugins, no stable
 * id) are excluded. Emits only `derived` findings.
 */
export const runtimeMutationRiskRule: DiagnosisRule = {
  id: 'runtime-mutation-risk',
  title: 'Runtime mutation risk',
  description: 'Flags cordis self-modification hazards: rollbacks on plugins never defined or run this session, and mutations left running at session end.',
  analyze(parsed: ParsedSession): Finding[] {
    // First pass: resolve each cordis_define's pluginId from its paired tool/result meta.
    const defineResultPluginIds = new Map<string, string>()
    for (const e of parsed.events) {
      if (e.type !== 'tool/result') continue
      const d = e.data as any
      const callId = d?.message?.content?.[0]?.toolCallId
      const pluginId = d?.meta?.pluginId
      if (typeof callId === 'string' && typeof pluginId === 'string') {
        defineResultPluginIds.set(callId, pluginId)
      }
    }

    const calls = parsed.events.filter(e =>
      e.type === 'tool/call' && MUTATION_VERBS.has(String(e.data.name)))

    const findings: Finding[] = []
    const exists = new Set<string>()          // pluginIds seen this session (define result or run args)
    const running = new Map<string, number>() // pluginId -> latest run seq, cleared by stop/undefine

    for (const e of calls) {
      const name = String(e.data.name)
      const args = parseArgs(e.data)

      if (name === 'cordis_define') {
        const callId = strField(e.data, 'callId') ?? ''
        const pluginId = defineResultPluginIds.get(callId)
        if (pluginId) exists.add(pluginId)
        // record-only: no finding on its own
      } else if (name === 'cordis_run') {
        const pluginId = args && typeof args.pluginId === 'string' ? args.pluginId : undefined
        if (pluginId) {
          exists.add(pluginId)
          running.set(pluginId, e.seq)
        }
      } else { // cordis_stop | cordis_undefine
        const pluginId = args && typeof args.pluginId === 'string' ? args.pluginId : undefined
        if (pluginId) {
          if (!exists.has(pluginId)) {
            const action = name === 'cordis_stop' ? 'Stopped' : 'Removed'
            findings.push({
              ruleId: 'runtime-mutation-risk',
              title: 'rollback on unregistered plugin',
              severity: 'warning',
              truthLevel: 'derived',
              diagnosis: `${action} plugin '${pluginId}', which was never defined or run in this session — it may not exist (possibly cross-session state).`,
              evidence: [{
                seq: e.seq,
                eventType: 'tool/call',
                summary: `${name} targeting plugin '${pluginId}' with no prior define/run in this session`,
              }],
            })
          }
          running.delete(pluginId)
        }
      }
    }

    // Any plugin still running at session end is an unclosed mutation.
    for (const [pluginId, seq] of running) {
      findings.push({
        ruleId: 'runtime-mutation-risk',
        title: 'unclosed mutation',
        severity: 'info',
        truthLevel: 'derived',
        diagnosis: `Plugin '${pluginId}' was run and never stopped or removed in this session — still running at session end (may be intentional persistence).`,
        evidence: [{
          seq,
          eventType: 'tool/call',
          summary: `cordis_run of '${pluginId}' with no later stop/undefine in this session`,
        }],
      })
    }

    return findings
  },
}
