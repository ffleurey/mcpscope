<script lang="ts">
  import type { ChatMessage, ContextSegment, SegmentType } from '../types'
  import { activeContextSegments } from '../chatStore'

  interface Props {
    messages: ChatMessage[]          // needed only for the live streaming estimate
    loadedContextLength: number | null
  }

  const { messages, loadedContextLength }: Props = $props()

  // Map segment type to its CSS variable name
  const segmentColors: Record<SegmentType, string> = {
    'system-prompt':    'var(--token-system-prompt)',
    'user':             'var(--token-user)',
    'reasoning':        'var(--token-reasoning)',
    'content':          'var(--token-content)',
    'tool-definitions': 'var(--token-tool-definitions)',
    'tool-call':        'var(--token-tool-call)',
    'tool-response':    'var(--token-tool-response)',
  }

  const segmentLabels: Record<SegmentType, string> = {
    'system-prompt':    'System prompt',
    'user':             'User message',
    'reasoning':        'Reasoning (in context)',
    'content':          'Response',
    'tool-definitions': 'Tool definitions',
    'tool-call':        'Tool call',
    'tool-response':    'Tool response',
  }

  // The authoritative segments come from chatStore (which owns the context window).
  // We only add one live estimate on top: the growing orange bar while the model streams
  // reasoning tokens. We can't get the exact token count until the API responds, so we
  // estimate from character count (≈ 3.5 chars/token for thinking text).
  let allSegments = $derived.by((): ContextSegment[] => {
    const base = $activeContextSegments
    const streaming = messages.find(m => m.status === 'streaming')
    if (!streaming?.thinking?.length) return base
    const estimatedTokens = Math.max(1, Math.ceil(streaming.thinking.length / 3.5))
    return [...base, { type: 'reasoning', tokens: estimatedTokens, msgId: streaming.id + '-live-r' }]
  })

  let totalUsed = $derived(allSegments.reduce((s, seg) => s + seg.tokens, 0))
  let ctxSize = $derived(loadedContextLength ?? 0)
  let pct = $derived(ctxSize > 0 ? Math.min(100, (totalUsed / ctxSize) * 100) : 0)

  let legendTypes = $derived.by(() => {
    const seen = new Set<SegmentType>()
    for (const seg of allSegments) seen.add(seg.type)
    return [...seen] as SegmentType[]
  })

  function fmt(n: number) { return n.toLocaleString() }
</script>

{#if ctxSize > 0 || allSegments.length > 0}
  <div class="context-bar-wrapper">
    <div class="bar-header">
      <span class="bar-label">Context</span>
      {#if ctxSize > 0}
        <span class="bar-counts">{fmt(totalUsed)} / {fmt(ctxSize)} ({Math.round(pct)}%)</span>
      {:else}
        <span class="bar-counts">{fmt(totalUsed)} tokens</span>
      {/if}
    </div>

    <div class="bar-track" title="Context usage by token type">
      {#if ctxSize > 0}
        {#each allSegments as seg (seg.msgId)}
          <div
            class="bar-segment"
            style="width: {(seg.tokens / ctxSize) * 100}%; background: {segmentColors[seg.type]};"
            title="{segmentLabels[seg.type]}: {fmt(seg.tokens)} tokens"
          ></div>
        {/each}
      {:else if allSegments.length > 0}
        {@const total = allSegments.reduce((s, g) => s + g.tokens, 0)}
        {#each allSegments as seg (seg.msgId)}
          <div
            class="bar-segment"
            style="width: {(seg.tokens / total) * 100}%; background: {segmentColors[seg.type]};"
            title="{segmentLabels[seg.type]}: {fmt(seg.tokens)} tokens"
          ></div>
        {/each}
      {/if}
    </div>

    {#if legendTypes.length > 0}
      <div class="bar-legend">
        {#each legendTypes as type (type)}
          <span class="legend-item">
            <span class="legend-dot" style="background: {segmentColors[type]};"></span>
            {segmentLabels[type]}
          </span>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .context-bar-wrapper {
    padding: 0.4rem 0.75rem 0.3rem;
    border-top: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    flex-shrink: 0;
  }

  .bar-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.25rem;
    font-size: 0.68rem;
  }

  .bar-label {
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .bar-counts {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .bar-track {
    height: 8px;
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    flex-direction: row;
  }

  .bar-segment {
    height: 100%;
    min-width: 1px;
    flex-shrink: 0;
  }

  .bar-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    margin-top: 0.3rem;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.65rem;
    color: var(--text-muted);
  }

  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
</style>
