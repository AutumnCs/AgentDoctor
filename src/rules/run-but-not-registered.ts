import type { ParsedSession } from '../session-log.js'
import type { Finding, DiagnosisRule } from '../types.js'

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

    // 1. Record each define's declared tool names WITH its result seq, so a run is
    //    always checked against the declaration that was in force at that time (not a
    //    later redefinition of the same pluginId).
    //    Declarations: array of { seq, names } sorted by seq.
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
      if (names.length === 0) continue
      const list = declaredByName.get(pluginId) ?? []
      list.push({ seq: e.seq, names })
      declaredByName.set(pluginId, list)
    }

    // 2. Collect the full timeline of mutation and listTools events, in seq order, so we
    //    can bound each run's "next listTools" by any later stop/undefine of the plugin.
    const stopSeq = new Map<string, number[]>() // pluginId -> seqs of stop/undefine
    const listToolResults: Array<{ seq: number; names: Set<string> }> = []
    for (const e of events) {
      const d = e.data as any
      if (e.type === 'tool/result') {
        const inner = d?.message?.content?.[0]?.content?.[0]
        const text = inner?.text
        if (typeof text === 'string') {
          const tools = parseListTools(text)
          if (tools !== null) listToolResults.push({ seq: e.seq, names: new Set(tools) })
        }
      } else if (e.type === 'tool/call') {
        const name = d?.name
        if (name === 'cordis_stop' || name === 'cordis_undefine') {
          const args = parseArgs(d)
          const pluginId = typeof args?.pluginId === 'string' ? args.pluginId : undefined
          if (pluginId) {
            const arr = stopSeq.get(pluginId) ?? []
            arr.push(e.seq)
            stopSeq.set(pluginId, arr)
          }
        }
      }
    }

    // 3. For each run, find the FIRST listTools after it that is still before any later
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

      // Bound: ignore listTools results at/after the plugin's next stop/undefine.
      const stops = stopSeq.get(pluginId) ?? []
      const nextStop = stops.find(s => s > e.seq)
      const next = listToolResults.find(r => r.seq > e.seq && (nextStop === undefined || r.seq < nextStop))
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

function parseArgs(data: any): Record<string, unknown> | null {
  const raw = data?.arguments
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

/**
 * Extract model-visible tool names from a cordis_define code.host, using the DSH DSL
 * shape `harness.defineTool({ name: '...', ... })`. Heuristic, not a JS parser: only
 * literal `defineTool({ name: 'x' })` forms are recognized. A plugin that registers
 * tools another way is missed (under-report). The regex is not a full parse — a nested
 * object carrying a string-valued `name:` before the tool's own could be picked up
 * instead; in the DSH DSL shape `name` is conventionally the first string-valued key, so
 * this is low-probability but not impossible.
 */
function extractToolNames(code: string): string[] {
  const names: string[] = []
  const re = /defineTool\s*\(\s*\{[^}]*?name:\s*['"]([^'"]+)['"]/gs
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    if (m[1] && !names.includes(m[1])) names.push(m[1])
  }
  return names
}

/**
 * Parse a `Tool.listTools` result text into an array of tool names, or null if the text
 * is not a recognizable listTools result. Guards on both `method === 'listTools'` and
 * the `data.tools` array so a different inspect method returning a `tools` array is not
 * misread.
 */
function parseListTools(text: string): string[] | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const data = JSON.parse(trimmed)
    if (data?.method !== 'listTools') return null
    const tools = data?.data?.tools
    if (!Array.isArray(tools)) return null
    return tools.map((t: any) => t?.name).filter((n: unknown): n is string => typeof n === 'string')
  } catch {
    return null
  }
}
