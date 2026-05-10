// Chat store: active chat sessions, messages, streaming state.
import { writable, get } from 'svelte/store'
import type { ChatSession, ChatMessage, ModelConfig, MessageTrace, ToolCallBlock, McpToolDefinition, ToolRound, ContextSegment } from './types'
import {
  getAllChatSessions,
  saveChatSession,
  deleteChatSession,
  getMessagesForSession,
  saveChatMessage,
} from './db'
import { streamChatCompletion, probeSystemPromptTokens, probeToolDefinitionsTokens, listModels, type LmToolParam, type StreamedToolCall } from './services/lmstudio'
import { lmConnections, mcpProfiles } from './connectionStore'
import { McpClientHandle } from './services/mcpClient'

export const chatSessions = writable<ChatSession[]>([])
export const activeChatId = writable<string | null>(null)
export const activeMessages = writable<ChatMessage[]>([])
export const isStreaming = writable<boolean>(false)

// The authoritative context bar segments for the active session.
// Computed and maintained by chatStore (which owns what's in the API context window).
// ContextBar is a pure renderer — it reads this store and adds only the live
// thinking estimate on top (character-count estimate while tokens stream in).
export const activeContextSegments = writable<ContextSegment[]>([])

// One-shot signal: when set to a non-null string, ChatView restores it to the composer
export const restoredComposerText = writable<string | null>(null)

// Holds the active AbortController while streaming; null when idle
let activeAbortController: AbortController | null = null

/** Cancel the active streaming request. No-op if not streaming. */
export function abortStreaming(): void {
  activeAbortController?.abort()
}

// One McpClientHandle per live ChatSession (keyed by session id)
const mcpHandles = new Map<string, McpClientHandle>()

// Stores in-progress init promises so sendMessage() can await a background init
// that was already started by createChat() — prevents double-init and race conditions
const chatInitPromises = new Map<string, Promise<void>>()

// Max tool call rounds per user turn before we stop and report
const MAX_TOOL_ROUNDS = 5

