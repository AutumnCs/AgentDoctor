import type { ParsedSession, SessionEvent } from './session-log.js'
import type { RuntimeSnapshot, RuntimeNode } from './types.js'
import { classifyCordisCall } from './cordis-verbs.js'

/**
 * Rebuild the runtime snapshot sequence from the session log.
 * Static baseline (cordis.yml) is an empty baseline in Phase 0; dynamic
 * changes come from cordis tool/call events.
 * See DESIGN.md "DSH self-evolution is 5 enumerable verbs".
 */
export function buildRuntimeSnapshots(parsed: ParsedSession): RuntimeSnapshot[] {
  const snapshots: RuntimeSnapshot[] = []
  let revision = 0
  let nodes: RuntimeNode[] = []

  // initial snapshot
  snapshots.push({ revision, nodes: [...nodes], toolCount: nodes.filter(n => n.kind === 'tool').length })

  for (const event of parsed.events) {
    if (event.type !== 'tool/call') continue
    const name = String(event.data.name)
    const verb = classifyCordisCall(name)
    // inspect is read-only: it reports topology but does not mutate it, so it
    // must not bump the revision or produce a snapshot.
    if (verb === null || verb === 'inspect') continue

    revision++
    if (verb === 'run' || verb === 'define') {
      // cordis_mount / cordis_run: parse the package name, record a dynamic node
      const args = JSON.parse(String(event.data.arguments ?? '{}'))
      const pkgName = String(args.name ?? args.code ?? `dyn-${revision}`)
      nodes.push({ id: `dyn-${revision}`, kind: 'plugin', origin: 'dynamic', name: pkgName })
    } else if (verb === 'stop' || verb === 'undefine') {
      // unmount: remove the matching dynamic node (simplified: remove the last dynamic)
      const idx = nodes.findIndex(n => n.origin === 'dynamic')
      if (idx >= 0) nodes = nodes.filter((_, i) => i !== idx)
    }
    snapshots.push({ revision, nodes: [...nodes], toolCount: nodes.filter(n => n.kind === 'tool').length })
  }

  return snapshots
}
