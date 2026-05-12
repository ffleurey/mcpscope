<script lang="ts">
  import type { ToolCallBlock } from '../types'
  import JsonDialog from './JsonDialog.svelte'

  interface Props {
    toolCall: ToolCallBlock
  }

  const { toolCall }: Props = $props()

  let open = $state(false)
  let showRaw = $state(false)
  let thinkingOpen = $state(false)

  let statusLabel = $derived.by(() => {
    switch (toolCall.status) {
      case 'pending':  return 'Pending'
      case 'running':  return 'Running…'
      case 'done':     return toolCall.isError ? 'Error' : 'Done'
      case 'error':    return 'Error'
      default:         return toolCall.status
    }
  })

  let durationMs = $derived(
    toolCall.startedAt && toolCall.completedAt
      ? toolCall.completedAt - toolCall.startedAt
      : null
  )

  let parsedArgs = $derived.by(() => {
    try { return JSON.parse(toolCall.argumentsJson || '{}') }
    catch { return toolCall.argumentsJson }
  })

  let thinkingLineCount = $derived(
    toolCall.thinkingBefore?.split('\n').filter(l => l.trim()).length ?? 0
  )
</script>

{#if toolCall.thinkingBefore}
  <details class="pre-thinking" bind:open={thinkingOpen}>
    <summary class="pre-thinking-summary">
      <span class="thinking-label">Reasoning ({thinkingLineCount} lines)</span>
    </summary>
    <div class="pre-thinking-content">{toolCall.thinkingBefore}</div>
  </details>
{/if}

<details class="tool-block" bind:open>
  <summary class="tool-summary">
    <span class="tool-icon">⚙</span>
    <span class="tool-name">{toolCall.name}</span>
    <span class="tool-status" class:running={toolCall.status === 'running'} class:error={toolCall.isError || toolCall.status === 'error'} class:done={toolCall.status === 'done' && !toolCall.isError}>
      {statusLabel}
    </span>
    {#if durationMs !== null}
      <span class="tool-duration">{durationMs}ms</span>
    {/if}
  </summary>

  <div class="tool-detail">
    <div class="tool-section-label">Arguments</div>
    <pre class="tool-pre">{typeof parsedArgs === 'string' ? parsedArgs : JSON.stringify(parsedArgs, null, 2)}</pre>

    {#if toolCall.result !== undefined}
      <div class="tool-section-label">Result {#if toolCall.isError}<span class="error-badge">error</span>{/if}</div>
      <pre class="tool-pre tool-result" class:error-result={toolCall.isError}>{toolCall.result}</pre>
    {/if}

    {#if toolCall.mcpRaw}
      <button class="raw-btn" onclick={() => { showRaw = true }}>⋯ raw MCP</button>
    {/if}
  </div>
</details>

{#if showRaw}
  <JsonDialog
    title="Raw MCP exchange — {toolCall.name}"
    data={toolCall.mcpRaw}
    onClose={() => { showRaw = false }}
  />
{/if}

<style>
  /* Reasoning block shown before the tool call */
  .pre-thinking {
    margin-bottom: 0.2rem;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    overflow: hidden;
  }

  .pre-thinking-summary {
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    font-size: 0.72rem;
    list-style: none;
    user-select: none;
    background: var(--bg-panel);
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .pre-thinking-summary::-webkit-details-marker { display: none; }

  .pre-thinking-summary::before {
    content: '▶';
    font-size: 0.55rem;
    color: var(--text-muted);
    transition: transform 0.15s;
    display: inline-block;
  }

  details[open] .pre-thinking-summary::before {
    transform: rotate(90deg);
  }

  .thinking-label { color: var(--text-muted); }

  .pre-thinking-content {
    max-height: 10rem;
    overflow-y: auto;
    padding: 0.4rem 0.65rem;
    font-size: 0.78rem;
    font-style: italic;
    color: var(--text-muted);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--bg);
    border-top: 1px solid var(--border-subtle);
  }

  /* Tool call block */
  .tool-block {
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    margin-bottom: 0.4rem;
    overflow: hidden;
  }

  .tool-summary {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.6rem;
    font-size: 0.78rem;
    cursor: pointer;
    background: var(--bg-panel);
    list-style: none;
    user-select: none;
  }

  .tool-summary::-webkit-details-marker { display: none; }

  .tool-summary::before {
    content: '▶';
    font-size: 0.58rem;
    color: var(--text-muted);
    transition: transform 0.15s;
    display: inline-block;
  }

  details[open] .tool-summary::before {
    transform: rotate(90deg);
  }

  .tool-icon {
    font-size: 0.75rem;
    opacity: 0.6;
  }

  .tool-name {
    font-weight: 600;
    font-family: var(--font-mono, monospace);
    color: var(--token-tool-call, #e8a000);
  }

  .tool-status {
    margin-left: auto;
    font-size: 0.68rem;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--border-subtle);
  }

  .tool-status.running { color: var(--color-accent, #4a9eff); border-color: var(--color-accent, #4a9eff); }
  .tool-status.done    { color: #4caf50; border-color: #4caf50; }
  .tool-status.error   { color: var(--color-error, #e74c3c); border-color: var(--color-error, #e74c3c); }

  .tool-duration {
    font-size: 0.65rem;
    color: var(--text-muted);
  }

  .tool-detail {
    padding: 0.5rem 0.75rem;
    border-top: 1px solid var(--border-subtle);
    background: var(--bg);
  }

  .tool-section-label {
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.2rem;
    margin-top: 0.4rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .tool-section-label:first-child { margin-top: 0; }

  .tool-pre {
    font-size: 0.78rem;
    font-family: var(--font-mono, monospace);
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 3px;
    padding: 0.4rem 0.6rem;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--text);
    margin: 0;
    max-height: 12rem;
    overflow-y: auto;
  }

  .tool-result { color: var(--text); }
  .error-result { color: var(--color-error, #e74c3c); }

  .error-badge {
    font-size: 0.62rem;
    background: var(--color-error, #e74c3c);
    color: white;
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    text-transform: none;
    font-weight: normal;
    letter-spacing: 0;
  }

  .raw-btn {
    background: none;
    border: 1px solid var(--border-subtle);
    border-radius: 3px;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0 0.35rem;
    line-height: 1.6;
    margin-top: 0.4rem;
  }
  .raw-btn:hover { border-color: var(--border); color: var(--text); }
</style>
