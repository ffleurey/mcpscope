import { z } from 'zod'

export const providerTypeSchema = z.enum(['lmstudio', 'openrouter', 'ollama'])

export const lmStudioConnectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  providerType: providerTypeSchema.default('lmstudio'),
  autoSwapModel: z.boolean().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const modelConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  connectionId: z.string(),
  connectionName: z.string().optional(),
  modelKey: z.string(),
  modelDisplayName: z.string(),
  systemPrompt: z.string(),
  // Optional: unset means "use the provider default" (request omits temperature).
  temperature: z.number().optional(),
  reasoning: z.enum(['on', 'off']).optional(),
  contextSize: z.number().int().positive().optional(),
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
  defaultEnabled: z.boolean().optional().default(false),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  // Origin + gating, surfaced by the listing API. Bundled companion servers are
  // source: 'builtin' (read-only); a key-gated companion whose key is unset carries
  // a disabledReason the GUI shows as a tooltip. Absent on user-submitted payloads.
  source: z.enum(['builtin', 'user']).optional(),
  disabledReason: z.string().nullable().optional(),
})

export const sessionStatusSchema = z.enum(['draft', 'ready', 'active', 'error', 'archived'])
export const sessionLifecycleStateSchema = z.enum(['initializing', 'ready', 'running', 'error'])
export const sessionInitStatusSchema = z.enum(['pending', 'initializing', 'ready', 'error'])
export const sessionTypeSchema = z.enum(['primary', 'session_analysis'])
export const parentKindSchema = z.enum(['session', 'benchmark'])
export const turnStatusSchema = z.enum([
  'draft',
  'streaming',
  'awaiting-tools',
  'complete',
  'error',
  'aborted',
])
export const roundStatusSchema = z.enum(['pending', 'streaming', 'complete', 'error', 'aborted'])
export const roundFinishReasonSchema = z.enum([
  'stop',
  'tool_calls',
  'length',
  'error',
  'cancelled',
])
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
export const contextStateSchema = z.enum([
  'included',
  'excluded',
  'stripped',
  'historical-only',
  'round-only',
])
export const compactionStrategySchema = z.enum(['none', 'strip-reasoning'])
export const compactionStrategyWithFallbackSchema = compactionStrategySchema
  .nullable()
  .transform((v) => v ?? 'strip-reasoning')
export const tokenSourceSchema = z.enum([
  'exact-api',
  'delta-derived',
  'corrected',
  'estimated',
  'manual',
  'unknown',
])
export const tokenConfidenceSchema = z.enum(['exact', 'corrected', 'estimated', 'unknown'])
// Mirrors the backend's exchangeKindValues (packages/engine/src/domain/model.ts). The
// legacy `lmstudio-*` kinds were dropped there (fresh-DB, no migration), so they
// are gone here too.
export const exchangeKindSchema = z.enum([
  'llm-request',
  'llm-response',
  'llm-probe-request',
  'llm-probe-response',
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
  temperature: z.number().nullable().optional(),
  reasoning: z.enum(['on', 'off']).nullable(),
  providerType: providerTypeSchema.nullable().optional(),
  contextSize: z.number().int().positive().nullable().optional(),
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
  sessionType: sessionTypeSchema.default('primary'),
  parentKind: parentKindSchema.nullable().default(null),
  parentId: z.string().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  modelProfileSnapshot: modelProfileSnapshotSchema,
  mcpProfileSnapshots: z.array(mcpProfileSnapshotSchema).default([]),
  loadedContextLength: z.number().int().positive().nullable(),
  systemPromptTokens: z.number().int().nonnegative().nullable(),
  toolDefinitionsTokens: z.number().int().nonnegative().nullable(),
  isContextExhausted: z.boolean(),
  compactionStrategy: compactionStrategyWithFallbackSchema,
  initError: z.object({ errorKind: z.string(), message: z.string() }).nullable().optional(),
})

