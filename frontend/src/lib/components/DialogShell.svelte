<script lang="ts">
  import { onMount } from 'svelte'
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    onClose: () => void
    /** Optional extra CSS class on the <dialog> element for sizing overrides */
    dialogClass?: string
    /**
     * Lock the dialog to a fixed tall height (85vh) instead of sizing to content,
     * so it doesn't resize as content changes. The body region scrolls instead.
     */
    fixedHeight?: boolean
    /**
     * Remove the body padding and let the child own its layout/scroll (a flex
     * column). Use when the child manages its own fixed toolbar + scroll area.
     */
    flush?: boolean
    children: Snippet
  }

  let {
    title,
    onClose,
    dialogClass = '',
    fixedHeight = false,
    flush = false,
    children,
  }: Props = $props()

  let dialogEl = $state<HTMLDialogElement | null>(null)

  onMount(() => {
    dialogEl?.showModal()
  })

  // Clicking the backdrop must NOT close the dialog — that would discard
  // in-progress content on an accidental outside click. The dialog closes only
  // via an explicit action: a footer button, the close ✕, or Escape (the
  // keyboard equivalent of the ✕). Native <dialog> closes on Escape on its own;
  // intercept it so the parent's open-state stays in sync via onClose().
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  // ── Drag ────────────────────────────────────────────────────────────

  let dragging = $state(false)
  let dragX = $state(0)
  let dragY = $state(0)
  let dragStartX = 0
  let dragStartY = 0
  let offsetStartX = 0
  let offsetStartY = 0

  function startDrag(e: MouseEvent) {
    // Only drag from the header itself, not the close button
    if ((e.target as HTMLElement).closest('.close-btn')) return
    dragging = true
    dragStartX = e.clientX
    dragStartY = e.clientY
    offsetStartX = dragX
    offsetStartY = dragY
    e.preventDefault()
  }

  function onDrag(e: MouseEvent) {
    if (!dragging) return
    dragX = offsetStartX + e.clientX - dragStartX
    dragY = offsetStartY + e.clientY - dragStartY
  }

  function endDrag() {
    dragging = false
  }
</script>

<svelte:window onmousemove={onDrag} onmouseup={endDrag} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogEl}
  class="shell-dialog {dialogClass}"
  class:dragging
  class:fixed-height={fixedHeight}
  style="transform: translate({dragX}px, {dragY}px)"
  onkeydown={handleKeydown}
>
  <div class="dialog-inner">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="dialog-header" onmousedown={startDrag}>
      <span class="dialog-title">{title}</span>
      <button class="close-btn" onclick={onClose} aria-label="Close">✕</button>
    </div>
    <div class="dialog-body" class:flush>
      {@render children()}
    </div>
  </div>
</dialog>

<style>
  .shell-dialog {
    background: transparent;
    border: none;
    padding: 0;
    max-width: min(720px, 95vw);
    width: 100%;
    max-height: 85vh;
    transition: none;
  }

  .shell-dialog.dragging {
    transition: none;
  }

  .shell-dialog::backdrop {
    background: rgba(0, 0, 0, 0.62);
  }

  .dialog-inner {
    background: var(--bg-surface);
    /* Amber-dim edge marks the active/focused surface; the elevation shadow lifts
       it off the dark backdrop (dark-on-dark needs both color + depth to separate). */
    border: 1px solid var(--amber-dim);
    border-radius: 8px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
    display: flex;
    flex-direction: column;
    max-height: 85vh;
    overflow: hidden;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    cursor: grab;
    user-select: none;
  }

  .dialog-header:active {
    cursor: grabbing;
  }

  .dragging .dialog-header {
    cursor: grabbing;
  }

  .dialog-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-bright);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 1rem;
    padding: 0.2rem 0.4rem;
    border-radius: 3px;
    line-height: 1;
    flex-shrink: 0;
    position: relative;
    z-index: 1;
  }

  .close-btn:hover {
    color: var(--text-bright);
    background: var(--bg-base);
  }

  .dialog-body {
    flex: 1;
    overflow: auto;
    min-height: 0;
    padding: 0.75rem 1rem;
  }

  /* Fixed tall dialog: the inner fills the locked height so content scrolls
     within the body rather than the dialog growing/shrinking with content. */
  .shell-dialog.fixed-height {
    height: 85vh;
  }

  .shell-dialog.fixed-height .dialog-inner {
    height: 100%;
  }

  /* Flush body: the child owns layout + scrolling (e.g. a fixed toolbar above a
     scrollable region). No padding here; the child provides its own. */
  .dialog-body.flush {
    padding: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
