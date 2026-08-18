import { describe, it, expect } from 'vitest'
import { classifyCordisCall, CORDIS_VERB_MAP } from '../src/cordis-verbs.js'

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
