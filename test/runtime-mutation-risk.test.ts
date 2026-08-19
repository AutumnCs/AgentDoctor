import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSessionLog } from '../src/session-log.js'
import { runtimeMutationRiskRule } from '../src/rules/runtime-mutation-risk.js'

describe('runtime mutation risk rule', () => {
  const bad = runtimeMutationRiskRule.analyze(parseSessionLog(
    readFileSync('test/fixtures/runtime-mutation-risk.jsonl', 'utf-8')))

  it('reports exactly one finding (only the ghost rollback)', () => {
    expect(bad).toHaveLength(1)
  })

  it('flags a rollback on a plugin never defined or run this session (ghost-1)', () => {
    const ghosts = bad.filter(f => f.title === 'rollback on unregistered plugin')
    expect(ghosts).toHaveLength(1)
    expect(ghosts[0].severity).toBe('warning')
    expect(ghosts[0].truthLevel).toBe('derived')
    expect(ghosts[0].evidence.some(e => e.seq === 110)).toBe(true)
    expect(ghosts[0].evidence.some(e => e.summary.includes('ghost-1'))).toBe(true)
  })

  it('does not emit an unclosed-mutation finding (that is noise, not signal)', () => {
    const unclosed = bad.filter(f => f.title === 'unclosed mutation')
    expect(unclosed).toHaveLength(0)
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

  it('does not flag run-then-stop when the plugin was defined cross-session', () => {
    // A plugin run this session (its define happened in a prior session) is not a
    // ghost when later stopped — `run` admits its id to the exists set.
    const crossSession = [
      '{"type":"session","version":0,"id":"cross-0001","createdAt":1,"cwd":"G:/AgentDoctor"}',
      '{"type":"tool/call","seq":1,"time":2,"data":{"turn":1,"step":1,"callId":"run-cross","name":"cordis_run","arguments":"{\\"pluginId\\":\\"cross-1\\",\\"packageId\\":\\"pkg-1\\",\\"mode\\":\\"run\\"}"}}',
      '{"type":"tool/call","seq":2,"time":3,"data":{"turn":1,"step":2,"callId":"stop-cross","name":"cordis_stop","arguments":"{\\"pluginId\\":\\"cross-1\\"}"}}',
    ].join('\n')
    const findings = runtimeMutationRiskRule.analyze(parseSessionLog(crossSession))
    expect(findings).toEqual([])
  })
})
