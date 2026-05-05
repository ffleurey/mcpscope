<script lang="ts">
  import type { ChatMessage } from '../types'

  interface Props {
    message: ChatMessage
    modelName?: string
  }

  const { message, modelName = 'Assistant' }: Props = $props()
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
      {message.content}<span
        class="cursor"
        class:visible={message.status === 'streaming' && message.content.length > 0}
      ></span>
    {/if}
  </div>
</div>

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
    line-height: 1.65;
    white-space: pre-wrap;
    word-break: break-word;
  }

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
