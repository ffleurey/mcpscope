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
  import TracePartBlock from './TracePartBlock.svelte'

  interface Props {
    turn: TurnRecord
    rounds: RoundRecord[]
    parts: PartRecord[]
    rawExchanges: RawExchangeRecord[]
    roundStreams: StreamingRoundState[]
    /** chat: clean chat view; inspect: full detail with round headers + buttons */
    mode?: 'chat' | 'inspect'
    contextSnapshotsByRound?: Map<string, ContextEntry[]>
    loadedContextLength?: number | null
  }

  const {
    turn,
    rounds,
    parts,
    rawExchanges,
    roundStreams,
    mode = 'chat',
    contextSnapshotsByRound,
    loadedContextLength = null,
  }: Props = $props()

  let showDialog = $state(false)
  let dialogTitle = $state('')
  let dialogData = $state<unknown>(null)

  const sortedRounds = $derived([...rounds].sort((a, b) => a.roundIndex - b.roundIndex))
  const sortedParts = $derived([...parts].sort((a, b) => a.ordinal - b.ordinal))
  const turnIsComplete = $derived(
    turn.status === 'complete' || turn.status === 'error' || turn.status === 'aborted',
  )
  const lastRound = $derived(sortedRounds.at(-1) ?? null)
  const partsByRound = $derived.by(() => {
    const m = new Map<string, PartRecord[]>()
    for (const p of sortedParts) {
      if (!p.roundId) continue
      m.set(p.roundId, [...(m.get(p.roundId) ?? []), p])
    }
    return m
  })
  const rawExchangesByRound = $derived.by(() => {
    const m = new Map<string, RawExchangeRecord[]>()
    for (const x of rawExchanges) {
      if (!x.roundId) continue
      m.set(x.roundId, [...(m.get(x.roundId) ?? []), x])
    }
    return m
  })
  const roundStreamsByRound = $derived.by(() => {
    const m = new Map<string, StreamingRoundState>()
    for (const rs of roundStreams) m.set(rs.roundId, rs)
    return m
  })
  const userPart = $derived(sortedParts.find((p) => p.partType === 'user-message') ?? null)
  const ungroupedParts = $derived(sortedParts.filter((p) => p.roundId === null))
  const assistantContentParts = $derived(sortedParts.filter((p) => p.partType === 'assistant-content'))
  const toolCallCount = $derived(sortedParts.filter((p) => p.partType === 'tool-call').length)

  function openDialog(title: string, data: unknown): void {
    dialogTitle = title
    dialogData = data
    showDialog = true
  }
</script>

