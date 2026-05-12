<script lang="ts">
  import type { PartRecord, RawExchangeRecord } from '../backendTypes'
  import { deriveContextEntries } from '../traceStreaming'
  import ContextSnapshotBar from './ContextSnapshotBar.svelte'
  import JsonDialog from './JsonDialog.svelte'
  import TracePartBlock from './TracePartBlock.svelte'

  interface Props {
    parts: PartRecord[]
    rawExchanges: RawExchangeRecord[]
    mode?: 'compact' | 'inspect'
    /** Loaded context window size for bar scale. */
    loadedContextLength?: number | null
  }

  const { parts, rawExchanges, mode = 'inspect', loadedContextLength = null }: Props = $props()

  let showDialog = $state(false)

  const totalTokens = $derived(
    parts.reduce((sum, part) => sum + (part.tokens.count ?? 0), 0),
  )

  const contextEntries = $derived(deriveContextEntries(parts))

  function openRawDialog(): void {
    showDialog = true
  }
</script>

<details class="prelude-block" class:compact={mode === 'compact'} open={mode === 'inspect'}>
  <summary class="prelude-summary">
    <div class="prelude-summary-main">
      <span class="prelude-label">Session setup</span>
      <span class="prelude-status">pre-turn</span>
    </div>
    <div class="prelude-summary-meta">
      {#if totalTokens > 0}
        <span>{totalTokens.toLocaleString()} total tokens</span>
      {/if}
      <span>{parts.length} parts</span>
      {#if rawExchanges.length > 0}
        <span>{rawExchanges.length} raw exchanges</span>
      {/if}
    </div>
  </summary>

  <div class="prelude-body">
    <section class="prelude-section">
      <div class="prelude-section-header">
        <span class="prelude-section-label">Included before Turn 1</span>
        <div class="prelude-actions">
          <button
            class="meta-btn"
            disabled={rawExchanges.length === 0}
            onclick={openRawDialog}
          >
            Raw{rawExchanges.length > 0 ? ` (${rawExchanges.length})` : ''}
          </button>
        </div>
      </div>

      <div class="prelude-parts">
        {#each parts as part (part.id)}
          <TracePartBlock {part} {mode} />
        {/each}
      </div>
    </section>
  </div>
</details>

{#if contextEntries.length > 0}
  <div class="prelude-ctx-bar" class:compact={mode === 'compact'}>
    <ContextSnapshotBar
      entries={contextEntries}
      contextSize={loadedContextLength}
      label="Setup context"
      showLegend={false}
      compact={mode === 'compact'}
    />
  </div>
{/if}

{#if showDialog}
  <JsonDialog
    title="Session setup raw exchanges"
    data={rawExchanges}
    onClose={() => { showDialog = false }}
  />
{/if}

<style>
  .prelude-block {
    margin-bottom: 1rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-panel);
    overflow: hidden;
  }

  .prelude-block.compact {
    border: none;
    border-left: 2px solid var(--border);
    border-radius: 0;
    background: transparent;
    margin-bottom: 0.8rem;
    padding-left: 0.7rem;
  }

  .prelude-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.8rem 1rem;
    cursor: pointer;
    list-style: none;
    background: var(--bg-panel);
  }

  .prelude-block.compact .prelude-summary {
    padding: 0.2rem 0 0.4rem;
    background: transparent;
  }

  .prelude-summary::-webkit-details-marker {
    display: none;
  }

  .prelude-summary::before {
    content: '▶';
    font-size: 0.62rem;
    color: var(--text-muted);
    transition: transform 0.15s;
    margin-right: 0.5rem;
  }

  details[open] > .prelude-summary::before {
    transform: rotate(90deg);
  }

  .prelude-summary-main,
  .prelude-summary-meta,
  .prelude-actions {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex-wrap: wrap;
  }

  .prelude-label,
  .prelude-section-label {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--text);
  }

  .prelude-status {
    font-size: 0.72rem;
    color: var(--text-muted);
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    padding: 0.12rem 0.45rem;
  }

  .prelude-summary-meta {
    font-size: 0.74rem;
    color: var(--text-muted);
  }

  .prelude-body {
    padding: 0 1rem 1rem;
    border-top: 1px solid var(--border);
  }

  .prelude-block.compact .prelude-body {
    padding: 0 0 0.15rem;
    border-top: none;
  }

  .prelude-section {
    margin-top: 0.9rem;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg);
    overflow: hidden;
  }

  .prelude-block.compact .prelude-section {
    margin-top: 0.1rem;
    border: none;
    background: transparent;
  }

  .prelude-section-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 0.85rem;
    border-bottom: 1px solid var(--border-subtle);
    background: color-mix(in srgb, var(--bg-panel) 85%, transparent);
  }

  .prelude-block.compact .prelude-section-header {
    padding: 0.15rem 0 0.2rem;
    border-bottom: none;
    background: transparent;
  }

  .prelude-parts {
    padding: 0 0.85rem 0.2rem;
  }

  .prelude-block.compact .prelude-parts {
    padding: 0;
  }

  .prelude-ctx-bar {
    margin-bottom: 1rem;
  }

  .prelude-ctx-bar.compact {
    margin-bottom: 0.8rem;
    padding-left: 0.7rem;
    border-left: 2px solid var(--border-subtle);
  }

  .meta-btn {
    background: none;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.72rem;
    padding: 0.2rem 0.5rem;
  }

  .meta-btn:hover:enabled {
    color: var(--text);
    border-color: var(--border);
  }

  .meta-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
