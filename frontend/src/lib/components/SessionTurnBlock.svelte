<script lang="ts">
  import type {
    ContextEntry,
    PartRecord,
    RoundRecord,
    TurnRecord,
  } from '../backendTypes'
  import type { StreamingRoundState } from '../traceStreaming'
  import CompactRoundContent from './CompactRoundContent.svelte'
  import ContextSnapshotBar from './ContextSnapshotBar.svelte'
  import IdBadge from './IdBadge.svelte'
  import MarkdownPreviewDialog from './MarkdownPreviewDialog.svelte'
  import TracePartBlock from './TracePartBlock.svelte'
  import { looksLikeMarkdown } from '../markdownRender'
  import { highlightStructuredText } from '../textHighlight'

  interface Props {
    turn: TurnRecord
    rounds: RoundRecord[]
    parts: PartRecord[]
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
    roundStreams,
    mode = 'chat',
    contextSnapshotsByRound,
    loadedContextLength = null,
  }: Props = $props()

  let showMarkdownPreview = $state(false)
  let markdownPreviewSource = $state('')
  /** Chat mode: collapsed = show only answers; expanded = show full round detail */
  let chatCollapsed = $state(true)
  /** Assessment prompt: collapsed by default for analysis turns */
  let promptCollapsed = $state(true)

  const sortedRounds = $derived([...rounds].sort((a, b) => a.roundIndex - b.roundIndex))
  const sortedParts = $derived([...parts].sort((a, b) => a.ordinal - b.ordinal))
  const turnIsComplete = $derived(
    turn.status === 'complete' || turn.status === 'error' || turn.status === 'aborted',
  )
  const isAnalysisWorkflowTurn = $derived(turn.ownerStepId !== null && turn.ownerStepId !== undefined)
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
  const assistantContentParts = $derived(sortedParts.filter((p) => p.partType === 'assistant-content'))
  const toolCallCount = $derived(sortedParts.filter((p) => p.partType === 'tool-call').length)
  const hasReasoning = $derived(sortedParts.some((p) => p.partType === 'assistant-reasoning'))
  /** True when there's something worth expanding (tool calls, reasoning, multiple rounds, or assessment prompt) */
  const hasDetail = $derived(toolCallCount > 0 || hasReasoning || sortedRounds.length > 1 || turn.status === 'error' || (isAnalysisWorkflowTurn && userPart !== null))

  function normalizeText(text: string | null | undefined): string | null {
    if (!text) return null
    const normalized = text.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '')
    return normalized.length > 0 ? normalized : null
  }

  function openMarkdownPreview(text: string): void {
    markdownPreviewSource = text
    showMarkdownPreview = true
  }
</script>

