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
 * Status-pill class for a run. Complete → success, error → error, active
 * (running/paused) → soft, everything else → dim.
 */
export function runStatusPillClass(status: string): string {
  if (status === 'complete') return 'success'
  if (status === 'error') return 'error'
  if (status === 'running' || status === 'paused') return 'soft'
  return 'dim'
}

/** Newest-first by updatedAt — shared so list stores sort identically. */
export function sortByUpdatedAtDesc<T extends { updatedAt: number }>(records: T[]): T[] {
  return [...records].sort((a, b) => b.updatedAt - a.updatedAt)
}
