<script lang="ts">
  import { tick } from 'svelte'
  import type { ChatMessage } from '../types'
  import JsonDialog from './JsonDialog.svelte'

  interface Props {
    message: ChatMessage
    modelName?: string
  }

  const { message, modelName = 'Assistant' }: Props = $props()

  let thinkingEl = $state<HTMLElement | null>(null)
  let thinkingOpen = $state(true)
  let showRaw = $state(false)

  let thinkingLineCount = $derived(
    message.thinking?.split('\n').filter(l => l.trim()).length ?? 0
  )

  // Auto-collapse when streaming completes
  $effect(() => {
    if (message.status === 'complete' && message.thinking) {
      thinkingOpen = false
    }
  })

  // Auto-scroll thinking area to bottom while streaming
  $effect(() => {
    message.thinking  // track changes
    if (thinkingEl && thinkingOpen && message.status === 'streaming') {
      tick().then(() => {
        if (thinkingEl) thinkingEl.scrollTop = thinkingEl.scrollHeight
      })
    }
  })

  function fmt(n: number) { return n.toLocaleString() }
</script>

<div class="message" class:user={message.role === 'user'} class:assistant={message.role === 'assistant'}>
  <div class="message-label">
    {#if message.role === 'user'}
      You
    {:else}
      {modelName}
    {/if}
  </div>
  <div class="message-content">
    {#if message.status === 'error'}
      <span class="error-text">{message.errorMessage ?? 'An error occurred.'}</span>
      {#if message.content}
        <span class="partial-text">{message.content}</span>
      {/if}
    {:else}
      {#if message.thinking}
        <details class="thinking-block" bind:open={thinkingOpen}>
          <summary class="thinking-summary">
            {#if message.status === 'streaming' && !message.content}
              <span class="thinking-label thinking-active">Thinking…</span>
            {:else}
              <span class="thinking-label">Thought ({thinkingLineCount} lines)</span>
            {/if}
          </summary>
          <div class="thinking-content" bind:this={thinkingEl}>
            {message.thinking}
          </div>
        </details>
      {/if}
      {#if message.content || message.status !== 'streaming'}
        <div class="response-text">
          {message.content}<span
            class="cursor"
            class:visible={message.status === 'streaming' && message.content.length > 0}
          ></span>
        </div>
      {/if}
      {#if message.status === 'complete' && message.usage}
        {@const u = message.usage}
        <div class="stats-bar">
          <span title="Tokens in the prompt sent to the model (accumulated conversation history)">History: {fmt(u.promptTokens)}</span>
          <span class="sep">·</span>
          <span>Generated: {fmt(u.completionTokens)}{u.reasoningTokens ? ` (reasoning: ${fmt(u.reasoningTokens)})` : ''}</span>
          {#if message.trace}
            <button class="raw-btn" onclick={() => { showRaw = true }}>⋯ raw</button>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>

{#if showRaw}
  <JsonDialog
    title="Raw API usage — {message.role} message"
    data={message.trace}
    onClose={() => { showRaw = false }}
  />
{/if}

<style>
  .message {
    padding: 0.75rem 0;
    border-top: 1px solid var(--border-subtle);
  }

  .message:first-child {
    border-top: none;
  }

  .message-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 0.3rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .message-content {
    color: var(--text);
    font-size: 0.9rem;
  }

  .thinking-block {
    margin-bottom: 0.6rem;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    overflow: hidden;
  }

  .thinking-summary {
    cursor: pointer;
    padding: 0.3rem 0.6rem;
    font-size: 0.75rem;
    list-style: none;
    user-select: none;
    background: var(--bg-panel);
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .thinking-summary::-webkit-details-marker { display: none; }

  .thinking-summary::before {
    content: '▶';
    font-size: 0.6rem;
    color: var(--text-muted);
    transition: transform 0.15s;
    display: inline-block;
  }

  details[open] .thinking-summary::before {
    transform: rotate(90deg);
  }

  .thinking-label {
    color: var(--text-muted);
  }

  .thinking-label.thinking-active {
    color: var(--color-accent, #4a9eff);
  }

  .thinking-content {
    max-height: 12rem;
    overflow-y: auto;
    padding: 0.5rem 0.75rem;
    font-size: 0.82rem;
    font-style: italic;
    color: var(--text-muted);
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--bg);
    border-top: 1px solid var(--border-subtle);
  }

  .response-text {
    color: var(--text);
    font-size: 0.9rem;
    line-height: 1.65;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .stats-bar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.5rem;
    font-size: 0.72rem;
    color: var(--text-muted);
    flex-wrap: wrap;
  }
  .sep { opacity: 0.4; }
  .raw-btn {
    background: none;
    border: 1px solid var(--border-subtle);
    border-radius: 3px;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0 0.35rem;
    line-height: 1.6;
    margin-left: 0.2rem;
  }
  .raw-btn:hover { border-color: var(--border); color: var(--text); }

  .error-text {
    color: var(--color-error);
    display: block;
  }

  .partial-text {
    display: block;
    color: var(--text-muted);
    margin-top: 0.4rem;
  }

  .cursor {
    display: none;
  }

  .cursor.visible {
    display: inline-block;
    width: 2px;
    height: 1em;
    background: var(--text);
    vertical-align: text-bottom;
    margin-left: 1px;
    animation: blink 1s step-end infinite;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
</style>
