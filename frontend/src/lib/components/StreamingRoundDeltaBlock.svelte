<script lang="ts">
  import type { StreamingRoundState } from '../traceStreaming'

  interface Props {
    roundState: StreamingRoundState
  }

  const { roundState }: Props = $props()
</script>

<div class="stream-stack">
  {#if roundState.reasoningText}
    <div class="stream-live-block">
      <div class="summary-row">
        <span class="meta-label">Reasoning</span>
        <span class="pill pill-end on-raised">streaming</span>
      </div>
      <pre class="session-text detail italic stream-body">{roundState.reasoningText}</pre>
    </div>
  {/if}

  {#each roundState.toolCalls as toolCall (toolCall.toolCallIndex)}
    <div class="stream-live-block summary-row">
      <span class="meta-label">Tool</span>
      <span class="session-text mono detail">{toolCall.name || 'Resolving tool name…'}</span>
      <span class="pill pill-end on-raised">sending</span>
    </div>
  {/each}
</div>

<style>
  .stream-live-block {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-raised);
    padding: var(--compact-message-pad-y) var(--compact-message-pad-x);
  }

  .stream-stack {
    display: flex;
    flex-direction: column;
    gap: var(--compact-stack-gap);
  }

  /* Streamed body text sits a hair below its header row. */
  .stream-body {
    margin-top: var(--compact-meta-gap);
  }
</style>
