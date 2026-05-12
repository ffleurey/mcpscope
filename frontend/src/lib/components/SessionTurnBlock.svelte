<script lang="ts">
  import type {
    ContextEntry,
    PartRecord,
    RawExchangeRecord,
    RoundRecord,
    TurnRecord,
  } from '../backendTypes'
  import type { StreamingRoundState } from '../traceStreaming'
  import CompactRoundContent from './CompactRoundContent.svelte'
  import ContextSnapshotBar from './ContextSnapshotBar.svelte'
  import JsonDialog from './JsonDialog.svelte'
  import StreamingRoundDeltaBlock from './StreamingRoundDeltaBlock.svelte'
  import TracePartBlock from './TracePartBlock.svelte'

  interface Props {
    turn: TurnRecord
    rounds: RoundRecord[]
    parts: PartRecord[]
    rawExchanges: RawExchangeRecord[]
    roundStreams: StreamingRoundState[]
    mode?: 'compact' | 'inspect'
    /** Per-round context snapshots computed from all parts. */
    contextSnapshotsByRound?: Map<string, ContextEntry[]>
    /** Loaded context window size for the context bar scale. */
    loadedContextLength?: number | null
  }

  const {
    turn,
    rounds,
    parts,
    rawExchanges,
    roundStreams,
    mode = 'inspect',
    contextSnapshotsByRound,
    loadedContextLength = null,
  }: Props = $props()

  let showDialog = $state(false)
  let dialogTitle = $state('')
  let dialogData = $state<unknown>(null)

  const sortedRounds = $derived([...rounds].sort((left, right) => left.roundIndex - right.roundIndex))
  const sortedParts = $derived([...parts].sort((left, right) => left.ordinal - right.ordinal))
  const partsByRound = $derived.by(() => {
    const grouped = new Map<string, PartRecord[]>()
    for (const part of sortedParts) {
      if (!part.roundId) continue
      const current = grouped.get(part.roundId) ?? []
      current.push(part)
      grouped.set(part.roundId, current)
    }
    return grouped
  })
  const rawExchangesByRound = $derived.by(() => {
    const grouped = new Map<string, RawExchangeRecord[]>()
    for (const exchange of rawExchanges) {
      if (!exchange.roundId) continue
      const current = grouped.get(exchange.roundId) ?? []
      current.push(exchange)
      grouped.set(exchange.roundId, current)
    }
    return grouped
  })
  const roundStreamsByRound = $derived.by(() => {
    const grouped = new Map<string, StreamingRoundState>()
    for (const roundStream of roundStreams) {
      grouped.set(roundStream.roundId, roundStream)
    }
    return grouped
  })
  const compactUserPart = $derived(sortedParts.find((part) => part.partType === 'user-message') ?? null)
  const ungroupedParts = $derived(sortedParts.filter((part) => part.roundId === null))

  function openDialog(title: string, data: unknown): void {
    dialogTitle = title
    dialogData = data
    showDialog = true
  }

  function formatTimestamp(timestamp: number | null): string {
    if (timestamp == null) return 'n/a'
    return timestamp > 10_000 ? new Date(timestamp).toLocaleString() : String(timestamp)
  }
</script>

