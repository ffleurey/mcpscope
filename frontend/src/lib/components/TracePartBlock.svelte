<script lang="ts">
  import type { PartRecord } from '../backendTypes'
  import JsonDialog from './JsonDialog.svelte'
  import IdBadge from './IdBadge.svelte'

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
  {#if mode === 'inspect'}
    <div class="part-id-row">
      <IdBadge id={part.id} />
    </div>
  {/if}
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
    <details class="part-details disclosure-boxed">
      <summary class="part-summary disclosure-summary">
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
      <summary class="part-summary disclosure-summary">
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
    <pre class="part-text part-{part.partType}">{part.payload.text}</pre>
  {/if}

  {#if hasJsonPayload}
    <button class="btn btn-xs raw-btn" onclick={() => { showJson = true }}>View JSON</button>
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
    border-top: 1px solid var(--border);
  }

  .part-id-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0 0 0.35rem;
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

  .part-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .part-block.compact .part-title {
    font-size: 0.68rem;
  }

  .part-preview {
    min-width: 0;
    flex: 1;
    color: var(--green-bright);
    font-size: 0.82rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .part-subtitle {
    font-size: 0.8rem;
    color: var(--green-bright);
  }

  /* Chrome comes from the global .token-pill; only the layout differs here. */
  .token-pill {
    margin-left: auto;
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

  /* ── Content text: all 1rem, differentiate only by font family/style ─ */
  .part-text-block {
    margin: 0;
    min-width: 0;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
    color: var(--green-bright);
    font-family: inherit;
    font-size: 1rem;
  }

  .part-text {
    margin: 0;
    min-width: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--green-bright);
    font-size: 1rem;
    line-height: 1.5;
  }

  /* Reasoning: sans, italic, same size */
  .part-assistant-reasoning {
    font-style: italic;
    font-family: inherit;
  }

  /* Tool calls / results: mono, same size */
  .part-tool-call,
  .part-tool-result {
    font-family: var(--mono);
    font-style: normal;
  }

  .part-block.compact .part-text,
  .part-block.compact .part-text-block {
    font-size: 1rem;
    line-height: 1.5;
  }

  .user-bubble {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    column-gap: var(--compact-inline-gap, 0.35rem);
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: var(--compact-message-pad-y, 0.38rem) var(--compact-message-pad-x, 0.72rem);
  }

  .part-note {
    margin-top: 0.45rem;
    font-size: 0.76rem;
    color: var(--green-bright);
  }

  .message-meta {
    display: flex;
    align-items: end;
  }

  /* Button chrome from .btn .btn-xs; only the layout offset is local. */
  .raw-btn {
    margin-top: 0.45rem;
  }

  /* ── Tool definitions list ───────────────────────────────────────────── */
  .tool-list {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin-top: 0.25rem;
  }

  .tool-item {
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .tool-summary {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.28rem 0.5rem;
    cursor: pointer;
    list-style: none;
    border-radius: 4px;
  }

  .tool-summary::-webkit-details-marker { display: none; }

  .tool-summary::before {
    content: '▶';
    font-size: 0.55rem;
    color: var(--text-dim);
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
    font-size: 1rem;
    font-weight: 600;
    color: var(--green-bright);
    flex-shrink: 0;
  }

  .tool-meta {
    font-size: 0.75rem;
    color: var(--text-dim);
    flex-shrink: 0;
  }

  .tool-detail {
    padding: 0.4rem 0.7rem 0.5rem;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .tool-description {
    font-size: 1rem;
    color: var(--green-bright);
    line-height: 1.5;
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
    font-size: 1rem;
    color: var(--green-bright);
    font-weight: 600;
  }

  .param-meta {
    font-family: var(--mono);
    font-size: 1rem;
    color: var(--green-bright);
  }

  .param-desc {
    font-size: 1rem;
    color: var(--green-bright);
    padding-left: 0.6rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .tool-no-params {
    font-size: 0.75rem;
    color: var(--text-dim);
    font-style: italic;
  }
</style>
