<script lang="ts">
  import type { StreamingRoundState } from '../traceStreaming'

  interface Props {
    roundState: StreamingRoundState
    mode?: 'compact' | 'inspect'
  }

  const { roundState, mode = 'inspect' }: Props = $props()
</script>

{#if mode === 'compact'}
  <div class="stream-stack">
    {#if roundState.reasoningText}
      <div class="stream-live-block">
        <div class="stream-header">
          <span class="stream-label">Reasoning</span>
          <span class="status-pill">streaming</span>
        </div>
        <pre class="stream-text stream-reasoning">{roundState.reasoningText}</pre>
      </div>
    {/if}

    {#each roundState.toolCalls as toolCall (toolCall.toolCallIndex)}
      <div class="stream-tool-row">
        <span class="stream-label">Tool · {toolCall.name || 'Resolving tool name…'}</span>
        <span class="status-pill">sending</span>
      </div>
    {/each}
  </div>
{:else}
  {#if roundState.reasoningText}
    <div class="stream-block">
      <div class="stream-header">
        <span class="stream-label">Reasoning</span>
        <span class="status-pill">streaming</span>
      </div>
      <pre class="stream-text stream-reasoning">{roundState.reasoningText}</pre>
    </div>
  {/if}

  {#each roundState.toolCalls as toolCall (toolCall.toolCallIndex)}
    <div class="stream-block">
      <div class="stream-header">
        <span class="stream-label">Tool call</span>
        <span class="status-pill">streaming</span>
      </div>
      <div class="stream-tool-name">{toolCall.name || 'Resolving tool name…'}</div>
      {#if toolCall.arguments}
        <pre class="stream-text">{toolCall.arguments}</pre>
      {/if}
    </div>
  {/each}

  {#if roundState.contentText}
    <div class="stream-block">
      <div class="stream-header">
        <span class="stream-label">Assistant</span>
        <span class="status-pill">streaming</span>
      </div>
      <div class="stream-content">{roundState.contentText}</div>
    </div>
  {/if}
{/if}

<style>
  .stream-block {
    padding: 0.75rem 0;
    border-top: 1px dashed var(--border);
  }

  .stream-live-block,
  .stream-tool-row {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: color-mix(in srgb, var(--bg-surface) 78%, transparent);
    padding: var(--compact-message-pad-y, 0.38rem) var(--compact-message-pad-x, 0.72rem);
  }

  .stream-stack {
    display: flex;
    flex-direction: column;
    gap: var(--compact-stack-gap, 0.14rem);
  }

  .stream-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .stream-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* Chrome from the global .status-pill; only the layout differs here. */
  .status-pill {
    margin-left: auto;
  }

  .stream-content {
    margin-top: var(--compact-meta-gap, 0.14rem);
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
    color: var(--green-bright);
    font-size: 1rem;
    font-family: inherit;
  }

  .stream-reasoning {
    margin: var(--compact-meta-gap, 0.14rem) 0 0;
    font-style: italic;
    color: var(--green-bright);
    font-family: inherit;
    font-size: 1rem;
    line-height: 1.5;
  }

  .stream-text {
    margin: var(--compact-meta-gap, 0.14rem) 0 0;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
    color: var(--green-bright);
    font-family: var(--mono, monospace);
    font-size: 1rem;
  }

  .stream-tool-name {
    margin-top: var(--compact-meta-gap, 0.14rem);
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
    color: var(--green-bright);
    font-family: var(--mono, monospace);
    font-size: 1rem;
  }

  .stream-tool-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
</style>
