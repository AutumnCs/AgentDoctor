/** The cordis self-modification tool verb semantics (normalized). */
export type CordisVerb = 'inspect' | 'define' | 'run' | 'stop' | 'undefine'

/**
 * cordis verb mapping table. Data-driven and configurable: DSH itself drifts
 * between cordis_mount/unmount (legacy) and cordis_define/run/stop/undefine
 * (current), so do not hard-code — normalize both to the semantic verbs.
 */
export const CORDIS_VERB_MAP: Record<string, CordisVerb> = {
  cordis_inspect: 'inspect',
  cordis_inspect_self: 'inspect',   // appears in the DSH system-prompt/tool-schema surface, not as a recorded call
  cordis_inspect_query: 'inspect',  // appears in the DSH system-prompt/tool-schema surface, not as a recorded call
  cordis_define: 'define',
  cordis_mount: 'run',     // legacy name, equivalent to run
  cordis_run: 'run',
  cordis_stop: 'stop',
  cordis_unmount: 'stop',  // legacy name, equivalent to stop
  cordis_undefine: 'undefine',
}

/** Classify a tool name into a cordis verb; return null for non-cordis tools. */
export function classifyCordisCall(name: string): CordisVerb | null {
  return CORDIS_VERB_MAP[name] ?? null
}