// Per-session summary returned by GET /api/sessions?include_children=true — the
// full-tree payload the frontend needs for the sidebar (primary chats, benchmark
// runs, and analysis children). NOT the default GET /api/sessions shape, which is
// the lean, top-level-only MCP/CLI `list` contract (id/title/status/model/updated_at).
// Field names are snake_case matching the canonical backend operation contract.
export const sessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: sessionLifecycleStateSchema,
  init_status: sessionInitStatusSchema,
  session_type: sessionTypeSchema.default('primary'),
  parent_kind: parentKindSchema.nullable().default(null),
  parent_id: z.string().nullable().default(null),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  is_context_exhausted: z.boolean(),
  loaded_context_length: z.number().int().positive().nullable(),
  compaction_strategy: compactionStrategyWithFallbackSchema,
  workflow_kind: z
    .enum([
      'full_session_analysis',
      'fast_session_analysis',
      'fast_tool_analysis',
      'benchmark_evaluation',
    ])
    .optional(),
  workflow_phase: z
    .enum([
      'bootstrap',
      'assessing',
      'turn_summary',
      'coverage_validation',
      'final_aggregation',
      'complete',
      'error',
    ])
    .optional(),
  plan_progress: z
    .object({
      total: z.number(),
      completed: z.number(),
      currentCommandKind: z.string().nullable(),
      currentCommandId: z.string().nullable(),
    })
    .optional(),
  latest_error: z
    .object({
      step_id: z.string().nullable(),
      error_kind: z.string().nullable(),
      message: z.string(),
    })
    .optional(),
  model_profile_snapshot: z.object({ name: z.string() }),
  mcp_profile_snapshots: z.array(z.object({ name: z.string() })).default([]),
})

export const stepRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  stepTypeKey: z.string(),
  parentStepId: z.string().nullable(),
  childIndex: z.number().int().nonnegative(),
  status: z.string(),
  params: z.record(z.string(), z.unknown()),
  state: z.record(z.string(), z.unknown()),
  createdAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
})

export const turnRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  ownerStepId: z.string().nullable(),
  turnNumber: z.number().int().nonnegative(),
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

export const traceArtifactSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  stepId: z.string().nullable(),
  content: z.unknown(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.number().int().nonnegative(),
})

export const workflowStepTraceSchema = z.object({
  step: stepRecordSchema,
  ownedTurns: z.array(turnRecordSchema).default([]),
  postambleSteps: z.array(stepRecordSchema).default([]),
  artifacts: z.array(traceArtifactSchema).default([]),
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
  steps: z.array(stepRecordSchema).default([]),
  turns: z.array(turnRecordSchema),
  rounds: z.array(roundRecordSchema),
  parts: z.array(partRecordSchema),
  // The UI does not render raw exchanges (payloads are viewed via the inspect
  // dialog); they are carried in the trace so trace export/replay stays complete.
  rawExchanges: z.array(rawExchangeRecordSchema),
  artifacts: z.array(traceArtifactSchema).optional().default([]),
  workflowSteps: z.array(workflowStepTraceSchema).optional().default([]),
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

export const analysisStreamEventSchema = z.discriminatedUnion('type', [
  ...turnStreamEventSchema.options,
  z.object({
    type: z.literal('analysis-step-started'),
    step: stepRecordSchema,
  }),
  z.object({
    type: z.literal('analysis-step-completed'),
    step: stepRecordSchema,
  }),
  z.object({
    type: z.literal('analysis-phase-changed'),
    phase: z.string(),
    commandKind: z.string(),
    commandId: z.string(),
    completedCount: z.number(),
    totalCount: z.number(),
  }),
  z.object({
    type: z.literal('analysis-complete'),
    trace: sessionTraceBundleSchema,
  }),
  z.object({
    type: z.literal('analysis-failed'),
    message: z.string(),
  }),
])

export type AnalysisStreamEvent = z.infer<typeof analysisStreamEventSchema>

// ─── Scheduler types ───────────────────────────────────────────────────────

const executionTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session'), sessionId: z.string() }),
  z.object({
    kind: z.literal('step'),
    sessionId: z.string(),
    stepId: z.string(),
  }),
  z.object({ kind: z.literal('init'), sessionId: z.string() }),
])

const executionJobOwnerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('benchmark-run'), id: z.string() }),
  z.object({ kind: z.literal('benchmark-evaluation'), id: z.string() }),
])
export type ExecutionJobOwner = z.infer<typeof executionJobOwnerSchema>

const executionJobSchema = z.object({
  jobId: z.string(),
  target: executionTargetSchema,
  prompt: z.string().optional(),
  createdAt: z.number(),
  owner: executionJobOwnerSchema.optional(),
})

const activeExecutionJobSchema = executionJobSchema.extend({
  startedAt: z.number(),
})

const terminalJobSchema = activeExecutionJobSchema.extend({
  endedAt: z.number(),
  outcome: z.enum(['completed', 'failed', 'removed']),
  error: z.string().optional(),
})

export const executionSnapshotSchema = z.object({
  controlState: z.enum(['running', 'paused']),
  activeJob: activeExecutionJobSchema.nullable(),
  pendingJobs: z.array(executionJobSchema),
  lastTerminalJob: terminalJobSchema.nullable(),
})

export const schedulerEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('scheduler-job-enqueued'),
    job: executionJobSchema,
  }),
  z.object({
    type: z.literal('scheduler-job-started'),
    job: activeExecutionJobSchema,
  }),
  z.object({
    type: z.literal('scheduler-job-completed'),
    job: terminalJobSchema,
  }),
  z.object({ type: z.literal('scheduler-job-failed'), job: terminalJobSchema }),
  z.object({
    type: z.literal('scheduler-job-removed'),
    jobId: z.string(),
    target: executionTargetSchema,
  }),
  z.object({ type: z.literal('scheduler-paused') }),
  z.object({ type: z.literal('scheduler-resumed') }),
  z.object({
    type: z.literal('scheduler-execution-event'),
    sessionId: z.string(),
    jobId: z.string(),
    event: z.union([analysisStreamEventSchema, preludeStreamEventSchema]),
  }),
  // Initial snapshot event sent when SSE connection opens
  z.object({
    type: z.literal('scheduler-snapshot'),
    controlState: z.enum(['running', 'paused']),
    activeJob: activeExecutionJobSchema.nullable(),
    pendingJobs: z.array(executionJobSchema),
    lastTerminalJob: terminalJobSchema.nullable(),
  }),
])

export type ExecutionTarget = z.infer<typeof executionTargetSchema>
export type ExecutionJob = z.infer<typeof executionJobSchema>
export type ActiveExecutionJob = z.infer<typeof activeExecutionJobSchema>
export type TerminalJob = z.infer<typeof terminalJobSchema>
export type ExecutionSnapshot = z.infer<typeof executionSnapshotSchema>
export type SchedulerEvent = z.infer<typeof schedulerEventSchema>

// ─── Benchmark schemas ───────────────────────────────────────────────────────
// camelCase, mirroring the backend benchmark HTTP contract (see BENCHMARK.md).

export const benchmarkRunStatusSchema = z.enum([
  'pending',
  'running',
  'paused',
  'stopped',
  'complete',
  'error',
])

export const benchmarkSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const benchmarkSummarySchema = benchmarkSchema.extend({
  caseCount: z.number().int().nonnegative(),
  runCount: z.number().int().nonnegative(),
})

export const rubricCriterionSchema = z.object({
  id: z.number().int(),
  description: z.string(),
  points: z.number().int(),
})

