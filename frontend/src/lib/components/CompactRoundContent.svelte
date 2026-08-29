<script lang="ts">
  import type { PartRecord } from '../backendTypes'
  import type { StreamingRoundState } from '../traceStreaming'
  import IdBadge from './IdBadge.svelte'
  import JsonDialog from './JsonDialog.svelte'
  import SessionAnswerBlock from './SessionAnswerBlock.svelte'
  import StreamingRoundDeltaBlock from './StreamingRoundDeltaBlock.svelte'
  import TracePartBlock from './TracePartBlock.svelte'
  import TokenPill from './TokenPill.svelte'
  import { isEstimatedTokens, normalizeMessageText } from '../format'

  interface Props {
    parts: PartRecord[]
    roundStream?: StreamingRoundState | null
  }

  type CompactItem =
    | {
        kind: 'assistant-content'
        key: string
        part: PartRecord
      }
    | {
        kind: 'reasoning'
        key: string
        part: PartRecord
      }
    | {
        kind: 'tool-group'
        key: string
        toolCall: PartRecord | null
        results: PartRecord[]
      }
    | {
        kind: 'fallback'
        key: string
        part: PartRecord
      }

  const { parts, roundStream = null }: Props = $props()

  let showDialog = $state(false)
  let dialogTitle = $state('')
  let dialogData = $state<unknown>(null)

  function openDialog(title: string, data: unknown): void {
    dialogTitle = title
    dialogData = data
    showDialog = true
  }

  function normalizeToolName(part: PartRecord | null): string {
    const toolJson = part?.payload.json as { name?: string } | null
    return toolJson?.name ?? part?.payload.summary ?? 'unknown'
  }

  function normalizeToolArguments(part: PartRecord | null): string | null {
    const toolJson = part?.payload.json as { arguments?: string } | null
    if (typeof toolJson?.arguments === 'string' && toolJson.arguments.length > 0) {
      return toolJson.arguments
    }
    return part?.payload.text ?? null
  }

  function toolGroupTokens(toolCall: PartRecord | null, results: PartRecord[]): number | null {
    const counts = [toolCall, ...results]
      .filter((part): part is PartRecord => part !== null)
      .map((part) => part.tokens.count)
      .filter((count): count is number => count !== null)

    return counts.length > 0 ? counts.reduce((sum, count) => sum + count, 0) : null
  }

  function isToolWaiting(toolCall: PartRecord | null, results: PartRecord[]): boolean {
    return toolCall !== null && results.length === 0
  }

  const sortedParts = $derived([...parts].sort((left, right) => left.ordinal - right.ordinal))
  const hasCommittedReasoningPart = $derived(
    sortedParts.some((part) => part.partType === 'assistant-reasoning'),
  )
  const pendingReasoningText = $derived(
    !hasCommittedReasoningPart
      ? normalizeMessageText(roundStream?.completedReasoningText)
      : null,
  )
  const visibleStreamingContent = $derived(normalizeMessageText(roundStream?.contentText))
  const compactItems = $derived.by(() => {
    const items: CompactItem[] = []
    const groupedResultIds = new Set<string>()

    for (const part of sortedParts) {
      if (groupedResultIds.has(part.id)) {
        continue
      }

      if (part.partType === 'assistant-content') {
        items.push({
          kind: 'assistant-content',
          key: part.id,
          part,
        })
        continue
      }

      if (part.partType === 'assistant-reasoning') {
        items.push({
          kind: 'reasoning',
          key: part.id,
          part,
        })
        continue
      }

      if (part.partType === 'tool-call') {
        const results = sortedParts.filter(
          (candidate) => candidate.partType === 'tool-result' && candidate.parentPartId === part.id,
        )
        results.forEach((result) => groupedResultIds.add(result.id))
        items.push({
          kind: 'tool-group',
          key: `tool-${part.id}`,
          toolCall: part,
          results,
        })
        continue
      }

      if (part.partType === 'tool-result') {
        items.push({
          kind: 'tool-group',
          key: `tool-result-${part.id}`,
          toolCall: null,
          results: [part],
        })
        continue
      }

      items.push({
        kind: 'fallback',
        key: part.id,
        part,
      })
    }

    return items
  })
</script>

