<script lang="ts">
  import { highlightJson } from '../jsonHighlight'
  import DialogShell from './DialogShell.svelte'

  interface Props {
    title: string
    data: unknown
    onClose: () => void
  }

  let { title, data, onClose }: Props = $props()

  let wrap = $state(false)

  const highlighted = $derived(highlightJson(data))
</script>

<DialogShell {title} {onClose} dialogClass="json-dialog-size">
  <div class="json-toolbar">
    <button
      class="wrap-btn"
      class:active={wrap}
      onclick={() => { wrap = !wrap }}
      title={wrap ? 'Disable line wrap' : 'Enable line wrap'}
    >
      {wrap ? 'No wrap' : 'Wrap'}
    </button>
  </div>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  <pre class="json-body" class:wrapped={wrap}>{@html highlighted}</pre>
</DialogShell>

<style>
  :global(.json-dialog-size) {
    max-width: min(760px, 95vw);
  }

  .json-toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0.35rem 0.75rem;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    flex-shrink: 0;
  }

  .wrap-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.72rem;
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    line-height: 1.4;
  }

  .wrap-btn:hover { color: var(--text); background: var(--bg); }
  .wrap-btn.active { color: var(--color-accent); border-color: var(--color-accent); }

  .json-body {
    margin: 0;
    padding: 1rem;
    overflow: auto;
    font-family: var(--font-mono, monospace);
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--text);
    background: var(--bg);
    white-space: pre;
    flex: 1;
  }

  .json-body.wrapped {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* hljs JSON token colours */
  .json-body :global(.hljs-attr)    { color: var(--color-accent, #60a5fa); }
  .json-body :global(.hljs-string)  { color: var(--color-success, #4ade80); }
  .json-body :global(.hljs-number)  { color: #f9a825; }
  .json-body :global(.hljs-literal) { color: #e879f9; }
  .json-body :global(.hljs-punctuation),
  .json-body :global(.hljs-attr + .hljs-punctuation) { color: var(--text-muted); }
</style>
