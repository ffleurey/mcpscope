<script lang="ts">
  import { tick } from 'svelte'
  import { modelConfigs, mcpProfiles } from '../connectionStore'
  import { lmConnections } from '../connectionStore'
  import {
    activeSession,
    activeTrace,
    activeTraceLoading,
    activeTurnStream,
    exportActiveTrace,
    isSendingTurn,
    sendMessage,
    sessionError,
  } from '../sessionStore'
  import type { StreamingRoundState } from '../traceStreaming'
  import { deriveContextSnapshotAtRound } from '../traceStreaming'
  import type { ModelConfig } from '../types'
  import ContextSnapshotBar from './ContextSnapshotBar.svelte'
  import SessionPreludeBlock from './SessionPreludeBlock.svelte'
  import SessionTurnBlock from './SessionTurnBlock.svelte'

  let transcriptEl = $state<HTMLElement | null>(null)
  let textareaEl = $state<HTMLTextAreaElement | null>(null)
  let composerText = $state('')
  let selectedConfigId = $state<string>('')
  let selectedMcpProfileId = $state<string>('')
  let viewMode = $state<'compact' | 'inspect'>('compact')
  let stickToBottom = $state(true)
  let lastSessionId = $state<string | null>(null)
  let lastTurnCount = $state(0)
  let lastStreamingTurnId = $state<string | null>(null)
  let session = $derived($activeSession)
  let visibleParts = $derived.by(() => (
    ($activeTrace?.parts ?? [])
      .filter((part) => part.display.state !== 'hidden')
      .sort((left, right) => left.ordinal - right.ordinal)
  ))
  let transcriptParts = $derived.by(() => (
    visibleParts.filter((part) => part.display.state === 'transcript')
  ))
  let sessionPreludeParts = $derived(visibleParts.filter((part) => part.turnId === null))
  let traceTurns = $derived.by(() => (
    [...($activeTrace?.turns ?? [])].sort((left, right) => left.sequenceNumber - right.sequenceNumber)
  ))
  let traceRounds = $derived.by(() => (
    [...($activeTrace?.rounds ?? [])].sort((left, right) => {
      const leftTurn = $activeTrace?.turns.find((turn) => turn.id === left.turnId)?.sequenceNumber ?? 0
      const rightTurn = $activeTrace?.turns.find((turn) => turn.id === right.turnId)?.sequenceNumber ?? 0
      return leftTurn === rightTurn
        ? left.roundIndex - right.roundIndex
        : leftTurn - rightTurn
    })
  ))
  let traceRawExchanges = $derived($activeTrace?.rawExchanges ?? [])
  let partsByTurn = $derived.by(() => {
    const grouped = new Map<string, typeof transcriptParts>()
    for (const part of transcriptParts) {
      if (!part.turnId) continue
      const current = grouped.get(part.turnId) ?? []
      current.push(part)
      grouped.set(part.turnId, current)
    }
    return grouped
  })
  let roundsByTurn = $derived.by(() => {
    const grouped = new Map<string, typeof traceRounds>()
    for (const round of traceRounds) {
      const current = grouped.get(round.turnId) ?? []
      current.push(round)
      grouped.set(round.turnId, current)
    }
    return grouped
  })
  let rawExchangesByTurn = $derived.by(() => {
    const grouped = new Map<string, typeof traceRawExchanges>()
    for (const exchange of traceRawExchanges) {
      if (!exchange.turnId) continue
      const current = grouped.get(exchange.turnId) ?? []
      current.push(exchange)
      grouped.set(exchange.turnId, current)
    }
    return grouped
  })
  let roundStreamsByTurn = $derived.by(() => {
    const grouped = new Map<string, StreamingRoundState[]>()
    for (const roundState of ($activeTurnStream?.rounds ?? [])) {
      const current = grouped.get(roundState.turnId) ?? []
      current.push(roundState)
      grouped.set(roundState.turnId, current)
    }
    return grouped
  })
  let sessionPreludeRawExchanges = $derived(traceRawExchanges.filter((exchange) => exchange.turnId === null))

  // Per-round context snapshots — used to show a context bar after each round.
  let allParts = $derived($activeTrace?.parts ?? [])
  let contextSnapshotsByRound = $derived.by(() => {
    const result = new Map<string, ReturnType<typeof deriveContextSnapshotAtRound>>()
    for (const round of traceRounds) {
      result.set(round.id, deriveContextSnapshotAtRound(allParts, round.id, traceTurns))
    }
    return result
  })
  let activeStreamingTurnId = $derived($activeTurnStream?.turnId ?? null)
  let streamingSignature = $derived.by(() => (
    ($activeTurnStream?.rounds ?? [])
      .map((roundState) => [
        roundState.roundId,
        roundState.reasoningText.length,
        roundState.completedReasoningText.length,
        roundState.contentText.length,
        ...roundState.toolCalls.map((toolCall) => (
          `${toolCall.toolCallIndex}:${toolCall.id.length}:${toolCall.name.length}:${toolCall.arguments.length}`
        )),
      ].join(':'))
      .join('|')
  ))
  let hasTraceContent = $derived(
    sessionPreludeParts.length > 0
      || sessionPreludeRawExchanges.length > 0
      || traceTurns.length > 0,
  )
  let hasMessages = $derived(traceTurns.length > 0)

  // True when the session has hit the context limit
  let isExhausted = $derived(session?.isContextExhausted === true)

  let displayModelName = $derived(
    session?.modelProfileSnapshot?.name
      ?? $modelConfigs.find(c => c.id === selectedConfigId)?.name
      ?? 'No model selected'
  )

  $effect(() => {
    if (!$modelConfigs.some((config) => config.id === selectedConfigId)) {
      selectedConfigId = $modelConfigs[0]?.id ?? ''
    }
  })

  $effect(() => {
    if (!$mcpProfiles.some((profile) => profile.id === selectedMcpProfileId)) {
      selectedMcpProfileId = ''
    }
  })

  $effect(() => {
    const sessionId = session?.id ?? null
    const turnCount = traceTurns.length
    const streamingTurnId = activeStreamingTurnId
    visibleParts.length + sessionPreludeRawExchanges.length + streamingSignature.length

    const sessionChanged = sessionId !== lastSessionId
    const newTurnStarted = turnCount > lastTurnCount
      || (streamingTurnId !== null && streamingTurnId !== lastStreamingTurnId)

    lastSessionId = sessionId
    lastTurnCount = turnCount
    lastStreamingTurnId = streamingTurnId

    if (sessionChanged) {
      stickToBottom = true
    }

    if (sessionChanged || newTurnStarted || stickToBottom) {
      tick().then(scrollToBottom)
    }
  })

  function scrollToBottom() {
    if (transcriptEl) {
      transcriptEl.scrollTop = transcriptEl.scrollHeight
    }
  }

  function isNearBottom(): boolean {
    if (!transcriptEl) return true
    const distanceFromBottom = transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight
    return distanceFromBottom <= 24
  }

  function handleTranscriptScroll(): void {
    stickToBottom = isNearBottom()
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
    if (!text || $isSendingTurn || isExhausted) return

    let draftSelection:
      | {
          modelConfig: ModelConfig
          connection: typeof $lmConnections[number]
          mcpProfile: typeof $mcpProfiles[number] | null
        }
      | undefined

    if (!session) {
      const effectiveConfig = $modelConfigs.find(c => c.id === selectedConfigId)
      if (!effectiveConfig) return

      const connection = $lmConnections.find((item) => item.id === effectiveConfig.connectionId)
      if (!connection) return

      draftSelection = {
        modelConfig: effectiveConfig,
        connection,
        mcpProfile: $mcpProfiles.find((profile) => profile.id === selectedMcpProfileId) ?? null,
      }
    }

    composerText = ''
    await tick()
    resizeTextarea()
    await sendMessage({
      userContent: text,
      draftSelection,
    })
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
    <span class="chat-title">{session?.title ?? 'New session'}</span>
    <span class="chat-model">{displayModelName}</span>
    <div class="view-mode-toggle">
      <button
        class="view-mode-btn"
        class:active={viewMode === 'compact'}
        onclick={() => { viewMode = 'compact' }}
        title="Use the compact chat layout"
      >
        Chat
      </button>
      <button
        class="view-mode-btn"
        class:active={viewMode === 'inspect'}
        onclick={() => { viewMode = 'inspect' }}
        title="Use the detailed inspection layout"
      >
        Inspect
      </button>
    </div>
    {#if $activeTrace}
      <button class="btn btn-ghost export-btn" onclick={exportActiveTrace} title="Export the canonical session trace as JSON">⬇ Export</button>
    {/if}
  </div>

  <!-- Transcript -->
  <div class="transcript" bind:this={transcriptEl} onscroll={handleTranscriptScroll}>
    {#if $activeTraceLoading}
      <div class="empty-transcript">
        <span>Loading trace…</span>
      </div>
    {:else if !hasTraceContent}
      <div class="empty-transcript">
        {#if $sessionError}
          <span class="init-error">{$sessionError}</span>
        {:else}
          <span>Start a session…</span>
        {/if}
      </div>
    {:else}
      {#if sessionPreludeParts.length > 0}
        <SessionPreludeBlock
          parts={sessionPreludeParts}
          rawExchanges={sessionPreludeRawExchanges}
          mode={viewMode}
        />
      {/if}

      {#each traceTurns as turn (turn.id)}
        <SessionTurnBlock
          {turn}
          rounds={roundsByTurn.get(turn.id) ?? []}
          parts={partsByTurn.get(turn.id) ?? []}
          rawExchanges={rawExchangesByTurn.get(turn.id) ?? []}
          roundStreams={roundStreamsByTurn.get(turn.id) ?? []}
          mode={viewMode}
          {contextSnapshotsByRound}
          loadedContextLength={session?.loadedContextLength ?? null}
        />
      {/each}
    {/if}
  </div>

  <!-- Context bar (above composer, below transcript) -->
  {#if $activeTrace}
    <ContextSnapshotBar
      entries={$activeTrace.context}
      contextSize={session?.loadedContextLength ?? null}
    />
  {/if}

  <!-- Context exhausted banner -->
  {#if isExhausted}
    <div class="exhausted-banner">
      ⚠️ Context window full — this session cannot continue. Start a new session to keep experimenting.
    </div>
  {/if}

  <!-- Composer -->
  <div class="composer">
    <div class="composer-input-row">
        <textarea
          bind:this={textareaEl}
          bind:value={composerText}
          placeholder={isExhausted ? 'Context window full — start a new session' : 'Message… (Ctrl+Enter to send)'}
          rows="2"
          disabled={$isSendingTurn || isExhausted}
          oninput={resizeTextarea}
          onkeydown={handleKeydown}
        ></textarea>
        <button
          class="btn btn-primary send-btn"
          onclick={handleSend}
          disabled={$isSendingTurn || isExhausted || !composerText.trim()}
        >
          {$isSendingTurn ? 'Sending…' : 'Send'}
        </button>
      </div>
      <div class="composer-meta">
        {#if !hasMessages}
        <div class="model-pickers">
          {#if $modelConfigs.length > 0}
            <select class="model-select" bind:value={selectedConfigId} disabled={$isSendingTurn}>
              {#each $modelConfigs as c (c.id)}
                <option value={c.id}>{c.name}</option>
              {/each}
            </select>
          {:else}
            <span class="model-loading">No model configs — create one first</span>
          {/if}
          <select class="model-select mcp-select" bind:value={selectedMcpProfileId} disabled={$isSendingTurn}>
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

  .view-mode-toggle {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: auto;
  }

  .view-mode-btn {
    background: none;
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0.18rem 0.5rem;
  }

  .view-mode-btn.active {
    color: var(--text);
    border-color: var(--border);
    background: color-mix(in srgb, var(--bg-panel) 85%, transparent);
  }

  .export-btn {
    font-size: 0.72rem;
    padding: 0.2rem 0.55rem;
    margin-left: 0.75rem;
    margin-right: 0.75rem;
    opacity: 0.6;
  }
  .export-btn:hover { opacity: 1; }

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

  .init-error {
    color: var(--color-warning);
    font-size: 0.85rem;
  }
</style>
