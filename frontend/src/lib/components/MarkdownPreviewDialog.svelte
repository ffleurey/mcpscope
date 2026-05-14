<script lang="ts">
  import { renderMarkdown } from '../markdownRender'
  import DialogShell from './DialogShell.svelte'

  interface Props {
    source: string
    onClose: () => void
  }

  let { source, onClose }: Props = $props()

  const rendered = $derived(renderMarkdown(source))
</script>

<DialogShell title="Rendered preview" {onClose} dialogClass="md-dialog-size">
  <div class="md-body">
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    <div class="prose">{@html rendered}</div>
  </div>
</DialogShell>

<style>
  :global(.md-dialog-size) {
    max-width: min(760px, 95vw);
  }

  .md-body {
    padding: 1.25rem 1.5rem;
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
