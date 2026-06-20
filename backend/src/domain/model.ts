import { z } from "zod";
import { providerTypeValues } from "./configuration.js";

/** Single schema/domain version recorded in schema_meta and reported on /api/system. */
export const SCHEMA_VERSION = 3;

export const sessionTypeValues = ["primary", "session_analysis"] as const;
export const parentKindValues = ["session", "benchmark"] as const;

export const sessionStatusValues = [
  "draft",
  "ready",
  "active",
  "error",
  "archived",
] as const;
export const sessionInitStatusValues = [
  "pending",
  "initializing",
  "ready",
  "error",
] as const;
export const turnStatusValues = [
  "draft",
  "streaming",
  "awaiting-tools",
  "complete",
  "error",
  "aborted",
] as const;
export const roundStatusValues = [
  "pending",
  "streaming",
  "complete",
  "error",
  "aborted",
] as const;
export const roundFinishReasonValues = [
  "stop",
  "tool_calls",
  "length",
  "error",
  "cancelled",
] as const;
export const compactionStrategyValues = ["none", "strip-reasoning"] as const;
export const benchmarkRunStatusValues = [
  "pending",
  "running",
  "complete",
  "error",
] as const;
export const partTypeValues = [
  "system-prompt",
  "mcp-instructions",
  "tool-definitions",
  "user-message",
  "assistant-reasoning",
  "assistant-content",
  "tool-call",
  "tool-result",
  "diagnostic-note",
] as const;
export const displayStateValues = [
  "transcript",
  "diagnostic",
  "hidden",
] as const;
export const contextStateValues = [
  "included",
  "excluded",
  "stripped",
  "historical-only",
  "round-only",
] as const;
export const tokenSourceValues = [
  "exact-api",
  "delta-derived",
  "corrected",
  "estimated",
  "manual",
  "unknown",
] as const;
export const tokenConfidenceValues = [
  "exact",
  "corrected",
  "estimated",
  "unknown",
] as const;
export const exchangeKindValues = [
  // Provider-agnostic exchange kinds (current)
  "llm-request",
  "llm-response",
  "llm-probe-request",
  "llm-probe-response",
  // MCP exchanges
  "mcp-request",
  "mcp-response",
  // Legacy LM Studio-specific labels (kept for backward compatibility with stored data)
  "lmstudio-request",
  "lmstudio-response",
  "lmstudio-probe-request",
  "lmstudio-probe-response",
] as const;

export const sessionTypeSchema = z.enum(sessionTypeValues);
export const parentKindSchema = z.enum(parentKindValues);

export const sessionStatusSchema = z.enum(sessionStatusValues);
export const sessionInitStatusSchema = z.enum(sessionInitStatusValues);
export const turnStatusSchema = z.enum(turnStatusValues);
export const roundStatusSchema = z.enum(roundStatusValues);
export const roundFinishReasonSchema = z.enum(roundFinishReasonValues);
export const compactionStrategySchema = z.enum(compactionStrategyValues);
export const partTypeSchema = z.enum(partTypeValues);
export const displayStateSchema = z.enum(displayStateValues);
export const contextStateSchema = z.enum(contextStateValues);
export const tokenSourceSchema = z.enum(tokenSourceValues);
export const tokenConfidenceSchema = z.enum(tokenConfidenceValues);
export const exchangeKindSchema = z.enum(exchangeKindValues);

export const modelProfileSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  connectionBaseUrl: z.string().url(),
  apiKey: z.string().nullable(),
  modelKey: z.string(),
  modelDisplayName: z.string(),
  systemPrompt: z.string(),
  temperature: z.number(),
  reasoning: z.enum(["on", "off"]).nullable(),
  providerType: z.enum(providerTypeValues).nullable().optional(),
  contextSize: z.number().int().positive().optional().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const mcpProfileSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  transport: z.literal("streamable-http"),
  authType: z.enum(["none", "bearer", "basic"]).nullable(),
  authValue: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const tokenMetadataSchema = z.object({
  count: z.number().int().nonnegative().nullable(),
  source: tokenSourceSchema,
  confidence: tokenConfidenceSchema,
  note: z.string().nullable(),
});

export const partPayloadSchema = z.object({
  text: z.string().nullable(),
  json: z.unknown().nullable(),
  mimeType: z.string().nullable(),
  summary: z.string().nullable(),
});

