<script lang="ts">
  import type { PartRecord, StepRecord } from '../backendTypes'
  import IdBadge from './IdBadge.svelte'
  import TracePartBlock from './TracePartBlock.svelte'

  interface Props {
    step: StepRecord
    parts: PartRecord[]
  }

  const { step, parts }: Props = $props()

  const strategy = $derived(
    typeof step.params.strategy === 'string' ? step.params.strategy : 'unknown',
  )
  const sourceTurnNumber = $derived(
    typeof step.params.sourceTurnSequenceNumber === 'number'
      ? step.params.sourceTurnSequenceNumber
      : null,
  )
  const strippedPartCount = $derived(
    typeof step.state.strippedPartCount === 'number' ? step.state.strippedPartCount : 0,
  )
  const tokensRemoved = $derived(
    typeof step.state.compactionTokensRemoved === 'number' ? step.state.compactionTokensRemoved : 0,
  )
  const beforeTokens = $derived(
    typeof step.state.contextTokensAtTurnEnd === 'number'
      ? step.state.contextTokensAtTurnEnd
      : null,
  )
  const afterTokens = $derived(
    typeof step.state.contextTokensAfterCompaction === 'number'
      ? step.state.contextTokensAfterCompaction
      : null,
  )
  const sortedParts = $derived([...parts].sort((left, right) => left.ordinal - right.ordinal))
</script>

<section class="card compaction-step">
  <div class="card-meta has-reveal">
    <div class="card-line">
      <span class="meta-label">Compaction</span>
      {#if step.status === 'error'}
        <span class="pill red">{step.status}</span>
      {/if}
      <span class="compaction-step-detail">{strategy}</span>
      {#if sourceTurnNumber !== null}
        <span class="compaction-step-detail">after turn {sourceTurnNumber}</span>
      {/if}
      {#if tokensRemoved > 0}
        <span class="compaction-step-tokens">−{tokensRemoved.toLocaleString()} tokens</span>
      {:else}
        <span class="compaction-step-detail">no tokens removed</span>
      {/if}
      {#if strippedPartCount > 0}
        <span class="compaction-step-detail">{strippedPartCount} parts</span>
      {/if}
      {#if beforeTokens !== null && afterTokens !== null}
        <span class="compaction-step-tokens"
          >{beforeTokens.toLocaleString()} → {afterTokens.toLocaleString()}</span
        >
      {/if}
    </div>
    <div class="compaction-step-actions reveal-item">
      <IdBadge id={step.id} />
    </div>
  </div>

  <div class="compaction-step-parts">
    {#each sortedParts as part (part.id)}
      <TracePartBlock {part} />
    {/each}
  </div>
</section>

<style>
  .compaction-step {
    margin: 0.5rem 0 0.9rem;
  }

  .compaction-step-detail {
    font-size: var(--font-label);
    color: var(--text-dim);
  }

  .compaction-step-tokens {
    font-size: var(--font-label);
    color: var(--amber-bright);
    font-variant-numeric: tabular-nums;
  }

  .compaction-step-parts {
    display: grid;
    gap: 0.35rem;
  }
</style>
