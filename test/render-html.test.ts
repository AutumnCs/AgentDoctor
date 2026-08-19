import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSessionLog } from '../src/session-log.js'
import { renderEvolutionHtml } from '../src/render-html.js'

describe('renderEvolutionHtml', () => {
  const html = renderEvolutionHtml(parseSessionLog(
    readFileSync('test/fixtures/run-but-not-registered.jsonl', 'utf-8')))

  it('is a self-contained HTML document with no external assets', () => {
    expect(html).toMatch(/^<!doctype html>/i)
    expect(html).toContain('<style>')
    // no external stylesheet or script — only the footer link to the repo
    expect(html).not.toContain('<link')
    expect(html).not.toContain('<script src=')
    expect(html).not.toContain('@import')
  })

  it('shows the observed tool (took effect) and the missing tool (didn\'t show up)', () => {
    expect(html).toContain('took effect')
    expect(html).toContain("didn't show up")
  })

  it('renders the declared tool name and the plugin id', () => {
    expect(html).toContain('greet')
    expect(html).toContain('grx-1')
  })

  it('shows the evidence seq pointers (@6621 for the missing, @11634 for the observed)', () => {
    expect(html).toContain('@6621')
    expect(html).toContain('@11634')
  })

  it('summarizes the counts up top (1 change, 1 ok, 1 failed)', () => {
    // The summary line: "2 tool-surface changes · 1 took effect · 1 didn't show up"
    expect(html).toContain('tool-surface change')
  })
})
