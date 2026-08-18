import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { classifyCordisCall, CORDIS_VERB_MAP } from '../src/cordis-verbs.js'
import { parseSessionLog } from '../src/session-log.js'
import { buildRuntimeSnapshots } from '../src/runtime-snapshot.js'
import { diffRuntime } from '../src/runtime-diff.js'

describe('classifyCordisCall', () => {
  it('recognizes legacy cordis_mount / cordis_unmount', () => {
    expect(classifyCordisCall('cordis_mount')).toBe('run')
    expect(classifyCordisCall('cordis_unmount')).toBe('stop')
  })

  it('recognizes current cordis_run / cordis_stop / cordis_undefine', () => {
    expect(classifyCordisCall('cordis_run')).toBe('run')
    expect(classifyCordisCall('cordis_stop')).toBe('stop')
    expect(classifyCordisCall('cordis_undefine')).toBe('undefine')
  })

  it('returns null for non-cordis tools', () => {
    expect(classifyCordisCall('bash')).toBe(null)
    expect(classifyCordisCall('inspect_pr')).toBe(null)
  })
})

describe('runtime snapshot + diff', () => {
  it('从 session log 重建出至少两个 runtime 快照', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const snapshots = buildRuntimeSnapshots(parseSessionLog(text))
    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    expect(snapshots[0].revision).toBeLessThan(snapshots[snapshots.length - 1].revision)
  })

  it('diff 出 cordis_mount 新增的节点', () => {
    const text = readFileSync('test/fixtures/cordis-tool-round.jsonl', 'utf-8')
    const snapshots = buildRuntimeSnapshots(parseSessionLog(text))
    // 找到 mount 前后的两个快照
    const diff = diffRuntime(snapshots[0], snapshots[1])
    expect(diff.added.length).toBeGreaterThan(0)
    expect(diff.added.some(n => n.origin === 'dynamic')).toBe(true)
  })
})
