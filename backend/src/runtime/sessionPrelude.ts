import type { PartRecord, SessionRecord } from '../domain/model.js'
import { deriveExactDeltaTokenMetadata, deriveExactUserTokenMetadata } from '../domain/tokenAccounting.js'
import { updatePartRecord, updateSessionRecord } from '../persistence/repository.js'
import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from './modelTurns.js'
import type { ApiMessage } from '../domain/selectors.js'
import { buildLmToolDefinitions } from '../domain/selectors.js'
import { probeRequestPromptTokens } from './promptTokenProbing.js'

function createUuid(): string {
  return crypto.randomUUID()
}

function now(): number {
  return Date.now()
}

export function createSystemPromptPart(session: SessionRecord, ordinal: number, createdAt = now()): PartRecord | null {
  const prompt = session.modelProfileSnapshot.systemPrompt.trim()
  if (!prompt) {
    return null
  }

  return {
    id: createUuid(),
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
  lmStudioGateway: LmStudioGateway,
  session: SessionRecord,
  parts: PartRecord[],
): Promise<PartRecord[]> {
  const systemPromptPart = parts.find(part => part.turnId === null && part.partType === 'system-prompt')
  if (!systemPromptPart || systemPromptPart.tokens.count != null) {
    return parts
  }

  const promptTokens = await probeRequestPromptTokens(
    lmStudioGateway,
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
      note: 'Exact LM Studio prompt token count for the system prompt message',
    },
    provenanceJson: {
      derivedFrom: 'lmstudio.prompt_tokens.probe',
    },
    updatedAt,
  }

  session.systemPromptTokens = promptTokens
  session.updatedAt = updatedAt

  const tx = database.connection.transaction(() => {
    updatePartRecord(database.connection, updatedPart)
    updateSessionRecord(database.connection, session)
  })
  tx()

  return parts.map(part => (part.id === updatedPart.id ? updatedPart : part))
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
    .filter(part => part.turnId === null && part.context.state === 'included')
    .filter(part => part.partType === 'system-prompt' || part.partType === 'mcp-instructions')
    .map(part => ({
      role: 'system' as const,
      content: part.payload.text,
    }))
    .filter((message): message is ApiMessage & { role: 'system'; content: string } => typeof message.content === 'string')
}

export async function ensureSessionPreludeTokenMetadata(
  database: BackendDatabase,
  lmStudioGateway: LmStudioGateway,
  session: SessionRecord,
  parts: PartRecord[],
): Promise<PartRecord[]> {
  let nextParts = await ensureSystemPromptTokenMetadata(database, lmStudioGateway, session, parts)
  const updatedAt = now()
  const updates = new Map<string, PartRecord>()

  const systemPromptPart = nextParts.find(part => part.turnId === null && part.partType === 'system-prompt') ?? null
  const mcpInstructionsPart = nextParts.find(part => part.turnId === null && part.partType === 'mcp-instructions') ?? null
  const toolDefinitionsPart = nextParts.find(part => part.turnId === null && part.partType === 'tool-definitions') ?? null

  if (mcpInstructionsPart && mcpInstructionsPart.tokens.count == null && mcpInstructionsPart.payload.text) {
    const prefixMessages = systemPromptPart?.payload.text
      ? [{ role: 'system' as const, content: systemPromptPart.payload.text }]
      : []
    const combinedMessages = [
      ...prefixMessages,
      { role: 'system' as const, content: mcpInstructionsPart.payload.text },
    ]

    const combinedTokens = await probeRequestPromptTokens(lmStudioGateway, session, combinedMessages, undefined, {
      database,
      sessionId: session.id,
      turnId: null,
      roundId: null,
    })
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
          { derivedFrom: 'lmstudio.prompt_tokens.prelude-delta' },
          updatedAt,
        ),
      )
    }
  }

  if (toolDefinitionsPart && toolDefinitionsPart.tokens.count == null) {
    const preludeMessages = buildSessionPreludeMessages(nextParts.map(part => updates.get(part.id) ?? part))
    const anchorMessages = preludeMessages.length > 0
      ? preludeMessages
      : [{ role: 'user' as const, content: 'Token probe anchor.' }]
    const tools = buildLmToolDefinitions([toolDefinitionsPart])
    const withoutToolsTokens = await probeRequestPromptTokens(lmStudioGateway, session, anchorMessages, undefined, {
      database,
      sessionId: session.id,
      turnId: null,
      roundId: null,
    })
    const withToolsTokens = await probeRequestPromptTokens(lmStudioGateway, session, anchorMessages, tools, {
      database,
      sessionId: session.id,
      turnId: null,
      roundId: null,
    })
    const metadata = deriveExactDeltaTokenMetadata(
      withToolsTokens,
      withoutToolsTokens,
      'Derived as exact prompt delta introduced by LM Studio tool definitions',
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
          { derivedFrom: 'lmstudio.prompt_tokens.tools-delta' },
          updatedAt,
        ),
      )
    }
  }

  if (updates.size === 0) {
    return nextParts
  }

  nextParts = nextParts.map(part => updates.get(part.id) ?? part)

  const tx = database.connection.transaction(() => {
    nextParts
      .filter(part => updates.has(part.id))
      .forEach(part => updatePartRecord(database.connection, part))
    updateSessionRecord(database.connection, session)
  })
  tx()

  return nextParts
}

export function deriveModelOnlyUserTokens(
  promptTokens: number | null,
  parts: PartRecord[],
): PartRecord['tokens'] {
  const includedPreludeParts = parts.filter(part => (
    part.turnId === null
    && part.context.state === 'included'
    && (part.partType === 'system-prompt' || part.partType === 'mcp-instructions')
  ))

  return deriveExactUserTokenMetadata(promptTokens, includedPreludeParts)
}

export function deriveExactToolPreludeTokens(
  parts: PartRecord[],
): number | null {
  const includedPreludeParts = parts.filter(part => (
    part.turnId === null
    && part.context.state === 'included'
    && (
      part.partType === 'system-prompt'
      || part.partType === 'mcp-instructions'
      || part.partType === 'tool-definitions'
    )
  ))

  if (includedPreludeParts.some(part => part.tokens.count == null)) {
    return null
  }

  return includedPreludeParts.reduce((sum, part) => sum + (part.tokens.count ?? 0), 0)
}
