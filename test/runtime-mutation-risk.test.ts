import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSessionLog } from '../src/session-log.js'
import { runtimeMutationRiskRule } from '../src/rules/runtime-mutation-risk.js'

describe('runtime mutation risk rule', () => {
  const bad = runtimeMutationRiskRule.analyze(parseSessionLog(
    readFileSync('test/fixtures/runtime-mutation-risk.jsonl', 'utf-8')))

  it('reports exactly two findings', () => {
    expect(bad).toHaveLength(2)
  })

  it('flags a rollback on a plugin never defined or run this session (ghost-1)', () => {
    const ghosts = bad.filter(f => f.title === 'rollback on unregistered plugin')
    expect(ghosts).toHaveLength(1)
    expect(ghosts[0].severity).toBe('warning')
    expect(ghosts[0].truthLevel).toBe('derived')
    expect(ghosts[0].evidence.some(e => e.seq === 110)).toBe(true)
    expect(ghosts[0].evidence.some(e => e.summary.includes('ghost-1'))).toBe(true)
  })

  it('flags a mutation left running at session end (repo-1)', () => {
    const unclosed = bad.filter(f => f.title === 'unclosed mutation')
    expect(unclosed).toHaveLength(1)
    expect(unclosed[0].severity).toBe('info')
    expect(unclosed[0].truthLevel).toBe('derived')
    expect(unclosed[0].evidence.some(e => e.seq === 102)).toBe(true)
    expect(unclosed[0].evidence.some(e => e.summary.includes('repo-1'))).toBe(true)
  })

  it('does not flag the balanced run-then-stop of insp-1', () => {
    const mentions = bad.filter(f =>
      f.diagnosis.includes('insp-1') || f.evidence.some(e => e.summary.includes('insp-1')))
    expect(mentions).toHaveLength(0)
  })

  it('produces no findings on a clean session with no cordis mutation', () => {
    const clean = runtimeMutationRiskRule.analyze(parseSessionLog(
      readFileSync('test/fixtures/code-mode-turn.jsonl', 'utf-8')))
    expect(clean).toEqual([])
  })
})
