import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSessionLog } from '../src/session-log.js'
import { renderEvolution } from '../src/evolution.js'

describe('renderEvolution', () => {
  const output = renderEvolution(parseSessionLog(
    readFileSync('test/fixtures/run-but-not-registered.jsonl', 'utf-8')))

  it('shows the declared tool for the define', () => {
    expect(output).toContain("declares tool(s): 'greet'")
  })

  it('marks the failed run as declared but not visible', () => {
    // first run (pkg-1) declared greet, but the snapshot after it (@6621) lacks greet
    expect(output).toContain("~ tool 'greet'  declared but not visible in snapshot @6621")
  })

  it('marks the fixed run as observed', () => {
    // second run (pkg-2) declared greet and the snapshot after it (@11634) has it
    expect(output).toContain("+ tool 'greet'  (observed in snapshot @11634)")
  })

  it('renders the full lifecycle in order (define → failed run → redefine → fixed run)', () => {
    const d1 = output.indexOf('rev 6437')
    const r1 = output.indexOf('rev 6525')
    const d2 = output.indexOf('rev 11498')
    const r2 = output.indexOf('rev 11578')
    expect(d1).toBeGreaterThanOrEqual(0)
    expect(r1).toBeGreaterThan(d1)
    expect(d2).toBeGreaterThan(r1)
    expect(r2).toBeGreaterThan(d2)
  })
})

describe('renderEvolution (truthfulness edges)', () => {
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
  function render(lines: string[]) {
    return renderEvolution(parseSessionLog(lines.join('\n')))
  }

  it('does NOT flag a tool that was stopped before the next snapshot (absence is removal, not failure)', () => {
    const lines = [
      line('session', 0, null),
      call(10, 'd1', 'cordis_define', { plugin: { kind: 'new', idPrefix: 'x' }, name: 'n', code: { host: "harness.defineTool({ name: 't' })" } }),
      defineResult(11, 'd1', 'x-1', 'pkg-1'),
      call(12, 'r1', 'cordis_run', { pluginId: 'x-1', packageId: 'pkg-1', mode: 'run' }),
      call(13, 's1', 'cordis_stop', { pluginId: 'x-1' }),
      listToolsResult(14, []),
    ]
    const out = render(lines)
    // the run should show "no tool-list snapshot after this run" (bounded by stop),
    // NOT "declared but not visible"
    expect(out).not.toContain('declared but not visible')
    expect(out).toContain('no tool-list snapshot after this run')
  })

  it('does NOT flag a run with no following snapshot (marks it unobserved, not failed)', () => {
    const lines = [
      line('session', 0, null),
      call(10, 'd1', 'cordis_define', { plugin: { kind: 'new', idPrefix: 'x' }, name: 'n', code: { host: "harness.defineTool({ name: 't' })" } }),
      defineResult(11, 'd1', 'x-1', 'pkg-1'),
      call(12, 'r1', 'cordis_run', { pluginId: 'x-1', packageId: 'pkg-1', mode: 'run' }),
    ]
    const out = render(lines)
    expect(out).not.toContain('declared but not visible')
    expect(out).toContain('no tool-list snapshot after this run')
  })
})
