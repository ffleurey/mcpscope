<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { activeMessages, activeChatId, chatSessions, isStreaming, sendMessage, createChat } from '../chatStore'
  import { modelProfiles } from '../profileStores'
  import { listModels } from '../services/lmstudio'
  import type { LmStudioModel } from '../services/lmstudio'
  import type { ModelProfile } from '../types'
  import ChatMessageBlock from './ChatMessageBlock.svelte'

  let transcriptEl = $state<HTMLElement | null>(null)
  let textareaEl = $state<HTMLTextAreaElement | null>(null)
  let composerText = $state('')
  let selectedModelId = $state<string>('')
  let availableModels = $state<LmStudioModel[]>([])
  let selectedLmModelId = $state('')
  let modelsLoading = $state(false)

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
    session?.modelSnapshot?.modelId
      ? `${session.modelSnapshot.name} / ${session.modelSnapshot.modelId}`
      : selectedLmModelId
        ? `${$modelProfiles.find(p => p.id === selectedModelId)?.name ?? ''} / ${selectedLmModelId}`
        : 'No model selected'
  )

  async function fetchModelsForProfile(profileId: string) {
    const profile = $modelProfiles.find(p => p.id === profileId)
    if (!profile) {
      availableModels = []
      selectedLmModelId = ''
      return
    }
    modelsLoading = true
    availableModels = []
    try {
      const models = await listModels(profile.baseUrl, profile.apiKey)
      availableModels = models
      const hasPreferred = !!profile.modelId && models.some(m => m.key === profile.modelId)
      const firstLoaded = models.find(m => m.isLoaded)
      selectedLmModelId = hasPreferred
        ? profile.modelId
        : (firstLoaded?.key ?? models[0]?.key ?? '')
    } finally {
      modelsLoading = false
    }
  }

  async function handleProfileChange() {
    await fetchModelsForProfile(selectedModelId)
  }

  onMount(async () => {
    scrollToBottom()
    if ($modelProfiles.length > 0) {
      selectedModelId = $modelProfiles[0].id
      await fetchModelsForProfile(selectedModelId)
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
    if (!text || $isStreaming) return

    let profile = session?.modelSnapshot ?? $modelProfiles.find(p => p.id === selectedModelId)
    if (!profile) return

    const effectiveProfile: ModelProfile = session
      ? profile
      : { ...profile, modelId: selectedLmModelId }

    if (!effectiveProfile.modelId) return

    composerText = ''
    await tick()
    resizeTextarea()

    if (!$activeChatId) {
      await createChat(effectiveProfile)
    }

    await sendMessage(text, effectiveProfile)
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
      {#if !hasMessages}
        <div class="model-pickers">
          {#if $modelProfiles.length > 0}
            <select class="model-select" bind:value={selectedModelId} onchange={handleProfileChange} disabled={$isStreaming}>
              {#each $modelProfiles as p (p.id)}
                <option value={p.id}>{p.name}</option>
              {/each}
            </select>
          {/if}
          {#if availableModels.length > 0}
            <select class="model-select model-select-lm" bind:value={selectedLmModelId} disabled={$isStreaming || modelsLoading}>
              {#each availableModels as m (m.uid)}
                <option value={m.key}>{m.displayName}{m.isLoaded ? ' ●' : ''}</option>
              {/each}
            </select>
          {:else if modelsLoading}
            <span class="model-loading">Loading models…</span>
          {:else if $modelProfiles.length > 0}
            <span class="model-loading">No models found</span>
          {/if}
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