{#if mode === 'compact'}
  <section class="compact-turn">
    {#if compactUserPart}
      <TracePartBlock part={compactUserPart} mode="compact" />
    {/if}

    {#if ungroupedParts.length > 0 && compactUserPart === null}
      <div class="compact-round">
        <div class="compact-round-parts">
          {#each ungroupedParts as part (part.id)}
            <TracePartBlock {part} mode="compact" />
          {/each}
        </div>
      </div>
    {/if}

    {#each sortedRounds as round (round.id)}
      {@const roundParts = (partsByRound.get(round.id) ?? []).filter((part) => part.id !== compactUserPart?.id)}
      {@const roundExchanges = rawExchangesByRound.get(round.id) ?? []}
      {@const roundStream = roundStreamsByRound.get(round.id) ?? null}
      {@const roundSnapshot = contextSnapshotsByRound?.get(round.id) ?? null}
      <section class="compact-round">
        <div class="compact-round-meta">
          <span class="compact-round-label">Round {round.roundIndex + 1}</span>
          <span class="compact-round-status">{round.finishReason ?? round.status}</span>
          {#if round.usage.totalTokens !== null}
            <span class="compact-round-tokens">{round.usage.totalTokens.toLocaleString()} total</span>
          {/if}
          <div class="compact-round-actions">
            <button class="meta-btn" onclick={() => openDialog(`Round ${round.roundIndex + 1}`, round)}>
              Round
            </button>
            {#if round.requestPayloadJson !== null}
              <button class="meta-btn" onclick={() => openDialog(`Round ${round.roundIndex + 1} request`, round.requestPayloadJson)}>
                Request
              </button>
            {/if}
            {#if round.responseTraceJson !== null}
              <button class="meta-btn" onclick={() => openDialog(`Round ${round.roundIndex + 1} response`, round.responseTraceJson)}>
                Response
              </button>
            {/if}
            <button
              class="meta-btn"
              disabled={roundExchanges.length === 0}
              onclick={() => openDialog(`Round ${round.roundIndex + 1} raw exchanges`, roundExchanges)}
            >
              Raw{roundExchanges.length > 0 ? ` (${roundExchanges.length})` : ''}
            </button>
          </div>
        </div>

        <div class="compact-round-parts">
          <CompactRoundContent parts={roundParts} {roundStream} />
        </div>

        {#if roundSnapshot && roundSnapshot.length > 0}
          <div class="round-ctx-bar">
            <ContextSnapshotBar
              entries={roundSnapshot}
              contextSize={loadedContextLength}
              label="ctx"
              showLegend={false}
              compact
            />
          </div>
        {/if}
      </section>
    {/each}

    {#if turn.compactionApplied !== null && turn.compactionApplied !== 'none'}
      <div class="compaction-summary">
        {#if turn.compactionTokensRemoved !== null && turn.compactionTokensRemoved > 0}
          <span class="compaction-label">↓ {turn.compactionApplied}</span>
          <span class="compaction-tokens">−{turn.compactionTokensRemoved.toLocaleString()} tokens</span>
          {#if turn.contextTokensAtTurnEnd !== null && turn.contextTokensAfterCompaction !== null}
            <span class="compaction-range">{turn.contextTokensAtTurnEnd.toLocaleString()} → {turn.contextTokensAfterCompaction.toLocaleString()}</span>
          {/if}
        {:else}
          <span class="compaction-label">↓ {turn.compactionApplied}</span>
          <span class="compaction-tokens">no tokens removed</span>
        {/if}
      </div>
    {/if}
  </section>
{:else}
  <details class="turn-block" open>
    <summary class="turn-summary">
      <div class="turn-summary-main">
        <span class="turn-label">Turn {turn.sequenceNumber}</span>
        <span class="turn-status">{turn.status}</span>
        {#if turn.outcome}
          <span class="turn-outcome">{turn.outcome}</span>
        {/if}
      </div>
      <div class="turn-summary-meta">
        {#if turn.usage.totalTokens !== null}
          <span>{turn.usage.totalTokens.toLocaleString()} total tokens</span>
        {/if}
        {#if turn.contextTokensAfterCompaction !== null}
          <span>{turn.contextTokensAfterCompaction.toLocaleString()} ctx after compaction</span>
        {/if}
        <span>{formatTimestamp(turn.completedAt ?? turn.createdAt)}</span>
      </div>
    </summary>

    <div class="turn-body">
      {#if ungroupedParts.length > 0}
        <section class="round-block">
          <div class="round-header">
            <div class="round-header-main">
              <span class="round-label">Turn-level parts</span>
            </div>
            <div class="round-actions">
              <button class="meta-btn" onclick={() => openDialog(`Turn ${turn.sequenceNumber}`, turn)}>
                Turn JSON
              </button>
            </div>
          </div>

          <div class="round-parts">
            {#each ungroupedParts as part (part.id)}
              <TracePartBlock {part} mode="inspect" />
            {/each}
          </div>
        </section>
      {/if}

      {#each sortedRounds as round (round.id)}
        {@const roundParts = partsByRound.get(round.id) ?? []}
        {@const roundExchanges = rawExchangesByRound.get(round.id) ?? []}
        {@const roundStream = roundStreamsByRound.get(round.id) ?? null}
        {@const roundSnapshot = contextSnapshotsByRound?.get(round.id) ?? null}
        <section class="round-block">
          <div class="round-header">
            <div class="round-header-main">
              <span class="round-label">Round {round.roundIndex + 1}</span>
              <span class="round-status">{round.finishReason ?? round.status}</span>
              {#if round.usage.totalTokens !== null}
                <span class="round-meta">{round.usage.totalTokens.toLocaleString()} total</span>
              {/if}
            </div>
            <div class="round-actions">
              <button class="meta-btn" onclick={() => openDialog(`Round ${round.roundIndex + 1}`, round)}>
                Round
              </button>
              {#if round.requestPayloadJson !== null}
                <button class="meta-btn" onclick={() => openDialog(`Round ${round.roundIndex + 1} request`, round.requestPayloadJson)}>
                  Request
                </button>
              {/if}
              {#if round.responseTraceJson !== null}
                <button class="meta-btn" onclick={() => openDialog(`Round ${round.roundIndex + 1} response`, round.responseTraceJson)}>
                  Response
                </button>
              {/if}
              <button
                class="meta-btn"
                disabled={roundExchanges.length === 0}
                onclick={() => openDialog(`Round ${round.roundIndex + 1} raw exchanges`, roundExchanges)}
              >
                Raw{roundExchanges.length > 0 ? ` (${roundExchanges.length})` : ''}
              </button>
            </div>
          </div>

          <div class="round-parts">
            {#if roundParts.length > 0}
              {#each roundParts as part (part.id)}
                <TracePartBlock {part} mode="inspect" />
              {/each}
            {/if}

            {#if roundStream}
              <StreamingRoundDeltaBlock roundState={roundStream} mode="inspect" />
            {/if}

            {#if roundParts.length === 0 && !roundStream}
              <div class="round-empty">
                {#if round.status === 'streaming'}
                  Waiting for streamed output…
                {:else}
                  No committed transcript parts for this round.
                {/if}
              </div>
            {/if}
          </div>

          {#if roundSnapshot && roundSnapshot.length > 0}
            <div class="round-ctx-bar-full">
              <ContextSnapshotBar
                entries={roundSnapshot}
                contextSize={loadedContextLength}
                label="Context at round end"
                showLegend={false}
                compact
              />
            </div>
          {/if}
        </section>
      {/each}
    </div>
  </details>
{/if}

{#if showDialog}
  <JsonDialog title={dialogTitle} data={dialogData} onClose={() => { showDialog = false }} />
{/if}

<style>
  .compact-turn {
    --compact-stack-gap: 0.14rem;
    --compact-inline-gap: 0.35rem;
    --compact-row-gap: 0.28rem;
    --compact-round-gap: 0.42rem;
    --compact-round-indent: 0.82rem;
    --compact-round-padding: 0.72rem;
    --compact-summary-pad-y: 0.18rem;
    --compact-summary-pad-x: 0.38rem;
    --compact-message-pad-y: 0.38rem;
    --compact-message-pad-x: 0.72rem;
    --compact-meta-gap: 0.14rem;
    --compact-detail-bottom-pad: 0.42rem;
    --compact-detail-indent: 1.15rem;
    --compact-line-height: 1.4;
    margin-top: 0.72rem;
  }

  .compact-turn:first-child {
    margin-top: 0;
  }

  .compact-round {
    margin-top: var(--compact-round-gap, 0.42rem);
    margin-left: var(--compact-round-indent, 0.82rem);
    padding-left: var(--compact-round-padding, 0.72rem);
    border-left: 2px solid var(--border-subtle);
  }

  .compact-round-meta {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    margin-bottom: var(--compact-meta-gap, 0.14rem);
  }

  .compact-round-label,
  .compact-round-status,
  .compact-round-tokens {
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  .compact-round-actions {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-left: auto;
  }

  .compact-round-parts {
    display: flex;
    flex-direction: column;
    gap: var(--compact-stack-gap, 0.14rem);
  }

  .compaction-summary {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.35rem;
    margin-left: var(--compact-round-indent, 0.82rem);
    padding: 0.2rem 0.5rem;
    background: var(--bg-subtle, rgba(0,0,0,0.04));
    border-radius: 4px;
    font-size: 0.68rem;
  }

  .compaction-label {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .compaction-tokens {
    color: var(--color-warning, #b45309);
    font-variant-numeric: tabular-nums;
  }

  .compaction-range {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .turn-block {
    margin-top: 1rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-panel);
    overflow: hidden;
  }

  .turn-block:first-child {
    margin-top: 0;
  }

  .turn-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.8rem 1rem;
    cursor: pointer;
    list-style: none;
    background: var(--bg-panel);
  }

  .turn-summary::-webkit-details-marker {
    display: none;
  }

  .turn-summary::before {
    content: '▶';
    font-size: 0.62rem;
    color: var(--text-muted);
    transition: transform 0.15s;
    margin-right: 0.5rem;
  }

  details[open] > .turn-summary::before {
    transform: rotate(90deg);
  }

  .turn-summary-main,
  .turn-summary-meta,
  .round-header-main,
  .round-actions {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex-wrap: wrap;
  }

  .turn-label,
  .round-label {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--text);
  }

  .turn-status,
  .round-status,
  .turn-outcome,
  .round-meta {
    font-size: 0.72rem;
    color: var(--text-muted);
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    padding: 0.12rem 0.45rem;
  }

  .turn-summary-meta {
    font-size: 0.74rem;
    color: var(--text-muted);
  }

  .turn-body {
    padding: 0 1rem 1rem;
    border-top: 1px solid var(--border);
  }

  .round-block {
    margin-top: 0.9rem;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg);
    overflow: hidden;
  }

  .round-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 0.85rem;
    border-bottom: 1px solid var(--border-subtle);
    background: color-mix(in srgb, var(--bg-panel) 85%, transparent);
  }

  .round-parts {
    padding: 0 0.85rem 0.2rem;
  }

  .round-empty {
    padding: 0.85rem 0;
    font-size: 0.8rem;
    color: var(--text-muted);
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

  /* Per-round context snapshot bar */
  .round-ctx-bar {
    margin-top: var(--compact-meta-gap, 0.14rem);
    padding-top: 0.18rem;
    border-top: 1px solid var(--border-subtle);
  }

  .round-ctx-bar-full {
    padding: 0.3rem 0.85rem 0.5rem;
    border-top: 1px solid var(--border-subtle);
    background: color-mix(in srgb, var(--bg) 60%, transparent);
  }
</style>
