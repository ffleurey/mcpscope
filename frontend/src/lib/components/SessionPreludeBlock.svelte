<script lang="ts">
  import type { PartRecord } from '../backendTypes'
  import { deriveContextEntries } from '../traceStreaming'
  import ContextSnapshotBar from './ContextSnapshotBar.svelte'
  import IdBadge from './IdBadge.svelte'
  import TracePartBlock from './TracePartBlock.svelte'

  interface Props {
    parts: PartRecord[]
    mode?: 'chat' | 'inspect'
    /** Loaded context window size for bar scale. */
    loadedContextLength?: number | null
    /** True while the prelude initialization stream is in progress. */
    isInitializing?: boolean
  }

  const {
    parts,
    mode = 'inspect',
    loadedContextLength = null,
    isInitializing = false,
  }: Props = $props()

  /** Chat mode: collapsed after init completes (user can expand to review setup) */
  let chatCollapsed = $state(false)
  $effect(() => {
    if (!isInitializing) chatCollapsed = true
  })

  const sortedParts = $derived([...parts].sort((a, b) => a.ordinal - b.ordinal))
  const totalTokens = $derived(parts.reduce((sum, p) => sum + (p.tokens.count ?? 0), 0))
  const contextEntries = $derived(deriveContextEntries(parts))
  const statusLabel = $derived(isInitializing ? 'initializing' : 'complete')
  const canCollapse = $derived(mode === 'chat' && !isInitializing)
  const setupId = $derived.by(() => {
    const sid = parts[0]?.sessionId
    return sid ? `${sid}.S` : null
  })
</script>

<!-- Same compact layout for both modes; chat can collapse after init completes -->
<section class="compact-setup">
  <div class="compact-setup-meta">
    {#if canCollapse}
      <button
        class="setup-toggle-btn"
        onclick={() => {
          chatCollapsed = !chatCollapsed
        }}
        aria-expanded={!chatCollapsed}
      >
        <span class="disclosure-arrow" class:open={!chatCollapsed}>▶</span>
        <span class="compact-setup-label">Session Setup</span>
        <span class="compact-setup-status">{statusLabel}</span>
        {#if totalTokens > 0}
          <span class="compact-setup-tokens">{totalTokens.toLocaleString()} tokens</span>
        {/if}
      </button>
    {:else}
      <span class="compact-setup-label">Session Setup</span>
      <span class="compact-setup-status">{statusLabel}</span>
      {#if isInitializing}
        <span class="setup-spinner" aria-label="Setting up">⋯</span>
      {:else if totalTokens > 0}
        <span class="compact-setup-tokens">{totalTokens.toLocaleString()} tokens</span>
      {/if}
      {#if mode === 'inspect' && setupId}
        <IdBadge id={setupId} />
      {/if}
    {/if}
  </div>

  {#if !canCollapse || !chatCollapsed}
    <div class="compact-setup-parts">
      {#each sortedParts as part (part.id)}
        <TracePartBlock {part} mode={mode === 'inspect' ? 'inspect' : 'compact'} />
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
  {/if}
</section>

<style>
  .compact-setup {
    margin-bottom: 0.8rem;
  }

  .compact-setup-meta {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin-bottom: 0.25rem;
  }

  .setup-toggle-btn {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    background: none;
    border: none;
    padding: 0.1rem 0;
    cursor: pointer;
    color: inherit;
  }

  .setup-toggle-btn:hover .compact-setup-label {
    color: var(--text-bright);
  }

  .compact-setup-label {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-dim);
  }

  .compact-setup-status,
  .compact-setup-tokens {
    font-size: 0.68rem;
    color: var(--text-dim);
  }

  .compact-setup-parts {
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
    margin-left: 0.82rem;
    padding-left: 0.72rem;
    border-left: 2px solid var(--border);
  }

  .compact-ctx-bar {
    margin-top: 0.28rem;
    margin-left: 0.82rem;
    padding-left: 0.72rem;
    border-left: 2px solid var(--border);
  }

  .setup-spinner {
    font-size: 1.1rem;
    color: var(--text-dim);
    animation: blink 1.2s ease-in-out infinite;
  }

  @keyframes blink {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }

  .setup-empty-hint {
    padding: 0.5rem 0;
    font-size: 0.78rem;
    color: var(--text-dim);
    font-style: italic;
  }
</style>
