import { readFileSync } from 'node:fs'
import { parseSessionLog } from './session-log.js'
import { RULES, runDiagnosis } from './diagnosis.js'
import type { Finding } from './types.js'

const SEVERITY_ORDER: Record<Finding['severity'], number> = { critical: 0, warning: 1, info: 2 }

function printFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log('no findings')
    return
  }
  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  for (const f of sorted) {
    console.log(`\n[${f.severity}] [${f.truthLevel}] ${f.title}`)
    console.log(`  ${f.diagnosis}`)
    for (const ev of f.evidence) {
      console.log(`  evidence: seq ${ev.seq} (${ev.eventType}) — ${ev.summary}`)
    }
  }
}

function main(): void {
  const [cmd, arg] = process.argv.slice(2)

  if (cmd === 'rules') {
    for (const r of RULES) {
      console.log(`${r.id} — ${r.title}`)
      console.log(`  ${r.description}`)
    }
    return
  }

  if (cmd === 'diagnose') {
    if (!arg) {
      console.error('usage: npx tsx src/cli.ts diagnose <session.jsonl>')
      process.exit(1)
    }
    let text: string
    try {
      text = readFileSync(arg, 'utf-8')
    } catch {
      console.error(`error: cannot read ${arg}`)
      process.exit(1)
    }
    try {
      const parsed = parseSessionLog(text)
      printFindings(runDiagnosis(parsed))
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
    return
  }

  console.error('usage: npx tsx src/cli.ts <diagnose <session.jsonl> | rules>')
  process.exit(1)
}

main()
