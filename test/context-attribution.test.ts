import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSessionLog } from '../src/session-log.js'
import { attributeContext } from '../src/context-attribution.js'

describe('attributeContext', () => {
  it('extracts system and tool-schema contributions from request/header', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const snapshot = attributeContext(parseSessionLog(text))
    const cats = snapshot.contributions.map(c => c.category)
    expect(cats).toContain('system')
    expect(cats).toContain('tool-schema')
  })

  it('labels tool-schema contribution as an estimate, not exact', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const snapshot = attributeContext(parseSessionLog(text))
    const schema = snapshot.contributions.find(c => c.category === 'tool-schema')
    expect(schema?.level).toBe('derived')
  })
})
