import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSessionLog } from '../src/session-log.js'

describe('parseSessionLog', () => {
  it('解析首行为 session 头', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const parsed = parseSessionLog(text)
    expect(parsed.header.type).toBe('session')
    expect(parsed.header.id).toBe('sess-0001')
  })

  it('解析出所有事件并保留 seq 顺序', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const parsed = parseSessionLog(text)
    expect(parsed.events.length).toBeGreaterThan(0)
    const seqs = parsed.events.map(e => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
  })

  it('提取出 cordis tool/call 事件', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const parsed = parseSessionLog(text)
    const cordisCalls = parsed.events.filter(e =>
      e.type === 'tool/call' && String(e.data.name).startsWith('cordis_'))
    expect(cordisCalls.length).toBeGreaterThan(0)
    expect(cordisCalls.map(c => c.data.name)).toContain('cordis_inspect')
  })
})
