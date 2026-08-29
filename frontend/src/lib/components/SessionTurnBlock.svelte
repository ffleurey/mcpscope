<script lang="ts">
  import type { ContextEntry, PartRecord, RoundRecord, TurnRecord } from '../backendTypes'
  import type { StreamingRoundState } from '../traceStreaming'
  import CompactRoundContent from './CompactRoundContent.svelte'
  import ContextSnapshotBar from './ContextSnapshotBar.svelte'
  import IdBadge from './IdBadge.svelte'
  import SessionAnswerBlock from './SessionAnswerBlock.svelte'
  import TokenPill from './TokenPill.svelte'
  import TracePartBlock from './TracePartBlock.svelte'
  import { normalizeMessageText } from '../format'
  import Icon from './Icon.svelte'
  import { iconChevronRight, iconArrowDown } from '../design/icons'

  interface Props {
    turn: TurnRecord
    rounds: RoundRecord[]
    parts: PartRecord[]
    roundStreams: StreamingRoundState[]
    contextSnapshotsByRound?: Map<string, ContextEntry[]>
    loadedContextLength?: number | null
  }

  const {
    turn,
    rounds,
    parts,
    roundStreams,
    contextSnapshotsByRound,
    loadedContextLength = null,
  }: Props = $props()

  /** Collapsed = answers only; expanded = full round detail. Live turns are always expanded. */
  let expanded = $state(false)
  /** Assessment prompt: collapsed by default for analysis turns */
  let promptCollapsed = $state(true)

  const sortedRounds = $derived([...rounds].sort((a, b) => a.roundIndex - b.roundIndex))
  const sortedParts = $derived([...parts].sort((a, b) => a.ordinal - b.ordinal))
  const turnIsComplete = $derived(
    turn.status === 'complete' || turn.status === 'error' || turn.status === 'aborted',
  )
  const isAnalysisWorkflowTurn = $derived(
    turn.ownerStepId !== null && turn.ownerStepId !== undefined,
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
  const roundStreamsByRound = $derived.by(() => {
    const m = new Map<string, StreamingRoundState>()
    for (const rs of roundStreams) m.set(rs.roundId, rs)
    return m
  })
  const userPart = $derived(sortedParts.find((p) => p.partType === 'user-message') ?? null)
  const ungroupedParts = $derived(sortedParts.filter((p) => p.roundId === null))
  const assistantContentParts = $derived(
    sortedParts.filter((p) => p.partType === 'assistant-content'),
  )
  const toolCallCount = $derived(sortedParts.filter((p) => p.partType === 'tool-call').length)
  const hasReasoning = $derived(sortedParts.some((p) => p.partType === 'assistant-reasoning'))
  /** True when there's something worth expanding (tool calls, reasoning, multiple rounds, or assessment prompt) */
  const hasDetail = $derived(
    toolCallCount > 0 ||
      hasReasoning ||
      sortedRounds.length > 1 ||
      turn.status === 'error' ||
      (isAnalysisWorkflowTurn && userPart !== null),
  )
  const statusNoteworthy = $derived(turn.status === 'error' || turn.status === 'aborted')
</script>

<section class="compact-turn">
  <!-- User message: collapsible for analysis workflows, always visible elsewhere -->
  {#if userPart}
    {#if isAnalysisWorkflowTurn}
      <button
        class="assessment-prompt-toggle"
        onclick={() => {
          promptCollapsed = !promptCollapsed
        }}
        title={promptCollapsed ? 'Expand prompt' : 'Collapse prompt'}
      >
        <span class="disclosure-arrow" class:open={!promptCollapsed}
          ><Icon path={iconChevronRight} /></span
        >
        <span class="toggle-label">Assessment Prompt</span>
      </button>
      {#if !promptCollapsed}
        <TracePartBlock part={userPart} />
      {/if}
    {:else}
      <TracePartBlock part={userPart} />
    {/if}
  {/if}

  {#if ungroupedParts.length > 0 && userPart === null}
    <div class="compact-round">
      <div class="compact-round-parts">
        {#each ungroupedParts as part (part.id)}
          <TracePartBlock {part} />
        {/each}
      </div>
    </div>
  {/if}

  {#if turnIsComplete}
    <!-- ── Completed turn: quiet meta row, answers by default, detail on expand ── -->
    <div class="turn-meta-row has-reveal">
      <button
        class="turn-toggle"
        onclick={() => {
          expanded = !expanded
        }}
        disabled={!hasDetail}
        aria-expanded={expanded}
      >
        {#if hasDetail}
          <span class="disclosure-arrow" class:open={expanded}
            ><Icon path={iconChevronRight} /></span
          >
        {/if}
        <span class="turn-stats">
          {sortedRounds.length} round{sortedRounds.length !== 1 ? 's' : ''}
          {#if toolCallCount > 0}· {toolCallCount} tool call{toolCallCount !== 1 ? 's' : ''}{/if}
          {#if turn.usage.totalTokens !== null}·
            <span class="tokens-value">{turn.usage.totalTokens.toLocaleString()} tokens</span
            >{/if}
          {#if turn.outcome && turn.outcome !== 'stop'}· {turn.outcome}{/if}
        </span>
      </button>
      {#if statusNoteworthy}
        <span class="pill red">{turn.status}</span>
      {/if}
      <span class="reveal-item pill-end"><IdBadge id={turn.id} /></span>
    </div>

    {#if !expanded}
      <!-- Answers only: the chat layer -->
      {#each assistantContentParts as part (part.id)}
        {@const text = normalizeMessageText(part.payload.text)}
        {#if text}
          <div class="chat-answer-block">
            <SessionAnswerBlock {text} partId={part.id} />
          </div>
        {/if}
      {/each}
    {:else}
      <!-- Full round detail -->
      {#each sortedRounds as round (round.id)}
        {@const roundParts = (partsByRound.get(round.id) ?? []).filter(
          (p) => p.id !== userPart?.id,
        )}
        {@const roundStream = roundStreamsByRound.get(round.id) ?? null}
        <section class="compact-round">
          <div class="round-header has-reveal">
            <span class="round-header-text"
              >Round {round.roundIndex + 1} · {round.finishReason ?? round.status}</span
            >
            <TokenPill count={round.usage.totalTokens} short />
            <span class="reveal-item"><IdBadge id={round.id} /></span>
          </div>
          <div class="compact-round-parts">
            <CompactRoundContent parts={roundParts} {roundStream} />
          </div>
        </section>
      {/each}

      <!-- Compaction note (detail layer) -->
      {#if turn.compactionApplied !== null && turn.compactionApplied !== 'none'}
        <div class="compaction-summary">
          {#if turn.compactionTokensRemoved !== null && turn.compactionTokensRemoved > 0}
            <span class="compaction-label"
              ><Icon path={iconArrowDown} /> {turn.compactionApplied}</span
            >
            <span class="compaction-tokens"
              >−{turn.compactionTokensRemoved.toLocaleString()} tokens</span
            >
            {#if turn.contextTokensAtTurnEnd !== null && turn.contextTokensAfterCompaction !== null}
              <span class="compaction-range"
                >{turn.contextTokensAtTurnEnd.toLocaleString()} → {turn.contextTokensAfterCompaction.toLocaleString()}</span
              >
            {/if}
          {:else}
            <span class="compaction-label"
              ><Icon path={iconArrowDown} /> {turn.compactionApplied}</span
            >
            <span class="compaction-tokens">no tokens removed</span>
          {/if}
        </div>
      {/if}
    {/if}

    <!-- Context bar: always visible after a completed turn -->
    {#if lastRound}
      {@const lastSnapshot = contextSnapshotsByRound?.get(lastRound.id) ?? null}
      {#if lastSnapshot && lastSnapshot.length > 0}
        <div class="turn-ctx-bar">
          <ContextSnapshotBar
            entries={lastSnapshot}
            contextSize={loadedContextLength}
            label="After turn {turn.turnNumber}"
            showLegend={false}
            turnId={turn.id}
            compact
          />
        </div>
      {/if}
    {/if}
  {:else}
    <!-- ── Live turn: all rounds shown expanded ─────────────────────── -->
    {#each sortedRounds as round (round.id)}
      {@const roundParts = (partsByRound.get(round.id) ?? []).filter((p) => p.id !== userPart?.id)}
      {@const roundStream = roundStreamsByRound.get(round.id) ?? null}
      {@const roundSnapshot = contextSnapshotsByRound?.get(round.id) ?? null}
      <section class="compact-round">
        <div class="round-header has-reveal">
          <span class="round-header-text"
            >Round {round.roundIndex + 1} · {round.finishReason ?? round.status}</span
          >
          <TokenPill count={round.usage.totalTokens} short />
          <span class="reveal-item"><IdBadge id={round.id} /></span>
        </div>

        <div class="compact-round-parts">
          {#if roundParts.length > 0 || roundStream}
            <CompactRoundContent parts={roundParts} {roundStream} />
          {:else if round.status === 'streaming'}
            <div class="round-streaming-hint">Waiting for streamed output…</div>
          {/if}
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
  {/if}
</section>

<style>
  .compact-turn {
    margin-top: 0.72rem;
  }

  .compact-turn:first-child {
    margin-top: 0;
  }

  /* ── Rounds ─────────────────────────────────────────────────────────── */
  .compact-round {
    margin-top: var(--chat-gap);
    margin-left: var(--chat-indent);
    padding-left: var(--chat-pad);
    border-left: 2px solid var(--border);
  }

  .round-header {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: var(--font-label);
    color: var(--text-dim);
    margin-bottom: var(--chat-stack);
  }

  .round-header-text {
    white-space: nowrap;
  }

  .compact-round-parts {
    display: flex;
    flex-direction: column;
    gap: var(--chat-stack);
  }

  .round-streaming-hint {
    font-size: var(--font-label);
    color: var(--text-dim);
    padding: 0.3rem 0;
    font-style: italic;
  }

  .round-ctx-bar {
    margin-top: var(--chat-stack);
    padding-top: 0.18rem;
    border-top: 1px solid var(--border);
  }

  /* ── Turn-level context bar (after completion) ──────────────────────── */
  .turn-ctx-bar {
    margin-top: 0.28rem;
    margin-left: var(--chat-indent);
    padding-left: var(--chat-pad);
    border-left: 2px solid var(--border);
  }

  /* ── Answer block (chat layer) ──────────────────────────────────────── */
  .chat-answer-block {
    margin-top: var(--chat-gap);
    margin-left: var(--chat-indent);
    padding-left: var(--chat-pad);
    border-left: 2px solid var(--border);
  }

  /* ── Turn meta row (metadata layer) ─────────────────────────────────── */
  .turn-meta-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: var(--chat-gap);
    margin-left: var(--chat-indent);
    border-left: 2px solid var(--border);
    border-radius: 0 4px 4px 0;
    padding: 0.22rem var(--chat-pad);
    font-size: var(--font-label);
    color: var(--text-dim);
  }

  .turn-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    font-size: inherit;
    font-family: inherit;
    text-align: left;
    min-width: 0;
  }

  .turn-toggle:disabled {
    cursor: default;
  }

  .turn-toggle:not(:disabled):hover .turn-stats {
    color: var(--text-bright);
  }

  .turn-stats {
    font-variant-numeric: tabular-nums;
  }

  .turn-stats .tokens-value {
    color: var(--amber-bright);
  }

  /* ── Assessment prompt toggle ──────────────────────────────────────── */
  .assessment-prompt-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.22rem var(--chat-pad);
    border: none;
    background: none;
    cursor: pointer;
    border-left: 2px solid var(--border);
    border-radius: 0 4px 4px 0;
    width: 100%;
    text-align: left;
    font-size: var(--font-label);
    color: var(--text-dim);
  }

  .assessment-prompt-toggle:hover {
    background: var(--bg-hover);
  }

  .assessment-prompt-toggle .toggle-label {
    font-weight: 500;
  }

  /* ── Compaction note (detail layer) ─────────────────────────────────── */
  .compaction-summary {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.35rem;
    margin-left: var(--chat-indent);
    padding: 0.2rem 0.5rem;
    background: var(--bg-surface);
    border-radius: 4px;
    font-size: var(--font-label);
  }

  .compaction-label {
    color: var(--text-dim);
  }
  .compaction-tokens {
    color: var(--amber-bright);
    font-variant-numeric: tabular-nums;
  }
  .compaction-range {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
</style>