export const partContextSchema = z.object({
  state: contextStateSchema,
  note: z.string().nullable(),
  strippedByCompactionAtTurnId: z.string().nullable(),
});

export const partDisplaySchema = z.object({
  state: displayStateSchema,
  collapsedByDefault: z.boolean(),
});

export const sessionRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: sessionStatusSchema,
  initStatus: sessionInitStatusSchema,
  sessionType: sessionTypeSchema.default("primary"),
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
  compactionStrategy: compactionStrategySchema,
  analysisState: z.record(z.string(), z.unknown()).optional(),
});

// Slim summary returned by GET /api/sessions — only what the UI and CLI need for listing.
// The full SessionRecord is available via GET /api/sessions/:sessionId/trace.
export const sessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: sessionStatusSchema,
  initStatus: sessionInitStatusSchema,
  sessionType: sessionTypeSchema.default("primary"),
  parentKind: parentKindSchema.nullable().default(null),
  parentId: z.string().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  isContextExhausted: z.boolean(),
  loadedContextLength: z.number().int().positive().nullable(),
  compactionStrategy: compactionStrategySchema,
  modelProfileSnapshot: z.object({ name: z.string() }),
  mcpProfileSnapshots: z.array(z.object({ name: z.string() })).default([]),
});

export const usageSummarySchema = z.object({
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
});

export const stepRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  stepTypeKey: z.string(),
  parentStepId: z.string().nullable().default(null),
  childIndex: z.number().int().nonnegative(),
  status: z.string(),
  params: z.record(z.string(), z.unknown()),
  state: z.record(z.string(), z.unknown()),
  createdAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
});

export const turnRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  ownerStepId: z.string().nullable().default(null),
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
});

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
});

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
});

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
});

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark (static test suite), cases, and runs
//
// A benchmark is a static suite; a case is one prompt (+ optional tool-behavior
// expectations); a run is one execution that selects cases and repeats each N
// times. Each repetition is a normal primary session with parentKind='benchmark'
// and parentId = the run id. See backlog/completed/benchmark-v1.md.
// ─────────────────────────────────────────────────────────────────────────────

export const benchmarkRunStatusSchema = z.enum(benchmarkRunStatusValues);

// One scored rubric criterion: a natural-language condition checked by the LLM
// judge against the session trace, worth up to `points`. `id` is 1-based and
// stable within a case's rubric (the judge references it). Shared by the
// benchmark domain (case rubric, run snapshot) and the analysis layer (the
// benchmark_evaluation judge); defined here in the domain layer so analysis can
// import it without a cycle.
export const rubricCriterionSchema = z.object({
  id: z.number().int().positive(),
  description: z.string().min(1),
  points: z.number().int().nonnegative(),
});
export type RubricCriterion = z.infer<typeof rubricCriterionSchema>;

