import type { ParsedSession } from './session-log.js'

/**
 * Shared cordis helpers used by both the diagnosis rules and the evolution
 * renderer. These live here so the "declared vs observed tool" check cannot
 * drift between its two consumers (run-but-not-registered rule and renderEvolution).
 */

/** Parse a tool/call `arguments` JSON string into an object, or null if absent/malformed. */
export function parseArgs(data: Record<string, unknown>): Record<string, unknown> | null {
  const raw = (data as any)?.arguments
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
export function extractToolNames(code: string): string[] {
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
export function parseListTools(text: string): string[] | null {
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

/** A tool-set snapshot observed at a listTools result. */
export interface ToolSnapshot {
  seq: number
  names: Set<string>
}

/** Collect every listTools snapshot, in seq order. */
export function collectToolSnapshots(parsed: ParsedSession): ToolSnapshot[] {
  const snapshots: ToolSnapshot[] = []
  for (const e of parsed.events) {
    if (e.type !== 'tool/result') continue
    const d = e.data as any
    const inner = d?.message?.content?.[0]?.content?.[0]
    const text = inner?.text
    if (typeof text !== 'string') continue
    const tools = parseListTools(text)
    if (tools === null) continue
    snapshots.push({ seq: e.seq, names: new Set(tools) })
  }
  return snapshots
}

/** Map pluginId -> seqs of its stop/undefine events (ascending). */
export function collectStopSeqs(parsed: ParsedSession): Map<string, number[]> {
  const stopSeq = new Map<string, number[]>()
  for (const e of parsed.events) {
    if (e.type !== 'tool/call') continue
    const d = e.data as any
    const name = d?.name
    if (name !== 'cordis_stop' && name !== 'cordis_undefine') continue
    const args = parseArgs(d)
    const pluginId = args && typeof args.pluginId === 'string' ? args.pluginId : undefined
    if (!pluginId) continue
    const arr = stopSeq.get(pluginId) ?? []
    arr.push(e.seq)
    stopSeq.set(pluginId, arr)
  }
  return stopSeq
}

/**
 * Find the first listTools snapshot after `runSeq` that is still BEFORE the plugin's
 * next stop/undefine. If the only post-run snapshot is after a stop/undefine, the tool's
 * absence is explained by removal, so return undefined (no reliable observation of the
 * run's registration outcome).
 */
export function effectiveSnapshotAfter(
  snapshots: ToolSnapshot[],
  stopSeq: Map<string, number[]>,
  runSeq: number,
  pluginId: string,
): ToolSnapshot | undefined {
  const stops = stopSeq.get(pluginId) ?? []
  const nextStop = stops.find(s => s > runSeq)
  return snapshots.find(s => s.seq > runSeq && (nextStop === undefined || s.seq < nextStop))
}
