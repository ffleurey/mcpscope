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
