<script lang="ts">
  import type { PartRecord } from '../backendTypes'
  import JsonDialog from './JsonDialog.svelte'

  interface McpTool {
    name: string
    description?: string
    inputSchema?: {
      type?: string
      properties?: Record<string, { type?: string; description?: string; enum?: unknown[] }>
      required?: string[]
    }
  }

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

  const tools = $derived.by((): McpTool[] => {
    if (part.partType !== 'tool-definitions' || !Array.isArray(part.payload.json)) return []
    return (part.payload.json as McpTool[]).filter(t => t?.name)
  })

  const toolsCharTotal = $derived(tools.reduce((sum, t) => sum + JSON.stringify(t).length, 0))

  function paramCount(tool: McpTool): number {
    return Object.keys(tool.inputSchema?.properties ?? {}).length
  }

  function estimateToolTokens(tool: McpTool): number | null {
    if (tokenCount === null || toolsCharTotal === 0) return null
    return Math.round(tokenCount * JSON.stringify(tool).length / toolsCharTotal)
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
        {#if part.partType === 'tool-definitions'}
          <span class="part-preview">({tools.length} tool{tools.length !== 1 ? 's' : ''})</span>
        {:else if previewText}
          <span class="part-preview">{previewText}</span>
        {/if}
        {#if tokenCount !== null}
          <span class="token-pill">{fmtTokens(tokenCount)}</span>
        {/if}
      </summary>

      <div class="part-body">
        {@render partBodyContent()}
      </div>
    </details>
  {:else if isCollapsible}
    <details class="part-details" open={!part.display.collapsedByDefault}>
      <summary class="part-summary">
        <span class="part-title">{partLabel}</span>
        {#if part.partType === 'tool-definitions'}
          <span class="part-subtitle">({tools.length} tool{tools.length !== 1 ? 's' : ''})</span>
        {:else if part.payload.summary}
          <span class="part-subtitle">{part.payload.summary}</span>
        {/if}
        {#if tokenCount !== null}
          <span class="token-pill">{fmtTokens(tokenCount)}</span>
        {/if}
      </summary>

      <div class="part-body">
        {@render partBodyContent()}
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

{#snippet partBodyContent()}
  {#if part.partType === 'tool-definitions' && tools.length > 0}
    <div class="tool-list">
      {#each tools as tool}
        {@const nParams = paramCount(tool)}
        {@const estTokens = estimateToolTokens(tool)}
        <details class="tool-item">
          <summary class="tool-summary">
            <span class="tool-name">{tool.name}</span>
            <span class="tool-meta">({nParams} parameter{nParams !== 1 ? 's' : ''})</span>
            {#if estTokens !== null}
              <span class="token-pill">~{estTokens.toLocaleString()} tokens</span>
            {/if}
          </summary>
          <div class="tool-detail">
            {#if tool.description}
              <div class="tool-description">{tool.description}</div>
            {/if}
            {#if tool.inputSchema?.properties && Object.keys(tool.inputSchema.properties).length > 0}
              <div class="tool-params">
                {#each Object.entries(tool.inputSchema.properties) as [paramName, param]}
                  {@const isRequired = tool.inputSchema?.required?.includes(paramName) ?? false}
                  <div class="tool-param">
                    <div class="param-header">
                      <span class="param-name">{paramName}</span>
                      <span class="param-meta">{param.type ?? 'any'}{isRequired ? ' (required)' : ''}</span>
                    </div>
                    {#if param.description}
                      <div class="param-desc">{param.description}</div>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <div class="tool-no-params">No parameters</div>
            {/if}
          </div>
        </details>
      {/each}
    </div>
  {:else if part.payload.text}
    <pre class="part-text">{part.payload.text}</pre>
  {/if}

  {#if hasJsonPayload}
    <button class="raw-btn" onclick={() => { showJson = true }}>View JSON</button>
  {/if}

  {#if part.context.note && part.partType !== 'tool-definitions'}
    <div class="part-note">{part.context.note}</div>
  {/if}
{/snippet}

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
    background: var(--bg-active);
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

  /* ── Tool definitions list ───────────────────────────────────────────── */
  .tool-list {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin-top: 0.25rem;
  }

  .tool-item {
    border: 1px solid var(--border-subtle);
    border-radius: 5px;
    overflow: hidden;
  }

  .tool-summary {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.28rem 0.5rem;
    cursor: pointer;
    list-style: none;
    border-radius: 5px;
  }

  .tool-summary::-webkit-details-marker { display: none; }

  .tool-summary::before {
    content: '▶';
    font-size: 0.55rem;
    color: var(--text-muted);
    flex-shrink: 0;
    transition: transform 0.12s;
    margin-top: 0.1rem;
  }

  .tool-item[open] > .tool-summary::before {
    transform: rotate(90deg);
  }

  .tool-summary:hover {
    background: var(--bg-hover);
  }

  .tool-name {
    font-family: var(--mono);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text);
    flex-shrink: 0;
  }

  .tool-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .tool-detail {
    padding: 0.4rem 0.7rem 0.5rem;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .tool-description {
    font-size: 0.82rem;
    color: var(--text-muted);
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .tool-params {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .tool-param {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .param-header {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
  }

  .param-name {
    font-family: var(--mono);
    font-size: 0.78rem;
    color: var(--text);
    font-weight: 500;
  }

  .param-meta {
    font-family: var(--mono);
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .param-desc {
    font-size: 0.8rem;
    color: var(--text-muted);
    padding-left: 0.6rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .tool-no-params {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-style: italic;
  }
</style>
