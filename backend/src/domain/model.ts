import { z } from 'zod'

export const DOMAIN_MODEL_VERSION = 1

export const sessionTypeValues = ['primary', 'session_analysis', 'session_compaction', 'benchmark_analysis'] as const
export const parentKindValues = ['session', 'benchmark'] as const

export const sessionStatusValues = ['draft', 'ready', 'active', 'error', 'archived'] as const
export const sessionInitStatusValues = ['pending', 'initializing', 'ready', 'error'] as const
export const turnStatusValues = ['draft', 'streaming', 'awaiting-tools', 'complete', 'error', 'aborted'] as const
export const roundStatusValues = ['pending', 'streaming', 'complete', 'error', 'aborted'] as const
export const roundFinishReasonValues = ['stop', 'tool_calls', 'length', 'error', 'cancelled'] as const
export const compactionStrategyValues = ['none', 'strip-reasoning'] as const
export const partTypeValues = [
  'system-prompt',
  'mcp-instructions',
  'tool-definitions',
  'user-message',
  'assistant-reasoning',
  'assistant-content',
  'tool-call',
  'tool-result',
  'diagnostic-note',
] as const
export const displayStateValues = ['transcript', 'diagnostic', 'hidden'] as const
export const contextStateValues = ['included', 'excluded', 'stripped', 'historical-only', 'round-only'] as const
export const tokenSourceValues = ['exact-api', 'delta-derived', 'corrected', 'estimated', 'manual', 'unknown'] as const
export const tokenConfidenceValues = ['exact', 'corrected', 'estimated', 'unknown'] as const
export const exchangeKindValues = [
  'lmstudio-request',
  'lmstudio-response',
  'lmstudio-probe-request',
  'lmstudio-probe-response',
  'mcp-request',
  'mcp-response',
] as const

export const sessionTypeSchema = z.enum(sessionTypeValues)
export const parentKindSchema = z.enum(parentKindValues)

export const sessionStatusSchema = z.enum(sessionStatusValues)
export const sessionInitStatusSchema = z.enum(sessionInitStatusValues)
export const turnStatusSchema = z.enum(turnStatusValues)
export const roundStatusSchema = z.enum(roundStatusValues)
export const roundFinishReasonSchema = z.enum(roundFinishReasonValues)
export const compactionStrategySchema = z.enum(compactionStrategyValues)
export const partTypeSchema = z.enum(partTypeValues)
export const displayStateSchema = z.enum(displayStateValues)
export const contextStateSchema = z.enum(contextStateValues)
export const tokenSourceSchema = z.enum(tokenSourceValues)
export const tokenConfidenceSchema = z.enum(tokenConfidenceValues)
export const exchangeKindSchema = z.enum(exchangeKindValues)

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

export const sessionRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: sessionStatusSchema,
  initStatus: sessionInitStatusSchema,
  sessionType: sessionTypeSchema.default('primary'),
  parentKind: parentKindSchema.nullable().default(null),
  parentId: z.string().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  modelProfileSnapshot: modelProfileSnapshotSchema,
  mcpProfileSnapshot: mcpProfileSnapshotSchema.nullable(),
  loadedContextLength: z.number().int().positive().nullable(),
  systemPromptTokens: z.number().int().nonnegative().nullable(),
  toolDefinitionsTokens: z.number().int().nonnegative().nullable(),
  isContextExhausted: z.boolean(),
  compactionStrategy: compactionStrategySchema,
})

// Slim summary returned by GET /api/sessions — only what the UI and CLI need for listing.
// The full SessionRecord is available via GET /api/sessions/:sessionId/trace.
export const sessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: sessionStatusSchema,
  initStatus: sessionInitStatusSchema,
  sessionType: sessionTypeSchema.default('primary'),
  parentKind: parentKindSchema.nullable().default(null),
  parentId: z.string().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  isContextExhausted: z.boolean(),
  loadedContextLength: z.number().int().positive().nullable(),
  compactionStrategy: compactionStrategySchema,
  modelProfileSnapshot: z.object({ name: z.string() }),
  mcpProfileSnapshot: z.object({ name: z.string() }).nullable(),
})

export const usageSummarySchema = z.object({
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
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

export type ModelProfileSnapshot = z.infer<typeof modelProfileSnapshotSchema>
export type McpProfileSnapshot = z.infer<typeof mcpProfileSnapshotSchema>
export type TokenMetadata = z.infer<typeof tokenMetadataSchema>
export type CompactionStrategy = z.infer<typeof compactionStrategySchema>
export type SessionType = z.infer<typeof sessionTypeSchema>
export type ParentKind = z.infer<typeof parentKindSchema>
export type SessionRecord = z.infer<typeof sessionRecordSchema>
export type SessionSummary = z.infer<typeof sessionSummarySchema>
export type TurnRecord = z.infer<typeof turnRecordSchema>
export type RoundRecord = z.infer<typeof roundRecordSchema>
export type PartRecord = z.infer<typeof partRecordSchema>
export type RawExchangeRecord = z.infer<typeof rawExchangeRecordSchema>

// ─── Benchmark container record ───────────────────────────────────────────────

/**
 * BenchmarkRecord is the minimal persistence record for a Benchmark container.
 * Stored in the `session_containers` table with container_type_key = 'benchmark'.
 *
 * Sessions may reference a benchmark by setting parentKind='benchmark' and
 * parentId to the benchmark's id.  Benchmark is a `SessionContainer` that is
 * not itself a Session.
 */
export const benchmarkRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  state: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export type BenchmarkRecord = z.infer<typeof benchmarkRecordSchema>

export function getDomainModelSummary() {
  return {
    version: DOMAIN_MODEL_VERSION,
    entities: ['session', 'turn', 'round', 'part', 'raw-exchange'],
    enums: {
      sessionTypeValues,
      parentKindValues,
      sessionStatusValues,
      sessionInitStatusValues,
      turnStatusValues,
      roundStatusValues,
      roundFinishReasonValues,
      compactionStrategyValues,
      partTypeValues,
      displayStateValues,
      contextStateValues,
      tokenSourceValues,
      tokenConfidenceValues,
      exchangeKindValues,
    },
  }
}
