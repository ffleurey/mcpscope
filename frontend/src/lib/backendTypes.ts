import { z } from 'zod'

export const lmStudioConnectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const modelConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  connectionId: z.string(),
  modelKey: z.string(),
  modelDisplayName: z.string(),
  systemPrompt: z.string(),
  temperature: z.number(),
  reasoning: z.enum(['on', 'off']).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const mcpServerProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  transport: z.literal('streamable-http'),
  authType: z.enum(['none', 'bearer', 'basic']).nullable().optional().default(null),
  authValue: z.string().nullable().optional().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const sessionStatusSchema = z.enum(['draft', 'ready', 'active', 'error', 'archived'])
export const sessionInitStatusSchema = z.enum(['pending', 'initializing', 'ready', 'error'])
export const turnStatusSchema = z.enum(['draft', 'streaming', 'awaiting-tools', 'complete', 'error', 'aborted'])
export const roundStatusSchema = z.enum(['pending', 'streaming', 'complete', 'error', 'aborted'])
export const roundFinishReasonSchema = z.enum(['stop', 'tool_calls', 'length', 'error', 'cancelled'])
export const partTypeSchema = z.enum([
  'system-prompt',
  'mcp-instructions',
  'tool-definitions',
  'user-message',
  'assistant-reasoning',
  'assistant-content',
  'tool-call',
  'tool-result',
  'diagnostic-note',
])
export const displayStateSchema = z.enum(['transcript', 'diagnostic', 'hidden'])
export const contextStateSchema = z.enum(['included', 'excluded', 'stripped', 'historical-only', 'round-only'])
export const compactionStrategySchema = z.enum(['none', 'strip-reasoning'])
export const compactionStrategyWithFallbackSchema = compactionStrategySchema.nullable().transform(v => v ?? 'strip-reasoning')
export const tokenSourceSchema = z.enum(['exact-api', 'delta-derived', 'corrected', 'estimated', 'manual', 'unknown'])
export const tokenConfidenceSchema = z.enum(['exact', 'corrected', 'estimated', 'unknown'])
export const exchangeKindSchema = z.enum([
  'lmstudio-request',
  'lmstudio-response',
  'lmstudio-probe-request',
  'lmstudio-probe-response',
  'mcp-request',
  'mcp-response',
])
export const lmStudioStreamDeltaSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('reasoning'),
    textDelta: z.string(),
  }),
  z.object({
    kind: z.literal('content'),
    textDelta: z.string(),
  }),
  z.object({
    kind: z.literal('tool-call'),
    toolCallIndex: z.number().int().nonnegative(),
    idDelta: z.string().optional(),
    nameDelta: z.string().optional(),
    argumentsDelta: z.string().optional(),
  }),
])

export const modelProfileSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  connectionBaseUrl: z.string().url(),
  apiKey: z.string().nullable(),
  modelKey: z.string(),
  modelDisplayName: z.string(),
  systemPrompt: z.string(),
  temperature: z.number(),
  reasoning: z.enum(['on', 'off']).nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const mcpProfileSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  transport: z.literal('streamable-http'),
  authType: z.enum(['none', 'bearer', 'basic']).nullable(),
  authValue: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const tokenMetadataSchema = z.object({
  count: z.number().int().nonnegative().nullable(),
  source: tokenSourceSchema,
  confidence: tokenConfidenceSchema,
  note: z.string().nullable(),
})

export const partPayloadSchema = z.object({
  text: z.string().nullable(),
  json: z.unknown().nullable(),
  mimeType: z.string().nullable(),
  summary: z.string().nullable(),
})

export const partContextSchema = z.object({
  state: contextStateSchema,
  note: z.string().nullable(),
  strippedByCompactionAtTurnId: z.string().nullable(),
})

export const partDisplaySchema = z.object({
  state: displayStateSchema,
  collapsedByDefault: z.boolean(),
})

export const usageSummarySchema = z.object({
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
})

export const sessionRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: sessionStatusSchema,
  initStatus: sessionInitStatusSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  modelProfileSnapshot: modelProfileSnapshotSchema,
  mcpProfileSnapshot: mcpProfileSnapshotSchema.nullable(),
  loadedContextLength: z.number().int().positive().nullable(),
  systemPromptTokens: z.number().int().nonnegative().nullable(),
  toolDefinitionsTokens: z.number().int().nonnegative().nullable(),
  isContextExhausted: z.boolean(),
  compactionStrategy: compactionStrategyWithFallbackSchema,
})

export const turnRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  sequenceNumber: z.number().int().nonnegative(),
  status: turnStatusSchema,
  createdAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
  outcome: z.string().nullable(),
  usage: usageSummarySchema,
  contextTokensAtTurnEnd: z.number().int().nonnegative().nullable(),
  contextTokensAfterCompaction: z.number().int().nonnegative().nullable(),
  compactionApplied: compactionStrategySchema.nullable(),
  compactionTokensRemoved: z.number().int().nonnegative().nullable(),
})

export const roundRecordSchema = z.object({
  id: z.string(),
  turnId: z.string(),
  roundIndex: z.number().int().nonnegative(),
  status: roundStatusSchema,
  finishReason: roundFinishReasonSchema.nullable(),
  startedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
  usage: usageSummarySchema,
  requestPayloadJson: z.unknown().nullable(),
  responseTraceJson: z.unknown().nullable(),
})

