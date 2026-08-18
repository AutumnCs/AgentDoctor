export interface SessionHeaderLine {
  type: 'session'
  version: number
  id: string
  createdAt: number
  cwd?: string
  [key: string]: unknown
}

export interface SessionEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
}

export interface ParsedSession {
  header: SessionHeaderLine
  events: SessionEvent[]
}

/**
 * Parse a DSH session JSONL: the first line is the session header, each
 * subsequent line is an event. Read-only and fault-tolerant: skip a
 * non-JSON line with a warning instead of throwing.
 * See DESIGN.md section 3 "single source of truth".
 */
export function parseSessionLog(text: string): ParsedSession {
  const lines = text.split('\n').filter(line => line.trim().length > 0)
  let header: SessionHeaderLine | null = null
  const events: SessionEvent[] = []

  for (const line of lines) {
    let record: any
    try {
      record = JSON.parse(line)
    } catch {
      console.warn('session-log: skip invalid JSON line')
      continue
    }
    if (record.type === 'session') {
      header = record
    } else {
      events.push({
        type: record.type,
        seq: record.seq,
        time: record.time,
        data: record.data ?? {},
      })
    }
  }

  if (header === null) {
    throw new Error('session-log: missing session header line')
  }
  return { header, events }
}
