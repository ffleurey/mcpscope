import type { PartRecord, SessionRecord } from '../domain/model.js'
import { formatSetupPartId } from '../domain/hierarchicalIds.js'
import { deriveExactDeltaTokenMetadata } from '../domain/tokenAccounting.js'
import { updatePartRecord, updateSessionRecord } from '../persistence/repository.js'
import { runInTransaction } from '../persistence/connection.js'
import type { BackendDatabase } from '../persistence/db.js'
import type { ChatCompletionGateway } from './modelTurns.js'
import type { ApiMessage } from '../domain/selectors.js'
import { buildLmToolDefinitions } from '../domain/selectors.js'
import { probeRequestPromptTokens } from './promptTokenProbing.js'
import { getProviderContextLength } from '../services/provider/index.js'

function now(): number {
  return Date.now()
}

export function createSystemPromptPart(
  session: SessionRecord,
  ordinal: number,
  preludePartNumber: number,
  createdAt = now(),
): PartRecord | null {
  const prompt = session.modelProfileSnapshot.systemPrompt.trim()
  if (!prompt) {
    return null
  }

  return {
    id: formatSetupPartId(session.id, preludePartNumber, 'system-prompt'),
    sessionId: session.id,
    turnId: null,
    roundId: null,
    parentPartId: null,
    ordinal,
    partType: 'system-prompt',
    roleLabel: 'system',
    payload: {
      text: prompt,
      json: null,
      mimeType: 'text/plain',
      summary: 'Model system prompt',
    },
    display: {
      state: 'diagnostic',
      collapsedByDefault: true,
    },
    context: {
      state: 'included',
      note: 'Session-level system prompt included in every turn',
      strippedByCompactionAtTurnId: null,
    },
    tokens: {
      count: null,
      source: 'unknown',
      confidence: 'unknown',
      note: 'Exact prompt token count has not been probed yet',
    },
    provenanceJson: null,
    createdAt,
    updatedAt: createdAt,
  }
}

export async function ensureSystemPromptTokenMetadata(
  database: BackendDatabase,
  chatCompletionGateway: ChatCompletionGateway,
  session: SessionRecord,
  parts: PartRecord[],
): Promise<PartRecord[]> {
  const systemPromptPart = parts.find(
    (part) => part.turnId === null && part.partType === 'system-prompt',
  )
  if (!systemPromptPart || systemPromptPart.tokens.count != null) {
    return parts
  }

  const promptTokens = await probeRequestPromptTokens(
    chatCompletionGateway,
    session,
    [
      {
        role: 'system',
        content: systemPromptPart.payload.text,
      },
    ],
    undefined,
    {
      database,
      sessionId: session.id,
      turnId: null,
      roundId: null,
    },
  )

  if (promptTokens == null) {
    return parts
  }

  const updatedAt = now()
  const updatedPart: PartRecord = {
    ...systemPromptPart,
    tokens: {
      count: promptTokens,
      source: 'exact-api',
      confidence: 'exact',
      note: 'Exact prompt token count for the system prompt message',
    },
    provenanceJson: {
      derivedFrom: 'prompt_tokens.probe',
    },
    updatedAt,
  }

  session.systemPromptTokens = promptTokens
  session.updatedAt = updatedAt

  const tx = () =>
    runInTransaction(database.connection, () => {
      updatePartRecord(database.connection, updatedPart)
      updateSessionRecord(database.connection, session)
    })
  tx()

  return parts.map((part) => (part.id === updatedPart.id ? updatedPart : part))
}

function updatePartTokens(
  part: PartRecord,
  tokenMetadata: PartRecord['tokens'],
  provenanceJson: unknown,
  updatedAt: number,
): PartRecord {
  return {
    ...part,
    tokens: tokenMetadata,
    provenanceJson,
    updatedAt,
  }
}

function buildSessionPreludeMessages(parts: PartRecord[]): ApiMessage[] {
  return parts
    .filter((part) => part.turnId === null && part.context.state === 'included')
    .filter((part) => part.partType === 'system-prompt' || part.partType === 'mcp-instructions')
    .map((part) => ({
      role: 'system' as const,
      content: part.payload.text,
    }))
    .filter(
      (message): message is ApiMessage & { role: 'system'; content: string } =>
        typeof message.content === 'string',
    )
}

/**
 * Record the context window the model is *actually* loaded with.
 *
 * Prefers the gateway's authoritative loaded-context lookup (LM Studio native
 * API reports the real `context_length` of the running instance). Only when
 * that is unavailable — and we have nothing recorded yet — does it fall back to
 * the provider-level resolution (Ollama `/api/show`, OAI `/v1/models`, or the
 * configured `contextSize`). The fallback never overwrites a previously-captured
 * real value, so an evicted model on re-entry can't downgrade a good reading.
 */
async function captureLoadedContextLength(
  database: BackendDatabase,
  chatCompletionGateway: ChatCompletionGateway,
  session: SessionRecord,
): Promise<void> {
  let contextLength: number | null = null

  if (chatCompletionGateway.getLoadedContextLength) {
    contextLength = await chatCompletionGateway.getLoadedContextLength(
      session.modelProfileSnapshot.connectionBaseUrl,
      session.modelProfileSnapshot.apiKey ?? undefined,
      session.modelProfileSnapshot.modelKey,
    )
  }

  // No authoritative value. Only resolve a fallback if we have nothing yet —
  // don't clobber a real reading from a prior call with a config echo.
  if (contextLength == null && session.loadedContextLength == null) {
    const provider = session.modelProfileSnapshot.providerType ?? 'lmstudio'
    contextLength = await getProviderContextLength(
      session.modelProfileSnapshot.connectionBaseUrl,
      session.modelProfileSnapshot.apiKey ?? undefined,
      session.modelProfileSnapshot.modelKey,
      provider,
      session.modelProfileSnapshot.contextSize,
    )
  }

  if (contextLength != null && contextLength !== session.loadedContextLength) {
    session.loadedContextLength = contextLength
    session.updatedAt = now()
    updateSessionRecord(database.connection, session)
  }
}