// Compute the authoritative list of context bar segments from the current session state
// and messages. This is the single source of truth for what's in the API context window.
//
// Design principle: chatStore builds the apiMessages array and knows exactly what it sent
// (and what it stripped). Rather than having ContextBar reverse-engineer this from usage stats,
// chatStore calls rebuildContextSegments() after every meaningful state change and exposes
// the result via activeContextSegments. ContextBar is then a pure renderer.
//
// The only thing NOT covered here is the live thinking estimate (growing orange bar while
// the model is streaming reasoning tokens). That's added by ContextBar on top because it
// requires character-count estimation before the final token count arrives from the API.
function rebuildContextSegments(session: ChatSession, messages: ChatMessage[]): ContextSegment[] {
  const segs: ContextSegment[] = []

  // Fixed elements: always present in every API call
  if (session.systemPromptTokens && session.systemPromptTokens > 0) {
    segs.push({ type: 'system-prompt', tokens: session.systemPromptTokens, msgId: 'system' })
  }
  if (session.toolDefinitionsTokens && session.toolDefinitionsTokens > 0) {
    segs.push({ type: 'tool-definitions', tokens: session.toolDefinitionsTokens, msgId: 'tool-defs' })
  }

  const visible = messages.filter(m => m.status !== 'aborted' && m.status !== 'error')
  const streamingMsg = visible.find(m => m.status === 'streaming') ?? null

  // Reasoning visibility policy (see REASONING STRIPPING POLICY in buildBaseApiMessages):
  // Only the last COMPLETED assistant turn shows its reasoning in the bar (it was just
  // generated and is still in the live context). All historical turns have reasoning stripped.
  // While streaming, no completed turn is "last" — old orange bars disappear.
  const lastCompletedAssistantId = streamingMsg
    ? null
    : visible.filter(m => m.role === 'assistant' && m.status === 'complete').at(-1)?.id ?? null

  // Helper: split a combined tc+tr prompt delta into per-tool-call segments.
  //
  // ACCURACY NOTE:
  // The tcTrDelta total IS EXACT — it is derived from API promptToken deltas after
  // subtracting reasoning tokens (which are also exact from the API). So the bar's
  // total tc+tr height for any round is accurate.
  //
  // The split of that total across individual tool calls within a round uses string-length
  // ratios (argumentsJson / result). This is a VISUAL SPLIT ONLY — it affects how the
  // bar is colored per call but not the total. Getting per-call exact counts would
  // require a separate probe API call per tool call, which is not worth the cost.
  const pushTcTr = (tcTrDelta: number, msg: ChatMessage, round: ToolRound, r: number, prefix = '') => {
    if (tcTrDelta <= 0) return
    const roundTcs = (msg.toolCalls ?? []).filter(tc => round.toolCallIds.includes(tc.id))
    if (roundTcs.length === 0) {
      segs.push({ type: 'tool-call', tokens: tcTrDelta, msgId: `${msg.id}-${prefix}tc-r${r}` })
    } else {
      const totalArgLen = roundTcs.reduce((s, tc) => s + (tc.argumentsJson?.length ?? 0), 0)
      const totalResLen = roundTcs.reduce((s, tc) => s + (tc.result?.length ?? 0), 0)
      const totalLen = (totalArgLen + totalResLen) || 1
      for (const tc of roundTcs) {
        segs.push({ type: 'tool-call', tokens: Math.max(1, Math.round(tcTrDelta * (tc.argumentsJson?.length ?? 0) / totalLen)), msgId: `${msg.id}-${prefix}tc-${tc.id}` })
        segs.push({ type: 'tool-response', tokens: Math.max(1, Math.round(tcTrDelta * (tc.result?.length ?? 0) / totalLen)), msgId: `${msg.id}-${prefix}tr-${tc.id}` })
      }
    }
  }

  for (const msg of visible) {
    if (msg.status === 'streaming') {
      // Streaming message: add segments for all COMPLETED intermediate rounds.
      // The live thinking estimate (growing orange) is added by ContextBar on top.
      const rounds = msg.toolRounds ?? []
      if (rounds.length === 0) continue  // nothing accurate yet — skip until round 0 completes

      // User segment: exact, derived from rounds[0].promptTokens minus all preceding segments.
      // This telescopes correctly for any number of prior turns.
      const prevTotal = segs.reduce((s, g) => s + g.tokens, 0)
      segs.push({ type: 'user', tokens: Math.max(1, rounds[0].promptTokens - prevTotal), msgId: `${msg.id}-u` })

      // Completed intermediate rounds (r and r+1 both known → delta is exact)
      for (let r = 0; r < rounds.length - 1; r++) {
        const round = rounds[r]
        const nextRound = rounds[r + 1]
        const rawDelta = Math.max(0, nextRound.promptTokens - round.promptTokens)
        // Streaming msg is always the current turn → always show intermediate reasoning as orange
        if (round.reasoningTokens > 0) {
          segs.push({ type: 'reasoning', tokens: round.reasoningTokens, msgId: `${msg.id}-ir${r}` })
        }
        pushTcTr(Math.max(0, rawDelta - round.reasoningTokens), msg, round, r, 's')
      }
      continue
    }

    if (msg.role === 'user') {
      if (msg.tokens && msg.tokens > 0) {
        segs.push({ type: 'user', tokens: msg.tokens, msgId: msg.id })
      }
    } else if (msg.role === 'assistant' && msg.usage) {
      const isLastTurn = msg.id === lastCompletedAssistantId

      if (msg.toolRounds && msg.toolRounds.length > 0) {
        const rounds = msg.toolRounds

        // Compute the live tc+tr total from PT deltas (used as proportional weights for the
        // visual split, and as the estimate when historicalPayloadTokens is not yet known).
        const liveTcTrValues: number[] = []
        let liveTcTrSum = 0
        for (let r = 0; r < rounds.length - 1; r++) {
          const raw = Math.max(0, rounds[r + 1].promptTokens - rounds[r].promptTokens - rounds[r].reasoningTokens)
          liveTcTrValues.push(raw)
          liveTcTrSum += raw
        }

        // When historicalPayloadTokens is set, it is the EXACT cost of (tc+tr + final content)
        // in the historical context — derived from the next turn's promptTokens via LM Studio
        // feedback. Without it we use the live tc+tr sum (slight overcount from format overhead).
        const finalContentEst = Math.max(0, Math.ceil((msg.content?.length ?? 0) / 4))
        let effectiveTcTrTotal: number
        let tcTrScale: number
        if (msg.historicalPayloadTokens !== undefined) {
          const correctedTcTr = Math.max(0, msg.historicalPayloadTokens - finalContentEst)
          effectiveTcTrTotal = correctedTcTr
          tcTrScale = liveTcTrSum > 0 ? correctedTcTr / liveTcTrSum : 0
        } else {
          effectiveTcTrTotal = liveTcTrSum
          tcTrScale = 1
        }

        for (let r = 0; r < rounds.length - 1; r++) {
          const round = rounds[r]
          // Historical turns: intermediate reasoning stripped → show only for isLastTurn
          if (isLastTurn && round.reasoningTokens > 0) {
            segs.push({ type: 'reasoning', tokens: round.reasoningTokens, msgId: `${msg.id}-ir${r}` })
          }
          pushTcTr(Math.round(liveTcTrValues[r] * tcTrScale), msg, round, r)
        }

        // Final round reasoning: only for last turn or explicit thinkingInContext opt-in
        const finalRound = rounds[rounds.length - 1]
        if ((isLastTurn || msg.thinkingInContext) && finalRound.reasoningTokens > 0) {
          segs.push({ type: 'reasoning', tokens: finalRound.reasoningTokens, msgId: `${msg.id}-r` })
        }
        // Final content: char/4 of the actual text we send in the historical reconstruction.
        if (finalContentEst > 0) {
          segs.push({ type: 'content', tokens: finalContentEst, msgId: `${msg.id}-c` })
        }
      } else {
        // Simple response (no tool rounds) or legacy messages
        const contentTokens = Math.max(0, msg.usage.completionTokens - (msg.usage.reasoningTokens ?? 0))
        if ((isLastTurn || msg.thinkingInContext) && msg.usage.reasoningTokens) {
          segs.push({ type: 'reasoning', tokens: msg.usage.reasoningTokens, msgId: `${msg.id}-r` })
        }
        // Tool calls for legacy messages (messages that predate toolRounds tracking).
        // These messages don't have per-round promptToken data so we fall back to
        // character-length estimates. This is the ONLY place estimates are used for
        // completed messages — it only affects messages created before this tracking
        // was introduced and cannot be corrected retroactively.
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            const callTokens = Math.max(10, Math.ceil((tc.argumentsJson?.length ?? 0) / 4))
            segs.push({ type: 'tool-call', tokens: callTokens, msgId: `${msg.id}-tc-${tc.id}` })
            const responseTokens = Math.max(10, Math.ceil((tc.result?.length ?? 0) / 4))
            segs.push({ type: 'tool-response', tokens: responseTokens, msgId: `${msg.id}-tr-${tc.id}` })
          }
        }
        if (contentTokens > 0) {
          segs.push({ type: 'content', tokens: contentTokens, msgId: `${msg.id}-c` })
        }
      }
    }
  }

  return segs
}

export async function initChatStore(): Promise<void> {
  try {
    const sessions = await getAllChatSessions()
    sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    chatSessions.set(sessions)
  } catch (e) {
    // Non-fatal — app still works, just starts with no chat history
    // eslint-disable-next-line no-console
    console.error('Failed to load chat sessions:', e)
  }
}

