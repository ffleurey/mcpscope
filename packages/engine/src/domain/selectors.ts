import type { PartRecord, SessionRecord } from './model.js'

export interface ApiToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ApiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  reasoning_content?: string
  tool_calls?: ApiToolCall[]
  tool_call_id?: string
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface TranscriptEntry {
  id: string
  turnId: string | null
  roundId: string | null
  type: PartRecord['partType']
  roleLabel: string | null
  text: string | null
  summary: string | null
  tokens: PartRecord['tokens']
  context: PartRecord['context']
}

export interface ContextEntry {
  id: string
  turnId: string | null
  roundId: string | null
  type: PartRecord['partType']
  roleLabel: string | null
  text: string | null
  summary: string | null
  tokens: PartRecord['tokens']
}

function sortParts(parts: PartRecord[]): PartRecord[] {
  return [...parts].sort((a, b) => a.ordinal - b.ordinal)
}

export function buildModelMessages(
  session: SessionRecord,
  historicalParts: PartRecord[],
  nextUserContent: string,
): ModelMessage[] {
  const apiMessages = buildApiMessages(session, historicalParts, nextUserContent)

  return apiMessages
    .filter((message): message is ModelMessage => (
      (message.role === 'system' || message.role === 'user' || message.role === 'assistant')
      && typeof message.content === 'string'
    ))
}

export function buildApiMessages(
  session: SessionRecord,
  historicalParts: PartRecord[],
  nextUserContent?: string,
): ApiMessage[] {
  const sortedParts = sortParts(historicalParts)
  const messages: ApiMessage[] = []
  const hasSystemPromptPart = sortedParts.some(part => part.turnId === null && part.partType === 'system-prompt')
  const toolCallsByRound = new Map<string, ApiToolCall[]>()
  const assistantContentByRound = new Map<string, string[]>()
  const emittedAssistantToolRounds = new Set<string>()

  for (const part of sortedParts) {
    if (part.context.state !== 'included' || !part.roundId) continue

    if (part.partType === 'tool-call') {
      const toolJson = part.payload.json as { id?: string; name?: string; arguments?: string } | null
      const toolCalls = toolCallsByRound.get(part.roundId) ?? []
      toolCalls.push({
        id: toolJson?.id ?? part.id,
        type: 'function',
        function: {
          name: toolJson?.name ?? 'unknown',
          arguments: toolJson?.arguments ?? '{}',
        },
      })
      toolCallsByRound.set(part.roundId, toolCalls)
    }

    if (part.partType === 'assistant-content' && part.payload.text) {
      const contentParts = assistantContentByRound.get(part.roundId) ?? []
      contentParts.push(part.payload.text)
      assistantContentByRound.set(part.roundId, contentParts)
    }
  }

  for (let i = 0; i < sortedParts.length; i++) {
    const part = sortedParts[i]
    if (!part) continue
    if (part.context.state !== 'included') continue

    if ((part.partType === 'system-prompt' || part.partType === 'mcp-instructions') && part.payload.text) {
      messages.push({
        role: 'system',
        content: part.payload.text,
      })
      continue
    }

    if (part.partType === 'user-message' && part.payload.text) {
      messages.push({
        role: 'user',
        content: part.payload.text,
      })
      continue
    }

    if (part.partType === 'assistant-content' || part.partType === 'tool-call') {
      const roundId = part.roundId
      if (!roundId) {
        if (part.partType === 'assistant-content' && part.payload.text) {
          messages.push({
            role: 'assistant',
            content: part.payload.text,
          })
        }
        continue
      }
      if (emittedAssistantToolRounds.has(roundId)) {
        continue
      }
      const toolCalls = toolCallsByRound.get(roundId) ?? []
      const content = (assistantContentByRound.get(roundId) ?? []).join('') || null

      messages.push({
        role: 'assistant',
        content,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })

      emittedAssistantToolRounds.add(roundId)
      continue
    }

    if (part.partType === 'tool-result') {
      const provenance = part.provenanceJson as { toolCallId?: string } | null
      messages.push({
        role: 'tool',
        content: part.payload.text,
        tool_call_id: provenance?.toolCallId ?? part.parentPartId ?? part.id,
      })
      continue
    }

    if (part.partType === 'assistant-reasoning' && part.payload.text) {
      messages.push({
        role: 'assistant',
        content: part.payload.text,
      })
      continue
    }
  }

  if (nextUserContent) {
    messages.push({
      role: 'user',
      content: nextUserContent,
    })
  }

  if (!hasSystemPromptPart && session.modelProfileSnapshot.systemPrompt.trim()) {
    messages.unshift({
      role: 'system',
      content: session.modelProfileSnapshot.systemPrompt,
    })
  }

  return messages
}

export function buildLmToolDefinitions(parts: PartRecord[]): Array<{
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}> {
  return sortParts(parts)
    .filter(part => part.partType === 'tool-definitions')
    .flatMap(part => {
      const tools = Array.isArray(part.payload.json) ? part.payload.json : []
      return tools
        .map(tool => {
          const record = tool as { name?: string; description?: string; inputSchema?: Record<string, unknown> }
          if (!record.name) return null
          return {
            type: 'function' as const,
            function: {
              name: record.name,
              description: record.description ?? '',
              parameters: record.inputSchema ?? { type: 'object', properties: {} },
            },
          }
        })
        .filter((value): value is {
          type: 'function'
          function: {
            name: string
            description: string
            parameters: Record<string, unknown>
          }
        } => value !== null)
    })
}

export function deriveTranscriptEntries(parts: PartRecord[]): TranscriptEntry[] {
  return sortParts(parts)
    .filter(part => part.display.state === 'transcript')
    .map(part => ({
      id: part.id,
      turnId: part.turnId,
      roundId: part.roundId,
      type: part.partType,
      roleLabel: part.roleLabel,
      text: part.payload.text,
      summary: part.payload.summary,
      tokens: part.tokens,
      context: part.context,
    }))
}

export function deriveContextEntries(parts: PartRecord[]): ContextEntry[] {
  return sortParts(parts)
    .filter(part => part.context.state === 'included' || part.context.state === 'round-only')
    .map(part => ({
      id: part.id,
      turnId: part.turnId,
      roundId: part.roundId,
      type: part.partType,
      roleLabel: part.roleLabel,
      text: part.payload.text,
      summary: part.payload.summary,
      tokens: part.tokens,
    }))
}
