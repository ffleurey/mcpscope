<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { activeMessages, activeChatId, chatSessions, isStreaming, sendMessage } from '../chatStore'
  import { modelProfiles } from '../profileStores'
  import ChatMessageBlock from './ChatMessageBlock.svelte'

  let transcriptEl = $state<HTMLElement | null>(null)
  let textareaEl = $state<HTMLTextAreaElement | null>(null)
  let composerText = $state('')
  let selectedModelId = $state<string>('')

  // Derive active session from stores
  let session = $derived($chatSessions.find(s => s.id === $activeChatId) ?? null)
  let hasMessages = $derived($activeMessages.length > 0)

  // Thinking indicator: streaming but no assistant content yet
  let isThinking = $derived(
    $isStreaming &&
    $activeMessages.length > 0 &&
    $activeMessages[$activeMessages.length - 1].role === 'assistant' &&
    $activeMessages[$activeMessages.length - 1].content === ''
  )

  // Model name to display
  let displayModelName = $derived(
    session?.modelSnapshot?.name ?? $modelProfiles.find(p => p.id === selectedModelId)?.name ?? 'No model selected'
  )

  // Auto-select first model profile if none selected
  $effect(() => {
    if (!selectedModelId && $modelProfiles.length > 0) {
      selectedModelId = $modelProfiles[0].id
    }
  })

  // Scroll to bottom when messages change
  $effect(() => {
    // Track message changes
    $activeMessages
    tick().then(() => scrollToBottom())
  })

  function scrollToBottom() {
    if (transcriptEl) {
      transcriptEl.scrollTop = transcriptEl.scrollHeight
    }
  }

  function resizeTextarea() {
    if (!textareaEl) return
    textareaEl.style.height = 'auto'
    const lineHeight = 20
    const minHeight = lineHeight * 2
    const maxHeight = lineHeight * 6
    const scrollH = textareaEl.scrollHeight
    textareaEl.style.height = `${Math.min(Math.max(scrollH, minHeight), maxHeight)}px`
  }

  async function handleSend() {
    const text = composerText.trim()
    if (!text || $isStreaming) return

    let profile = session?.modelSnapshot ?? $modelProfiles.find(p => p.id === selectedModelId)
    if (!profile) return

    composerText = ''
    await tick()
    resizeTextarea()
    await sendMessage(text, profile)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      handleSend()
    }
  }

  onMount(() => {
    scrollToBottom()
  })
</script>

<div class="chat-view">
  <!-- Header -->
  <div class="chat-header">
    <span class="chat-title">{session?.title ?? 'Chat'}</span>
    <span class="chat-model">{displayModelName}</span>
  </div>

  <!-- Transcript -->
  <div class="transcript" bind:this={transcriptEl}>
    {#if $activeMessages.length === 0}
      <div class="empty-transcript">
        <span>Start a conversation…</span>
      </div>
    {:else}
      {#each $activeMessages as msg (msg.id)}
        <ChatMessageBlock
          message={msg}
          modelName={session?.modelSnapshot?.name ?? 'Assistant'}
        />
      {/each}
      {#if isThinking}
        <div class="thinking">Thinking…</div>
      {/if}
    {/if}
  </div>

  <!-- Composer -->
  <div class="composer">
    <div class="composer-input-row">
      <textarea
        bind:this={textareaEl}
        bind:value={composerText}
        placeholder="Message… (Ctrl+Enter to send)"
        rows="2"
        disabled={$isStreaming}
        oninput={resizeTextarea}
        onkeydown={handleKeydown}
      ></textarea>
      <button
        class="btn btn-primary send-btn"
        onclick={handleSend}
        disabled={$isStreaming || !composerText.trim()}
      >
        Send
      </button>
    </div>
    <div class="composer-meta">
      {#if !hasMessages && $modelProfiles.length > 0}
        <select
          class="model-select"
          bind:value={selectedModelId}
          disabled={$isStreaming}
        >
          {#each $modelProfiles as profile (profile.id)}
            <option value={profile.id}>{profile.name}</option>
          {/each}
        </select>
      {:else}
        <span class="model-label">{displayModelName}</span>
      {/if}
      <span class="hint">Ctrl+Enter to send</span>
    </div>
  </div>
</div>

<style>
  .chat-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .chat-header {
    flex-shrink: 0;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1.25rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }

  .chat-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-model {
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: nowrap;
    margin-left: 1rem;
  }

  .transcript {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.25rem;
  }

  .empty-transcript {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .thinking {
    padding: 0.75rem 0;
    color: var(--text-muted);
    font-size: 0.85rem;
    font-style: italic;
    border-top: 1px solid var(--border-subtle);
  }

  .composer {
    flex-shrink: 0;
    border-top: 1px solid var(--border);
    padding: 0.75rem 1.25rem;
    background: var(--bg);
  }

  .composer-input-row {
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
  }

  textarea {
    flex: 1;
    min-height: 40px;
    resize: none;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-family: inherit;
    font-size: 0.875rem;
    line-height: 1.5;
    padding: 0.5rem 0.75rem;
    outline: none;
    overflow-y: auto;
  }

  textarea:focus {
    border-color: #555;
  }

  textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .send-btn {
    flex-shrink: 0;
    align-self: flex-end;
  }

  .send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .composer-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.4rem;
  }

  .model-label {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .model-select {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-family: inherit;
    font-size: 0.75rem;
    padding: 0.15rem 0.4rem;
    outline: none;
    cursor: pointer;
  }

  .model-select:focus {
    border-color: #555;
  }

  .hint {
    font-size: 0.7rem;
    color: var(--text-muted);
    opacity: 0.6;
  }
</style>
