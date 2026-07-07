/**
 * Make a <table class="data-table"> with a <colgroup> resizable by dragging
 * the right border of each header cell. Dependency-free Svelte action.
 *
 *   <table class="data-table" use:columnResize>
 *     <colgroup>…</colgroup>
 *     <thead>…</thead>
 *
 * The table fills its container (`width: 100%`); exactly one column — the
 * `<col class="col-flex">` — has no fixed width and absorbs the slack. Dragging a
 * handle changes only that column's width, and the flex column takes up (or yields)
 * the difference, so the table stays justified and the other fixed columns don't
 * move. When fixed widths exceed the container the `.table-scroll` wrapper scrolls.
 * The flex column has no handle (resizing it would defeat the fill), and neither
 * does the last column (its right edge is the table border, not a column divider).
 * Widths are applied to the matching <col> elements (px) and are session-only.
 */
export function columnResize(table: HTMLTableElement) {
  const cols = Array.from(table.querySelectorAll('col'))
  const headRow = table.tHead?.rows[0]
  if (!headRow || cols.length === 0) return

  const handles: HTMLDivElement[] = []
  // The in-flight drag's teardown (if any) — run on destroy so a table
  // unmounted mid-drag doesn't leak window listeners.
  let activeDragCleanup: (() => void) | null = null

  Array.from(headRow.cells).forEach((th, i) => {
    if (i >= cols.length) return // no matching <col> for this header cell
    // The last column's right edge is the table border, not a border between two
    // columns: a handle there resizes nothing and would protrude a few px past the
    // table, showing a spurious horizontal scrollbar in the .table-scroll wrapper.
    if (i === cols.length - 1) return
    // The elastic column must stay auto-width to absorb slack — never give it a
    // fixed width via a drag handle.
    if (cols[i].classList.contains('col-flex')) return

    th.style.position = 'relative'
    const handle = document.createElement('div')
    handle.className = 'col-resize-handle'
    th.appendChild(handle)
    handles.push(handle)

    let startX = 0
    let startW = 0

    function onMove(e: MouseEvent) {
      const w = Math.max(40, startW + e.clientX - startX)
      cols[i].style.width = `${w}px`
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      activeDragCleanup = null
    }
    function onDown(e: MouseEvent) {
      startX = e.clientX
      startW = th.offsetWidth
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      activeDragCleanup = onUp
      e.preventDefault()
      e.stopPropagation()
    }

    handle.addEventListener('mousedown', onDown)
  })

  return {
    destroy() {
      // A table unmounted mid-drag must not leak the window listeners
      // (or leave the col-resize cursor stuck).
      activeDragCleanup?.()
      handles.forEach((h) => h.remove())
    },
  }
}
