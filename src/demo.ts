import { readFileSync } from 'node:fs'
import { parseSessionLog } from './session-log.js'
import { buildRuntimeSnapshots } from './runtime-snapshot.js'
import { diffRuntime } from './runtime-diff.js'
import { attributeContext } from './context-attribution.js'

function main(): void {
  const path = process.argv[2] ?? 'test/fixtures/advanced-toolchain.jsonl'
  console.log('╔══════════════════════════════════════╗')
  console.log('║  Agent Doctor — demo (SAMPLE DATA)   ║')
  console.log('╚══════════════════════════════════════╝')

  const parsed = parseSessionLog(readFileSync(path, 'utf-8'))
  console.log(`\nSession: ${parsed.header.id}`)
  console.log(`Events:  ${parsed.events.length}`)

  const snapshots = buildRuntimeSnapshots(parsed)
  console.log(`\n── Runtime snapshots ──`)
  console.log(`${snapshots.length} snapshots (revision 0 → ${snapshots[snapshots.length - 1].revision})`)

  for (let i = 1; i < snapshots.length; i++) {
    const d = diffRuntime(snapshots[i - 1], snapshots[i])
    console.log(`\nrev ${d.from} → ${d.to}`)
    for (const n of d.added) console.log(`  + ${n.name} (${n.origin})`)
    for (const n of d.removed) console.log(`  - ${n.name} (${n.origin})`)
    console.log(`  tools: ${d.toolCountDelta >= 0 ? '+' : ''}${d.toolCountDelta}`)
  }

  const ctx = attributeContext(parsed)
  console.log(`\n── Context attribution (estimate) ──`)
  console.log(`total ~${ctx.totalTokens} tokens (estimated)`)
  for (const c of ctx.contributions) {
    console.log(`  ${c.category.padEnd(14)} ~${c.tokens} (${c.level})`)
  }
}

main()
