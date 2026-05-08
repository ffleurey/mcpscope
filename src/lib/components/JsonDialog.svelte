<script lang="ts">
  import { onMount } from 'svelte'

  interface Props {
    title: string
    data: unknown
    onClose: () => void
  }

  let { title, data, onClose }: Props = $props()

  let dialogEl = $state<HTMLDialogElement | null>(null)

  onMount(() => {
    dialogEl?.showModal()
  })

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === dialogEl) onClose()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose()
  }

  const formatted = $derived(JSON.stringify(data, null, 2))
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogEl}
  class="json-dialog"
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="dialog-inner">
    <div class="dialog-header">
      <span class="dialog-title">{title}</span>
      <button class="close-btn" onclick={onClose} aria-label="Close">✕</button>
    </div>
    <pre class="json-body">{formatted}</pre>
  </div>
</dialog>

<style>
  .json-dialog {
    background: transparent;
    border: none;
    padding: 0;
    max-width: min(720px, 95vw);
    width: 100%;
    max-height: 85vh;
  }
  .json-dialog::backdrop {
    background: rgba(0, 0, 0, 0.55);
  }
  .dialog-inner {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 8px;
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
  }
  .dialog-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
  }
  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0.2rem 0.4rem;
    border-radius: 3px;
    line-height: 1;
  }
  .close-btn:hover { color: var(--text); background: var(--bg); }
  .json-body {
    margin: 0;
    padding: 1rem;
    overflow: auto;
    font-family: var(--mono, monospace);
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--text);
    background: var(--bg);
    flex: 1;
    white-space: pre;
  }
</style>
