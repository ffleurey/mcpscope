<script lang="ts">
  import type { PartRecord, StepRecord } from '../backendTypes'
  import IdBadge from './IdBadge.svelte'
  import TracePartBlock from './TracePartBlock.svelte'

  interface Props {
    step: StepRecord
    parts: PartRecord[]
    mode?: 'chat' | 'inspect'
  }

  const { step, parts, mode = 'chat' }: Props = $props()

  const strategy = $derived(typeof step.params.strategy === 'string' ? step.params.strategy : 'unknown')
  const sourceTurnNumber = $derived(typeof step.params.sourceTurnSequenceNumber === 'number' ? step.params.sourceTurnSequenceNumber : null)
  const strippedPartCount = $derived(typeof step.state.strippedPartCount === 'number' ? step.state.strippedPartCount : 0)
  const tokensRemoved = $derived(typeof step.state.compactionTokensRemoved === 'number' ? step.state.compactionTokensRemoved : 0)
  const beforeTokens = $derived(typeof step.state.contextTokensAtTurnEnd === 'number' ? step.state.contextTokensAtTurnEnd : null)
  const afterTokens = $derived(typeof step.state.contextTokensAfterCompaction === 'number' ? step.state.contextTokensAfterCompaction : null)
  const sortedParts = $derived([...parts].sort((left, right) => left.ordinal - right.ordinal))
</script>

<section class="compaction-step">
  <div class="compaction-step-meta">
    <div class="compaction-step-line">
      <span class="compaction-step-label">Compaction step</span>
      <span class="compaction-step-status">{step.status}</span>
      <span class="compaction-step-strategy">{strategy}</span>
      {#if sourceTurnNumber !== null}
        <span class="compaction-step-detail">after turn {sourceTurnNumber}</span>
      {/if}
      {#if tokensRemoved > 0}
        <span class="compaction-step-detail">−{tokensRemoved.toLocaleString()} tokens</span>
      {:else}
        <span class="compaction-step-detail">no tokens removed</span>
      {/if}
      {#if strippedPartCount > 0}
        <span class="compaction-step-detail">{strippedPartCount} parts</span>
      {/if}
      {#if beforeTokens !== null && afterTokens !== null}
        <span class="compaction-step-detail">{beforeTokens.toLocaleString()} → {afterTokens.toLocaleString()}</span>
      {/if}
    </div>
    <div class="compaction-step-actions">
      <IdBadge id={step.id} />
    </div>
  </div>

  <div class="compaction-step-parts">
    {#each sortedParts as part (part.id)}
      <TracePartBlock {part} mode={mode === 'inspect' ? 'inspect' : 'compact'} />
    {/each}
  </div>
</section>

<style>
  .compaction-step {
    margin: 0.5rem 0 0.9rem;
    padding: 0.75rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-surface);
  }

  .compaction-step-meta {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.45rem;
  }

  .compaction-step-line {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    align-items: center;
  }

  .compaction-step-label {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--text-bright);
  }

  .compaction-step-status,
  .compaction-step-strategy,
  .compaction-step-detail {
    font-size: 0.76rem;
    color: var(--text-dim);
  }

  .compaction-step-parts {
    display: grid;
    gap: 0.35rem;
  }
</style>