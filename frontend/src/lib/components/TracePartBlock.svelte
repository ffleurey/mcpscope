<script lang="ts">
  import type { PartRecord } from '../backendTypes'
  import JsonDialog from './JsonDialog.svelte'
  import IdBadge from './IdBadge.svelte'
  import TokenPill from './TokenPill.svelte'
  import { isEstimatedTokens, normalizeMessageText } from '../format'

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
  }

  const { part }: Props = $props()

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
  const estimated = $derived(isEstimatedTokens(part))
  const textClass = $derived(
    part.partType === 'assistant-reasoning'
      ? 'italic'
      : part.partType === 'tool-call' || part.partType === 'tool-result'
        ? 'mono'
        : '',
  )
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

  const tools = $derived.by((): McpTool[] => {
    if (part.partType !== 'tool-definitions' || !Array.isArray(part.payload.json)) return []
    return (part.payload.json as McpTool[]).filter((t) => t?.name)
  })

  const toolsCharTotal = $derived(tools.reduce((sum, t) => sum + JSON.stringify(t).length, 0))

  function paramCount(tool: McpTool): number {
    return Object.keys(tool.inputSchema?.properties ?? {}).length
  }

  function estimateToolTokens(tool: McpTool): number | null {
    if (tokenCount === null || toolsCharTotal === 0) return null
    return Math.round((tokenCount * JSON.stringify(tool).length) / toolsCharTotal)
  }
</script>

{#if part.partType === 'user-message'}
  {@const messageText = normalizeMessageText(part.payload.text)}
  <div class="user-bubble has-reveal">
    {#if messageText}
      <div class="session-text">{messageText}</div>
    {/if}
    <div class="message-meta">
      <span class="reveal-item"><IdBadge id={part.id} /></span>
      <TokenPill count={tokenCount} {estimated} onRaised />
    </div>
  </div>
{:else}
  <details class="disclosure-boxed">
    <summary class="summary-row disclosure-summary has-reveal">
      <span class="meta-label">{partLabel}</span>
      {#if part.partType === 'tool-definitions'}
        <span class="part-preview">({tools.length} tool{tools.length !== 1 ? 's' : ''})</span>
      {:else if previewText}
        <span class="part-preview">{previewText}</span>
      {/if}
      <span class="summary-meta">
        <span class="reveal-item"><IdBadge id={part.id} /></span>
        <TokenPill count={tokenCount} {estimated} />
      </span>
    </summary>

    <div class="part-body">
      {#if part.partType === 'tool-definitions' && tools.length > 0}
        <div class="tool-list">
          {#each tools as tool}
            {@const nParams = paramCount(tool)}
            {@const estTokens = estimateToolTokens(tool)}
            <details class="tool-item">
              <summary class="tool-summary disclosure-summary">
                <span class="session-text mono detail tool-name">{tool.name}</span>
                <span class="tool-meta">({nParams} parameter{nParams !== 1 ? 's' : ''})</span>
                <TokenPill count={estTokens} estimated short end />
              </summary>
              <div class="tool-detail">
                {#if tool.description}
                  <div class="session-text detail">{tool.description}</div>
                {/if}
                {#if tool.inputSchema?.properties && Object.keys(tool.inputSchema.properties).length > 0}
                  <div class="tool-params">
                    {#each Object.entries(tool.inputSchema.properties) as [paramName, param]}
                      {@const isRequired = tool.inputSchema?.required?.includes(paramName) ?? false}
                      <div class="tool-param">
                        <div class="param-header">
                          <span class="session-text mono detail param-name">{paramName}</span>
                          <span class="param-meta"
                            >{param.type ?? 'any'}{isRequired ? ' (required)' : ''}</span
                          >
                        </div>
                        {#if param.description}
                          <div class="session-text detail param-desc">{param.description}</div>
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
        <pre class="session-text detail {textClass}">{part.payload.text}</pre>
      {/if}

      {#if hasJsonPayload}
        <button
          class="btn btn-xs raw-btn"
          onclick={() => {
            showJson = true
          }}>View JSON</button
        >
      {/if}

      {#if part.context.note && part.partType !== 'tool-definitions'}
        <div class="part-note">{part.context.note}</div>
      {/if}
    </div>
  </details>
{/if}

{#if showJson}
  <JsonDialog
    title="{partLabel} JSON"
    data={part.payload.json}
    onClose={() => {
      showJson = false
    }}
  />
{/if}

<style>
  .part-preview {
    min-width: 0;
    flex: 1;
    color: var(--text-dim);
    font-size: var(--font-label);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .part-body {
    margin-top: var(--compact-meta-gap);
    padding: 0 var(--compact-summary-pad-x) var(--compact-detail-bottom-pad);
  }

  .user-bubble {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    column-gap: var(--compact-inline-gap);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: var(--compact-message-pad-y) var(--compact-message-pad-x);
  }

  .part-note {
    margin-top: 0.45rem;
    font-size: var(--font-label);
    color: var(--text-dim);
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

  /* Marker chrome comes from the global .disclosure-summary; only layout is local. */
  .tool-summary {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.28rem 0.5rem;
    border-radius: 4px;
  }

  .tool-summary:hover {
    background: var(--bg-hover);
  }

  .tool-name {
    font-weight: 600;
    flex-shrink: 0;
  }

  .tool-meta {
    font-size: var(--font-label);
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
    font-weight: 600;
  }

  .param-meta {
    font-family: var(--mono);
    font-size: var(--font-label);
    color: var(--text-dim);
  }

  .param-desc {
    padding-left: 0.6rem;
  }

  .tool-no-params {
    font-size: var(--font-label);
    color: var(--text-dim);
    font-style: italic;
  }
</style>