export const benchmarkCaseSchema = z.object({
  id: z.string(),
  benchmarkId: z.string(),
  name: z.string().nullable().default(null),
  prompt: z.string(),
  orderIndex: z.number().int().nonnegative(),
  expectedToolsCalled: z.array(z.string()).default([]),
  expectedToolsNotCalled: z.array(z.string()).default([]),
  rubric: z.array(rubricCriterionSchema).default([]),
  sourceSessionId: z.string().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const benchmarkRunCaseSnapshotSchema = z.object({
  sourceCaseId: z.string(),
  name: z.string().nullable(),
  prompt: z.string(),
  expectedToolsCalled: z.array(z.string()),
  expectedToolsNotCalled: z.array(z.string()),
  rubric: z.array(rubricCriterionSchema).default([]),
})

export const benchmarkRunSessionRefSchema = z.object({
  sessionId: z.string(),
  sourceCaseId: z.string(),
  repetition: z.number().int().positive(),
  status: z.enum(['running', 'complete', 'error', 'cancelled']).default('running'),
  error: z.string().nullable().default(null),
})

export const benchmarkRunSchema = z.object({
  id: z.string(),
  benchmarkId: z.string(),
  benchmarkName: z.string(),
  status: benchmarkRunStatusSchema,
  modelConfigId: z.string(),
  mcpProfileIds: z.array(z.string()).default([]),
  cases: z.array(benchmarkRunCaseSnapshotSchema).default([]),
  repetitions: z.number().int().positive(),
  sessions: z.array(benchmarkRunSessionRefSchema).default([]),
  error: z.string().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().nullable().default(null),
  completedAt: z.number().int().nonnegative().nullable().default(null),
})

// ── Report shapes (computed on read; see backend benchmarkMetrics.ts) ──

const numberStatsSchema = z.object({
  min: z.number(),
  max: z.number(),
  mean: z.number(),
  median: z.number(),
  stddev: z.number(),
})

const perToolCountsSchema = z.object({
  calls: z.number(),
  errors: z.number(),
  resultPayloadChars: z.number(),
})

export const sessionMetricsSchema = z.object({
  sessionId: z.string(),
  terminalStatus: z.string().nullable(),
  completed: z.boolean(),
  toolCallCount: z.number(),
  toolErrorCount: z.number(),
  toolsCalled: z.array(z.string()),
  perTool: z.record(z.string(), perToolCountsSchema),
  tokens: z.object({
    prompt: z.number().nullable(),
    completion: z.number().nullable(),
    reasoning: z.number().nullable(),
    total: z.number().nullable(),
  }),
  finalAnswer: z.string().nullable(),
})

export const caseReportSchema = z.object({
  caseId: z.string(),
  prompt: z.string(),
  repetitions: z.number(),
  sessionCount: z.number(),
  hasChecks: z.boolean(),
  passCount: z.number().nullable(),
  passAtK: z.boolean().nullable(),
  passHatK: z.boolean().nullable(),
  successRate: z.number().nullable(),
  completedCount: z.number(),
  toolErrorCount: z.number(),
  toolCallStats: numberStatsSchema.nullable(),
  totalTokenStats: numberStatsSchema.nullable(),
  perTool: z.record(z.string(), perToolCountsSchema),
  sessions: z.array(sessionMetricsSchema),
})

export const perToolRollupSchema = z.object({
  calls: z.number(),
  errors: z.number(),
  errorRate: z.number(),
  resultPayloadChars: z.number(),
  casesUsedIn: z.number(),
})

export const runReportSchema = z.object({
  runId: z.string(),
  benchmarkId: z.string(),
  status: z.string(),
  repetitions: z.number(),
  caseCount: z.number(),
  sessionCount: z.number(),
  cases: z.array(caseReportSchema),
  perTool: z.record(z.string(), perToolRollupSchema),
})

// ── Benchmark HTTP response envelopes ──

export const listBenchmarksResponseSchema = z.object({
  benchmarks: z.array(benchmarkSummarySchema),
})

// Salvage runs individually: one corrupt run snapshot (e.g. bad data injected
// through an unvalidated path) must not make the whole benchmark view
// unparseable. Invalid records are dropped with a console.error; the rest of
// the screen keeps working.
const salvagedBenchmarkRunsSchema = z.array(z.unknown()).transform((items) => {
  const runs: z.infer<typeof benchmarkRunSchema>[] = []
  for (const item of items) {
    const parsed = benchmarkRunSchema.safeParse(item)
    if (parsed.success) {
      runs.push(parsed.data)
    } else {
      const id = item && typeof item === 'object' && 'id' in item ? String(item.id) : '(unknown id)'
      console.error(`mcpscope: skipping corrupt benchmark run record ${id}`, parsed.error.issues)
    }
  }
  return runs
})

export const benchmarkDetailResponseSchema = z.object({
  benchmark: benchmarkSchema,
  cases: z.array(benchmarkCaseSchema),
  runs: salvagedBenchmarkRunsSchema,
})

export const benchmarkResponseSchema = z.object({
  benchmark: benchmarkSchema,
})

export const benchmarkCaseResponseSchema = z.object({
  case: benchmarkCaseSchema,
})

export const benchmarkRunResponseSchema = z.object({
  run: benchmarkRunSchema,
})

export const benchmarkRunReportResponseSchema = z.object({
  run: benchmarkRunSchema,
  report: runReportSchema,
})

// ── Evaluation shapes (LLM rubric judging; computed scores on read) ──

export const evaluationSessionRefSchema = z.object({
  runSessionId: z.string(),
  analysisSessionId: z.string(),
  status: z.string(),
})

export const evaluationCriterionScoreSchema = z.object({
  id: z.number(),
  description: z.string(),
  max: z.number(),
  points: z.number().nullable(),
  note: z.string().default(''),
})

export const evaluationSessionScoreSchema = z.object({
  runSessionId: z.string(),
  analysisSessionId: z.string(),
  sourceCaseId: z.string(),
  status: z.string(),
  awarded: z.number().nullable(),
  max: z.number().nullable(),
  pct: z.number().nullable(),
  criteria: z.array(evaluationCriterionScoreSchema).default([]),
})

export const evaluationCaseScoreSchema = z.object({
  sourceCaseId: z.string(),
  name: z.string().nullable(),
  pctStats: numberStatsSchema.nullable(),
  sessions: z.array(evaluationSessionScoreSchema),
})

export const evaluationScoreSchema = z.object({
  overallPct: z.number().nullable(),
  cases: z.array(evaluationCaseScoreSchema),
})

export const benchmarkEvaluationSchema = z.object({
  id: z.string(),
  runId: z.string(),
  judgeModelConfigId: z.string(),
  // null => the judge ran at the provider's own default temperature.
  judgeTemperature: z.number().nullable().default(0),
  status: z.string(),
  error: z.string().nullable().default(null),
  sessions: z.array(evaluationSessionRefSchema).default([]),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const benchmarkEvaluationReportSchema = benchmarkEvaluationSchema.extend({
  expectedSessions: z.number().int().nonnegative().default(0),
  judgedSessions: z.number().int().nonnegative().default(0),
  // Completed run sessions skipped because their case snapshot has no rubric.
  skippedNoRubric: z.number().int().nonnegative().default(0),
  score: evaluationScoreSchema,
})

export const benchmarkEvaluationResponseSchema = z.object({
  evaluation: benchmarkEvaluationSchema,
})

export const benchmarkEvaluationsResponseSchema = z.object({
  evaluations: z.array(benchmarkEvaluationReportSchema),
})

export type BenchmarkRunStatus = z.infer<typeof benchmarkRunStatusSchema>
export type Benchmark = z.infer<typeof benchmarkSchema>
export type BenchmarkSummary = z.infer<typeof benchmarkSummarySchema>
export type BenchmarkCase = z.infer<typeof benchmarkCaseSchema>
export type BenchmarkRunCaseSnapshot = z.infer<typeof benchmarkRunCaseSnapshotSchema>
export type BenchmarkRun = z.infer<typeof benchmarkRunSchema>
export type BenchmarkDetailResponse = z.infer<typeof benchmarkDetailResponseSchema>
export type NumberStats = z.infer<typeof numberStatsSchema>
export type CaseReport = z.infer<typeof caseReportSchema>
export type RunReport = z.infer<typeof runReportSchema>
export type RubricCriterion = z.infer<typeof rubricCriterionSchema>
export type BenchmarkEvaluation = z.infer<typeof benchmarkEvaluationSchema>
export type BenchmarkEvaluationReport = z.infer<typeof benchmarkEvaluationReportSchema>
export type EvaluationScore = z.infer<typeof evaluationScoreSchema>
export type EvaluationCaseScore = z.infer<typeof evaluationCaseScoreSchema>

// Response of GET /api/sessions?include_children=true (the only session-list call
// the frontend makes). The default GET /api/sessions returns the lean, paginated
// MCP/CLI `list` shape instead — deliberately not modeled here.
export const listSessionsWithChildrenResponseSchema = z.object({
  api_version: z.literal(1),
  sessions: z.array(sessionSummarySchema),
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
  /** Job ID of the auto-enqueued init job. Present when the backend scheduler
   *  accepted the init job; absent if admission failed. Pass to awaitJob for
   *  precise completion tracking. */
  initJobId: z.string().optional(),
})

// Every `type` the backend `inspect` operation can return. Must stay in sync with
// the runtime resolver (hierarchicalLookup) + resolveBenchmarkInspect. The
// id-pill, CLI, and MCP all consume this; a missing value rejects the response
// client-side with a ZodError. Guarded by backendTypes.test.ts.
export const inspectTypeSchema = z.enum([
  'session',
  'setup',
  'step',
  'turn',
  'round',
  'part',
  'benchmark',
  'benchmark_case',
  'benchmark_run',
  'benchmark_evaluation',
])

export const hierarchicalLookupResponseSchema = z.object({
  id: z.string(),
  type: inspectTypeSchema,
  mode: z.enum(['summary', 'full']),
  data: z.unknown(),
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

export const sessionCreationDefaultsSchema = z.object({
  defaultModelConfigId: z.string().nullable(),
  updatedAt: z.number().int().nonnegative(),
})

// NOTE: benchmark_evaluation is intentionally absent — it is launched only by a
// benchmark run, never from the manual analysis-launch UI. The session-summary
// workflow_kind enum above does include it (for parsing those spawned sessions).
export const analysisWorkflowKindSchema = z.enum([
  'full_session_analysis',
  'fast_session_analysis',
  'fast_tool_analysis',
])

export const sessionCreationDefaultsResponseSchema = z.object({
  sessionCreationDefaults: sessionCreationDefaultsSchema,
})

export const launchAnalysisResponseSchema = z.object({
  session: sessionRecordSchema,
})

export const analysisSystemPromptResponseSchema = z.object({
  systemPrompt: z.string(),
})

export type SessionCreationDefaults = z.infer<typeof sessionCreationDefaultsSchema>
export type AnalysisWorkflowKind = z.infer<typeof analysisWorkflowKindSchema>

export type LmStudioConnection = z.infer<typeof lmStudioConnectionSchema>
export type ModelConfig = z.infer<typeof modelConfigSchema>
export type McpServerProfile = z.infer<typeof mcpServerProfileSchema>
export type ModelProfileSnapshot = z.infer<typeof modelProfileSnapshotSchema>
export type McpProfileSnapshot = z.infer<typeof mcpProfileSnapshotSchema>

export type SessionType = z.infer<typeof sessionTypeSchema>
export type ParentKind = z.infer<typeof parentKindSchema>
export type SessionRecord = z.infer<typeof sessionRecordSchema>
export type SessionSummary = z.infer<typeof sessionSummarySchema>
export type StepRecord = z.infer<typeof stepRecordSchema>
export type TurnRecord = z.infer<typeof turnRecordSchema>
export type RoundRecord = z.infer<typeof roundRecordSchema>
export type PartRecord = z.infer<typeof partRecordSchema>
export type RawExchangeRecord = z.infer<typeof rawExchangeRecordSchema>
export type TraceArtifactRecord = z.infer<typeof traceArtifactSchema>
export type WorkflowStepTrace = z.infer<typeof workflowStepTraceSchema>
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>
export type ContextEntry = z.infer<typeof contextEntrySchema>
export type SessionTraceBundle = z.infer<typeof sessionTraceBundleSchema>
export type LmStudioStreamDelta = z.infer<typeof lmStudioStreamDeltaSchema>
export type TurnStreamEvent = z.infer<typeof turnStreamEventSchema>
export type PreludeStreamEvent = z.infer<typeof preludeStreamEventSchema>
export type HierarchicalLookupResponse = z.infer<typeof hierarchicalLookupResponseSchema>
export type LaunchAnalysisResponse = z.infer<typeof launchAnalysisResponseSchema>
