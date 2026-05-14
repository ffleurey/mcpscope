<script lang="ts">
  import { onMount } from 'svelte'
  import { renderMarkdown } from '../markdownRender'

  interface Props {
    source: string
    onClose: () => void
  }

  let { source, onClose }: Props = $props()

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

  const rendered = $derived(renderMarkdown(source))
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogEl}
  class="md-dialog"
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="dialog-inner">
    <div class="dialog-header">
      <span class="dialog-title">Rendered preview</span>
      <button class="close-btn" onclick={onClose} aria-label="Close">✕</button>
    </div>
    <div class="dialog-body">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div class="prose">{@html rendered}</div>
    </div>
  </div>
</dialog>

<style>
  .md-dialog {
    background: transparent;
    border: none;
    padding: 0;
    max-width: min(760px, 95vw);
    width: 100%;
    max-height: 85vh;
  }

  .md-dialog::backdrop {
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
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
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

  .dialog-body {
    overflow: auto;
    padding: 1.25rem 1.5rem;
    flex: 1;
  }

  /* ── Prose styles for rendered markdown ─────────────────────────────── */

  .prose {
    color: var(--text);
    font-size: 0.9rem;
    line-height: 1.7;
  }

  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3),
  .prose :global(h4),
  .prose :global(h5),
  .prose :global(h6) {
    color: var(--text);
    font-weight: 600;
    line-height: 1.3;
    margin: 1.2em 0 0.4em;
  }

  .prose :global(h1) { font-size: 1.4em; }
  .prose :global(h2) { font-size: 1.2em; }
  .prose :global(h3) { font-size: 1.05em; }
  .prose :global(h4),
  .prose :global(h5),
  .prose :global(h6) { font-size: 0.95em; }

  .prose :global(h1:first-child),
  .prose :global(h2:first-child),
  .prose :global(h3:first-child) { margin-top: 0; }

  .prose :global(p) { margin: 0.7em 0; }
  .prose :global(p:first-child) { margin-top: 0; }
  .prose :global(p:last-child) { margin-bottom: 0; }

  .prose :global(ul),
  .prose :global(ol) {
    padding-left: 1.4em;
    margin: 0.5em 0;
  }

  .prose :global(li) { margin: 0.25em 0; }

  .prose :global(code) {
    font-family: var(--font-mono, monospace);
    font-size: 0.85em;
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: 3px;
    padding: 0.1em 0.35em;
    color: var(--color-success, #4ade80);
  }

  .prose :global(pre) {
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: 5px;
    padding: 0.75rem 1rem;
    overflow-x: auto;
    margin: 0.7em 0;
  }

  .prose :global(pre code) {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.82em;
    color: var(--text);
    border-radius: 0;
  }

  .prose :global(blockquote) {
    border-left: 3px solid var(--border);
    margin: 0.7em 0;
    padding: 0.1em 0.9em;
    color: var(--text-muted);
    font-style: italic;
  }

  .prose :global(hr) {
    border: none;
    border-top: 1px solid var(--border-subtle);
    margin: 1em 0;
  }

  .prose :global(a) {
    color: var(--color-accent, #60a5fa);
    text-decoration: underline;
  }

  .prose :global(a:hover) {
    color: var(--text);
  }

  .prose :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.7em 0;
    font-size: 0.88em;
  }

  .prose :global(th),
  .prose :global(td) {
    border: 1px solid var(--border-subtle);
    padding: 0.35rem 0.65rem;
    text-align: left;
  }

  .prose :global(th) {
    background: var(--bg);
    font-weight: 600;
    color: var(--text-muted);
  }

  .prose :global(tr:nth-child(even)) {
    background: color-mix(in srgb, var(--bg-panel) 60%, transparent);
  }

  .prose :global(strong) { font-weight: 700; }
  .prose :global(em) { font-style: italic; }
</style>
