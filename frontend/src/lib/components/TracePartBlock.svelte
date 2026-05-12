<script lang="ts">
  import type { PartRecord } from '../backendTypes'
  import JsonDialog from './JsonDialog.svelte'

  interface Props {
    part: PartRecord
    mode?: 'compact' | 'inspect'
  }

  const { part, mode = 'inspect' }: Props = $props()

  let showJson = $state(false)

  const labels: Record<PartRecord['partType'], string> = {
    'system-prompt': 'System prompt',
    'mcp-instructions': 'MCP instructions',
    'tool-definitions': 'Tool definitions',
    'user-message': 'User',
    'assistant-reasoning': 'Reasoning',
    'assistant-content': 'Assistant',
    'tool-call': 'Tool call',
    'tool-result': 'Tool result',
    'diagnostic-note': 'Diagnostic',
  }

  const partLabel = $derived(labels[part.partType] ?? part.partType)
  const tokenCount = $derived(part.tokens.count)
  const isEstimated = $derived(part.tokens.confidence === 'estimated' || part.tokens.confidence === 'unknown')
  function fmtTokens(count: number | null): string {
    if (count === null) return ''
    const n = count.toLocaleString()
    return isEstimated ? `~${n} tokens` : `${n} tokens`
  }
  const hasJsonPayload = $derived(part.payload.json !== null)
  const previewText = $derived.by(() => {
    if (part.payload.summary) return part.payload.summary
    if (part.payload.text) {
      return part.payload.text.replace(/\s+/g, ' ').trim()
    }
    if (part.payload.json !== null) {
      const jsonText = JSON.stringify(part.payload.json)
      return jsonText.length > 120 ? `${jsonText.slice(0, 117)}...` : jsonText
    }
    return part.context.note ?? ''
  })
  const isCollapsible = $derived(
    part.partType === 'assistant-reasoning'
    || part.partType === 'tool-call'
    || part.partType === 'tool-result'
    || part.partType === 'tool-definitions'
    || part.partType === 'mcp-instructions',
  )

  function normalizeCompactMessageText(text: string | null | undefined): string | null {
    if (!text) {
      return null
    }

    const normalized = text
      .replace(/^(?:[ \t]*\n)+/, '')
      .replace(/(?:\n[ \t]*)+$/, '')

    return normalized.length > 0 ? normalized : null
  }
</script>

