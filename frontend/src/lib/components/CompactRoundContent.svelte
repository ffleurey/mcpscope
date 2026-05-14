<script lang="ts">
  import type { PartRecord } from '../backendTypes'
  import type { StreamingRoundState } from '../traceStreaming'
  import { looksLikeMarkdown } from '../markdownRender'
  import JsonDialog from './JsonDialog.svelte'
  import MarkdownPreviewDialog from './MarkdownPreviewDialog.svelte'
  import StreamingRoundDeltaBlock from './StreamingRoundDeltaBlock.svelte'
  import TracePartBlock from './TracePartBlock.svelte'

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
  let showMarkdownPreview = $state(false)
  let markdownPreviewSource = $state('')

  function openDialog(title: string, data: unknown): void {
    dialogTitle = title
    dialogData = data
    showDialog = true
  }

  function openMarkdownPreview(text: string): void {
    markdownPreviewSource = text
    showMarkdownPreview = true
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

  function normalizeCompactMessageText(text: string | null | undefined): string | null {
    if (!text) {
      return null
    }

    const normalized = text
      .replace(/^(?:[ \t]*\n)+/, '')
      .replace(/(?:\n[ \t]*)+$/, '')

    return normalized.length > 0 ? normalized : null
  }

  const sortedParts = $derived([...parts].sort((left, right) => left.ordinal - right.ordinal))
  const hasCommittedReasoningPart = $derived(
    sortedParts.some((part) => part.partType === 'assistant-reasoning'),
  )
  const pendingReasoningText = $derived(
    !hasCommittedReasoningPart
      ? normalizeCompactMessageText(roundStream?.completedReasoningText)
      : null,
  )
  const visibleStreamingContent = $derived(
    normalizeCompactMessageText(roundStream?.contentText),
  )
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
        const results = sortedParts.filter((candidate) => candidate.partType === 'tool-result' && candidate.parentPartId === part.id)
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
    <details class="collapsed-row">
      <summary class="collapsed-summary">
        <span class="row-label">Reasoning</span>
        <span class="summary-meta"></span>
      </summary>
      <div class="row-body">
        <pre class="row-text">{pendingReasoningText}</pre>
      </div>
    </details>
  {/if}

  {#each compactItems as item (item.key)}
    {#if item.kind === 'assistant-content'}
      {@const assistantText = normalizeCompactMessageText(item.part.payload.text)}
      <section class="assistant-block">
        {#if assistantText}
          <div class="assistant-text">{assistantText}</div>
        {/if}
        <div class="message-meta">
          {#if item.part.tokens.count !== null}
            <span class="token-pill">{item.part.tokens.count.toLocaleString()} tokens</span>
          {/if}
        </div>
        {#if assistantText && looksLikeMarkdown(assistantText)}
          <button class="preview-btn" onclick={() => openMarkdownPreview(assistantText)} aria-label="Render preview" title="Render preview">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        {/if}
      </section>
    {:else if item.kind === 'reasoning'}
      <details class="collapsed-row">
        <summary class="collapsed-summary">
          <span class="row-label">Reasoning</span>
          <span class="summary-meta">
            {#if item.part.tokens.count !== null}
              <span class="token-pill">{item.part.tokens.count.toLocaleString()} tokens</span>
            {/if}
          </span>
        </summary>
        <div class="row-body">
          {#if item.part.payload.text}
            <pre class="row-text">{item.part.payload.text}</pre>
          {/if}
          {#if item.part.payload.json !== null}
            <button class="meta-btn" onclick={() => openDialog('Reasoning JSON', item.part.payload.json)}>
              View JSON
            </button>
          {/if}
        </div>
      </details>
    {:else if item.kind === 'tool-group'}
      {@const toolName = normalizeToolName(item.toolCall)}
      {@const totalTokens = toolGroupTokens(item.toolCall, item.results)}
      <details class="collapsed-row">
        <summary class="collapsed-summary">
          <span class="row-label">Tool · {toolName}</span>
          <span class="summary-meta">
            {#if isToolWaiting(item.toolCall, item.results)}
              <span class="status-pill">waiting</span>
            {/if}
            {#if totalTokens !== null}
              <span class="token-pill">{totalTokens.toLocaleString()} tokens</span>
            {/if}
          </span>
        </summary>
        <div class="row-body tool-body">
          {#if item.toolCall}
            <section class="tool-section">
              <div class="tool-section-header">
                <span class="tool-section-label">Call</span>
                {#if item.toolCall.payload.json !== null}
                  <button class="meta-btn" onclick={() => openDialog(`Tool call · ${toolName}`, item.toolCall?.payload.json)}>
                    JSON
                  </button>
                {/if}
              </div>
              {#if normalizeToolArguments(item.toolCall)}
                <pre class="row-text">{normalizeToolArguments(item.toolCall)}</pre>
              {/if}
            </section>
          {/if}

          {#each item.results as result (result.id)}
            <section class="tool-section">
              <div class="tool-section-header">
                <span class="tool-section-label">Result</span>
                {#if result.payload.json !== null}
                  <button class="meta-btn" onclick={() => openDialog(`Tool result · ${toolName}`, result.payload.json)}>
                    JSON
                  </button>
                {/if}
              </div>
              {#if result.payload.text}
                <pre class="row-text">{result.payload.text}</pre>
              {/if}
            </section>
          {/each}
        </div>
      </details>
    {:else}
      <TracePartBlock part={item.part} mode="compact" />
    {/if}
  {/each}

  {#if visibleStreamingContent}
    <section class="assistant-block">
      <div class="assistant-text">{visibleStreamingContent}</div>
      <div class="message-meta">
        <span class="status-pill">streaming</span>
      </div>
    </section>
  {/if}

  {#if roundStream}
    <StreamingRoundDeltaBlock roundState={roundStream} mode="compact" />
  {/if}
</div>

{#if showDialog}
  <JsonDialog title={dialogTitle} data={dialogData} onClose={() => { showDialog = false }} />
{/if}

{#if showMarkdownPreview}
  <MarkdownPreviewDialog source={markdownPreviewSource} onClose={() => { showMarkdownPreview = false }} />
{/if}

<style>
  .compact-stack {
    display: flex;
    flex-direction: column;
    gap: var(--compact-stack-gap, 0.14rem);
  }

  .collapsed-summary,
  .tool-section-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .summary-meta {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--compact-inline-gap, 0.35rem);
  }

  .row-label,
  .tool-section-label {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .assistant-text {
    min-width: 0;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: var(--compact-line-height, 1.4);
    color: var(--text);
    font-size: 0.9rem;
  }

  .assistant-block {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    column-gap: var(--compact-inline-gap, 0.35rem);
  }

  .message-meta {
    display: flex;
    align-items: end;
  }

  .collapsed-row {
    border: 1px solid transparent;
    border-radius: 6px;
  }

  .collapsed-row[open] {
    border-color: var(--border-subtle);
    background: color-mix(in srgb, var(--bg-panel) 78%, transparent);
  }

  .collapsed-summary {
    cursor: pointer;
    list-style: none;
    padding: var(--compact-summary-pad-y, 0.18rem) var(--compact-summary-pad-x, 0.38rem);
    border-radius: 6px;
  }

  .collapsed-summary:hover {
    background: color-mix(in srgb, var(--bg-panel) 62%, transparent);
  }

  .collapsed-summary::-webkit-details-marker {
    display: none;
  }

  .collapsed-summary::before {
    content: '▶';
    font-size: 0.6rem;
    color: var(--text-muted);
    transition: transform 0.15s;
  }

  details[open] > .collapsed-summary::before {
    transform: rotate(90deg);
  }

  .row-body {
    padding:
      0
      var(--compact-summary-pad-x, 0.38rem)
      var(--compact-detail-bottom-pad, 0.42rem)
      var(--compact-detail-indent, 1.15rem);
  }

  .tool-body {
    display: flex;
    flex-direction: column;
    gap: var(--compact-row-gap, 0.3rem);
  }

  .row-text {
    margin: var(--compact-meta-gap, 0.14rem) 0 0;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: var(--compact-line-height, 1.4);
    color: var(--text);
    font-family: inherit;
    font-size: 0.84rem;
  }

  .token-pill {
    font-size: 0.68rem;
    color: var(--text-muted);
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
  }

  .status-pill {
    font-size: 0.68rem;
    color: var(--accent, var(--text));
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
  }

  .meta-btn {
    background: none;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.72rem;
    padding: 0.15rem 0.45rem;
  }

  .meta-btn:hover {
    color: var(--text);
    border-color: var(--border);
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

  .assistant-block:hover .preview-btn {
    opacity: 1;
  }

  .preview-btn:hover {
    color: var(--text);
    border-color: var(--border-subtle);
    background: var(--bg-panel);
    opacity: 1;
  }
</style>
