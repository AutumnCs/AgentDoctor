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
 * 解析 DSH session JSONL：首行是 session 头，后续每行是一个事件。
 * 只读、容错：某行不是合法 JSON 时跳过并记 warning，不抛异常。
 * 见 DESIGN.md 第 3 节「唯一事实源」。
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
