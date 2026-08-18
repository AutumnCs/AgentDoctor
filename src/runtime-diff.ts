import type { RuntimeSnapshot, RuntimeDiff, RuntimeNode } from './types.js'

/** Compute a git-style diff between two snapshots. */
export function diffRuntime(a: RuntimeSnapshot, b: RuntimeSnapshot): RuntimeDiff {
  const aIds = new Set(a.nodes.map(n => n.id))
  const bIds = new Set(b.nodes.map(n => n.id))
  const added: RuntimeNode[] = b.nodes.filter(n => !aIds.has(n.id))
  const removed: RuntimeNode[] = a.nodes.filter(n => !bIds.has(n.id))
  return {
    from: a.revision,
    to: b.revision,
    added,
    removed,
    toolCountDelta: b.toolCount - a.toolCount,
  }
}
