<script lang="ts">
  import type { ChatMessage, SegmentType } from '../types'

  interface Props {
    messages: ChatMessage[]
    loadedContextLength: number | null
    systemPromptTokens: number | null
    toolDefinitionsTokens?: number | null
  }

  const { messages, loadedContextLength, systemPromptTokens, toolDefinitionsTokens = null }: Props = $props()

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

  interface BarSegment { type: SegmentType; tokens: number; msgId: string }

  // Compute segments directly from the current messages[] state.
  // This is the live view of what's in the context window — reflects any changes
  // to thinkingInContext, pruning, summarisation, etc.
  let allSegments = $derived.by((): BarSegment[] => {
    const segs: BarSegment[] = []

    // Find the last completed assistant message — its reasoning is always shown
    // because it was just generated (still "in" the generation context window).
    // Older turns' reasoning is only shown if thinkingInContext is true.
    const lastAssistantId = [...messages]
      .reverse()
      .find(m => m.role === 'assistant' && m.status === 'complete' && m.usage)
      ?.id ?? null

    // System prompt (from session snapshot)
    if (systemPromptTokens && systemPromptTokens > 0) {
      segs.push({ type: 'system-prompt', tokens: systemPromptTokens, msgId: 'system' })
    }

    // Tool definitions — sent on every turn while MCP is active (estimated cost)
    if (toolDefinitionsTokens && toolDefinitionsTokens > 0) {
      segs.push({ type: 'tool-definitions', tokens: toolDefinitionsTokens, msgId: 'tool-defs' })
    }

    // Build an index of assistant messages by their position so user turns can
    // look ahead to the following assistant message (to avoid double-counting
    // tool call overhead that was already baked into userMsg.tokens).
    const assistantByIndex: Record<number, ChatMessage> = {}
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'assistant') assistantByIndex[i] = messages[i]
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      // Aborted messages are not in the LLM context — skip them entirely
      if (msg.status === 'aborted') continue
      if (msg.status === 'streaming' || msg.status === 'error') continue

      if (msg.role === 'user') {
        if (msg.tokens && msg.tokens > 0) {
          // Find the immediately following assistant message
          const nextAssistant = assistantByIndex[i + 1]
          let toolOverhead = 0
          if (nextAssistant?.toolCalls && nextAssistant.toolCalls.length > 0) {
            // userMsg.tokens = user_text + tool_overhead (tool calls + responses that
            // were fed back into the prompt). Subtract the estimated overhead so the
            // 'user' segment and the tool-call/tool-response segments don't double-count.
            if (nextAssistant.toolCallTokens) {
              toolOverhead += nextAssistant.toolCallTokens
            } else {
              for (const tc of nextAssistant.toolCalls) {
                toolOverhead += Math.max(10, Math.ceil((tc.argumentsJson?.length ?? 0) / 4))
              }
            }
            if (nextAssistant.toolResponseTokens) {
              toolOverhead += nextAssistant.toolResponseTokens
            } else {
              for (const tc of nextAssistant.toolCalls) {
                toolOverhead += Math.max(10, Math.ceil((tc.result?.length ?? 0) / 4))
              }
            }
          }
          const userTokens = Math.max(1, msg.tokens - toolOverhead)
          segs.push({ type: 'user', tokens: userTokens, msgId: msg.id })
        }
      } else if (msg.role === 'assistant' && msg.usage) {
        const u = msg.usage
        const contentTokens = Math.max(0, u.completionTokens - (u.reasoningTokens ?? 0))

        // Show reasoning if: this is the most recent turn (always show what was just generated)
        // OR the turn has thinkingInContext=true (user chose to forward reasoning to next turn)
        const isLastTurn = msg.id === lastAssistantId
        if ((isLastTurn || msg.thinkingInContext) && u.reasoningTokens) {
          segs.push({ type: 'reasoning', tokens: u.reasoningTokens, msgId: msg.id + '-r' })
        }

        // Tool calls made in this turn
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            // Use exact tokens if available, otherwise estimate from JSON length
            const callTokens = msg.toolCallTokens
              ? Math.round(msg.toolCallTokens / msg.toolCalls.length)
              : Math.max(10, Math.ceil((tc.argumentsJson?.length ?? 0) / 4))
            segs.push({ type: 'tool-call', tokens: callTokens, msgId: msg.id + '-tc-' + tc.id })

            // Tool response immediately follows the call in context
            const responseTokens = msg.toolResponseTokens
              ? Math.round(msg.toolResponseTokens / msg.toolCalls.length)
              : Math.max(10, Math.ceil((tc.result?.length ?? 0) / 4))
            segs.push({ type: 'tool-response', tokens: responseTokens, msgId: msg.id + '-tr-' + tc.id })
          }
        }

        if (contentTokens > 0) {
          segs.push({ type: 'content', tokens: contentTokens, msgId: msg.id + '-c' })
        }
      }
    }

    return segs
  })

  // Total persistent context = sum of all segments
  let totalUsed = $derived(allSegments.reduce((s, seg) => s + seg.tokens, 0))

  // Context window size
  let ctxSize = $derived(loadedContextLength ?? 0)

  // Percentage filled
  let pct = $derived(ctxSize > 0 ? Math.min(100, (totalUsed / ctxSize) * 100) : 0)

  // Legend: unique segment types present
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
