// Small shared formatting helpers for the UI.

/**
 * Compact treeview timestamp: `dd/mm HH:MM`. Used for session and run rows in
 * the sidebar so the same object type renders identically everywhere.
 */
export function formatTreeTimestamp(ts: number): string {
  const d = new Date(ts)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const HH = String(d.getHours()).padStart(2, '0')
  const MM = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm} ${HH}:${MM}`
}

/**
 * Status-dot class for a run (benchmark or analysis). In-progress states
 * (running/pending/paused) all read as an active dot; error is error; anything
 * else (complete/idle) is idle. Shared so every run row renders identically.
 */
export function runStatusDotClass(status: string): string {
  if (status === 'running' || status === 'pending' || status === 'paused') return 'running'
  if (status === 'error') return 'error'
  return 'idle'
}

/**
 * Pill color variant for a run status (used as `class="pill {…}"`).
 * Complete → green, error → red, everything else → the dim default.
 */
export function runStatusPillClass(status: string): string {
  if (status === 'complete') return 'green'
  if (status === 'error') return 'red'
  return ''
}

/** Newest-first by updatedAt — shared so list stores sort identically. */
export function sortByUpdatedAtDesc<T extends { updatedAt: number }>(records: T[]): T[] {
  return [...records].sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Normalize session message text for display: strip leading/trailing blank
 * lines, return null when nothing remains. Shared by the transcript blocks so
 * every message body is trimmed identically.
 */
export function normalizeMessageText(text: string | null | undefined): string | null {
  if (!text) return null
  const normalized = text.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '')
  return normalized.length > 0 ? normalized : null
}

/** True when a part's token count is estimated rather than provider-reported. */
export function isEstimatedTokens(
  part: { tokens: { confidence: string } } | null | undefined,
): boolean {
  return (
    part != null && (part.tokens.confidence === 'estimated' || part.tokens.confidence === 'unknown')
  )
}

/** Token-count metadata string: `1,234 tokens`, `~1,234 tk`, '' for null. */
export function fmtTokens(
  count: number | null,
  estimated = false,
  unit: 'tokens' | 'tk' = 'tokens',
): string {
  if (count === null) return ''
  const n = count.toLocaleString()
  return estimated ? `~${n} ${unit}` : `${n} ${unit}`
}
