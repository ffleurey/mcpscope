// Chat store: active chat sessions, messages, streaming state.
import { writable, get } from 'svelte/store'
import type { ChatSession, ChatMessage, ModelConfig, MessageTrace, ToolCallBlock, McpToolDefinition } from './types'
import {
  getAllChatSessions,
  saveChatSession,
  deleteChatSession,
  getMessagesForSession,
  saveChatMessage,
} from './db'
import { streamChatCompletion, probeSystemPromptTokens, listModels, type LmToolParam } from './services/lmstudio'
import { lmConnections, mcpProfiles } from './connectionStore'
import { McpClientHandle } from './services/mcpClient'

export const chatSessions = writable<ChatSession[]>([])
export const activeChatId = writable<string | null>(null)
export const activeMessages = writable<ChatMessage[]>([])
export const isStreaming = writable<boolean>(false)

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

// Max tool call rounds per user turn before we stop and report
const MAX_TOOL_ROUNDS = 5

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
  }
  await saveChatSession(session)
  chatSessions.update(list => [session, ...list])
  activeChatId.set(session.id)
  activeMessages.set([])
}

export async function selectChat(id: string): Promise<void> {
  activeChatId.set(id)
  const msgs = await getMessagesForSession(id)
  msgs.sort((a, b) => a.timestamp - b.timestamp)
  activeMessages.set(msgs)
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
  }
}

