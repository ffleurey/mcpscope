<script lang="ts">
  import type { PartRecord, RawExchangeRecord } from '../backendTypes'
  import { deriveContextEntries } from '../traceStreaming'
  import ContextSnapshotBar from './ContextSnapshotBar.svelte'
  import JsonDialog from './JsonDialog.svelte'
  import TracePartBlock from './TracePartBlock.svelte'

  interface Props {
    parts: PartRecord[]
    rawExchanges: RawExchangeRecord[]
    mode?: 'chat' | 'inspect'
    /** Loaded context window size for bar scale. */
    loadedContextLength?: number | null
    /** True while the prelude initialization stream is in progress. */
    isInitializing?: boolean
  }

  const {
    parts,
    rawExchanges,
    mode = 'inspect',
    loadedContextLength = null,
    isInitializing = false,
  }: Props = $props()

  let showDialog = $state(false)

  const sortedParts = $derived([...parts].sort((a, b) => a.ordinal - b.ordinal))
  const totalTokens = $derived(parts.reduce((sum, p) => sum + (p.tokens.count ?? 0), 0))
  const contextEntries = $derived(deriveContextEntries(parts))
  const statusLabel = $derived(isInitializing ? 'initializing' : 'complete')
</script>

{#if mode === 'chat'}
  <!-- ── Chat mode: same compact pattern as chat-turn ─────────────────── -->
  <section class="compact-setup">
    <div class="compact-setup-meta">
      <span class="compact-setup-label">Session Setup</span>
      <span class="compact-setup-status">{statusLabel}</span>
      {#if isInitializing}
        <span class="setup-spinner" aria-label="Setting up">⋯</span>
      {:else if totalTokens > 0}
        <span class="compact-setup-tokens">{totalTokens.toLocaleString()} tokens</span>
      {/if}
    </div>

    <div class="compact-setup-parts">
      {#each sortedParts as part (part.id)}
        <TracePartBlock {part} mode="compact" />
      {/each}
      {#if isInitializing && sortedParts.length === 0}
        <div class="setup-empty-hint">Setting up session…</div>
      {/if}
    </div>

    {#if !isInitializing && contextEntries.length > 0}
      <div class="compact-ctx-bar">
        <ContextSnapshotBar
          entries={contextEntries}
          contextSize={loadedContextLength}
          label="Setup context"
          showLegend={false}
          compact
        />
      </div>
    {/if}
  </section>
{:else}
  <!-- ── Inspect mode: looks exactly like a Turn block (always open) ───── -->
  <div class="turn-block">
    <div class="turn-header">
      <div class="turn-header-main">
        <span class="turn-label">Session Setup</span>
        <span class="turn-status">{statusLabel}</span>
        {#if isInitializing}
          <span class="setup-spinner" aria-label="Setting up">⋯</span>
        {/if}
      </div>
      <div class="turn-header-meta">
        {#if totalTokens > 0}
          <span>{totalTokens.toLocaleString()} tokens</span>
        {/if}
        <span>{parts.length} part{parts.length !== 1 ? 's' : ''}</span>
        {#if rawExchanges.length > 0}
          <button class="meta-btn" onclick={() => { showDialog = true }}>
            Raw ({rawExchanges.length})
          </button>
        {/if}
      </div>
    </div>

    <div class="turn-body">
      {#if sortedParts.length > 0}
        <section class="round-block">
          <div class="round-parts">
            {#each sortedParts as part (part.id)}
              <TracePartBlock {part} mode="inspect" />
            {/each}
          </div>
        </section>
      {:else if isInitializing}
        <div class="setup-empty-hint">Setting up session…</div>
      {/if}

      {#if !isInitializing && contextEntries.length > 0}
        <div class="setup-ctx-bar">
          <ContextSnapshotBar
            entries={contextEntries}
            contextSize={loadedContextLength}
            label="Setup context"
            showLegend={false}
          />
        </div>
      {/if}
    </div>
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
  /* ── Inspect mode — mirrors SessionTurnBlock's turn-block ─────────────── */
  .turn-block {
    margin-bottom: 1rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-panel);
    overflow: hidden;
  }

  .turn-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.8rem 1rem;
    background: var(--bg-panel);
  }

  .turn-header-main,
  .turn-header-meta {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex-wrap: wrap;
  }

  .turn-label {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--text);
  }

  .turn-status {
    font-size: 0.72rem;
    color: var(--text-muted);
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    padding: 0.12rem 0.45rem;
  }

  .turn-header-meta {
    font-size: 0.74rem;
    color: var(--text-muted);
  }

  .turn-body {
    padding: 0 1rem 1rem;
    border-top: 1px solid var(--border);
  }

  /* ── Round-like section wrapping the prelude parts ──────────────────── */
  .round-block {
    margin-top: 0.9rem;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg);
    overflow: hidden;
  }

  .round-parts {
    padding: 0 0.85rem 0.2rem;
  }

  /* ── Shared ─────────────────────────────────────────────────────────── */
  .setup-spinner {
    font-size: 1.1rem;
    color: var(--text-muted);
    animation: blink 1.2s ease-in-out infinite;
  }

  @keyframes blink {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  .setup-empty-hint {
    padding: 0.9rem 0;
    font-size: 0.8rem;
    color: var(--text-muted);
    font-style: italic;
  }

  .setup-ctx-bar {
    margin-top: 0.75rem;
    border-top: 1px solid var(--border-subtle);
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

  .meta-btn:hover {
    color: var(--text);
    border-color: var(--border);
  }

  /* ── Chat mode — mirrors chat-turn ────────────────────────────────────── */
  .compact-setup {
    margin-bottom: 0.8rem;
  }

  .compact-setup-meta {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin-bottom: 0.25rem;
  }

  .compact-setup-label {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .compact-setup-status,
  .compact-setup-tokens {
    font-size: 0.68rem;
    color: var(--text-muted);
  }

  .compact-setup-parts {
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
    margin-left: 0.82rem;
    padding-left: 0.72rem;
    border-left: 2px solid var(--border-subtle);
  }

  .compact-ctx-bar {
    margin-top: 0.28rem;
    margin-left: 0.82rem;
    padding-left: 0.72rem;
    border-left: 2px solid var(--border-subtle);
  }
</style>