export const benchmarkRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const benchmarkCaseRecordSchema = z.object({
  id: z.string(),
  benchmarkId: z.string(),
  // Optional human label; falls back to the prompt for display.
  name: z.string().nullable().default(null),
  prompt: z.string(),
  orderIndex: z.number().int().nonnegative(),
  // Optional deterministic tool-behavior expectations (Phase B checks). Empty = none.
  expectedToolsCalled: z.array(z.string()).default([]),
  expectedToolsNotCalled: z.array(z.string()).default([]),
  // Optional scored rubric for the LLM judge (Phase C). Empty = no rubric.
  rubric: z.array(rubricCriterionSchema).default([]),
  // Provenance: the session this case was extracted from, if any.
  sourceSessionId: z.string().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

// A run is an independent snapshot spawned from a (mutable) benchmark blueprint.
// It captures the case content + settings it ran, so editing or deleting the
// benchmark/cases afterward never alters a past run or its report.
export const benchmarkRunCaseSnapshotSchema = z.object({
  sourceCaseId: z.string(),
  name: z.string().nullable(),
  prompt: z.string(),
  expectedToolsCalled: z.array(z.string()),
  expectedToolsNotCalled: z.array(z.string()),
  // Snapshot of the case rubric at launch, so an after-the-fact evaluation
  // scores against the rubric as it was when the run executed.
  rubric: z.array(rubricCriterionSchema).default([]),
});

// One run-session: which snapshotted case and repetition a session corresponds to.
// status tracks in-flight progress: 'running' is recorded right after the session
// is created (before init/turn), then flipped to 'complete' or 'error'.
export const benchmarkRunSessionSchema = z.object({
  sessionId: z.string(),
  sourceCaseId: z.string(),
  repetition: z.number().int().positive(),
  status: z.enum(["running", "complete", "error"]).default("running"),
});

export const benchmarkRunRecordSchema = z.object({
  id: z.string(),
  benchmarkId: z.string(),
  // Snapshot of the source benchmark name for display (the benchmark may later be edited/deleted).
  benchmarkName: z.string(),
  status: benchmarkRunStatusSchema,
  // Effective model/MCP resolved and recorded at launch.
  modelConfigId: z.string(),
  mcpProfileIds: z.array(z.string()),
  // Snapshot of the selected cases at launch.
  cases: z.array(benchmarkRunCaseSnapshotSchema),
  repetitions: z.number().int().positive(),
  // Populated by the run coordinator as sessions are created.
  sessions: z.array(benchmarkRunSessionSchema).default([]),
  error: z.string().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().nullable().default(null),
  completedAt: z.number().int().nonnegative().nullable().default(null),
});

// An evaluation is a separate, repeatable judging pass over a completed run with
// a chosen judge model. It is a thin grouping/index over the reused
// session_analysis children (one per run-session); the verdicts live in analysis
// artifacts and scores are computed on read. A run carries 0..N evaluations.
export const benchmarkEvaluationSessionSchema = z.object({
  // The run-session being judged, and the session_analysis child that judges it.
  runSessionId: z.string(),
  analysisSessionId: z.string(),
  status: z.enum(["running", "complete", "error"]).default("running"),
});

export const benchmarkEvaluationRecordSchema = z.object({
  id: z.string(),
  runId: z.string(),
  judgeModelConfigId: z.string(),
  /** Sampling temperature for the judge sessions (default 0 = deterministic). */
  judgeTemperature: z.number().default(0),
  status: benchmarkRunStatusSchema,
  sessions: z.array(benchmarkEvaluationSessionSchema).default([]),
  error: z.string().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type ModelProfileSnapshot = z.infer<typeof modelProfileSnapshotSchema>;
export type McpProfileSnapshot = z.infer<typeof mcpProfileSnapshotSchema>;

export type TokenMetadata = z.infer<typeof tokenMetadataSchema>;
export type CompactionStrategy = z.infer<typeof compactionStrategySchema>;
export type SessionType = z.infer<typeof sessionTypeSchema>;
export type ParentKind = z.infer<typeof parentKindSchema>;
export type SessionRecord = z.infer<typeof sessionRecordSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type StepRecord = z.infer<typeof stepRecordSchema>;
export type TurnRecord = z.infer<typeof turnRecordSchema>;
export type RoundRecord = z.infer<typeof roundRecordSchema>;
export type PartRecord = z.infer<typeof partRecordSchema>;
export type RawExchangeRecord = z.infer<typeof rawExchangeRecordSchema>;
export type BenchmarkRecord = z.infer<typeof benchmarkRecordSchema>;
export type BenchmarkCaseRecord = z.infer<typeof benchmarkCaseRecordSchema>;
export type BenchmarkRunCaseSnapshot = z.infer<
  typeof benchmarkRunCaseSnapshotSchema
>;
export type BenchmarkRunSession = z.infer<typeof benchmarkRunSessionSchema>;
export type BenchmarkRunRecord = z.infer<typeof benchmarkRunRecordSchema>;
export type BenchmarkEvaluationSession = z.infer<
  typeof benchmarkEvaluationSessionSchema
>;
export type BenchmarkEvaluationRecord = z.infer<
  typeof benchmarkEvaluationRecordSchema
>;

export function getDomainModelSummary() {
  return {
    version: SCHEMA_VERSION,
    // Canonical execution-model entities in the landed implementation.
    entities: [
      "session",
      "step",
      "turn",
      "round",
      "part",
      "raw-exchange",
      "benchmark",
      "benchmark-case",
      "benchmark-run",
    ],
    enums: {
      sessionTypeValues,
      parentKindValues,
      benchmarkRunStatusValues,
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
  };
}
