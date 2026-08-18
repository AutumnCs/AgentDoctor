import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSessionLog } from '../src/session-log.js'

describe('parseSessionLog', () => {
  it('parses the first line as the session header', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const parsed = parseSessionLog(text)
    expect(parsed.header.type).toBe('session')
    expect(parsed.header.id).toBe('sess-0001')
  })

  it('parses all events and preserves seq order', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const parsed = parseSessionLog(text)
    expect(parsed.events.length).toBeGreaterThan(0)
    const seqs = parsed.events.map(e => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
  })

  it('extracts cordis tool/call events', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const parsed = parseSessionLog(text)
    const cordisCalls = parsed.events.filter(e =>
      e.type === 'tool/call' && String(e.data.name).startsWith('cordis_'))
    expect(cordisCalls.length).toBeGreaterThan(0)
    expect(cordisCalls.map(c => c.data.name)).toContain('cordis_inspect')
  })
})
