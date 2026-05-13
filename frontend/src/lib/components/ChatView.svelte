<script lang="ts">
  import { tick } from 'svelte'
  import {
    activeSession,
    activeTrace,
    activeTraceLoading,
    activeTurnStream,
    chatSessions,
    exportActiveTrace,
    isSendingTurn,
    sendMessage,
  } from '../sessionStore'
  import type { StreamingRoundState } from '../traceStreaming'
  import { deriveContextSnapshotAtRound } from '../traceStreaming'
  import { patchSessionTitle } from '../api/backendClient'
  import ContextSnapshotBar from './ContextSnapshotBar.svelte'
  import NewSessionPanel from './NewSessionPanel.svelte'
  import SessionPreludeBlock from './SessionPreludeBlock.svelte'
  import SessionTurnBlock from './SessionTurnBlock.svelte'

  let transcriptEl = $state<HTMLElement | null>(null)
  let textareaEl = $state<HTMLTextAreaElement | null>(null)
  let composerText = $state('')
  let viewMode = $state<'chat' | 'inspect'>('chat')
  let stickToBottom = $state(true)
  let lastSessionId = $state<string | null>(null)
  let lastTurnCount = $state(0)
  let lastStreamingTurnId = $state<string | null>(null)
  let editingTitle = $state(false)
  let titleDraft = $state('')
  let titleInputEl = $state<HTMLInputElement | null>(null)

  let session = $derived($activeSession)
  let visibleParts = $derived.by(() =>
    ($activeTrace?.parts ?? [])
      .filter((p) => p.display.state !== 'hidden')
      .sort((a, b) => a.ordinal - b.ordinal),
  )
  let transcriptParts = $derived(visibleParts.filter((p) => p.display.state === 'transcript'))
  let sessionPreludeParts = $derived(visibleParts.filter((p) => p.turnId === null))
  let traceTurns = $derived(
    [...($activeTrace?.turns ?? [])].sort((a, b) => a.sequenceNumber - b.sequenceNumber),
  )
  let traceRounds = $derived.by(() => {
    const turnSeq = new Map(($activeTrace?.turns ?? []).map((t) => [t.id, t.sequenceNumber]))
    return [...($activeTrace?.rounds ?? [])].sort((a, b) => {
      const tA = turnSeq.get(a.turnId) ?? 0
      const tB = turnSeq.get(b.turnId) ?? 0
      return tA === tB ? a.roundIndex - b.roundIndex : tA - tB
    })
  })
  let traceRawExchanges = $derived($activeTrace?.rawExchanges ?? [])
  let partsByTurn = $derived.by(() => {
    const m = new Map<string, typeof transcriptParts>()
    for (const p of transcriptParts) {
      if (!p.turnId) continue
      m.set(p.turnId, [...(m.get(p.turnId) ?? []), p])
    }
    return m
  })
  let roundsByTurn = $derived.by(() => {
    const m = new Map<string, typeof traceRounds>()
    for (const r of traceRounds) {
      m.set(r.turnId, [...(m.get(r.turnId) ?? []), r])
    }
    return m
  })
  let rawExchangesByTurn = $derived.by(() => {
    const m = new Map<string, typeof traceRawExchanges>()
    for (const x of traceRawExchanges) {
      if (!x.turnId) continue
      m.set(x.turnId, [...(m.get(x.turnId) ?? []), x])
    }
    return m
  })
  let roundStreamsByTurn = $derived.by(() => {
    const m = new Map<string, StreamingRoundState[]>()
    for (const rs of ($activeTurnStream?.rounds ?? [])) {
      m.set(rs.turnId, [...(m.get(rs.turnId) ?? []), rs])
    }
    return m
  })
  let sessionPreludeRawExchanges = $derived(traceRawExchanges.filter((x) => x.turnId === null))

  let allParts = $derived($activeTrace?.parts ?? [])
  let contextSnapshotsByRound = $derived.by(() => {
    const m = new Map<string, ReturnType<typeof deriveContextSnapshotAtRound>>()
    for (const r of traceRounds) {
      m.set(r.id, deriveContextSnapshotAtRound(allParts, r.id, traceTurns))
    }
    return m
  })

  let activeStreamingTurnId = $derived($activeTurnStream?.turnId ?? null)
  let streamingSignature = $derived.by(() =>
    ($activeTurnStream?.rounds ?? [])
      .map((rs) =>
        [
          rs.roundId,
          rs.reasoningText.length,
          rs.completedReasoningText.length,
          rs.contentText.length,
          ...rs.toolCalls.map((tc) => `${tc.toolCallIndex}:${tc.id.length}:${tc.name.length}:${tc.arguments.length}`),
        ].join(':'),
      )
      .join('|'),
  )

  let hasTraceContent = $derived(
    isInitializing || sessionPreludeParts.length > 0 || sessionPreludeRawExchanges.length > 0 || traceTurns.length > 0,
  )
  let isExhausted = $derived(session?.isContextExhausted === true)
  let isInitializing = $derived(session != null && session.initStatus !== 'ready')
  let displayModelName = $derived(session?.modelProfileSnapshot?.name ?? '')
  let displayMcpName = $derived(session?.mcpProfileSnapshot?.name ?? null)
  let displayCompaction = $derived(session?.compactionStrategy ?? null)

  async function startEditTitle() {
    if (!session) return
    titleDraft = session.title
    editingTitle = true
    await tick()
    titleInputEl?.select()
  }

  async function commitTitleEdit() {
    if (!session || !editingTitle) return
    editingTitle = false
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== session.title) {
      await patchSessionTitle(session.id, trimmed)
      chatSessions.update((sessions) =>
        sessions.map((s) => (s.id === session!.id ? { ...s, title: trimmed } : s))
      )
    }
  }

  function cancelTitleEdit() {
    editingTitle = false
  }

  function handleTitleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); void commitTitleEdit() }
    if (e.key === 'Escape') cancelTitleEdit()
  }

  // Auto-focus textarea when turn completes
  let _wasSending = false
  $effect(() => {
    const sending = $isSendingTurn
    if (_wasSending && !sending && textareaEl && !editingTitle) {
      tick().then(() => textareaEl?.focus())
    }
    _wasSending = sending
  })

  $effect(() => {
    const sessionId = session?.id ?? null
    const turnCount = traceTurns.length
    const streamingTurnId = activeStreamingTurnId
    // access reactive dependencies so this effect re-runs
    visibleParts.length + sessionPreludeRawExchanges.length + streamingSignature.length

    const sessionChanged = sessionId !== lastSessionId
    const newTurnStarted =
      turnCount > lastTurnCount ||
      (streamingTurnId !== null && streamingTurnId !== lastStreamingTurnId)

    lastSessionId = sessionId
    lastTurnCount = turnCount
    lastStreamingTurnId = streamingTurnId

    if (sessionChanged) stickToBottom = true
    if (sessionChanged || newTurnStarted || stickToBottom) tick().then(scrollToBottom)
  })

  function scrollToBottom() {
    if (transcriptEl) transcriptEl.scrollTop = transcriptEl.scrollHeight
  }

  function handleTranscriptScroll() {
    if (!transcriptEl) return
    const dist = transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight
    stickToBottom = dist <= 24
  }

  function resizeTextarea() {
    if (!textareaEl) return
    textareaEl.style.height = 'auto'
    const scrollH = textareaEl.scrollHeight
    textareaEl.style.height = `${Math.min(Math.max(scrollH, 40), 160)}px`
  }

  async function handleSend() {
    const text = composerText.trim()
    if (!text || $isSendingTurn || isExhausted || !session) return
    composerText = ''
    await tick()
    resizeTextarea()
    await sendMessage({ userContent: text })
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      handleSend()
    }
  }
