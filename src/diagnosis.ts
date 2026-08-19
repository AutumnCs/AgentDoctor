import type { ParsedSession } from './session-log.js'
import type { Finding, DiagnosisRule } from './types.js'
import { runtimeMutationRiskRule } from './rules/runtime-mutation-risk.js'

/** All registered diagnosis rules. Add a rule here to enable it. */
export const RULES: DiagnosisRule[] = [
  runtimeMutationRiskRule,
]

/** Run every registered rule over a parsed session and collect all findings. */
export function runDiagnosis(parsed: ParsedSession): Finding[] {
  const findings: Finding[] = []
  for (const rule of RULES) {
    findings.push(...rule.analyze(parsed))
  }
  return findings
}