export async function ensureSessionPreludeTokenMetadata(
  database: BackendDatabase,
  chatCompletionGateway: ChatCompletionGateway,
  session: SessionRecord,
  parts: PartRecord[],
): Promise<PartRecord[]> {
  let nextParts = await ensureSystemPromptTokenMetadata(
    database,
    chatCompletionGateway,
    session,
    parts,
  )
  const updatedAt = now()
  const updates = new Map<string, PartRecord>()

  const systemPromptPart =
    nextParts.find((part) => part.turnId === null && part.partType === 'system-prompt') ?? null
  const mcpInstructionsPart =
    nextParts.find((part) => part.turnId === null && part.partType === 'mcp-instructions') ?? null
  const toolDefinitionsPart =
    nextParts.find((part) => part.turnId === null && part.partType === 'tool-definitions') ?? null

  if (
    mcpInstructionsPart &&
    mcpInstructionsPart.tokens.count == null &&
    mcpInstructionsPart.payload.text
  ) {
    const prefixMessages = systemPromptPart?.payload.text
      ? [{ role: 'system' as const, content: systemPromptPart.payload.text }]
      : []
    const combinedMessages = [
      ...prefixMessages,
      { role: 'system' as const, content: mcpInstructionsPart.payload.text },
    ]

    const combinedTokens = await probeRequestPromptTokens(
      chatCompletionGateway,
      session,
      combinedMessages,
      undefined,
      {
        database,
        sessionId: session.id,
        turnId: null,
        roundId: null,
      },
    )
    const prefixTokens = prefixMessages.length > 0 ? (systemPromptPart?.tokens.count ?? null) : 0
    const metadata = deriveExactDeltaTokenMetadata(
      combinedTokens,
      prefixTokens,
      'Derived as exact session-prelude prompt delta for MCP instructions',
      'Exact MCP instruction tokens could not be probed',
    )

    if (metadata.count != null) {
      updates.set(
        mcpInstructionsPart.id,
        updatePartTokens(
          mcpInstructionsPart,
          metadata,
          { derivedFrom: 'prompt_tokens.prelude-delta' },
          updatedAt,
        ),
      )
    }
  }

  if (toolDefinitionsPart && toolDefinitionsPart.tokens.count == null) {
    const preludeMessages = buildSessionPreludeMessages(
      nextParts.map((part) => updates.get(part.id) ?? part),
    )
    const anchorMessages =
      preludeMessages.length > 0
        ? preludeMessages
        : [{ role: 'user' as const, content: 'Token probe anchor.' }]
    const tools = buildLmToolDefinitions([toolDefinitionsPart])
    const withoutToolsTokens = await probeRequestPromptTokens(
      chatCompletionGateway,
      session,
      anchorMessages,
      undefined,
      {
        database,
        sessionId: session.id,
        turnId: null,
        roundId: null,
      },
    )
    const withToolsTokens = await probeRequestPromptTokens(
      chatCompletionGateway,
      session,
      anchorMessages,
      tools,
      {
        database,
        sessionId: session.id,
        turnId: null,
        roundId: null,
      },
    )
    const metadata = deriveExactDeltaTokenMetadata(
      withToolsTokens,
      withoutToolsTokens,
      'Derived as exact prompt delta introduced by tool definitions',
      'Exact tool-definition tokens could not be probed',
    )

    if (metadata.count != null) {
      session.toolDefinitionsTokens = metadata.count
      session.updatedAt = updatedAt
      updates.set(
        toolDefinitionsPart.id,
        updatePartTokens(
          toolDefinitionsPart,
          metadata,
          { derivedFrom: 'prompt_tokens.tools-delta' },
          updatedAt,
        ),
      )
    }
  }

  // Capture the *actual* loaded context window now that probing has loaded the
  // model. Must run after the probes, not before: the probe is what triggers the
  // load, so querying earlier would miss it and fall back to the configured
  // value (which is exactly what masked models loading at the wrong size).
  await captureLoadedContextLength(database, chatCompletionGateway, session)

  if (updates.size === 0) {
    return nextParts
  }

  nextParts = nextParts.map((part) => updates.get(part.id) ?? part)

  const tx = () =>
    runInTransaction(database.connection, () => {
      nextParts
        .filter((part) => updates.has(part.id))
        .forEach((part) => updatePartRecord(database.connection, part))
      updateSessionRecord(database.connection, session)
    })
  tx()

  return nextParts
}

export function deriveExactToolPreludeTokens(parts: PartRecord[]): number | null {
  const includedPreludeParts = parts.filter(
    (part) =>
      part.turnId === null &&
      part.context.state === 'included' &&
      (part.partType === 'system-prompt' ||
        part.partType === 'mcp-instructions' ||
        part.partType === 'tool-definitions'),
  )

  if (includedPreludeParts.some((part) => part.tokens.count == null)) {
    return null
  }

  return includedPreludeParts.reduce((sum, part) => sum + (part.tokens.count ?? 0), 0)
}
