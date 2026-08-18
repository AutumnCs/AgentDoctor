import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSessionLog } from '../src/session-log.js'
import { attributeContext } from '../src/context-attribution.js'

describe('attributeContext', () => {
  const text = readFileSync('test/fixtures/advanced-toolchain.jsonl', 'utf-8')
  const snapshot = attributeContext(parseSessionLog(text))

  it('covers all four categories: system, messages, tool-result, tool-schema', () => {
    const cats = snapshot.contributions.map(c => c.category)
    expect(cats).toContain('system')
    expect(cats).toContain('messages')
    expect(cats).toContain('tool-result')
    expect(cats).toContain('tool-schema')
  })

  it('attributes real tool-result content (not ~1 token)', () => {
    const toolResult = snapshot.contributions.filter(c => c.category === 'tool-result')
    // the fixture's cordis_define/undefine results carry real text; their summed
    // estimate must exceed a trivial 1 token each
    const total = toolResult.reduce((s, c) => s + c.tokens, 0)
    expect(total).toBeGreaterThan(toolResult.length * 2)
  })

  it('attributes messages from user/message and assistant/message content', () => {
    const messages = snapshot.contributions.find(c => c.category === 'messages')
    expect(messages).toBeDefined()
    expect(messages!.tokens).toBeGreaterThan(0)
  })

  it('reports non-trivial magnitudes for dominant categories', () => {
    const byCategory = (cat: string) => snapshot.contributions.find(c => c.category === cat)?.tokens ?? 0
    expect(byCategory('system')).toBeGreaterThan(10000)
    expect(byCategory('tool-schema')).toBeGreaterThan(5000)
    expect(byCategory('messages')).toBeGreaterThan(400)
  })

  it('labels all contributions as derived estimates (no fake precision)', () => {
    for (const c of snapshot.contributions) {
      expect(c.level).toBe('derived')
    }
  })
})
