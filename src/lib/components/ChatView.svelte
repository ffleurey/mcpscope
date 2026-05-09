<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { activeMessages, activeChatId, chatSessions, isStreaming, sendMessage, createChat, abortStreaming, restoredComposerText } from '../chatStore'
  import { modelConfigs, mcpProfiles } from '../connectionStore'
  import type { ModelConfig } from '../types'
  import ChatMessageBlock from './ChatMessageBlock.svelte'
  import ContextBar from './ContextBar.svelte'
  import AbortedExchange from './AbortedExchange.svelte'

  let transcriptEl = $state<HTMLElement | null>(null)
  let textareaEl = $state<HTMLTextAreaElement | null>(null)
  let composerText = $state('')
  let selectedConfigId = $state<string>('')
  let selectedMcpProfileId = $state<string>('')  // '' = no MCP

  // Derive active session from stores
  let session = $derived($chatSessions.find(s => s.id === $activeChatId) ?? null)
  let hasMessages = $derived($activeMessages.length > 0)

  // True when the session has hit the context limit
  let isExhausted = $derived(session?.isContextExhausted === true)

  // Thinking indicator: streaming but no assistant content yet
  let isThinking = $derived(
    $isStreaming &&
    $activeMessages.length > 0 &&
    $activeMessages[$activeMessages.length - 1].role === 'assistant' &&
    $activeMessages[$activeMessages.length - 1].content === ''
  )

  // Initialization status of the current session
  let initStatus = $derived(session?.chatInitStatus ?? 'ready')
  let isInitializing = $derived(initStatus === 'pending' || initStatus === 'initializing')

  let displayModelName = $derived(
    session?.modelConfigSnapshot?.name
      ?? $modelConfigs.find(c => c.id === selectedConfigId)?.name
      ?? 'No model selected'
  )

  onMount(() => {
    scrollToBottom()
    if ($modelConfigs.length > 0) {
      selectedConfigId = $modelConfigs[0].id
    }
  })

  // When an abort restores the user's text, populate the composer and focus it
  $effect(() => {
    const text = $restoredComposerText
    if (text !== null) {
      composerText = text
      restoredComposerText.set(null)
      tick().then(() => {
        resizeTextarea()
        textareaEl?.focus()
      })
    }
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
    if (!text || $isStreaming || isExhausted || isInitializing) return

    const effectiveConfig: ModelConfig | undefined = session
      ? session.modelConfigSnapshot
      : $modelConfigs.find(c => c.id === selectedConfigId)

    if (!effectiveConfig) return

    composerText = ''
    await tick()
    resizeTextarea()

    if (!$activeChatId) {
      await createChat(effectiveConfig, selectedMcpProfileId || null)
    }

    await sendMessage(text, effectiveConfig)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      handleSend()
    }
  }
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
        {#if isInitializing}
          <span class="init-status">
            <span class="init-spinner"></span>
            {initStatus === 'initializing' ? 'Connecting to model and tools…' : 'Preparing…'}
          </span>
        {:else if initStatus === 'error'}
          <span class="init-error">⚠ Initialization had errors — some features may be unavailable</span>
        {:else}
          <span>Start a conversation…</span>
        {/if}
      </div>
    {:else}
      {#each $activeMessages as msg, i (msg.id)}
        {#if msg.status === 'aborted' && msg.role === 'user'}
          {@const next = $activeMessages[i + 1]}
          {@const abortedAssistant = next?.status === 'aborted' && next.role === 'assistant' ? next : null}
          <AbortedExchange userMsg={msg} assistantMsg={abortedAssistant} />
        {:else if msg.status === 'aborted' && msg.role === 'assistant'}
          <!-- rendered by the user AbortedExchange block above — skip -->
        {:else}
          <ChatMessageBlock
            message={msg}
            modelName={session?.modelConfigSnapshot?.name ?? 'Assistant'}
            loadedContextLength={session?.loadedContextLength ?? null}
          />
        {/if}
      {/each}
      {#if isThinking}
        <div class="thinking">Thinking…</div>
      {/if}
    {/if}
  </div>

  <!-- Context bar (above composer, below transcript) -->
  {#if hasMessages}
    <ContextBar
      messages={$activeMessages}
      loadedContextLength={session?.loadedContextLength ?? null}
      systemPromptTokens={session?.systemPromptTokens ?? null}
      toolDefinitionsTokens={session?.toolDefinitionsTokens ?? null}
    />
  {/if}

  <!-- Context exhausted banner -->
  {#if isExhausted}
    <div class="exhausted-banner">
      ⚠️ Context window full — this chat cannot continue. Start a new chat to keep experimenting.
    </div>
  {/if}

  <!-- Composer -->
  <div class="composer">
    <div class="composer-input-row">
      <textarea
        bind:this={textareaEl}
        bind:value={composerText}
        placeholder={isExhausted ? 'Context window full — start a new chat' : isInitializing ? 'Initializing…' : 'Message… (Ctrl+Enter to send)'}
        rows="2"
        disabled={$isStreaming || isExhausted || isInitializing}
        oninput={resizeTextarea}
        onkeydown={handleKeydown}
      ></textarea>
      <button
        class="btn btn-primary send-btn"
        onclick={handleSend}
        disabled={$isStreaming || isExhausted || isInitializing || !composerText.trim()}
      >
        Send
      </button>
      {#if $isStreaming}
        <button class="btn btn-stop stop-btn" onclick={abortStreaming} title="Stop generation">
          ■ Stop
        </button>
      {/if}
    </div>
    <div class="composer-meta">
      {#if !hasMessages}
        <div class="model-pickers">
          {#if $modelConfigs.length > 0}
            <select class="model-select" bind:value={selectedConfigId} disabled={$isStreaming}>
              {#each $modelConfigs as c (c.id)}
                <option value={c.id}>{c.name}</option>
              {/each}
            </select>
          {:else}
            <span class="model-loading">No model configs — create one first</span>
          {/if}
          <select class="model-select mcp-select" bind:value={selectedMcpProfileId} disabled={$isStreaming}>
            <option value="">No MCP</option>
            {#each $mcpProfiles as p (p.id)}
              <option value={p.id}>{p.name}</option>
            {/each}
          </select>
        </div>
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

  .stop-btn {
    flex-shrink: 0;
    align-self: flex-end;
    background: color-mix(in srgb, var(--danger, #c0392b) 85%, transparent);
    border-color: var(--danger, #c0392b);
    color: #fff;
    font-size: 0.8rem;
    padding: 0.4rem 0.75rem;
  }

  .stop-btn:hover {
    background: var(--danger, #c0392b);
  }

  .composer-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.4rem;
  }

  .model-pickers {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .model-loading {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .model-label {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .model-select {    background: var(--bg-input);
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

  .exhausted-banner {
    flex-shrink: 0;
    background: color-mix(in srgb, var(--danger, #c0392b) 12%, transparent);
    border-top: 1px solid color-mix(in srgb, var(--danger, #c0392b) 40%, transparent);
    color: var(--text);
    font-size: 0.8rem;
    padding: 0.5rem 1.25rem;
    text-align: center;
  }

  .init-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .init-error {
    color: var(--color-warning);
    font-size: 0.85rem;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .init-spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid var(--border);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
</style>