// Compute how many tokens belong to the user message in this turn.
// Back-filled onto the user ChatMessage when the assistant response arrives.
function computeUserTokens(
  promptTokens: number,
  prevAssistantUsage: ChatMessage['usage'] | undefined,
  prevThinkingInContext: boolean,
  sessionSystemPromptTokens: number | null,
  isFirstTurn: boolean
): number {
  if (isFirstTurn) {
    return Math.max(0, promptTokens - (sessionSystemPromptTokens ?? 0))
  }
  if (!prevAssistantUsage) return 0
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

  // On first message: snapshot model config, set title, and capture context metadata
  const existingMessages = await getMessagesForSession(sessionId)
  const isFirstTurn = existingMessages.length === 0

  if (isFirstTurn) {
    // Fetch the real loaded context length from the native API
    let loadedContextLength: number | null = null
    try {
      const models = await listModels(connection.baseUrl, connection.apiKey)
      const liveModel = models.find(m => m.key === modelConfig.modelKey)
      loadedContextLength = liveModel?.loadedContextLength ?? null
    } catch {
      // Non-fatal — context bar won't show percentage but chat still works
    }

    // Probe system prompt token count
    const systemPromptTokens = await probeSystemPromptTokens(
      connection.baseUrl,
      modelConfig.modelKey,
      modelConfig.systemPrompt,
      connection.apiKey
    )

    // Initialize MCP session if a profile is configured
    let mcpSessionUpdate: Partial<ChatSession> = {}
    if (session.mcpProfileId && !session.mcpSessionId) {
      const profile = get(mcpProfiles).find(p => p.id === session!.mcpProfileId)
      if (profile) {
        try {
          let handle = mcpHandles.get(sessionId)
          if (!handle) {
            handle = new McpClientHandle(profile.url)
            mcpHandles.set(sessionId, handle)
          }
          const info = await handle.initialize()

          // Estimate token cost of tools[] schemas
          const toolsJson = JSON.stringify(info.tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.inputSchema }
          })))
          const toolDefinitionsTokens = Math.ceil(toolsJson.length / 4)

          mcpSessionUpdate = {
            mcpSessionId: info.sessionId,
            mcpTools: info.tools,
            mcpInstructions: info.instructions,
            toolDefinitionsTokens,
          }
        } catch (e) {
          // Non-fatal — chat works without MCP, log to console
          // eslint-disable-next-line no-console
          console.error('MCP init failed:', e)
        }
      }
    }

    session = {
      ...session,
      title: userContent.slice(0, 60),
      modelConfigSnapshot: modelConfig,
      modelConfigId: modelConfig.id,
      loadedContextLength,
      systemPromptTokens,
      updatedAt: Date.now(),
      ...mcpSessionUpdate,
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

  try {
    // --- Tool execution loop ---
    // We loop up to MAX_TOOL_ROUNDS times, each time calling the LLM.
    // If it returns tool_calls we execute them and loop again.
    // On 'stop' (or any other finish_reason), we're done.
    let toolRound = 0
    let finishedNormally = false

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
            const base: ApiMessage = {
              role: 'assistant',
              content: m.content || null,  // null when assistant only made tool_calls
            }
            if (m.thinkingInContext && m.thinking) base.reasoning_content = m.thinking
            if (m.toolCalls && m.toolCalls.length > 0) {
              base.tool_calls = m.toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: tc.argumentsJson },
              }))
            }
            parts.push(base)
            if (m.toolCalls && m.toolCalls.length > 0) {
              for (const tc of m.toolCalls) {
                if (tc.status === 'done' || tc.status === 'error') {
                  parts.push({ role: 'tool', content: tc.result ?? '', tool_call_id: tc.id })
                }
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
      let toolCallsFromStream: import('./services/lmstudio').StreamedToolCall[] | undefined

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

        // Convert streamed tool calls to ToolCallBlock[] with status: pending
        const toolCallBlocks: ToolCallBlock[] = toolCallsFromStream.map(tc => ({
          id: tc.id,
          name: tc.name,
          argumentsJson: tc.argumentsJson,  // correct field name from StreamedToolCall
          status: 'pending' as const,
        }))
        assistantMsg.toolCalls = toolCallBlocks
        assistantMsg.usage = usage
        assistantMsg.trace = traceData

        // Update UI with tool calls visible
        activeMessages.update(msgs =>
          msgs.map(m => m.id === assistantMsg.id
            ? { ...m, toolCalls: toolCallBlocks, content: assistantMsg.content, thinking: assistantMsg.thinking }
            : m)
        )

        // Execute each tool call via MCP
        const mcpHandle = mcpHandles.get(sessionId)
        for (let i = 0; i < toolCallBlocks.length; i++) {
          const block = toolCallBlocks[i]
          block.status = 'running'
          block.startedAt = Date.now()

          activeMessages.update(msgs =>
            msgs.map(m => m.id === assistantMsg.id
              ? { ...m, toolCalls: [...toolCallBlocks] }
              : m)
          )

          try {
            let args: Record<string, unknown> = {}
            try { args = JSON.parse(block.argumentsJson || '{}') } catch { /* use empty */ }

            const result = mcpHandle
              ? await mcpHandle.callTool(block.name, args)
              : { content: `[MCP not initialized for tool: ${block.name}]`, isError: true, rawResult: null, durationMs: 0 }

            block.status = result.isError ? 'error' : 'done'
            block.completedAt = Date.now()
            block.result = result.content
            block.isError = result.isError
            block.mcpRaw = result.rawResult
          } catch (toolErr) {
            block.status = 'error'
            block.completedAt = Date.now()
            block.result = toolErr instanceof Error ? toolErr.message : String(toolErr)
            block.isError = true
          }

          activeMessages.update(msgs =>
            msgs.map(m => m.id === assistantMsg.id
              ? { ...m, toolCalls: [...toolCallBlocks] }
              : m)
          )
        }

        // Save assistant message with tool calls before the next round
        assistantMsg.toolCalls = toolCallBlocks
        await saveChatMessage(assistantMsg)

        // Extend apiMessages with: assistant tool_calls + tool results for next round
        apiMessages = [
          ...apiMessages,
          {
            role: 'assistant',
            content: assistantMsg.content || null,
            tool_calls: toolCallsFromStream.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: tc.argumentsJson },
            })),
          },
          ...toolCallBlocks.map(b => ({
            role: 'tool' as const,
            content: b.result ?? '',
            tool_call_id: b.id,
          })),
        ]

        // Reset streaming state for next round
        assistantMsg.content = ''
        assistantMsg.thinking = undefined
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
        const userTokens = computeUserTokens(
          usage.promptTokens,
          prevAssistantUsage,
          prevAssistant?.thinkingInContext ?? false,
          session.systemPromptTokens,
          isFirstTurn
        )
        userMsg.tokens = userTokens
        await saveChatMessage(userMsg)
        activeMessages.update(msgs =>
          msgs.map(m => m.id === userMsg.id ? { ...m, tokens: userTokens } : m)
        )
      }

      // Mark assistant message complete
      if (contextExhausted && !assistantMsg.errorMessage) {
        assistantMsg.errorMessage = 'Response truncated — context window full. Start a new chat to continue.'
      }
      assistantMsg.status = contextExhausted && !assistantMsg.content ? 'error' : 'complete'
      assistantMsg.usage = usage
      assistantMsg.trace = traceData
      assistantMsg.streamingCompletedAt = assistantMsg.streamingCompletedAt ?? Date.now()

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
                streamingStartedAt: assistantMsg.streamingStartedAt,
                streamingCompletedAt: assistantMsg.streamingCompletedAt,
              }
            : m
        )
      )

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