// Export the active chat as a JSON diagnostic dump — session metadata, all messages
// with their full token accounting fields, and the current context segments.
// Useful for diagnosing context bar discrepancies without needing a test harness.
// Reconstruct the API messages array that would have been sent at the start of a given
// assistant turn (i.e., at round 0 before any tool calls). This mirrors the logic of
// buildBaseApiMessages() inside sendMessage() so we can verify reasoning stripping and
// compute how many tokens each component contributes.
function reconstructApiMessagesForTurn(
  allMessages: ChatMessage[],
  assistantMsgId: string,
  session: ChatSession,
): { role: string; content: string | null; reasoning_content?: string; tool_calls?: unknown; tool_call_id?: string; _note?: string }[] {
  const modelConfig = session.modelConfigSnapshot
  const system = [
    ...(modelConfig.systemPrompt ? [{ role: 'system', content: modelConfig.systemPrompt }] : []),
    ...(session.mcpInstructions ? [{ role: 'system', content: `[MCP Server Instructions]\n${session.mcpInstructions}`, _note: 'mcpInstructions' }] : []),
  ]

  // Find the assistant message and the user message immediately before it
  const idx = allMessages.findIndex(m => m.id === assistantMsgId)
  if (idx < 0) return system

  const userMsg = idx > 0 ? allMessages[idx - 1] : null
  const history = allMessages.slice(0, idx > 0 ? idx - 1 : idx)  // everything before the user message

  const historyMessages = history
    .filter(m => m.status !== 'aborted' && m.status !== 'error')
    .flatMap(m => {
      if (m.role === 'user') {
        return [{ role: 'user', content: m.content }]
      }
      if (m.role === 'assistant') {
        if (m.toolRounds && m.toolRounds.length > 0 && m.toolCalls) {
          // Reconstruct each round as assistant+tool messages (reasoning stripped for history)
          return m.toolRounds.flatMap(round => {
            if (round.toolCallIds.length > 0) {
              const roundTcs = m.toolCalls!.filter(tc => round.toolCallIds.includes(tc.id))
              return [
                {
                  role: 'assistant',
                  content: null,
                  tool_calls: roundTcs.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.argumentsJson } })),
                  _note: `round reasoning stripped (was ${round.reasoningTokens} tokens)`,
                },
                ...roundTcs.map(tc => ({ role: 'tool', content: tc.result ?? '', tool_call_id: tc.id })),
              ]
            } else {
              // Final round
              const msg: { role: string; content: string | null; reasoning_content?: string; _note?: string } = { role: 'assistant', content: m.content || null }
              if (m.thinkingInContext && m.thinking) { msg.reasoning_content = m.thinking; msg._note = 'thinkingInContext=true, reasoning forwarded' }
              else msg._note = `final reasoning stripped (was ${m.usage?.reasoningTokens ?? 0} tokens)`
              return [msg]
            }
          })
        } else {
          const msg: { role: string; content: string | null; reasoning_content?: string; _note?: string } = { role: 'assistant', content: m.content || null }
          if (m.thinkingInContext && m.thinking) msg.reasoning_content = m.thinking
          return [msg]
        }
      }
      return []
    })

  return [
    ...system,
    ...historyMessages,
    ...(userMsg ? [{ role: 'user', content: userMsg.content }] : []),
  ]
}