<div class="part-block" class:user={part.partType === 'user-message'} class:compact={mode === 'compact'}>
  {#if mode === 'compact' && part.partType === 'user-message'}
    {@const compactText = normalizeCompactMessageText(part.payload.text)}
    <div class="user-bubble">
      {#if compactText}
        <div class="part-text-block">{compactText}</div>
      {/if}
      {#if tokenCount !== null}
        <div class="message-meta">
          <span class="token-pill">{fmtTokens(tokenCount)}</span>
        </div>
      {/if}
    </div>
  {:else if mode === 'compact'}
    <details class="part-details compact-row">
      <summary class="part-summary compact-summary">
        <span class="part-title">{partLabel}</span>
        {#if previewText}
          <span class="part-preview">{previewText}</span>
        {/if}
        {#if tokenCount !== null}
          <span class="token-pill">{fmtTokens(tokenCount)}</span>
        {/if}
      </summary>

      <div class="part-body">
        {#if part.payload.text}
          <pre class="part-text">{part.payload.text}</pre>
        {/if}

        {#if hasJsonPayload}
          <button class="raw-btn" onclick={() => { showJson = true }}>View JSON</button>
        {/if}

        {#if part.context.note}
          <div class="part-note">{part.context.note}</div>
        {/if}
      </div>
    </details>
  {:else if isCollapsible}
    <details class="part-details" open={!part.display.collapsedByDefault}>
      <summary class="part-summary">
        <span class="part-title">{partLabel}</span>
        {#if part.payload.summary}
          <span class="part-subtitle">{part.payload.summary}</span>
        {/if}
        {#if tokenCount !== null}
          <span class="token-pill">{fmtTokens(tokenCount)}</span>
        {/if}
      </summary>

      <div class="part-body">
        {#if part.payload.text}
          <pre class="part-text">{part.payload.text}</pre>
        {/if}

        {#if hasJsonPayload}
          <button class="raw-btn" onclick={() => { showJson = true }}>View JSON</button>
        {/if}

        {#if part.context.note}
          <div class="part-note">{part.context.note}</div>
        {/if}
      </div>
    </details>
  {:else}
    <div class="part-header">
      <span class="part-title">{partLabel}</span>
      {#if tokenCount !== null}
        <span class="token-pill">{fmtTokens(tokenCount)}</span>
      {/if}
    </div>

    {#if part.payload.text}
      <div class="part-text-block">{part.payload.text}</div>
    {/if}
  {/if}
</div>

{#if showJson}
  <JsonDialog
    title="{partLabel} JSON"
    data={part.payload.json}
    onClose={() => { showJson = false }}
  />
{/if}

<style>
  .part-block {
    padding: 0.75rem 0;
    border-top: 1px solid var(--border-subtle);
  }

  .part-block.compact {
    padding: 0;
    border-top: none;
  }

  .part-block:first-child {
    border-top: none;
  }

  .part-header,
  .part-summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .part-summary {
    cursor: pointer;
    list-style: none;
  }

  .part-summary::-webkit-details-marker {
    display: none;
  }

  .part-summary::before {
    content: '▶';
    font-size: 0.6rem;
    color: var(--text-muted);
    transition: transform 0.15s;
  }

  details[open] .part-summary::before {
    transform: rotate(90deg);
  }

  .part-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .part-block.compact .part-title {
    font-size: 0.68rem;
  }

  .compact-row {
    border: 1px solid transparent;
    border-radius: 6px;
  }

  .compact-row[open] {
    border-color: var(--border-subtle);
    background: color-mix(in srgb, var(--bg-panel) 78%, transparent);
  }

  .compact-summary {
    padding: var(--compact-summary-pad-y, 0.18rem) var(--compact-summary-pad-x, 0.38rem);
    border-radius: 6px;
  }

  .compact-summary:hover {
    background: color-mix(in srgb, var(--bg-panel) 62%, transparent);
  }

  .part-preview {
    min-width: 0;
    flex: 1;
    color: var(--text);
    font-size: 0.82rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .part-subtitle {
    font-size: 0.8rem;
    color: var(--text);
  }

  .token-pill {
    margin-left: auto;
    font-size: 0.68rem;
    color: var(--text-muted);
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
  }

  .part-body {
    margin-top: 0.45rem;
    padding-left: 1rem;
  }

  .part-block.compact .part-body {
    margin-top: var(--compact-meta-gap, 0.14rem);
    padding:
      0
      var(--compact-summary-pad-x, 0.38rem)
      var(--compact-detail-bottom-pad, 0.42rem);
  }

  .part-text,
  .part-text-block {
    margin: 0;
    min-width: 0;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: var(--compact-line-height, 1.4);
    color: var(--text);
    font-family: inherit;
    font-size: 0.9rem;
  }

  .part-text {
    font-style: italic;
    color: var(--text-muted);
  }

  .part-block.compact .part-text,
  .part-block.compact .part-text-block {
    font-size: 0.84rem;
    line-height: var(--compact-line-height, 1.4);
  }

  .user-bubble {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    column-gap: var(--compact-inline-gap, 0.35rem);
    background: color-mix(in srgb, var(--bg-panel) 92%, black 8%);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: var(--compact-message-pad-y, 0.38rem) var(--compact-message-pad-x, 0.72rem);
  }

  .part-note {
    margin-top: 0.45rem;
    font-size: 0.76rem;
    color: var(--text-muted);
  }

  .message-meta {
    display: flex;
    align-items: end;
  }

  .raw-btn {
    margin-top: 0.45rem;
    background: none;
    border: 1px solid var(--border-subtle);
    border-radius: 3px;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.72rem;
    padding: 0.15rem 0.45rem;
  }

  .raw-btn:hover {
    border-color: var(--border);
    color: var(--text);
  }
</style>
