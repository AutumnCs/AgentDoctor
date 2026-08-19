import type { ParsedSession } from './session-log.js'
import { computeEvolution } from './evolution.js'
import type { EvolutionStep } from './evolution.js'

/**
 * Render a session's tool-surface evolution as a self-contained HTML page (no external
 * assets, no framework, no server). The page shows the declared-vs-observed story with
 * GitHub-style red/green, hoverable evidence (seq pointers), and a plain-English summary
 * up top so a developer can read the agent's self-modification at a glance.
 *
 * Truthfulness: the page renders only what computeEvolution established — observed
 * (`+`), declared-but-missing (`~`), or unobserved. It never asserts a cause.
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function stepHtml(s: EvolutionStep): string {
  const c = s.change
  const id = `${c.pluginId ?? '?'}${c.packageId ? '/' + c.packageId : ''}`
  const seqTag = `<span class="seq">seq ${c.seq}</span>`

  if (c.kind === 'define') {
    const declares = c.declaredToolNames.length > 0
      ? `<div class="sub">wants to add ${c.declaredToolNames.map(t => `<code class="tool">${esc(t)}</code>`).join(', ')}</div>`
      : ''
    return `<div class="step define">${seqTag}<span class="verb define">define</span> <code class="id">${esc(id)}</code>${declares}</div>`
  }

  // run
  const runLabel = `<span class="verb run">run</span>`
  if (c.declaredToolNames.length === 0) {
    return `<div class="step run">${seqTag}${runLabel} <code class="id">${esc(id)}</code><div class="sub muted">(no tool declared)</div></div>`
  }
  if (s.unobserved) {
    return `<div class="step run">${seqTag}${runLabel} <code class="id">${esc(id)}</code><div class="sub muted">outcome not observed — no tool-list snapshot followed</div></div>`
  }

  const rows = [
    ...s.observed.map(t => `<div class="line add">+ <code class="tool">${esc(t)}</code><span class="why">took effect <span class="seq">@${s.snapshotSeq}</span></span></div>`),
    ...s.missing.map(t => `<div class="line miss">~ <code class="tool">${esc(t)}</code><span class="why">didn't show up <span class="seq">@${s.snapshotSeq}</span></span></div>`),
  ]
  return `<div class="step run">${seqTag}${runLabel} <code class="id">${esc(id)}</code>${rows.join('')}</div>`
}

function summaryHtml(steps: EvolutionStep[]): string {
  const runs = steps.filter(s => s.change.kind === 'run')
  const failed = runs.filter(s => s.missing.length > 0)
  const ok = runs.filter(s => s.observed.length > 0 && s.missing.length === 0)
  const total = runs.length

  if (total === 0) return `<p class="summary">This session didn't modify its own tools.</p>`

  const parts: string[] = []
  if (total > 0) parts.push(`<strong>${total}</strong> tool-surface change${total > 1 ? 's' : ''}`)
  if (ok.length > 0) parts.push(`<strong class="ok">${ok.length}</strong> took effect`)
  if (failed.length > 0) parts.push(`<strong class="bad">${failed.length}</strong> didn't show up`)
  return `<p class="summary">${parts.join(' · ')}</p>`
}

export function renderEvolutionHtml(parsed: ParsedSession): string {
  const steps = computeEvolution(parsed)
  const body = steps.length > 0
    ? steps.map(stepHtml).join('\n')
    : `<div class="empty">No cordis self-modification in this session.</div>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Doctor — tool-surface evolution</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0d1117;
    --panel: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --add: #3fb950;
    --miss: #d29922;
    --bad: #f85149;
    --accent: #58a6ff;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 760px; margin: 0 auto; padding: 40px 24px 64px; }
  header h1 { font-size: 20px; font-weight: 600; margin: 0 0 6px; letter-spacing: -0.01em; }
  header .sub { color: var(--muted); font-size: 14px; margin: 0; }
  .summary {
    font-size: 15px;
    margin: 24px 0 20px;
    padding: 14px 16px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .summary strong { font-weight: 600; }
  .summary .ok { color: var(--add); }
  .summary .bad { color: var(--bad); }
  .step {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 12px;
    background: var(--panel);
    font-family: var(--mono);
    font-size: 14px;
  }
  .step .seq { color: var(--muted); font-size: 12px; margin-right: 10px; }
  .verb {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 7px;
    border-radius: 4px;
    margin-right: 8px;
    vertical-align: 1px;
  }
  .verb.define { color: var(--accent); background: rgba(88,166,255,0.12); }
  .verb.run { color: #7ee787; background: rgba(126,231,135,0.12); }
  .id { color: var(--text); font-weight: 600; }
  .sub { margin-top: 8px; color: var(--muted); font-size: 13px; }
  .sub.muted { font-style: italic; }
  .line { margin-top: 10px; padding: 6px 10px; border-radius: 5px; font-size: 13px; }
  .line.add { background: rgba(63,185,80,0.10); }
  .line.add::before { content: ''; }
  .line.miss { background: rgba(210,153,34,0.10); }
  .line .why { color: var(--muted); font-size: 12px; margin-left: 8px; }
  .line.miss .why { color: #d29922; }
  code.tool { color: #ffa657; }
  .empty { color: var(--muted); text-align: center; padding: 48px 0; }
  footer { margin-top: 32px; color: var(--muted); font-size: 12px; text-align: center; }
  a { color: var(--accent); text-decoration: none; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Agent Doctor — tool-surface evolution</h1>
    <p class="sub">What this agent claimed to change, and what actually took effect.</p>
  </header>
  ${summaryHtml(steps)}
  ${body}
  <footer>Every line points at the raw session event (<code>seq</code>) that produced it. <a href="https://github.com/AutumnCs/AgentDoctor">Agent Doctor</a></footer>
</div>
</body>
</html>
`
}
