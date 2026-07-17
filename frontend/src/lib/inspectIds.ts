// Detection of inspectable IDs for the payload navigator.
//
// Grammar mirrors packages/engine/src/domain/hierarchicalIds.ts (the source of truth):
//   - session id = 4 uppercase Crockford base32 chars (no I/O/0/1)
//   - hierarchical suffixes: .S (setup), .<n>T/.<n>W/.<n>C (turn/step), .<n> (round/part),
//     and a trailing -<TYPE> part suffix (SP/MI/TD/U/R/A/T/TR/DN)
//   - benchmark family: B-XXXX, B-XXXX.N, R-XXXX, E-XXXX
//
// Config ids (model_config_id uuids, mcp_profile_ids / judge model slugs) are lowercase or
// dashed and do NOT match — so grammar-based detection excludes non-navigable ids for free.

const SESSION_BASE = '[A-HJ-NP-Z2-9]{4}'
const RUNTIME_ID = new RegExp(`^${SESSION_BASE}(?:\\.[0-9A-Z]+)*(?:-[A-Z]{1,2})?$`)
const BENCHMARK_ID = /^[BRE]-[A-HJ-NP-Z2-9]{4}(?:\.[0-9]+)?$/

/** True when `value` is a navigable inspect id (not a config uuid/slug). */
export function isInspectId(value: string): boolean {
  return RUNTIME_ID.test(value) || BENCHMARK_ID.test(value)
}

/** Collect every inspectable id appearing as a string value anywhere in a payload. */
export function collectInspectIds(data: unknown, acc: Set<string> = new Set()): Set<string> {
  if (typeof data === 'string') {
    if (isInspectId(data)) acc.add(data)
    return acc
  }
  if (Array.isArray(data)) {
    for (const item of data) collectInspectIds(item, acc)
    return acc
  }
  if (data && typeof data === 'object') {
    for (const value of Object.values(data)) collectInspectIds(value, acc)
  }
  return acc
}

export interface Segment {
  text: string
  /** Present when this segment is a clickable id. */
  id?: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Split a display string (rendered text or JSON) into plain + id segments, linking only
 * occurrences of ids in `ids`. Ids are matched longest-first with id-boundary guards, so a
 * short id is never linked inside a longer one (9LJM inside 9LJM.1T) and ids inside larger
 * tokens are left alone.
 */
export function linkify(display: string, ids: Set<string>): Segment[] {
  if (ids.size === 0) return [{ text: display }]

  const alternation = [...ids]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')
  // An id must not be flanked by other id characters (alnum, '.', '-').
  const re = new RegExp(`(?<![A-Za-z0-9.\\-])(?:${alternation})(?![A-Za-z0-9.\\-])`, 'g')

  const segments: Segment[] = []
  let last = 0
  for (const match of display.matchAll(re)) {
    const start = match.index
    if (start > last) segments.push({ text: display.slice(last, start) })
    segments.push({ text: match[0], id: match[0] })
    last = start + match[0].length
  }
  if (last < display.length) segments.push({ text: display.slice(last) })
  return segments
}
