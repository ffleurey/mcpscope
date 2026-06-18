/**
 * Make a <table class="data-table"> with a <colgroup> resizable by dragging
 * the right border of each header cell. Dependency-free Svelte action.
 *
 *   <table class="data-table" use:columnResize>
 *     <colgroup>…</colgroup>
 *     <thead>…</thead>
 *
 * Each column resizes INDEPENDENTLY — dragging a handle changes only that
 * column's width; the table grows/shrinks and its `.table-scroll` wrapper
 * scrolls horizontally as needed (no proportional redistribution across the
 * other columns). Widths are applied to the matching <col> elements (px) and
 * are session-only — they reset when the view unmounts.
 */
export function columnResize(table: HTMLTableElement) {
  const cols = Array.from(table.querySelectorAll('col'))
  const headRow = table.tHead?.rows[0]
  if (!headRow || cols.length === 0) return

  const handles: HTMLDivElement[] = []

  Array.from(headRow.cells).forEach((th, i) => {
    if (i >= cols.length) return // no matching <col> for this header cell

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
    }
    function onDown(e: MouseEvent) {
      startX = e.clientX
      startW = th.offsetWidth
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      e.preventDefault()
      e.stopPropagation()
    }

    handle.addEventListener('mousedown', onDown)
  })

  return {
    destroy() {
      handles.forEach((h) => h.remove())
    },
  }
}