export const partRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  turnId: z.string().nullable(),
  roundId: z.string().nullable(),
  parentPartId: z.string().nullable(),
  ordinal: z.number().int().nonnegative(),
  partType: partTypeSchema,
  roleLabel: z.string().nullable(),
  payload: partPayloadSchema,
  display: partDisplaySchema,
  context: partContextSchema,
  tokens: tokenMetadataSchema,
  provenanceJson: z.unknown().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const rawExchangeRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  turnId: z.string().nullable(),
  roundId: z.string().nullable(),
  kind: exchangeKindSchema,
  requestUrl: z.string(),
  requestMethod: z.string(),
  requestHeadersJson: z.unknown().nullable(),
  requestBody: z.string().nullable(),
  responseStatus: z.number().int().nullable(),
  responseHeadersJson: z.unknown().nullable(),
  responseBody: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
})

export const transcriptEntrySchema = z.object({
  id: z.string(),
  turnId: z.string().nullable(),
  roundId: z.string().nullable(),
  type: partTypeSchema,
  roleLabel: z.string().nullable(),
  text: z.string().nullable(),
  summary: z.string().nullable(),
  tokens: tokenMetadataSchema,
  context: partContextSchema,
})

export const contextEntrySchema = z.object({
  id: z.string(),
  turnId: z.string().nullable(),
  roundId: z.string().nullable(),
  type: partTypeSchema,
  roleLabel: z.string().nullable(),
  text: z.string().nullable(),
  summary: z.string().nullable(),
  tokens: tokenMetadataSchema,
})

export const sessionTraceBundleSchema = z.object({
  session: sessionRecordSchema,
  turns: z.array(turnRecordSchema),
  rounds: z.array(roundRecordSchema),
  parts: z.array(partRecordSchema),
  rawExchanges: z.array(rawExchangeRecordSchema),
  transcript: z.array(transcriptEntrySchema),
  context: z.array(contextEntrySchema),
})
export const turnStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('turn-started'),
    turn: turnRecordSchema,
  }),
  z.object({
    type: z.literal('round-started'),
    round: roundRecordSchema,
  }),
  z.object({
    type: z.literal('part-delta'),
    turnId: z.string(),
    roundId: z.string(),
    delta: lmStudioStreamDeltaSchema,
  }),
  z.object({
    type: z.literal('part-committed'),
    part: partRecordSchema,
  }),
  z.object({
    type: z.literal('round-committed'),
    round: roundRecordSchema,
  }),
  z.object({
    type: z.literal('turn-committed'),
    turn: turnRecordSchema,
    trace: sessionTraceBundleSchema,
  }),
  z.object({
    type: z.literal('turn-failed'),
    turnId: z.string().nullable(),
    message: z.string(),
    errorType: z.string().optional(),
    details: z.unknown().optional(),
  }),
])

export const preludeStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('part-committed'),
    part: partRecordSchema,
  }),
  z.object({
    type: z.literal('prelude-complete'),
    trace: sessionTraceBundleSchema,
  }),
  z.object({
    type: z.literal('prelude-failed'),
    message: z.string(),
    errorType: z.string().optional(),
    details: z.unknown().optional(),
  }),
])

export const listSessionsResponseSchema = z.object({
  sessions: z.array(sessionRecordSchema),
})

export const listLmConnectionsResponseSchema = z.object({
  lmConnections: z.array(lmStudioConnectionSchema),
})

export const listModelConfigsResponseSchema = z.object({
  modelConfigs: z.array(modelConfigSchema),
})

export const listMcpProfilesResponseSchema = z.object({
  mcpProfiles: z.array(mcpServerProfileSchema),
})

export const createSessionResponseSchema = z.object({
  session: sessionRecordSchema,
})

export const upsertLmConnectionResponseSchema = z.object({
  lmConnection: lmStudioConnectionSchema,
})

export const upsertModelConfigResponseSchema = z.object({
  modelConfig: modelConfigSchema,
})

export const upsertMcpProfileResponseSchema = z.object({
  mcpProfile: mcpServerProfileSchema,
})

export type LmStudioConnection = z.infer<typeof lmStudioConnectionSchema>
export type ModelConfig = z.infer<typeof modelConfigSchema>
export type McpServerProfile = z.infer<typeof mcpServerProfileSchema>
export type ModelProfileSnapshot = z.infer<typeof modelProfileSnapshotSchema>
export type McpProfileSnapshot = z.infer<typeof mcpProfileSnapshotSchema>
export type SessionRecord = z.infer<typeof sessionRecordSchema>
export type TurnRecord = z.infer<typeof turnRecordSchema>
export type RoundRecord = z.infer<typeof roundRecordSchema>
export type PartRecord = z.infer<typeof partRecordSchema>
export type RawExchangeRecord = z.infer<typeof rawExchangeRecordSchema>
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>
export type ContextEntry = z.infer<typeof contextEntrySchema>
export type SessionTraceBundle = z.infer<typeof sessionTraceBundleSchema>
export type LmStudioStreamDelta = z.infer<typeof lmStudioStreamDeltaSchema>
export type TurnStreamEvent = z.infer<typeof turnStreamEventSchema>
export type PreludeStreamEvent = z.infer<typeof preludeStreamEventSchema>