<div class="compact-stack">
  {#if pendingReasoningText}
    <details class="disclosure-boxed">
      <summary class="disclosure-summary summary-row">
        <span class="meta-label">Reasoning</span>
        <span class="summary-meta"></span>
      </summary>
      <div class="row-body">
        <pre class="session-text detail italic row-text">{pendingReasoningText}</pre>
      </div>
    </details>
  {/if}

  {#each compactItems as item (item.key)}
    {#if item.kind === 'assistant-content'}
      {@const assistantText = normalizeMessageText(item.part.payload.text)}
      {#if assistantText}
        <SessionAnswerBlock
          text={assistantText}
          partId={item.part.id}
          tokens={item.part.tokens.count}
          estimated={isEstimatedTokens(item.part)}
        />
      {/if}
    {:else if item.kind === 'reasoning'}
      <details class="disclosure-boxed">
        <summary class="disclosure-summary summary-row has-reveal">
          <span class="meta-label">Reasoning</span>
          <span class="summary-meta">
            <span class="reveal-item"><IdBadge id={item.part.id} /></span>
            <TokenPill count={item.part.tokens.count} estimated={isEstimatedTokens(item.part)} />
          </span>
        </summary>
        <div class="row-body">
          {#if item.part.payload.text}
            <pre class="session-text detail italic row-text">{item.part.payload.text}</pre>
          {/if}
          {#if item.part.payload.json !== null}
            <button
              class="btn btn-xs"
              onclick={() => openDialog('Reasoning JSON', item.part.payload.json)}
            >
              View JSON
            </button>
          {/if}
        </div>
      </details>
    {:else if item.kind === 'tool-group'}
      {@const toolName = normalizeToolName(item.toolCall)}
      {@const totalTokens = toolGroupTokens(item.toolCall, item.results)}
      <details class="disclosure-boxed">
        <summary class="disclosure-summary summary-row has-reveal">
          <span class="meta-label">Tool</span>
          <span class="summary-value">{toolName}</span>
          <span class="summary-meta">
            {#if item.toolCall}
              <span class="reveal-item"><IdBadge id={item.toolCall.id} /></span>
            {/if}
            {#if isToolWaiting(item.toolCall, item.results)}
              <span class="pill">waiting</span>
            {/if}
            <TokenPill
              count={totalTokens}
              estimated={isEstimatedTokens(item.toolCall) ||
                item.results.some((r) => isEstimatedTokens(r))}
            />
          </span>
        </summary>
        <div class="row-body tool-body">
          {#if item.toolCall}
            <section class="tool-section">
              <div class="tool-section-header">
                <span class="meta-label">Call</span>
                {#if item.toolCall.payload.json !== null}
                  <button
                    class="btn btn-xs"
                    onclick={() =>
                      openDialog(`Tool call · ${toolName}`, item.toolCall?.payload.json)}
                  >
                    JSON
                  </button>
                {/if}
              </div>
              {#if normalizeToolArguments(item.toolCall)}
                <pre class="session-text mono detail row-text">{normalizeToolArguments(item.toolCall)}</pre>
              {/if}
            </section>
          {/if}

          {#each item.results as result (result.id)}
            <section class="tool-section">
              <div class="tool-section-header">
                <span class="meta-label">Result</span>
                {#if result.payload.json !== null}
                  <button
                    class="btn btn-xs"
                    onclick={() => openDialog(`Tool result · ${toolName}`, result.payload.json)}
                  >
                    JSON
                  </button>
                {/if}
              </div>
              {#if result.payload.text}
                <pre class="session-text mono detail row-text">{result.payload.text}</pre>
              {/if}
            </section>
          {/each}
        </div>
      </details>
    {:else}
      <TracePartBlock part={item.part} />
    {/if}
  {/each}

  {#if visibleStreamingContent}
    <section class="assistant-block has-reveal">
      <pre class="session-text">{visibleStreamingContent}</pre>
      <div class="message-meta">
        <span class="pill">streaming</span>
      </div>
    </section>
  {/if}

  {#if roundStream}
    <StreamingRoundDeltaBlock roundState={roundStream} />
  {/if}
</div>

{#if showDialog}
  <JsonDialog
    title={dialogTitle}
    data={dialogData}
    onClose={() => {
      showDialog = false
    }}
  />
{/if}


<style>
  .compact-stack {
    display: flex;
    flex-direction: column;
    gap: var(--compact-stack-gap);
  }

  /* Layout-only companion class — never shadow the global .disclosure-summary. */
  .tool-section-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* The dynamic value beside an uppercase label (e.g. the tool name). */
  .summary-value {
    font-family: var(--mono);
    font-size: var(--font-label);
    color: var(--text-bright);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .assistant-block {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    column-gap: var(--compact-inline-gap);
  }

  .row-body {
    padding: 0 var(--compact-summary-pad-x) var(--compact-detail-bottom-pad)
      var(--compact-detail-indent);
  }

  .tool-body {
    display: flex;
    flex-direction: column;
    gap: var(--compact-row-gap);
  }

  /* Body text sits a hair below its summary/section header. */
  .row-text {
    margin-top: var(--compact-meta-gap);
  }
</style>
