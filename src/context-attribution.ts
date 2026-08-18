import type { ParsedSession } from './session-log.js'
import type { ContextSnapshot, ContextContribution } from './types.js'

/** Rough token estimate: chars / 1.5, as a derived estimate. */
function roughTokens(text: string): number {
  return Math.round(text.length / 1.5)
}

/**
 * Attribute context composition from request/header + tool/result.
 * Important: all token attribution is an estimate (DSH tokenMeter gives only
 * a total, not semantic breakdown), so label it level: 'derived' — never
 * present fake precision. See DESIGN.md section 9.
 */
export function attributeContext(parsed: ParsedSession): ContextSnapshot {
  const contributions: ContextContribution[] = []
  let total = 0

  const header = parsed.events.filter(e => e.type === 'request/header').at(-1)
  if (header) {
    const h = header.data.header as any
    if (typeof h?.system === 'string') {
      const t = roughTokens(h.system)
      contributions.push({ category: 'system', tokens: t, level: 'derived' })
      total += t
    }
    if (Array.isArray(h?.tools)) {
      const t = roughTokens(JSON.stringify(h.tools))
      contributions.push({ category: 'tool-schema', tokens: t, level: 'derived' })
      total += t
    }
  }

  for (const e of parsed.events) {
    if (e.type === 'tool/result') {
      const content = (e.data.message as any)?.content
      const t = roughTokens(JSON.stringify(content ?? ''))
      contributions.push({ category: 'tool-result', tokens: t, level: 'derived', sourceId: String(e.seq) })
      total += t
    }
  }

  return { totalTokens: total, contributions }
}
