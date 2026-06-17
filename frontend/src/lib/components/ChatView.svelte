<script lang="ts">
  import { tick } from 'svelte'
  import type { StepRecord, TurnRecord } from '../backendTypes'
  import {
    activeSession,
    activeTrace,
    activeTraceLoading,
    activeTurnStream,
    chatSessions,
    executeAnalysis,
    executeAnalysisStep,
    exportActiveTrace,
    isRetryingAnalysis,
    isSendingTurn,
    retryFailedAnalysisStep,
    retryInit,
    sendMessage,
  } from '../sessionStore'
  import { appVersion } from '../connectionStore'
  import { schedulerSnapshot } from '../executionStore'
  import { sessionHasQueuedOrActiveJob } from '../executionSelectors'
  import type { StreamingRoundState } from '../traceStreaming'
  import { deriveContextSnapshotAtRound } from '../traceStreaming'
  import { patchSessionTitle } from '../api/backendClient'
  import AnalysisWorkflowBlock from './AnalysisWorkflowBlock.svelte'
  import ContextSnapshotBar from './ContextSnapshotBar.svelte'
  import IdBadge from './IdBadge.svelte'
  import NewSessionPanel from './NewSessionPanel.svelte'
  import SessionCompactionStepBlock from './SessionCompactionStepBlock.svelte'
  import SessionPreludeBlock from './SessionPreludeBlock.svelte'
  import SessionTurnBlock from './SessionTurnBlock.svelte'

  type TimelineItem =
    | {
        kind: 'turn'
        id: string
        timelineKey: string
        sortTime: number
        turn: TurnRecord
      }
    | {
        kind: 'step'
        id: string
        timelineKey: string
        sortTime: number
        step: StepRecord
      }

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
  let traceSteps = $derived(
    [...($activeTrace?.steps ?? [])].sort((a, b) => a.childIndex - b.childIndex),
  )
  let visibleParts = $derived.by(() =>
    ($activeTrace?.parts ?? [])
      .filter((p) => p.display.state !== 'hidden')
      .sort((a, b) => a.ordinal - b.ordinal),
  )
  let transcriptParts = $derived(visibleParts.filter((p) => p.display.state === 'transcript'))
  let sessionPreludeParts = $derived(visibleParts.filter((p) => p.turnId === null))
  let traceTurns = $derived(
    [...($activeTrace?.turns ?? [])].sort((a, b) => a.turnNumber - b.turnNumber),
  )
  let renderableSteps = $derived(traceSteps)
  let analysisWorkflowSteps = $derived($activeTrace?.workflowSteps ?? [])
  let analysisLooseTurns = $derived.by(() =>
    isAnalysisSession ? traceTurns.filter((turn) => turn.ownerStepId === null) : [],
  )
  let traceRounds = $derived.by(() => {
    const turnSeq = new Map(($activeTrace?.turns ?? []).map((t) => [t.id, t.turnNumber]))
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
  let roundStreamsByTurn = $derived.by(() => {
    const m = new Map<string, StreamingRoundState[]>()
    for (const rs of $activeTurnStream?.rounds ?? []) {
      m.set(rs.turnId, [...(m.get(rs.turnId) ?? []), rs])
    }
    return m
  })
  let sessionPreludeRawExchanges = $derived(traceRawExchanges.filter((x) => x.turnId === null))
  let sessionHasExecutionJob = $derived.by(() => {
    return sessionHasQueuedOrActiveJob($schedulerSnapshot, session?.id)
  })
  let analysisRunDisabled = $derived(sessionHasExecutionJob || $isRetryingAnalysis)
  let timelineItems = $derived.by((): TimelineItem[] => {
    const items: TimelineItem[] = [
      ...traceTurns.map((turn) => ({
        kind: 'turn' as const,
        id: turn.id,
        timelineKey: `turn:${turn.id}`,
        sortTime: turn.createdAt,
        turn,
      })),
      ...renderableSteps.map((step) => ({
        kind: 'step' as const,
        id: step.id,
        timelineKey: `step:${step.id}`,
        sortTime: step.createdAt,
        step,
      })),
    ]

    items.sort((left, right) => {
      if (left.sortTime !== right.sortTime) {
        return left.sortTime - right.sortTime
      }
      if (left.kind !== right.kind) {
        return left.kind === 'step' ? -1 : 1
      }
      if (left.kind === 'step' && right.kind === 'step') {
        return left.step.childIndex - right.step.childIndex
      }
      if (left.kind === 'turn' && right.kind === 'turn') {
        return left.turn.turnNumber - right.turn.turnNumber
      }
      return left.id.localeCompare(right.id)
    })

    return items
  })

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
          ...rs.toolCalls.map(
            (tc) => `${tc.toolCallIndex}:${tc.id.length}:${tc.name.length}:${tc.arguments.length}`,
          ),
        ].join(':'),
      )
      .join('|'),
  )

  let isInitializing = $derived(
    session != null &&
      (session.init_status === 'pending' || session.init_status === 'initializing'),
  )
  let isInitError = $derived(session != null && session.init_status === 'error')
  let isAnalysisSession = $derived(session?.session_type === 'session_analysis')
  let analysisPhase = $derived.by(() => {
    if (!isAnalysisSession) return null
    return session?.workflow_phase ?? null
  })
  let analysisWorkflowKind = $derived.by(() => {
    if (!isAnalysisSession) return null
    return session?.workflow_kind ?? null
  })
  let analysisWorkflowLabel = $derived.by(() => {
    switch (analysisWorkflowKind) {
      case 'full_session_analysis':
        return 'Full Analysis'
      case 'fast_session_analysis':
        return 'Fast Session Analysis'
      case 'fast_tool_analysis':
        return 'Fast Tool Analysis'
      default:
        return 'Analysis session'
    }
  })
  let analysisLatestError = $derived(isAnalysisSession ? (session?.latest_error ?? null) : null)
  let analysisPlanProgress = $derived(isAnalysisSession ? (session?.plan_progress ?? null) : null)
  let analysisComplete = $derived(analysisPhase === 'complete')
  let analysisFailed = $derived(analysisPhase === 'error' || session?.status === 'error')
  let hasTraceContent = $derived(
    isInitializing ||
      sessionPreludeParts.length > 0 ||
      sessionPreludeRawExchanges.length > 0 ||
      timelineItems.length > 0 ||
      analysisWorkflowSteps.length > 0 ||
      analysisLooseTurns.length > 0,
  )
  let isExhausted = $derived(session?.is_context_exhausted === true)
  let displayModelName = $derived(session?.model_profile_snapshot?.name ?? '')
  let displayMcpNames = $derived(session?.mcp_profile_snapshots?.map((s) => s.name) ?? [])
  let displayCompaction = $derived(session?.compaction_strategy ?? null)

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
        sessions.map((s) => (s.id === session!.id ? { ...s, title: trimmed } : s)),
      )
    }
  }

  function cancelTitleEdit() {
    editingTitle = false
  }

  function handleTitleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commitTitleEdit()
    }
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
    if (!text || sessionHasExecutionJob || isExhausted || !session) return
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
      <IdBadge id={session.id} />
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
          onclick={() => {
            viewMode = 'chat'
          }}
          title="Chat view">Chat</button
        >
        <button
          class="view-mode-btn"
          class:active={viewMode === 'inspect'}
          onclick={() => {
            viewMode = 'inspect'
          }}
          title="Detailed inspection layout">Inspect</button
        >
      </div>

      {#if $activeTrace}
        <button
          class="btn export-btn"
          onclick={exportActiveTrace}
          title="Export session trace as JSON"
        >
          ⬇ Export
        </button>
      {/if}
    </div>

    <div class="transcript" bind:this={transcriptEl} onscroll={handleTranscriptScroll}>
      {#if $activeTraceLoading}
        <div class="empty-state"><span>Loading trace…</span></div>
      {:else if !hasTraceContent}
        <div class="empty-state">
          {#if isAnalysisSession}
            <span class="empty-hint"
              >{analysisWorkflowLabel} ready — click Run Analysis to start</span
            >
          {:else}
            <span class="empty-hint">Session ready — type your first message below</span>
          {/if}
        </div>
      {:else}
        {#if sessionPreludeParts.length > 0 || isInitializing}
          <SessionPreludeBlock
            parts={sessionPreludeParts}
            mode={viewMode}
            loadedContextLength={session.loaded_context_length ?? null}
            {isInitializing}
          />
        {/if}
        {#if isInitError}
          <div class="init-error-banner">
            Session initialization failed.
            <button class="btn btn-sm" onclick={() => retryInit(session.id)}
              >↻ Retry initialization</button
            >
          </div>
        {/if}
        {#if isAnalysisSession}
          {#each analysisWorkflowSteps as workflowStep (workflowStep.step.id)}
            <AnalysisWorkflowBlock
              {workflowStep}
              {roundsByTurn}
              {partsByTurn}
              {roundStreamsByTurn}
              {contextSnapshotsByRound}
              mode={viewMode}
              loadedContextLength={session.loaded_context_length ?? null}
            />
          {/each}

          {#each analysisLooseTurns as turn (turn.id)}
            <SessionTurnBlock
              {turn}
              rounds={roundsByTurn.get(turn.id) ?? []}
              parts={partsByTurn.get(turn.id) ?? []}
              roundStreams={roundStreamsByTurn.get(turn.id) ?? []}
              mode={viewMode}
              {contextSnapshotsByRound}
              loadedContextLength={session.loaded_context_length ?? null}
            />
          {/each}
        {:else}
          {#each timelineItems as item (item.timelineKey)}
            {#if item.kind === 'turn'}
              <SessionTurnBlock
                turn={item.turn}
                rounds={roundsByTurn.get(item.turn.id) ?? []}
                parts={partsByTurn.get(item.turn.id) ?? []}
                roundStreams={roundStreamsByTurn.get(item.turn.id) ?? []}
                mode={viewMode}
                {contextSnapshotsByRound}
                loadedContextLength={session.loaded_context_length ?? null}
              />
            {:else if item.step.stepTypeKey === 'compaction'}
              <SessionCompactionStepBlock step={item.step} parts={[]} mode={viewMode} />
            {/if}
          {/each}
        {/if}
      {/if}
    </div>

    {#if isExhausted}
      <div class="exhausted-banner">
        ⚠️ Context window full — this session cannot continue. Start a new session.
      </div>
    {/if}

    <!-- Composer: hidden while initializing or after init error -->
    {#if !isInitializing && !isInitError}
      {#if isAnalysisSession}
        <!-- ── Analysis control bar ──────────────────────────────────── -->
        <div class="analysis-bar">
          <div class="analysis-bar-info">
            <span class="analysis-bar-label">{analysisWorkflowLabel}</span>
            {#if analysisPhase}
              <span class="analysis-bar-phase">Phase: <strong>{analysisPhase}</strong></span>
            {/if}
            {#if analysisPlanProgress && analysisPlanProgress.total > 0 && !analysisComplete && !analysisFailed}
              <span class="analysis-bar-progress">
                Step {analysisPlanProgress.completed + 1} / {analysisPlanProgress.total}
                {#if analysisPlanProgress.currentCommandKind === 'assess'}
                  <span class="analysis-bar-command">Assessing…</span>
                {:else if analysisPlanProgress.currentCommandKind === 'turn_summary'}
                  <span class="analysis-bar-command">Summarizing…</span>
                {:else if analysisPlanProgress.currentCommandKind === 'bootstrap'}
                  <span class="analysis-bar-command">Bootstrap…</span>
                {:else if analysisPlanProgress.currentCommandKind === 'coverage'}
                  <span class="analysis-bar-command">Coverage check…</span>
                {:else if analysisPlanProgress.currentCommandKind === 'final_aggregation'}
                  <span class="analysis-bar-command">Building report…</span>
                {/if}
              </span>
              <div class="analysis-bar-progress-bar">
                <div
                  class="analysis-bar-progress-fill"
                  style="width: {Math.round(
                    (analysisPlanProgress.completed / analysisPlanProgress.total) * 100,
                  )}%"
                ></div>
              </div>
            {/if}
            {#if analysisLatestError}
              <span class="analysis-bar-error">
                Failure: {analysisLatestError.message}
                {#if analysisLatestError.error_kind}
                  <em>({analysisLatestError.error_kind})</em>
                {/if}
              </span>
            {/if}
          </div>
          {#if !analysisComplete}
            <button
              class="btn btn-primary"
              disabled={analysisRunDisabled}
              onclick={() => void executeAnalysis()}
            >
              {sessionHasExecutionJob ? '⏳ Queued…' : '▶ Run Analysis'}
            </button>
            {#if analysisFailed}
              <button
                class="btn"
                disabled={analysisRunDisabled}
                onclick={() => void retryFailedAnalysisStep()}
                title="Reset the failed cursor phase and rerun the failed step once"
              >
                {$isRetryingAnalysis ? '⏳ Retrying…' : '↻ Retry failed step'}
              </button>
            {/if}
            {#if viewMode === 'inspect'}
              <button
                class="btn"
                disabled={analysisRunDisabled}
                onclick={() => void executeAnalysisStep()}
                title="Advance one workflow step (debug)"
              >
                {sessionHasExecutionJob ? '⏳ Queued…' : '⏭ Step (Debug)'}
              </button>
            {/if}
          {:else}
            <span class="analysis-bar-done">✓ Analysis complete</span>
          {/if}
        </div>
      {:else}
        <div class="composer">
          <div class="composer-bubble" class:is-disabled={sessionHasExecutionJob || isExhausted}>
            <textarea
              bind:this={textareaEl}
              bind:value={composerText}
              placeholder={isExhausted
                ? 'Context window full — start a new session'
                : sessionHasExecutionJob
                  ? 'Queued or running for this session…'
                  : 'Message… (Ctrl+Enter to send)'}
              rows="2"
              disabled={sessionHasExecutionJob || isExhausted}
              oninput={resizeTextarea}
              onkeydown={handleKeydown}></textarea>
          </div>
          <div class="composer-footer">
            <div class="composer-config">
              <span class="config-label">
                Model: {displayModelName || '—'}
                {#if displayMcpNames.length > 0}
                  · MCP: {displayMcpNames.join(', ')}{:else}
                  · MCP: none{/if}
                {#if displayCompaction && displayCompaction !== 'none'}
                  · Compaction: {displayCompaction}{:else}
                  · Compaction: none{/if}
              </span>
            </div>
            <span class="composer-hint">v{$appVersion} · Ctrl+Enter to send</span>
          </div>
        </div>
      {/if}
    {/if}

    <!-- Context bar at the bottom — shown when session is active -->
    {#if $activeTrace && !isInitializing && !isInitError}
      <ContextSnapshotBar
        entries={$activeTrace.context}
        contextSize={session.loaded_context_length ?? null}
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
    background: var(--bg-base);
  }

  .chat-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-bright);
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
    background: color-mix(in srgb, var(--bg-surface) 70%, transparent);
  }

  .chat-title-input {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-bright);
    background: var(--bg-surface);
    border: 1px solid var(--border);
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
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0.18rem 0.5rem;
  }

  .view-mode-btn.active {
    color: var(--text-bright);
    border-color: var(--amber-bright);
  }

  .export-btn {
    font-size: 0.72rem;
    padding: 0.2rem 0.55rem;
    opacity: 0.6;
    flex-shrink: 0;
  }
  .export-btn:hover {
    opacity: 1;
  }

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
    color: var(--text-dim);
    font-size: 0.875rem;
  }

  .empty-hint {
    color: var(--text-dim);
    font-size: 0.82rem;
  }

  /* ── Init error banner ────────────────────────────────────────────────── */
  .init-error-banner {
    flex-shrink: 0;
    background: color-mix(in srgb, var(--red-bright) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--red-bright) 35%, transparent);
    border-radius: 6px;
    color: var(--text-bright);
    font-size: 0.82rem;
    padding: 0.75rem 1rem;
    margin: 0.5rem 0;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .init-error-banner .btn {
    flex-shrink: 0;
  }

  /* ── Exhausted banner ─────────────────────────────────────────────────── */
  .exhausted-banner {
    flex-shrink: 0;
    background: color-mix(in srgb, var(--red-bright) 10%, transparent);
    border-top: 1px solid color-mix(in srgb, var(--red-bright) 35%, transparent);
    color: var(--text-bright);
    font-size: 0.8rem;
    padding: 0.5rem 1.25rem;
    text-align: center;
  }

  /* ── Composer ─────────────────────────────────────────────────────────── */
  .composer {
    flex-shrink: 0;
    padding: 0.6rem 1.25rem 0.75rem;
    border-top: none; /* Context bar provides the visual separator */
    background: var(--bg-base);
  }

  /* Bubble styled to match the user message in the transcript */
  .composer-bubble {
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.38rem 0.72rem;
    transition: border-color 0.15s;
  }

  .composer-bubble:focus-within {
    border-color: var(--green-bright);
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
    color: var(--green-bright);
    font-family: inherit;
    font-size: 1rem;
    line-height: 1.5;
    outline: none;
    overflow-y: auto;
  }

  .composer-bubble textarea::placeholder {
    color: color-mix(in srgb, var(--green-bright) 40%, transparent);
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
    color: var(--text-dim);
    opacity: 0.75;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .composer-hint {
    font-size: 0.7rem;
    color: var(--text-dim);
    opacity: 0.55;
    flex-shrink: 0;
  }

  /* ── Analysis control bar ──────────────────────────────────────────────── */
  .analysis-bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.6rem 1.25rem;
    border-top: 1px solid var(--border);
    background: var(--bg-base);
  }

  .analysis-bar-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .analysis-bar-label {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-dim);
  }

  .analysis-bar-phase {
    font-size: 0.82rem;
    color: var(--text-dim);
  }

  .analysis-bar-error {
    font-size: 0.8rem;
    color: color-mix(in srgb, var(--text-bright) 88%, var(--red-bright) 12%);
  }

  .analysis-bar-error em {
    font-style: normal;
    color: var(--text-dim);
  }

  .analysis-bar-progress {
    font-size: 0.78rem;
    color: var(--text-dim);
    margin-left: 0.25rem;
  }
  .analysis-bar-command {
    font-style: italic;
    margin-left: 0.25rem;
  }
  .analysis-bar-progress-bar {
    width: 100%;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    margin-top: 0.35rem;
    overflow: hidden;
  }
  .analysis-bar-progress-fill {
    height: 100%;
    background: var(--amber-bright);
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .analysis-bar-done {
    font-size: 0.82rem;
    color: var(--green-bright);
    font-weight: 600;
  }
</style>