<!-- ─── Both modes share the compact-turn foundation ───────────────────── -->
<section class="compact-turn">

  <!-- User message: collapsible for analysis workflows, always visible elsewhere -->
  {#if userPart}
    {#if isAnalysisWorkflowTurn && mode === 'chat'}
      <!-- Assessment prompt: collapsible with toggle -->
      <button
        class="assessment-prompt-toggle"
        onclick={() => { promptCollapsed = !promptCollapsed }}
        title={promptCollapsed ? 'Expand prompt' : 'Collapse prompt'}
      >
        <span class="toggle-arrow" class:open={!promptCollapsed}>▶</span>
        <span class="toggle-label">Assessment Prompt</span>
      </button>
      {#if !promptCollapsed}
        <TracePartBlock part={userPart} mode="compact" />
      {/if}
    {:else}
      <!-- Regular turn: always visible -->
      <TracePartBlock part={userPart} mode="compact" />
    {/if}
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

    <!-- Toggle row: above the content, only when there's detail to show -->
    {#if hasDetail}
      <div class="chat-toggle-row">
        <button
          class="chat-toggle-btn"
          onclick={() => { chatCollapsed = !chatCollapsed }}
        >
          <span class="chat-toggle-arrow" class:open={!chatCollapsed}>▶</span>
          <span class="chat-toggle-status" class:is-error={turn.status === 'error'}>
            {turn.status}
          </span>
          <span class="chat-toggle-stats">
            {sortedRounds.length} round{sortedRounds.length !== 1 ? 's' : ''}
            {#if toolCallCount > 0}· {toolCallCount} tool call{toolCallCount !== 1 ? 's' : ''}{/if}
            {#if turn.usage.totalTokens !== null}· {turn.usage.totalTokens.toLocaleString()} tokens{/if}
          </span>
          {#if turn.outcome && turn.outcome !== 'stop'}
            <span class="chat-toggle-outcome">{turn.outcome}</span>
          {/if}
        </button>
      </div>
    {/if}

    {#if chatCollapsed}
      <!-- Collapsed: markdown syntax-highlighted answer text -->
      {#each assistantContentParts as part (part.id)}
        {@const text = normalizeText(part.payload.text)}
        {#if text}
          {@const rendered = highlightStructuredText(text)}
          <div class="chat-answer-block">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <pre class="chat-answer-text" class:is-json={rendered.format === 'json'}>{@html rendered.html}</pre>
            {#if rendered.format === 'markdown' && looksLikeMarkdown(text)}
              <button class="preview-btn" onclick={() => openMarkdownPreview(text)} aria-label="Render preview" title="Render preview">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            {/if}
          </div>
        {/if}
      {/each}
    {:else}
      <!-- Expanded: full round detail (answers visible within rounds) -->
      {#each sortedRounds as round (round.id)}
        {@const roundParts = (partsByRound.get(round.id) ?? []).filter((p) => p.id !== userPart?.id)}
        {@const roundStream = roundStreamsByRound.get(round.id) ?? null}
        <section class="compact-round">
          <div class="compact-round-parts">
            <CompactRoundContent parts={roundParts} {roundStream} />
          </div>
        </section>
      {/each}
    {/if}

    <!-- Context bar: always visible after a completed chat turn -->
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
    <!-- ── Chat (in-progress) OR Inspect (always): all rounds shown ──── -->
    {#each sortedRounds as round (round.id)}
      {@const roundParts = (partsByRound.get(round.id) ?? []).filter((p) => p.id !== userPart?.id)}
      {@const roundStream = roundStreamsByRound.get(round.id) ?? null}
      {@const roundSnapshot = contextSnapshotsByRound?.get(round.id) ?? null}
      <section class="compact-round">

        <!-- Round meta header: inspect mode only -->
        {#if mode === 'inspect'}
          <div class="inspect-id-row">
            <IdBadge id={turn.id} />
          </div>
          <div class="compact-round-meta">
            <span class="compact-round-label">Round {round.roundIndex + 1}</span>
            <span class="compact-round-status">{round.finishReason ?? round.status}</span>
            {#if round.usage.totalTokens !== null}
              <span class="compact-round-tokens">{round.usage.totalTokens.toLocaleString()} total</span>
            {/if}
            <div class="compact-round-actions">
              <IdBadge id={round.id} />
            </div>
          </div>
        {/if}

        <div class="compact-round-parts">
          {#if roundParts.length > 0 || roundStream}
          <CompactRoundContent parts={roundParts} {roundStream} inspectMode={mode === 'inspect'} />
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
            label="After turn {turn.turnNumber}"
            showLegend={false}
            turnId={turn.id}
            compact
          />
        </div>
      {/if}
    {/if}

    <!-- Compaction note: inspect mode only -->
    {#if mode === 'inspect' && turn.compactionApplied !== null && turn.compactionApplied !== 'none'}
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

{#if showMarkdownPreview}
  <MarkdownPreviewDialog source={markdownPreviewSource} onClose={() => { showMarkdownPreview = false }} />
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

  .inspect-id-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 0.2rem;
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

  /* ── Chat mode: markdown syntax-highlighted answer text ─────────────── */
  .chat-answer-block {
    position: relative;
    display: flex;
    flex-direction: column;
    margin-top: var(--chat-gap);
    margin-left: var(--chat-indent);
    padding-left: var(--chat-pad);
    border-left: 2px solid var(--border-subtle);
  }

  .chat-answer-text {
    font-size: 0.88rem;
    font-family: inherit;
    line-height: 1.65;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }

  .chat-answer-text.is-json {
    font-family: var(--font-mono, monospace);
  }

  .preview-btn {
    position: absolute;
    top: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.15rem;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .chat-answer-block:hover .preview-btn {
    opacity: 1;
  }

  .preview-btn:hover {
    color: var(--text);
    border-color: var(--border-subtle);
    background: var(--bg-panel);
    opacity: 1;
  }

  /* hljs markdown token colours — semantic palette */
  .chat-answer-text :global(.hljs-section) {
    color: var(--color-accent, #60a5fa);
    font-weight: 600;
  }
  .chat-answer-text :global(.hljs-strong) {
    color: var(--text);
    font-weight: 700;
  }
  .chat-answer-text :global(.hljs-emphasis) {
    color: var(--text);
    font-style: italic;
  }
  .chat-answer-text :global(.hljs-code) {
    color: var(--color-success, #4ade80);
    font-family: var(--font-mono, monospace);
  }
  .chat-answer-text :global(.hljs-quote) {
    color: var(--text-muted);
    font-style: italic;
  }
  .chat-answer-text :global(.hljs-bullet) {
    color: var(--color-accent, #60a5fa);
    font-weight: 700;
  }
  .chat-answer-text :global(.hljs-link) {
    color: var(--color-accent, #60a5fa);
    text-decoration: underline;
  }

  /* ── Chat mode: toggle row ──────────────────────────────────────────── */
  .chat-toggle-row {
    margin-top: var(--chat-gap);
    margin-left: var(--chat-indent);
  }

  .chat-toggle-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.22rem var(--chat-pad);
    border: none;
    background: none;
    cursor: pointer;
    border-left: 2px solid var(--border-subtle);
    border-radius: 0 4px 4px 0;
    width: 100%;
    text-align: left;
  }

  .chat-toggle-btn:hover {
    background: var(--bg-hover, rgba(0,0,0,0.04));
  }

  .chat-toggle-arrow {
    font-size: 0.55rem;
    color: var(--text-muted);
    transition: transform 0.12s;
    flex-shrink: 0;
  }

  .chat-toggle-arrow.open {
    transform: rotate(90deg);
  }

  .chat-toggle-status {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-muted);
    padding: 0.08rem 0.35rem;
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
  }

  .chat-toggle-status.is-error {
    color: var(--color-error, #dc2626);
    border-color: color-mix(in srgb, var(--color-error, #dc2626) 35%, transparent);
  }

  .chat-toggle-stats {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .chat-toggle-outcome {
    font-size: 0.68rem;
    color: var(--text-muted);
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    padding: 0.06rem 0.35rem;
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
    border-left: 2px solid var(--border-subtle);
    border-radius: 0 4px 4px 0;
    width: 100%;
    text-align: left;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .assessment-prompt-toggle:hover {
    background: var(--bg-hover, rgba(0,0,0,0.04));
  }

  .assessment-prompt-toggle .toggle-arrow {
    font-size: 0.55rem;
    color: var(--text-muted);
    transition: transform 0.12s;
    flex-shrink: 0;
  }

  .assessment-prompt-toggle .toggle-arrow.open {
    transform: rotate(90deg);
  }

  .assessment-prompt-toggle .toggle-label {
    font-weight: 500;
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
</style>
