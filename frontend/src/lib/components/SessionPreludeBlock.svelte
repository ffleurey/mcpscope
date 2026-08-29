<script lang="ts">
  import type { PartRecord } from '../backendTypes'
  import { deriveContextEntries } from '../traceStreaming'
  import ContextSnapshotBar from './ContextSnapshotBar.svelte'
  import IdBadge from './IdBadge.svelte'
  import TracePartBlock from './TracePartBlock.svelte'
  import TokenPill from './TokenPill.svelte'
  import Icon from './Icon.svelte'
  import { iconChevronRight } from '../design/icons'

  interface Props {
    parts: PartRecord[]
    /** Loaded context window size for bar scale. */
    loadedContextLength?: number | null
    /** True while the prelude initialization stream is in progress. */
    isInitializing?: boolean
  }

  const { parts, loadedContextLength = null, isInitializing = false }: Props = $props()

  /** Collapsed after init completes (user can expand to review setup) */
  let chatCollapsed = $state(false)
  $effect(() => {
    if (!isInitializing) chatCollapsed = true
  })

  const sortedParts = $derived([...parts].sort((a, b) => a.ordinal - b.ordinal))
  const totalTokens = $derived(parts.reduce((sum, p) => sum + (p.tokens.count ?? 0), 0))
  const contextEntries = $derived(deriveContextEntries(parts))
  const canCollapse = $derived(!isInitializing)
  const setupId = $derived.by(() => {
    const sid = parts[0]?.sessionId
    return sid ? `${sid}.S` : null
  })
</script>

<!-- Same compact layout for both modes; chat can collapse after init completes -->
<section class="compact-setup">
  <div class="compact-setup-meta has-reveal">
    {#if canCollapse}
      <button
        class="setup-toggle-btn"
        onclick={() => {
          chatCollapsed = !chatCollapsed
        }}
        aria-expanded={!chatCollapsed}
      >
        <span class="disclosure-arrow" class:open={!chatCollapsed}
          ><Icon path={iconChevronRight} /></span
        >
        <span class="meta-label compact-setup-label">Session Setup</span>
        {#if totalTokens > 0}
          <TokenPill count={totalTokens} />
        {/if}
      </button>
      {#if setupId}
        <span class="reveal-item"><IdBadge id={setupId} /></span>
      {/if}
    {:else}
      <span class="meta-label compact-setup-label">Session Setup</span>
      <span class="compact-setup-status">initializing</span>
      <span class="setup-spinner" aria-label="Setting up">⋯</span>
    {/if}
  </div>

  {#if !canCollapse || !chatCollapsed}
    <div class="compact-setup-parts">
      {#each sortedParts as part (part.id)}
        <TracePartBlock {part} />
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

  .compact-setup-status {
    font-size: var(--font-label);
    color: var(--text-dim);
  }

  .compact-setup-parts {
    display: flex;
    flex-direction: column;
    gap: var(--chat-stack);
    margin-left: var(--chat-indent);
    padding-left: var(--chat-pad);
    border-left: 2px solid var(--border);
  }

  .compact-ctx-bar {
    margin-top: 0.28rem;
    margin-left: var(--chat-indent);
    padding-left: var(--chat-pad);
    border-left: 2px solid var(--border);
  }

  .setup-spinner {
    font-size: var(--font-ui);
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
    font-size: var(--font-meta);
    color: var(--text-dim);
    font-style: italic;
  }
</style>