<!-- ─── Both modes share the compact-turn foundation ───────────────────── -->
<section class="compact-turn">

  <!-- User message: always visible -->
  {#if userPart}
    <TracePartBlock part={userPart} mode="compact" />
  {/if}

  {#if ungroupedParts.length > 0 && userPart === null}
    <div class="compact-round">
      <div class="compact-round-parts">
        {#each ungroupedParts as part (part.id)}
          <TracePartBlock {part} mode="compact" />
        {/each}
      </div>
    </div>
  {/if}

  {#if mode === 'chat' && turnIsComplete}
    <!-- ── Chat mode, completed ──────────────────────────────────────── -->

    <!-- Assistant response(s): always visible — this is the chat reply -->
    {#each assistantContentParts as part (part.id)}
      <TracePartBlock {part} mode="compact" />
    {/each}

    <!-- Collapsible behind-the-scenes: only shown when there's activity to explain -->
    {#if toolCallCount > 0 || sortedRounds.length > 1 || turn.status === 'error'}
      <details class="chat-detail">
        <summary class="chat-detail-row">
          <span class="chat-detail-status" class:is-error={turn.status === 'error'}>
            {turn.status}
          </span>
          <span class="chat-detail-stats">
            {sortedRounds.length} round{sortedRounds.length !== 1 ? 's' : ''}
            {#if toolCallCount > 0}· {toolCallCount} tool call{toolCallCount !== 1 ? 's' : ''}{/if}
            {#if turn.usage.totalTokens !== null}· {turn.usage.totalTokens.toLocaleString()} tokens{/if}
          </span>
          {#if turn.outcome && turn.outcome !== 'stop'}
            <span class="chat-detail-outcome">{turn.outcome}</span>
          {/if}
        </summary>

        <!-- Expanded: non-content round parts (tool calls, reasoning, tool results) -->
        <div class="chat-detail-body">
          {#each sortedRounds as round (round.id)}
            {@const allRoundParts = (partsByRound.get(round.id) ?? []).filter(
              (p) => p.id !== userPart?.id && p.partType !== 'assistant-content',
            )}
            {#if allRoundParts.length > 0}
              <div class="chat-detail-round">
                <span class="chat-detail-round-label">Round {round.roundIndex + 1}</span>
                <CompactRoundContent parts={allRoundParts} roundStream={null} />
              </div>
            {/if}
          {/each}
        </div>
      </details>
    {/if}

    <!-- Context bar: always visible after a completed chat turn -->
    {#if lastRound}
      {@const lastSnapshot = contextSnapshotsByRound?.get(lastRound.id) ?? null}
      {#if lastSnapshot && lastSnapshot.length > 0}
        <div class="turn-ctx-bar">
          <ContextSnapshotBar
            entries={lastSnapshot}
            contextSize={loadedContextLength}
            label="After turn {turn.sequenceNumber}"
            showLegend={false}
            compact
          />
        </div>
      {/if}
    {/if}

    <!-- Compaction note -->
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

  {:else}
    <!-- ── Chat (in-progress) OR Inspect (always): all rounds shown ──── -->
    {#each sortedRounds as round (round.id)}
      {@const roundParts = (partsByRound.get(round.id) ?? []).filter((p) => p.id !== userPart?.id)}
      {@const roundExchanges = rawExchangesByRound.get(round.id) ?? []}
      {@const roundStream = roundStreamsByRound.get(round.id) ?? null}
      {@const roundSnapshot = contextSnapshotsByRound?.get(round.id) ?? null}
      <section class="compact-round">

        <!-- Round meta header: inspect mode only -->
        {#if mode === 'inspect'}
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
        {/if}

        <div class="compact-round-parts">
          {#if roundParts.length > 0 || roundStream}
            <CompactRoundContent parts={roundParts} {roundStream} />
          {:else if round.status === 'streaming'}
            <div class="round-streaming-hint">Waiting for streamed output…</div>
          {/if}
        </div>

        {#if roundSnapshot && roundSnapshot.length > 0 && !turnIsComplete}
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

    <!-- Context bar after completed turn (inspect, or chat while still streaming end) -->
    {#if turnIsComplete && lastRound}
      {@const lastSnapshot = contextSnapshotsByRound?.get(lastRound.id) ?? null}
      {#if lastSnapshot && lastSnapshot.length > 0}
        <div class="turn-ctx-bar">
          <ContextSnapshotBar
            entries={lastSnapshot}
            contextSize={loadedContextLength}
            label="After turn {turn.sequenceNumber}"
            showLegend={false}
            compact
          />
        </div>
      {/if}
    {/if}

    <!-- Compaction note -->
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
  {/if}

</section>

{#if showDialog}
  <JsonDialog title={dialogTitle} data={dialogData} onClose={() => { showDialog = false }} />
{/if}

<style>
  .compact-turn {
    --chat-indent: 0.82rem;
    --chat-pad: 0.72rem;
    --chat-gap: 0.42rem;
    --chat-stack: 0.14rem;
    margin-top: 0.72rem;
  }

  .compact-turn:first-child {
    margin-top: 0;
  }

  /* ── Rounds (shared by both modes) ──────────────────────────────────── */
  .compact-round {
    margin-top: var(--chat-gap);
    margin-left: var(--chat-indent);
    padding-left: var(--chat-pad);
    border-left: 2px solid var(--border-subtle);
  }

  .compact-round-meta {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    margin-bottom: var(--chat-stack);
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
    gap: var(--chat-stack);
  }

  .round-streaming-hint {
    font-size: 0.78rem;
    color: var(--text-muted);
    padding: 0.3rem 0;
    font-style: italic;
  }

  .round-ctx-bar {
    margin-top: var(--chat-stack);
    padding-top: 0.18rem;
    border-top: 1px solid var(--border-subtle);
  }

  /* ── Turn-level context bar (after completion) ──────────────────────── */
  .turn-ctx-bar {
    margin-top: 0.28rem;
    margin-left: var(--chat-indent);
    padding-left: var(--chat-pad);
    border-left: 2px solid var(--border-subtle);
  }

  /* ── Chat mode: collapsible behind-the-scenes detail ──────────────── */
  .chat-detail {
    margin-top: var(--chat-gap);
    margin-left: var(--chat-indent);
  }

  .chat-detail-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem var(--chat-pad);
    list-style: none;
    cursor: pointer;
    border-left: 2px solid var(--border-subtle);
    border-radius: 0 4px 4px 0;
    user-select: none;
  }

  .chat-detail-row::-webkit-details-marker {
    display: none;
  }

  .chat-detail-row::before {
    content: '▶';
    font-size: 0.55rem;
    color: var(--text-muted);
    transition: transform 0.12s;
    flex-shrink: 0;
  }

  details[open] > .chat-detail-row::before {
    transform: rotate(90deg);
  }

  .chat-detail-status {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--color-success, #16a34a);
    padding: 0.08rem 0.35rem;
    border: 1px solid color-mix(in srgb, var(--color-success, #16a34a) 35%, transparent);
    border-radius: 999px;
  }

  .chat-detail-status.is-error {
    color: var(--color-error, #dc2626);
    border-color: color-mix(in srgb, var(--color-error, #dc2626) 35%, transparent);
  }

  .chat-detail-stats {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .chat-detail-outcome {
    font-size: 0.68rem;
    color: var(--text-muted);
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    padding: 0.06rem 0.35rem;
  }

  .chat-detail-body {
    margin-top: 0.3rem;
    padding-left: var(--chat-pad);
    border-left: 2px solid var(--border-subtle);
  }

  .chat-detail-round {
    display: flex;
    flex-direction: column;
    gap: var(--chat-stack);
    padding: 0.25rem 0;
    border-top: 1px solid var(--border-subtle);
  }

  .chat-detail-round:first-child {
    border-top: none;
  }

  .chat-detail-round-label {
    font-size: 0.68rem;
    color: var(--text-muted);
    margin-bottom: 0.1rem;
  }

  /* ── Compaction note ────────────────────────────────────────────────── */
  .compaction-summary {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.35rem;
    margin-left: var(--chat-indent);
    padding: 0.2rem 0.5rem;
    background: var(--bg-subtle, rgba(0,0,0,0.04));
    border-radius: 4px;
    font-size: 0.68rem;
  }

  .compaction-label { color: var(--text-muted); }
  .compaction-tokens { color: var(--color-warning, #b45309); font-variant-numeric: tabular-nums; }
  .compaction-range { color: var(--text-muted); font-variant-numeric: tabular-nums; }

  /* ── Shared button ──────────────────────────────────────────────────── */
  .meta-btn {
    background: none;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.72rem;
    padding: 0.2rem 0.5rem;
  }

  .meta-btn:hover:enabled { color: var(--text); border-color: var(--border); }
  .meta-btn:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
