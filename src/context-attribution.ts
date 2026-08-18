import type { ParsedSession } from './session-log.js'
import type { ContextSnapshot, ContextContribution } from './types.js'

/** Rough token estimate: content string length / 1.5, as a derived estimate. */
function roughTokens(text: string): number {
  return Math.round(text.length / 1.5)
}

/** Extract the plain-text content of a message content block array. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.map((block: any) => {
    if (typeof block?.text === 'string') return block.text
    if (block?.type === 'tool-result') return textOf(block.content)
    if (block?.type === 'tool-call') return block.arguments ?? ''
    return ''
  }).join('\n')
}

/**
 * Attribute context composition from the real DSH on-disk format.
 * Categories: system (request/header.system), messages (user/message +
 * assistant/message content), tool-result (tool/result inner content),
 * tool-schema (request/header.tools).
 *
 * Truthfulness: all token figures are DERIVED estimates (content length),
 * because DSH's tokenMeter reports only a total, not a per-category breakdown.
 * Placeholder values ({{...}}) are skipped, never given a fake number.
 * See DESIGN.md truthfulness principle.
 */
export function attributeContext(parsed: ParsedSession): ContextSnapshot {
  const contributions: ContextContribution[] = []
  let total = 0

  const add = (category: ContextContribution['category'], tokens: number, sourceId?: string) => {
    if (tokens <= 0) return
    contributions.push({ category, tokens, level: 'derived', ...(sourceId ? { sourceId } : {}) })
    total += tokens
  }

  // system + tool-schema from the LAST request/header
  const header = parsed.events.filter(e => e.type === 'request/header').at(-1)
  if (header) {
    const h = (header.data as any).header
    if (typeof h?.system === 'string' && h.system.length > 0) {
      add('system', roughTokens(h.system))
    }
    if (Array.isArray(h?.tools) && h.tools.length > 0) {
      // tools is a ToolSchema[] array in the real format; estimate over its JSON
      add('tool-schema', roughTokens(JSON.stringify(h.tools)))
    }
  }

  // messages + tool-result from surface events
  let messagesTokens = 0
  for (const e of parsed.events) {
    if (e.type === 'user/message') {
      // user/message data IS the message (data.content[])
      messagesTokens += roughTokens(textOf((e.data as any).content))
    } else if (e.type === 'assistant/message') {
      // assistant/message wraps the message in data.message
      messagesTokens += roughTokens(textOf((e.data as any).message?.content))
    } else if (e.type === 'tool/result') {
      // tool/result: data.message.content[0] is a tool-result block with inner content
      const msg = (e.data as any).message
      const inner = msg?.content?.[0]?.content
      add('tool-result', roughTokens(textOf(inner)), String(e.seq))
    }
  }
  add('messages', messagesTokens)

  return { totalTokens: total, contributions }
}
