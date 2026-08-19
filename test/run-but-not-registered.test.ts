import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSessionLog } from '../src/session-log.js'
import { runButNotRegisteredRule } from '../src/rules/run-but-not-registered.js'

describe('run-but-not-registered rule', () => {
  const findings = runButNotRegisteredRule.analyze(parseSessionLog(
    readFileSync('test/fixtures/run-but-not-registered.jsonl', 'utf-8')))

  it('flags the run whose declared tool did not register', () => {
    expect(findings).toHaveLength(1)
    const f = findings[0]
    expect(f.title).toBe('Run activated but tool did not register')
    expect(f.severity).toBe('warning')
    expect(f.truthLevel).toBe('derived')
    // evidence points at the run (6525) and the tool-list result missing 'greet' (6621)
    expect(f.evidence.some(e => e.seq === 6525)).toBe(true)
    expect(f.evidence.some(e => e.seq === 6621)).toBe(true)
  })

  it('names the missing tool and the plugin', () => {
    const f = findings[0]
    expect(f.diagnosis).toContain('grx-1')
    expect(f.diagnosis).toContain("'greet'")
  })

  it('does NOT flag the later update that did register the tool', () => {
    // The fix (run pkg-2 at seq 11578) registers 'greet' successfully; it must not be
    // reported. Only the first run (seq 6525) is a finding.
    const fixRuns = findings.filter(f => f.evidence.some(e => e.seq === 11578))
    expect(fixRuns).toHaveLength(0)
  })
})

describe('run-but-not-registered rule (false-positive edges)', () => {
  // Build session lines programmatically with JSON.stringify so the nested `arguments`
  // JSON string is escaped correctly (hand-written escapes silently break parsing).
  function line(type: string, seq: number, data: unknown): string {
    if (type === 'session') {
      return JSON.stringify({ type: 'session', version: 0, id: 'edge', createdAt: 1, cwd: 'G:/AgentDoctor' })
    }
    return JSON.stringify({ type, seq, time: seq, data })
  }
  function call(seq: number, callId: string, name: string, args: Record<string, unknown>) {
    return line('tool/call', seq, { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) })
  }
  function defineResult(seq: number, callId: string, pluginId: string, packageId: string) {
    return line('tool/result', seq, {
      message: { content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: `Defined ${pluginId}/${packageId}` }], isError: false }] },
      meta: { pluginId, packageId },
    })
  }
  function listToolsResult(seq: number, toolNames: string[]) {
    const body = { method: 'listTools', data: { tools: toolNames.map(n => ({ name: n })) } }
    return line('tool/result', seq, {
      message: { content: [{ type: 'tool-result', toolCallId: 'lt', content: [{ type: 'text', text: JSON.stringify(body) }], isError: false }] },
    })
  }
  function analyze(lines: string[]) {
    return runButNotRegisteredRule.analyze(parseSessionLog(lines.join('\n')))
  }

  it('does NOT flag when the plugin is stopped before the next listTools (absence is explained by removal)', () => {
    const lines = [
      line('session', 0, null),
      call(10, 'd1', 'cordis_define', { plugin: { kind: 'new', idPrefix: 'x' }, name: 'n', code: { host: "harness.defineTool({ name: 't' })" } }),
      defineResult(11, 'd1', 'x-1', 'pkg-1'),
      call(12, 'r1', 'cordis_run', { pluginId: 'x-1', packageId: 'pkg-1', mode: 'run' }),
      call(13, 's1', 'cordis_stop', { pluginId: 'x-1' }),
      listToolsResult(14, []),
    ]
    expect(analyze(lines)).toEqual([])
  })

  it('checks a run against the declaration in force at that time, not a later redefinition', () => {
    const lines = [
      line('session', 0, null),
      call(20, 'd1', 'cordis_define', { plugin: { kind: 'new', idPrefix: 'x' }, name: 'n', code: { host: "harness.defineTool({ name: 'a' })" } }),
      defineResult(21, 'd1', 'x-1', 'pkg-1'),
      call(22, 'r1', 'cordis_run', { pluginId: 'x-1', packageId: 'pkg-1', mode: 'run' }),
      call(23, 'd2', 'cordis_define', { plugin: { kind: 'existing', pluginId: 'x-1' }, name: 'n2', code: { host: "harness.defineTool({ name: 'b' })" } }),
      defineResult(24, 'd2', 'x-1', 'pkg-2'),
      listToolsResult(25, ['a']),
    ]
    expect(analyze(lines)).toEqual([])
  })
})