export function exportActiveChat(): void {
  const sessionId = get(activeChatId)
  const session = get(chatSessions).find(s => s.id === sessionId)
  if (!session) return

  const messages = get(activeMessages)
  const segments = get(activeContextSegments)

  const dump = {
    exportedAt: new Date().toISOString(),
    version: 2,
    session: {
      id: session.id,
      title: session.title,
      modelConfig: session.modelConfigSnapshot,
      systemPrompt: session.modelConfigSnapshot.systemPrompt ?? null,
      mcpInstructions: session.mcpInstructions ?? null,
      loadedContextLength: session.loadedContextLength,
      tokenEstimates: {
        systemPrompt: session.systemPromptTokens,
        toolDefinitions: session.toolDefinitionsTokens,
      },
      chatInitStatus: session.chatInitStatus,
      isContextExhausted: session.isContextExhausted,
      // Full tool schemas so we can independently count their tokens
      mcpTools: session.mcpTools ?? [],
    },
    contextSegments: segments,
    contextSegmentsTotal: segments.reduce((s, seg) => s + seg.tokens, 0),
    messages: messages.map(m => {
      const base = {
        id: m.id,
        role: m.role,
        status: m.status,
        timestamp: m.timestamp,
        content: m.content,
        contentLength: m.content.length,
        // For user messages: token count back-filled from API delta
        tokens: m.tokens,
        estimatedTokens: Math.ceil(m.content.length / 4),
      }

      if (m.role === 'assistant') {
        // Annotate each tool round with derived metrics
        const annotatedRounds = (m.toolRounds ?? []).map((round, i, arr) => {
          const prev = i > 0 ? arr[i - 1] : null
          const deltaFromPrev = prev ? round.promptTokens - prev.promptTokens : null
          const tcTrDelta = deltaFromPrev !== null ? Math.max(0, deltaFromPrev - (prev?.reasoningTokens ?? 0)) : null
          return {
            ...round,
            deltaFromPrev,
            tcTrDelta,  // actual tc+tr token cost of the PREVIOUS round (after subtracting its reasoning)
            isCapped: round.promptTokens >= (session.loadedContextLength ?? 999999) - 500,
          }
        })

        // Reconstruct what the API received at round 0 of this turn
        const apiPayload = reconstructApiMessagesForTurn(messages, m.id, session)

        return {
          ...base,
          thinking: m.thinking ?? null,
          thinkingLength: m.thinking?.length ?? 0,
          thinkingInContext: m.thinkingInContext ?? false,
          usage: m.usage,
          toolRounds: annotatedRounds,
          toolCalls: (m.toolCalls ?? []).map(tc => ({
            id: tc.id,
            name: tc.name,
            status: tc.status,
            argumentsJson: tc.argumentsJson,
            argumentsLength: tc.argumentsJson?.length ?? 0,
            argumentsEstimatedTokens: Math.ceil((tc.argumentsJson?.length ?? 0) / 4),
            result: tc.result ?? null,
            resultLength: tc.result?.length ?? 0,
            resultEstimatedTokens: Math.ceil((tc.result?.length ?? 0) / 4),
            thinkingBefore: tc.thinkingBefore ?? null,
            thinkingBeforeLength: tc.thinkingBefore?.length ?? 0,
            durationMs: tc.startedAt && tc.completedAt ? tc.completedAt - tc.startedAt : null,
            isError: tc.isError ?? false,
          })),
          // The reconstructed API payload for round 0 (what was sent before any tool calls)
          apiPayloadAtRound0: apiPayload,
          apiPayloadMessageCount: apiPayload.length,
          trace: m.trace,
        }
      }

      return base
    }),
  }

  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `chat-export-${session.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function createChat(modelConfig: ModelConfig, mcpProfileId: string | null = null): Promise<void> {
  const now = Date.now()

  // Look up the MCP profile snapshot if one is selected
  const mcpSnapshot = mcpProfileId
    ? (get(mcpProfiles).find(p => p.id === mcpProfileId) ?? null)
    : null

  const session: ChatSession = {
    id: crypto.randomUUID(),
    title: 'New chat',
    modelConfigId: modelConfig.id,
    modelConfigSnapshot: modelConfig,
    mcpProfileId: mcpProfileId,
    mcpSnapshot: mcpSnapshot,
    createdAt: now,
    updatedAt: now,
    loadedContextLength: null,
    systemPromptTokens: null,
    chatInitStatus: 'pending',
  }
  await saveChatSession(session)
  chatSessions.update(list => [session, ...list])
  activeChatId.set(session.id)
  activeMessages.set([])

  // Initialize in background — fetches context length, probes system prompt tokens,
  // and connects to MCP (if configured). User can see progress via chatInitStatus.
  // The Promise is stored in chatInitPromises so sendMessage() can await it if the
  // user manages to trigger a send before init completes.
  const initPromise = initializeChatSession(session.id, modelConfig)
  chatInitPromises.set(session.id, initPromise)
  initPromise
    .catch(e => { console.error('Background chat init failed:', e) }) // eslint-disable-line no-console
    .finally(() => chatInitPromises.delete(session.id))
}

// Run all initialization tasks for a chat session. Called from createChat() in the
// background so the chat opens instantly. Also called (or awaited) from sendMessage()
// as a fallback for sessions loaded from DB that were never fully initialized.
// Runs listModels + systemPrompt probe + MCP init all in parallel to minimize latency,
// then probes tool definitions tokens (requires both systemPromptTokens and tools, so sequential).
async function initializeChatSession(sessionId: string, modelConfig: ModelConfig): Promise<void> {
  let session = get(chatSessions).find(s => s.id === sessionId)
  if (!session) return

  const connection = get(lmConnections).find(c => c.id === modelConfig.connectionId)
  if (!connection) return

  // Mark as initializing so the UI can show a spinner
  session = { ...session, chatInitStatus: 'initializing' }
  chatSessions.update(list => list.map(s => s.id === sessionId ? session! : s))

  try {
    // Phase 1: run context-length fetch, system-prompt probe, and MCP init all in parallel
    const [loadedContextLength, systemPromptTokens, mcpResult] = await Promise.all([
      // 1. Fetch loaded context length from native API
      listModels(connection.baseUrl, connection.apiKey)
        .then(models => models.find(m => m.key === modelConfig.modelKey)?.loadedContextLength ?? null)
        .catch(() => null as number | null),

      // 2. Probe accurate system prompt token count (one minimal LLM call)
      probeSystemPromptTokens(
        connection.baseUrl,
        modelConfig.modelKey,
        modelConfig.systemPrompt,
        connection.apiKey
      ).catch(() => null as number | null),

      // 3. Initialize MCP session if a profile is configured
      (async (): Promise<Partial<ChatSession>> => {
        const currentSession = get(chatSessions).find(s => s.id === sessionId)
        const profileId = currentSession?.mcpProfileId
        if (!profileId) return {}
        const profile = get(mcpProfiles).find(p => p.id === profileId)
        if (!profile) return {}
        try {
          let handle = mcpHandles.get(sessionId)
          if (!handle) {
            handle = new McpClientHandle(profile.url)
            mcpHandles.set(sessionId, handle)
          }
          const info = await handle.initialize()
          return {
            mcpSessionId: info.sessionId,
            mcpTools: info.tools,
            mcpInstructions: info.instructions,
          }
        } catch (e) {
          console.error('MCP init failed:', e) // eslint-disable-line no-console
          return {}
        }
      })(),
    ])

    // Phase 2: probe tool definition token cost now that we have both systemPromptTokens
    // and the tools list. This must be sequential (needs phase 1 results).
    // probeToolDefinitionsTokens makes one minimal API call with the tools array and measures
    // the exact token cost — no estimates, no character-count approximations.
    const mcpTools = (mcpResult as Partial<ChatSession>).mcpTools
    const toolDefinitionsTokens = mcpTools && mcpTools.length > 0
      ? await probeToolDefinitionsTokens(
          connection.baseUrl,
          modelConfig.modelKey,
          modelConfig.systemPrompt,
          mcpTools.map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
          systemPromptTokens,
          connection.apiKey
        ).catch(() => null as number | null)
      : 0

    // Re-fetch session in case it was modified while we were initializing
    session = get(chatSessions).find(s => s.id === sessionId) ?? session!
    session = {
      ...session,
      loadedContextLength,
      systemPromptTokens,
      chatInitStatus: 'ready',
      ...mcpResult,
      toolDefinitionsTokens: toolDefinitionsTokens ?? null,
    }
    await saveChatSession(session)
    chatSessions.update(list => list.map(s => s.id === sessionId ? session! : s))
    // Rebuild context segments now that systemPromptTokens and toolDefinitionsTokens are known
    if (get(activeChatId) === sessionId) {
      activeContextSegments.set(rebuildContextSegments(session!, get(activeMessages)))
    }
  } catch (e) {
    chatSessions.update(list =>
      list.map(s => s.id === sessionId ? { ...s, chatInitStatus: 'error' as const } : s)
    )
    throw e
  }
}

export async function selectChat(id: string): Promise<void> {
  activeChatId.set(id)
  const msgs = await getMessagesForSession(id)
  msgs.sort((a, b) => a.timestamp - b.timestamp)
  activeMessages.set(msgs)
  // Rebuild segments from the loaded messages so the bar is accurate immediately
  const session = get(chatSessions).find(s => s.id === id)
  if (session) {
    activeContextSegments.set(rebuildContextSegments(session, msgs))
  }
}

export async function deleteChat(id: string): Promise<void> {
  // Close MCP session if one is open for this chat
  const handle = mcpHandles.get(id)
  if (handle) {
    handle.close().catch(() => {/* ignore */})
    mcpHandles.delete(id)
  }
  await deleteChatSession(id)
  chatSessions.update(list => list.filter(s => s.id !== id))
  if (get(activeChatId) === id) {
    activeChatId.set(null)
    activeMessages.set([])
    activeContextSegments.set([])
  }
}

// Compute how many tokens belong to the user message in this turn.
// Back-filled onto the user ChatMessage when the assistant response arrives.
// toolDefinitionsTokens: when MCP is active, these are included in every
//   LLM call's prompt but shown as a separate segment in the context bar —
//   subtract them to avoid double-counting.
function computeUserTokens(
  promptTokens: number,
  prevAssistantUsage: ChatMessage['usage'] | undefined,
  prevThinkingInContext: boolean,
  sessionSystemPromptTokens: number | null,
  isFirstTurn: boolean,
  toolDefinitionsTokens?: number | null
): number {
  const toolDefs = toolDefinitionsTokens ?? 0
  if (isFirstTurn) {
    // First turn: promptTokens = system + toolDefs + user_text + tool_overhead_from_rounds.
    // Subtract system and toolDefs to get (user_text + tool_overhead).
    return Math.max(0, promptTokens - (sessionSystemPromptTokens ?? 0) - toolDefs)
  }
  if (!prevAssistantUsage) return 0
  // Non-first turns: toolDefs appear in both current and prev prompts so they cancel
  // out in the difference — do NOT subtract separately.
  const prevContentTokens = (prevAssistantUsage.completionTokens ?? 0) - (prevAssistantUsage.reasoningTokens ?? 0)
  const prevReasoningInContext = prevThinkingInContext ? (prevAssistantUsage.reasoningTokens ?? 0) : 0
  return Math.max(
    0,
    promptTokens - prevAssistantUsage.promptTokens - prevContentTokens - prevReasoningInContext
  )
}

export async function sendMessage(userContent: string, modelConfig: ModelConfig): Promise<void> {
  const sessionId = get(activeChatId)
  if (!sessionId) return

  const sessions = get(chatSessions)
  let session = sessions.find(s => s.id === sessionId)
  if (!session) return

  // Look up the connection for API calls
  const connection = get(lmConnections).find(c => c.id === modelConfig.connectionId)
  if (!connection) return

  // On first message: set title and snapshot model config.
  // Initialization (context length, system prompt probe, MCP) runs eagerly as a
  // background task from createChat(). If it's still in progress, await it now so
  // the LLM call has access to the correct session fields (tools, context length, etc).
  const existingMessages = await getMessagesForSession(sessionId)
  const isFirstTurn = existingMessages.length === 0

  if (isFirstTurn) {
    // Await any background init that's already running
    const pending = chatInitPromises.get(sessionId)
    if (pending) {
      await pending
    } else if (!session.chatInitStatus || session.chatInitStatus === 'pending') {
      // Fallback: init hasn't started yet (e.g. session loaded from old DB)
      const p = initializeChatSession(sessionId, modelConfig)
      chatInitPromises.set(sessionId, p)
      await p.finally(() => chatInitPromises.delete(sessionId))
    }
    // Re-fetch session — init may have populated loadedContextLength, mcpTools, etc.
    session = get(chatSessions).find(s => s.id === sessionId) ?? session

    session = {
      ...session,
      title: userContent.slice(0, 60),
      modelConfigSnapshot: modelConfig,
      modelConfigId: modelConfig.id,
      updatedAt: Date.now(),
    }
    await saveChatSession(session)
    chatSessions.update(list => list.map(s => (s.id === sessionId ? session! : s)))
  }

  // Persist and add user message
  const userMsg: ChatMessage = {
    id: crypto.randomUUID(),
    sessionId,
    role: 'user',
    content: userContent,
    timestamp: Date.now(),
    status: 'complete',
  }
  await saveChatMessage(userMsg)
  activeMessages.update(msgs => [...msgs, userMsg])

  isStreaming.set(true)

  // Create abort controller for this request
  activeAbortController = new AbortController()
  const abortSignal = activeAbortController.signal

  // Build the tools[] parameter for LM Studio if MCP is active
  const mcpTools: McpToolDefinition[] = session.mcpTools ?? []
  const lmTools: LmToolParam[] | undefined = mcpTools.length > 0
    ? mcpTools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        }
      }))
    : undefined

  // Find the previous completed assistant message for user-token back-calculation
  const completedAssistants = get(activeMessages).filter(
    m => m.role === 'assistant' && m.status === 'complete' && m.usage
  )
  const prevAssistant = completedAssistants.at(-1)
  const prevAssistantUsage = prevAssistant?.usage

  // Create streaming assistant message
  const assistantMsg: ChatMessage = {
    id: crypto.randomUUID(),
    sessionId,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    status: 'streaming',
    thinkingInContext: false,
    streamingStartedAt: undefined,
    streamingCompletedAt: undefined,
  }
  activeMessages.update(msgs => [...msgs, assistantMsg])

  // Convenience: rebuild and publish context segments from current session + messages.
  // Called after every meaningful state change so the bar stays accurate without ContextBar
  // having to know anything about the context management policy.
  const refreshSegments = () => {
    const currentSession = get(chatSessions).find(s => s.id === sessionId)
    if (currentSession) {
      activeContextSegments.set(rebuildContextSegments(currentSession, get(activeMessages)))
    }
  }

  try {
    // --- Tool execution loop ---
    // We loop up to MAX_TOOL_ROUNDS times, each time calling the LLM.
    // If it returns tool_calls we execute them and loop again.
    // On 'stop' (or any other finish_reason), we're done.
    let toolRound = 0
    let finishedNormally = false
    // Prompt tokens from round 1 (before any tool call overhead is added).
    // Round 1 prompt = system + toolDefs + user, which is what we want for accurate
    // user-text token attribution. Subsequent rounds add tc/tr overhead on top.
    let firstRoundPromptTokens: number | null = null
    const toolRounds: ToolRound[] = []

    // Build the initial API message history from completed past exchanges only.
    // We deliberately exclude the live streaming assistantMsg — the API messages
    // array is extended explicitly with tool_calls + tool results each round.
    type ApiMessage = { role: string; content: string | null; reasoning_content?: string; tool_calls?: unknown; tool_call_id?: string }
    const buildBaseApiMessages = (): ApiMessage[] => {
      const system: ApiMessage[] = [
        ...(modelConfig.systemPrompt ? [{ role: 'system', content: modelConfig.systemPrompt }] : []),
        ...(session!.mcpInstructions ? [{ role: 'system', content: `[MCP Server Instructions]\n${session!.mcpInstructions}` }] : []),
      ]
      const history: ApiMessage[] = get(activeMessages)
        .filter(m => m.status !== 'aborted' && m.id !== assistantMsg.id && m.id !== userMsg.id)
        .flatMap(m => {
          const parts: ApiMessage[] = []
          if (m.role === 'user') {
            parts.push({ role: 'user', content: m.content })
          } else if (m.role === 'assistant') {
            if (m.toolRounds && m.toolRounds.length > 0 && m.toolCalls) {
              // Multi-round tool calls: reconstruct each round as separate assistant+tool interleaved messages.
              // This is the correct OpenAI API format: each round is one assistant tool_calls message
              // followed by one tool result message per tool called in that round.
              //
              // REASONING STRIPPING POLICY:
              // Within a live turn we send reasoning_content between rounds so the model retains
              // its chain-of-thought across tool calls. But once the final answer is given, that
              // reasoning has no value for subsequent user turns — the model only needs to know
              // what tools were called and what they returned. Stripping it also saves significant
              // tokens (intermediate reasoning can be thousands of tokens per round).
              for (const round of m.toolRounds) {
                if (round.toolCallIds.length > 0) {
                  const roundTcs = m.toolCalls.filter(tc => round.toolCallIds.includes(tc.id))
                  parts.push({
                    role: 'assistant',
                    content: null,
                    // reasoning_content intentionally omitted for historical turns.
                    // The model does not need "why I called this tool last turn" to answer
                    // the next question — the tool call + result already tell that story.
                    tool_calls: roundTcs.map(tc => ({
                      id: tc.id,
                      type: 'function',
                      function: { name: tc.name, arguments: tc.argumentsJson },
                    })),
                  })
                  for (const tc of roundTcs) {
                    parts.push({ role: 'tool', content: tc.result ?? '', tool_call_id: tc.id })
                  }
                } else {
                  // Final round: regular assistant response
                  const finalMsg: ApiMessage = { role: 'assistant', content: m.content || null }
                  if (m.thinkingInContext && m.thinking) finalMsg.reasoning_content = m.thinking
                  parts.push(finalMsg)
                }
              }
            } else {
              // Simple response (no tool calls) or legacy messages without toolRounds
              const base: ApiMessage = {
                role: 'assistant',
                content: m.content || null,
              }
              if (m.thinkingInContext && m.thinking) base.reasoning_content = m.thinking
              if (m.toolCalls && m.toolCalls.length > 0) {
                base.tool_calls = m.toolCalls.map(tc => ({
                  id: tc.id,
                  type: 'function',
                  function: { name: tc.name, arguments: tc.argumentsJson },
                }))
                parts.push(base)
                for (const tc of m.toolCalls) {
                  if (tc.status === 'done' || tc.status === 'error') {
                    parts.push({ role: 'tool', content: tc.result ?? '', tool_call_id: tc.id })
                  }
                }
              } else {
                parts.push(base)
              }
            }
          }
          return parts
        })
      // Append the current user message at the end
      return [...system, ...history, { role: 'user', content: userContent }]
    }

    // apiMessages is extended each tool round with assistant tool_calls + tool results
    let apiMessages: ApiMessage[] = buildBaseApiMessages()

    while (toolRound <= MAX_TOOL_ROUNDS) {
      const stream = streamChatCompletion(
        connection.baseUrl,
        modelConfig.modelKey,
        apiMessages,
        modelConfig.temperature,
        connection.apiKey,
        abortSignal,
        modelConfig.reasoning,
        lmTools
      )

      let usage: ChatMessage['usage'] | undefined
      let rawUsage: unknown
      let traceData: MessageTrace | undefined
      let firstTokenReceived = false
      let contextExhausted = false
      let toolCallsFromStream: StreamedToolCall[] | undefined

      for await (const chunk of stream) {
        if (chunk.done) {
          assistantMsg.streamingCompletedAt = Date.now()
          if (chunk.finishReason === 'length') contextExhausted = true
          if (chunk.usage) {
            usage = {
              promptTokens: chunk.usage.promptTokens,
              completionTokens: chunk.usage.completionTokens,
              totalTokens: chunk.usage.totalTokens,
              reasoningTokens: chunk.usage.reasoningTokens,
            }
            rawUsage = chunk.rawUsage
          }
          if (chunk.traceData) traceData = { ...chunk.traceData, rawUsage }
          if (chunk.finishReason === 'tool_calls' && chunk.toolCalls) {
            toolCallsFromStream = chunk.toolCalls
          }
          break
        }

        if (!firstTokenReceived && (chunk.content || chunk.thinking)) {
          firstTokenReceived = true
          assistantMsg.streamingStartedAt = Date.now()
        }

        let changed = false
        if (chunk.thinking) { assistantMsg.thinking = (assistantMsg.thinking ?? '') + chunk.thinking; changed = true }
        if (chunk.content) { assistantMsg.content += chunk.content; changed = true }
        if (changed) {
          activeMessages.update(msgs =>
            msgs.map(m => m.id === assistantMsg.id
              ? { ...m, content: assistantMsg.content, thinking: assistantMsg.thinking }
              : m)
          )
        }
      }

      // --- Handle tool calls ---
      if (toolCallsFromStream && toolCallsFromStream.length > 0 && toolRound < MAX_TOOL_ROUNDS) {
        toolRound++

        // Capture round 1's prompt tokens before any tool overhead is added
        if (firstRoundPromptTokens === null && usage) {
          firstRoundPromptTokens = usage.promptTokens
          // When we know this turn's first PT, we can compute the EXACT historical
          // payload cost for the previous tool-calling turn (replacing the estimate
          // from PT deltas). Formula: firstPT - prevRound0PT - char4(userContent)
          if (!isFirstTurn && prevAssistant?.toolRounds?.length && prevAssistant.historicalPayloadTokens === undefined) {
            const hp = Math.max(0, firstRoundPromptTokens - prevAssistant.toolRounds[0].promptTokens - Math.ceil(userContent.length / 4))
            prevAssistant.historicalPayloadTokens = hp
            await saveChatMessage(prevAssistant)
            activeMessages.update(msgs => msgs.map(m => m.id === prevAssistant!.id ? { ...m, historicalPayloadTokens: hp } : m))
            refreshSegments()
          }
        }

        // Record per-round token data for this LLM call
        if (usage) {
          toolRounds.push({
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            reasoningTokens: usage.reasoningTokens ?? 0,
            toolCallIds: toolCallsFromStream.map(tc => tc.id),
          })
          // Eagerly push to the message in the store so the context bar updates live
          // as each round completes (ContextBar handles streaming messages with toolRounds)
          assistantMsg.toolRounds = [...toolRounds]
        }

        // Capture reasoning from this round before clearing — stored on each block for traceability
        const roundThinking = assistantMsg.thinking ?? undefined

        // Convert streamed tool calls to ToolCallBlock[] with status: pending.
        // thinkingBefore preserves the model reasoning that led to this tool call.
        let roundBlocks: ToolCallBlock[] = toolCallsFromStream.map(tc => ({
          id: tc.id,
          name: tc.name,
          argumentsJson: tc.argumentsJson,
          status: 'pending' as const,
          thinkingBefore: roundThinking,
        }))

        // Accumulate across rounds (don't replace — multi-round calls all visible)
        const prevToolCalls = assistantMsg.toolCalls ?? []
        assistantMsg.toolCalls = [...prevToolCalls, ...roundBlocks]
        assistantMsg.thinking = undefined  // cleared; round thinking is in thinkingBefore
        assistantMsg.usage = usage
        assistantMsg.trace = traceData

        // Helper: replace one item in roundBlocks immutably (Svelte 5 needs new references)
        const updateBlock = (idx: number, patch: Partial<ToolCallBlock>) => {
          roundBlocks = roundBlocks.map((b, j) => j === idx ? { ...b, ...patch } : b)
          assistantMsg.toolCalls = [...prevToolCalls, ...roundBlocks]
          activeMessages.update(msgs =>
            msgs.map(m => m.id === assistantMsg.id
              ? { ...m, toolCalls: assistantMsg.toolCalls, thinking: undefined }
              : m)
          )
        }

        // Show tool calls immediately (thinking cleared, tool calls shown, toolRounds updated for bar)
        activeMessages.update(msgs =>
          msgs.map(m => m.id === assistantMsg.id
            ? { ...m, toolCalls: assistantMsg.toolCalls, content: assistantMsg.content, thinking: undefined, toolRounds: assistantMsg.toolRounds }
            : m)
        )
        // User segment and completed intermediate rounds are now computable — refresh bar
        refreshSegments()

        // Execute each tool call via MCP with immutable status updates
        const mcpHandle = mcpHandles.get(sessionId)
        for (let i = 0; i < roundBlocks.length; i++) {
          updateBlock(i, { status: 'running', startedAt: Date.now() })

          try {
            let args: Record<string, unknown> = {}
            try { args = JSON.parse(roundBlocks[i].argumentsJson || '{}') } catch { /* use empty */ }

            const result = mcpHandle
              ? await mcpHandle.callTool(roundBlocks[i].name, args)
              : { content: `[MCP not initialized for tool: ${roundBlocks[i].name}]`, isError: true, rawResult: null, durationMs: 0 }

            updateBlock(i, {
              status: result.isError ? 'error' : 'done',
              completedAt: Date.now(),
              result: result.content,
              isError: result.isError,
              mcpRaw: result.rawResult,
            })
          } catch (toolErr) {
            updateBlock(i, {
              status: 'error',
              completedAt: Date.now(),
              result: toolErr instanceof Error ? toolErr.message : String(toolErr),
              isError: true,
            })
          }
        }

        // Save assistant message with accumulated tool calls before the next round
        await saveChatMessage(assistantMsg)
        refreshSegments()  // tool results are now in the message — tc/tr split becomes accurate

        // Extend apiMessages with: assistant tool_calls + tool results for next round.
        // We include reasoning_content so the model retains its chain-of-thought across
        // tool rounds — the thinking that led to each tool call is essential context for
        // interpreting the result. Token attribution is handled accurately via ToolRound deltas.
        apiMessages = [
          ...apiMessages,
          {
            role: 'assistant',
            content: assistantMsg.content || null,
            ...(roundThinking ? { reasoning_content: roundThinking } : {}),
            tool_calls: toolCallsFromStream.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: tc.argumentsJson },
            })),
          },
          ...roundBlocks.map(b => ({
            role: 'tool' as const,
            content: b.result ?? '',
            tool_call_id: b.id,
          })),
        ]

        // Reset streaming fields for next round (thinking already cleared above)
        assistantMsg.content = ''
        assistantMsg.streamingStartedAt = undefined
        assistantMsg.streamingCompletedAt = undefined

        continue  // next LLM call
      }

      // If we hit the tool round limit, warn the user
      if (toolCallsFromStream && toolCallsFromStream.length > 0 && toolRound >= MAX_TOOL_ROUNDS) {
        assistantMsg.errorMessage = `Stopped after ${MAX_TOOL_ROUNDS} tool call rounds. The model may need more rounds to complete this task.`
      }

      // Back-fill user message tokens
      if (usage) {
        // For tool-calling turns, use toolRounds[0].promptTokens as an accurate baseline.
        // Round 0's prompt = system + toolDefs + user_text (no tool overhead yet).
        // For simple turns (no tool rounds) fall through to the existing formula.
        let userTokens: number
        if (toolRounds.length > 0 && usage) {
          const round0Prompt = toolRounds[0].promptTokens
          if (isFirstTurn) {
            // First turn: round0 = system + toolDefs + user
            userTokens = Math.max(1, round0Prompt - (session.systemPromptTokens ?? 0) - (session.toolDefinitionsTokens ?? 0))
          } else if (prevAssistantUsage) {
            // Non-first turn: round0 = prevFinalPrompt + prevContent + user
            // (prevFinalReasoning Rf is stripped before sending the next turn)
            //
            // Additionally, intermediate reasoning from prevAssistant's tool rounds was
            // sent as reasoning_content in the LIVE apiMessages but is now stripped from
            // buildBaseApiMessages for historical reconstruction. If the API counted that
            // reasoning in prevAssistantUsage.promptTokens, round0Prompt is smaller than
            // prevPromptTokens by exactly Σ(intermediate reasoning). Adding it back corrects
            // the discrepancy.
            const prevContent = (prevAssistantUsage.completionTokens ?? 0) - (prevAssistantUsage.reasoningTokens ?? 0)
            const prevReasoningInCtx = (prevAssistant?.thinkingInContext ?? false)
              ? (prevAssistantUsage.reasoningTokens ?? 0)
              : 0
            const prevIntermediateReasoning = (prevAssistant?.toolRounds ?? [])
              .filter(r => r.toolCallIds.length > 0)
              .reduce((s, r) => s + r.reasoningTokens, 0)
            userTokens = Math.max(1,
              round0Prompt - prevAssistantUsage.promptTokens - prevContent - prevReasoningInCtx + prevIntermediateReasoning
            )
          } else {
            userTokens = computeUserTokens(
              round0Prompt,
              prevAssistantUsage,
              prevAssistant?.thinkingInContext ?? false,
              session.systemPromptTokens,
              isFirstTurn,
              session.toolDefinitionsTokens
            )
          }
        } else {
          const promptForUserCalc = (isFirstTurn && firstRoundPromptTokens !== null)
            ? firstRoundPromptTokens
            : usage!.promptTokens

          if (!isFirstTurn && prevAssistant?.toolRounds?.length && prevAssistant.historicalPayloadTokens === undefined) {
            // Simple turn: this is the first time we know the exact PT for this prompt.
            // Use it to compute historicalPayloadTokens for the previous tool-calling turn
            // (replaces the estimate from PT deltas, which overcounts format overhead).
            const userChar4 = Math.ceil(userContent.length / 4)
            const hp = Math.max(0, promptForUserCalc - prevAssistant.toolRounds[0].promptTokens - userChar4)
            prevAssistant.historicalPayloadTokens = hp
            await saveChatMessage(prevAssistant)
            activeMessages.update(msgs => msgs.map(m => m.id === prevAssistant!.id ? { ...m, historicalPayloadTokens: hp } : m))
            // User tokens for a simple turn following a tool-calling turn: use char/4.
            // historicalPayloadTokens above was defined as (promptPT - round0PT_prev - userChar4)
            // so the bar total = round0PT_prev + historicalPayload + userChar4 = promptPT exactly.
            userTokens = userChar4
          } else {
            userTokens = computeUserTokens(
              promptForUserCalc,
              prevAssistantUsage,
              prevAssistant?.thinkingInContext ?? false,
              session.systemPromptTokens,
              isFirstTurn,
              session.toolDefinitionsTokens
            )
          }
        }
        userMsg.tokens = userTokens
        await saveChatMessage(userMsg)
        activeMessages.update(msgs =>
          msgs.map(m => m.id === userMsg.id ? { ...m, tokens: userTokens } : m)
        )
        refreshSegments()  // user segment now has its accurate token count
      }

      // Mark assistant message complete
      if (contextExhausted && !assistantMsg.errorMessage) {
        assistantMsg.errorMessage = 'Response truncated — context window full. Start a new chat to continue.'
      }
      assistantMsg.status = contextExhausted && !assistantMsg.content ? 'error' : 'complete'
      assistantMsg.usage = usage
      assistantMsg.trace = traceData
      assistantMsg.streamingCompletedAt = assistantMsg.streamingCompletedAt ?? Date.now()

      // Capture final round token data and attach all rounds to the message
      if (usage && toolRounds.length > 0) {
        toolRounds.push({
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          reasoningTokens: usage.reasoningTokens ?? 0,
          toolCallIds: [],
        })
        assistantMsg.toolRounds = toolRounds
      }

      await saveChatMessage(assistantMsg)
      activeMessages.update(msgs =>
        msgs.map(m =>
          m.id === assistantMsg.id
            ? {
                ...m,
                status: assistantMsg.status,
                usage,
                trace: traceData,
                thinkingInContext: false,
                errorMessage: assistantMsg.errorMessage,
                toolCalls: assistantMsg.toolCalls,
                toolRounds: assistantMsg.toolRounds,
                streamingStartedAt: assistantMsg.streamingStartedAt,
                streamingCompletedAt: assistantMsg.streamingCompletedAt,
              }
            : m
        )
      )
      // Turn is complete — final segment list (reasoning for last turn, content, etc.)
      refreshSegments()

      finishedNormally = true

      // Mark session exhausted if needed; update timestamp
      const updatedSession = {
        ...session!,
        updatedAt: Date.now(),
        isContextExhausted: contextExhausted || session.isContextExhausted,
      }
      await saveChatSession(updatedSession)
      chatSessions.update(list => {
        const updated = list.map(s => (s.id === sessionId ? updatedSession : s))
        updated.sort((a, b) => b.updatedAt - a.updatedAt)
        return updated
      })

      break  // normal exit from tool loop
    }

    // Safety: if loop exited without marking complete (shouldn't happen)
    if (!finishedNormally) {
      assistantMsg.status = 'error'
      assistantMsg.errorMessage = 'Tool call loop exited unexpectedly.'
      await saveChatMessage(assistantMsg)
      activeMessages.update(msgs =>
        msgs.map(m => m.id === assistantMsg.id ? { ...m, status: 'error' as const, errorMessage: assistantMsg.errorMessage } : m)
      )
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      assistantMsg.status = 'aborted'
      await saveChatMessage(assistantMsg)
      const abortedUserMsg = { ...userMsg, status: 'aborted' as const }
      await saveChatMessage(abortedUserMsg)
      activeMessages.update(msgs =>
        msgs.map(m => {
          if (m.id === assistantMsg.id) return { ...m, status: 'aborted' as const, thinkingInContext: false }
          if (m.id === userMsg.id)      return { ...m, status: 'aborted' as const }
          return m
        })
      )
      restoredComposerText.set(userContent)
      const updatedSession = { ...session!, updatedAt: Date.now() }
      await saveChatSession(updatedSession)
      chatSessions.update(list => {
        const updated = list.map(s => (s.id === sessionId ? updatedSession : s))
        updated.sort((a, b) => b.updatedAt - a.updatedAt)
        return updated
      })
      return
    }

    const errorMessage = e instanceof Error ? e.message : String(e)
    const isContextError = /context.*(length|window|limit|exceed|too long)|prompt.*too (large|long)|maximum.*token|token.*limit/i.test(errorMessage)

    assistantMsg.status = 'error'
    assistantMsg.errorMessage = isContextError
      ? `Context window full — the prompt is too long for this model. Start a new chat to continue.\n\nDetails: ${errorMessage}`
      : errorMessage
    await saveChatMessage(assistantMsg)
    activeMessages.update(msgs =>
      msgs.map(m => m.id === assistantMsg.id ? { ...m, status: 'error', errorMessage: assistantMsg.errorMessage } : m)
    )

    if (isContextError) {
      const updatedSession = { ...session!, updatedAt: Date.now(), isContextExhausted: true }
      await saveChatSession(updatedSession)
      chatSessions.update(list => {
        const updated = list.map(s => (s.id === sessionId ? updatedSession : s))
        updated.sort((a, b) => b.updatedAt - a.updatedAt)
        return updated
      })
    }
  } finally {
    activeAbortController = null
    isStreaming.set(false)
  }
}
