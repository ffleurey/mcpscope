<script lang="ts">
  import { untrack } from 'svelte'
  import {
    lookupByHierarchicalId,
    lookupTextByHierarchicalId,
  } from '../api/backendClient'
  import DialogShell from './DialogShell.svelte'
  import SegmentedControl from './SegmentedControl.svelte'

  interface Props {
    id: string
    /** Which detail level to open on; the dialog can switch freely after. */
    initialMode?: 'summary' | 'full'
    onClose: () => void
  }

  let { id, initialMode = 'full', onClose }: Props = $props()

  // The two orthogonal axes of the inspect tool, mirrored in the GUI:
  //   detail = summary | full   ·   format = text | json
  // `initialMode` only seeds the opening detail level (the dialog mounts fresh
  // each time the pill is used), after which the toggles drive `mode`.
  let mode = $state<'summary' | 'full'>(untrack(() => initialMode))
  let format = $state<'text' | 'json'>('text')

  let loading = $state(false)
  let error = $state<string | null>(null)
  let jsonData = $state<unknown>(null)
  let textData = $state('')
  let copied = $state(false)

  async function load(currentMode: 'summary' | 'full', currentFormat: 'text' | 'json') {
    loading = true
    error = null
    try {
      if (currentFormat === 'json') {
        jsonData = await lookupByHierarchicalId(id, currentMode)
      } else {
        textData = await lookupTextByHierarchicalId(id, currentMode)
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  // Reload on mount and whenever either axis changes.
  $effect(() => {
    void load(mode, format)
  })

  async function copyPayload() {
    const content =
      format === 'json' ? JSON.stringify(jsonData, null, 2) : textData
    try {
      await navigator.clipboard.writeText(content)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      // Clipboard unavailable in some contexts.
    }
  }
</script>

<DialogShell title={`Inspect ${id}`} {onClose} dialogClass="inspect-dialog-size" fixedHeight flush>
  <div class="inspect-toolbar">
    <div class="control">
      <span class="control-label">Detail</span>
      <SegmentedControl
        ariaLabel="Detail level"
        selected={mode}
        onSelect={(v) => (mode = v as 'summary' | 'full')}
        options={[
          { value: 'summary', label: 'Summary' },
          { value: 'full', label: 'Full' },
        ]}
      />
    </div>

    <div class="control">
      <span class="control-label">Format</span>
      <SegmentedControl
        ariaLabel="Format"
        selected={format}
        onSelect={(v) => (format = v as 'text' | 'json')}
        options={[
          { value: 'text', label: 'Text' },
          { value: 'json', label: 'JSON' },
        ]}
      />
    </div>

    <span class="toolbar-spacer"></span>

    <button
      class="copy-btn"
      onclick={copyPayload}
      disabled={loading || error != null}
      title="Copy the displayed payload to the clipboard"
    >
      {copied ? 'Copied ✓' : 'Copy payload'}
    </button>
  </div>

  <div class="inspect-body">
    {#if loading}
      <div class="state">Loading…</div>
    {:else if error}
      <pre class="payload payload-error">{error}</pre>
    {:else if format === 'json'}
      <pre class="payload">{JSON.stringify(jsonData, null, 2)}</pre>
    {:else}
      <pre class="payload">{textData}</pre>
    {/if}
  </div>
</DialogShell>

<style>
  /* Fixed width; the height is locked by DialogShell's `fixedHeight` (85vh), so
     the dialog uses the available space well and never resizes as content or
     options change — only the content region below scrolls. */
  :global(.inspect-dialog-size) {
    max-width: min(1040px, 92vw);
  }

  .inspect-toolbar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.55rem 0.85rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .toolbar-spacer {
    flex: 1;
  }

  .control {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .control-label {
    font-size: 0.66rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .copy-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-dim);
    cursor: pointer;
    font-family: var(--mono);
    font-size: 0.74rem;
    padding: 0.22rem 0.7rem;
    white-space: nowrap;
  }

  .copy-btn:hover:not(:disabled) {
    border-color: var(--text-dim);
    color: var(--text-bright);
  }

  .copy-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* The single scroll region: the toolbar above and the dialog frame stay put. */
  .inspect-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--bg-base);
  }

  .payload {
    margin: 0;
    padding: 1rem;
    font-family: var(--mono);
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--text-bright);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .payload-error {
    color: var(--red-bright);
  }

  .state {
    padding: 1.5rem;
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 0.8rem;
  }
</style>
