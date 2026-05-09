<script lang="ts">
  import type { ChatMessage } from '../types'

  interface Props {
    userMsg: ChatMessage
    assistantMsg: ChatMessage | null
  }

  const { userMsg, assistantMsg }: Props = $props()

  // Preview: first ~80 chars of the user message
  let preview = $derived(
    userMsg.content.length > 80
      ? userMsg.content.slice(0, 80).trimEnd() + '…'
      : userMsg.content
  )

  let hasPartial = $derived(
    !!(assistantMsg?.content || assistantMsg?.thinking)
  )
</script>

<details class="aborted-exchange">
  <summary class="aborted-summary">
    <span class="aborted-icon">⊘</span>
    <span class="aborted-label">Aborted</span>
    <span class="aborted-preview">{preview}</span>
  </summary>

  <div class="aborted-body">
    <div class="aborted-user">
      <span class="role-label">You</span>
      <p class="aborted-text">{userMsg.content}</p>
    </div>

    {#if hasPartial}
      <div class="aborted-assistant">
        <span class="role-label">Assistant (partial)</span>
        {#if assistantMsg?.thinking}
          <p class="aborted-thinking">{assistantMsg.thinking}</p>
        {/if}
        {#if assistantMsg?.content}
          <p class="aborted-text">{assistantMsg.content}</p>
        {/if}
      </div>
    {:else}
      <p class="aborted-no-response">No response received before stop.</p>
    {/if}
  </div>
</details>

<style>
  .aborted-exchange {
    margin: 0.35rem 0;
    border: 1px solid color-mix(in srgb, var(--text-muted) 20%, transparent);
    border-radius: 4px;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .aborted-summary {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.6rem;
    cursor: pointer;
    user-select: none;
    list-style: none;
    outline: none;
  }

  .aborted-summary::-webkit-details-marker { display: none; }

  .aborted-summary:hover {
    background: color-mix(in srgb, var(--text-muted) 6%, transparent);
    border-radius: 3px;
  }

  .aborted-icon {
    font-size: 0.85rem;
    opacity: 0.7;
  }

  .aborted-label {
    font-weight: 600;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.7;
    flex-shrink: 0;
  }

  .aborted-preview {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.6;
    font-style: italic;
  }

  .aborted-body {
    padding: 0.5rem 0.75rem 0.6rem;
    border-top: 1px solid color-mix(in srgb, var(--text-muted) 15%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .role-label {
    display: block;
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.6;
    margin-bottom: 0.2rem;
  }

  .aborted-text {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
    opacity: 0.8;
  }

  .aborted-thinking {
    margin: 0 0 0.3rem;
    white-space: pre-wrap;
    word-break: break-word;
    font-style: italic;
    opacity: 0.6;
    font-size: 0.75rem;
  }

  .aborted-no-response {
    margin: 0;
    font-style: italic;
    opacity: 0.55;
  }
</style>
