<script lang="ts">
  import { highlightJson } from '../jsonHighlight'
  import DialogShell from './DialogShell.svelte'

  interface Props {
    title: string
    data: unknown
    onClose: () => void
  }

  let { title, data, onClose }: Props = $props()

  const highlighted = $derived(highlightJson(data))
</script>

<DialogShell {title} {onClose} dialogClass="json-dialog-size">
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  <pre class="json-body">{@html highlighted}</pre>
</DialogShell>

<style>
  :global(.json-dialog-size) {
    max-width: min(760px, 95vw);
  }

  .json-body {
    margin: 0;
    padding: 1rem;
    overflow: auto;
    font-family: var(--font-mono, monospace);
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--text);
    background: var(--bg);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    flex: 1;
  }

  /* hljs JSON token colours */
  .json-body :global(.hljs-attr)    { color: var(--color-accent, #60a5fa); }
  .json-body :global(.hljs-string)  { color: var(--color-success, #4ade80); }
  .json-body :global(.hljs-number)  { color: #f9a825; }
  .json-body :global(.hljs-literal) { color: #e879f9; }
  .json-body :global(.hljs-punctuation),
  .json-body :global(.hljs-attr + .hljs-punctuation) { color: var(--text-muted); }
</style>