</script>

<div class="chat-view">
  {#if !session}
    <!-- ── No session: show setup panel ─────────────────────────────────── -->
    <NewSessionPanel />
  {:else}
    <!-- ── Active session ────────────────────────────────────────────────── -->
    <div class="chat-header">
      {#if editingTitle}
        <input
          class="chat-title-input"
          bind:this={titleInputEl}
          bind:value={titleDraft}
          onblur={commitTitleEdit}
          onkeydown={handleTitleKeydown}
        />
      {:else}
        <button class="chat-title" onclick={startEditTitle} title="Click to rename">
          {session.title}
        </button>
      {/if}
      <div class="view-mode-toggle">
        <button
          class="view-mode-btn"
          class:active={viewMode === 'chat'}
          onclick={() => { viewMode = 'chat' }}
          title="Chat view"
        >Chat</button>
        <button
          class="view-mode-btn"
          class:active={viewMode === 'inspect'}
          onclick={() => { viewMode = 'inspect' }}
          title="Detailed inspection layout"
        >Inspect</button>
      </div>
      {#if $activeTrace}
        <button class="btn btn-ghost export-btn" onclick={exportActiveTrace} title="Export session trace as JSON">
          ⬇ Export
        </button>
      {/if}
    </div>

    <div class="transcript" bind:this={transcriptEl} onscroll={handleTranscriptScroll}>
      {#if $activeTraceLoading}
        <div class="empty-state"><span>Loading trace…</span></div>
      {:else if !hasTraceContent}
        <div class="empty-state">
          <span class="empty-hint">Session ready — type your first message below</span>
        </div>
      {:else}
        {#if sessionPreludeParts.length > 0 || isInitializing}
          <SessionPreludeBlock
            parts={sessionPreludeParts}
            mode={viewMode}
            loadedContextLength={session.loadedContextLength ?? null}
            {isInitializing}
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
            loadedContextLength={session.loadedContextLength ?? null}
          />
        {/each}
      {/if}
    </div>

    <!-- Context bar above composer — only shown when session is ready -->
    {#if $activeTrace && !isInitializing}
      <ContextSnapshotBar
        entries={$activeTrace.context}
        contextSize={session.loadedContextLength ?? null}
        label="Context after compaction"
      />
    {/if}

    {#if isExhausted}
      <div class="exhausted-banner">
        ⚠️ Context window full — this session cannot continue. Start a new session.
      </div>
    {/if}

    <!-- Composer: hidden while initializing -->
    {#if !isInitializing}
      <div class="composer">
        <div class="composer-bubble" class:is-disabled={$isSendingTurn || isExhausted}>
          <textarea
            bind:this={textareaEl}
            bind:value={composerText}
            placeholder={
              isExhausted
                ? 'Context window full — start a new session'
                : $isSendingTurn
                ? 'Waiting for response…'
                : 'Message… (Ctrl+Enter to send)'
            }
            rows="2"
            disabled={$isSendingTurn || isExhausted}
            oninput={resizeTextarea}
            onkeydown={handleKeydown}
          ></textarea>
        </div>
        <div class="composer-footer">
          <div class="composer-config">
            <span class="config-label">
              Model: {displayModelName || '—'}
              {#if displayMcpName} · MCP: {displayMcpName}{:else} · MCP: none{/if}
              {#if displayCompaction && displayCompaction !== 'none'} · Compaction: {displayCompaction}{:else} · Compaction: none{/if}
            </span>
          </div>
          <span class="composer-hint">Ctrl+Enter to send</span>
        </div>
      </div>
    {/if}

    <!-- Context bar at the bottom — shown when session is active -->
    {#if $activeTrace && !isInitializing}
      <ContextSnapshotBar
        entries={$activeTrace.context}
        contextSize={session.loadedContextLength ?? null}
        label="Context after compaction"
      />
    {/if}
  {/if}
</div>

<style>
  .chat-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ── Header ───────────────────────────────────────────────────────────── */
  .chat-header {
    flex-shrink: 0;
    height: 40px;
    display: flex;
    align-items: center;
    gap: 0.75rem;
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
    min-width: 0;
    flex: 1;
    /* button reset */
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    cursor: text;
    border-radius: 4px;
  }

  .chat-title:hover {
    background: color-mix(in srgb, var(--bg-panel) 70%, transparent);
  }

  .chat-title-input {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text);
    background: var(--bg-panel);
    border: 1px solid var(--color-accent, #60a5fa);
    border-radius: 4px;
    padding: 0.1rem 0.35rem;
    min-width: 0;
    flex: 1;
    outline: none;
  }

  .view-mode-toggle {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
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
    opacity: 0.6;
    flex-shrink: 0;
  }
  .export-btn:hover { opacity: 1; }

  /* ── Transcript ───────────────────────────────────────────────────────── */
  .transcript {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.25rem;
  }

  .empty-state {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .empty-hint {
    color: var(--text-muted);
    font-size: 0.82rem;
  }

  /* ── Exhausted banner ─────────────────────────────────────────────────── */
  .exhausted-banner {
    flex-shrink: 0;
    background: color-mix(in srgb, var(--color-error) 10%, transparent);
    border-top: 1px solid color-mix(in srgb, var(--color-error) 35%, transparent);
    color: var(--text);
    font-size: 0.8rem;
    padding: 0.5rem 1.25rem;
    text-align: center;
  }

  /* ── Composer ─────────────────────────────────────────────────────────── */
  .composer {
    flex-shrink: 0;
    padding: 0.6rem 1.25rem 0.75rem;
    border-top: none; /* Context bar provides the visual separator */
    background: var(--bg);
  }

  /* Bubble styled to match the user message in the transcript */
  .composer-bubble {
    background: color-mix(in srgb, var(--bg-panel) 92%, black 8%);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.38rem 0.72rem;
    transition: border-color 0.15s;
  }

  .composer-bubble:focus-within {
    border-color: color-mix(in srgb, var(--color-accent) 60%, var(--border));
  }

  .composer-bubble.is-disabled {
    opacity: 0.65;
  }

  .composer-bubble textarea {
    display: block;
    width: 100%;
    min-height: 40px;
    resize: none;
    background: transparent;
    border: none;
    color: var(--text);
    font-family: inherit;
    font-size: 0.9rem;
    line-height: 1.5;
    outline: none;
    overflow-y: auto;
  }

  .composer-bubble textarea::placeholder {
    color: var(--text-muted);
    opacity: 0.7;
  }

  .composer-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 0.3rem;
    padding: 0 0.15rem;
  }

  .composer-config {
    display: flex;
    align-items: center;
    min-width: 0;
    flex: 1;
  }

  .config-label {
    font-size: 0.68rem;
    color: var(--text-muted);
    opacity: 0.75;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .composer-hint {
    font-size: 0.7rem;
    color: var(--text-muted);
    opacity: 0.55;
    flex-shrink: 0;
  }
</style>
