// ─────────────────────────────────────────────────────────────────────────────
// Agent-facing benchmark operations — the snake_case catalog surface mirrored by
// CLI and MCP. Thin wrappers over the camelCase functions in benchmark.ts that
// map record fields to snake_case result shapes. Registered in the operation
// catalog (catalog.ts) so each is auto-exposed as an mcpscope_<id> MCP tool and
// gets a CLI/HTTP endpoint. See AGENTS.md (CLI/MCP parity, snake_case results).
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import type { OperationContext } from "./context.js";
import { OperationError } from "./errors.js";
import {
  createBenchmarkEntry,
  listBenchmarkEntries,
  getBenchmarkDetail,
  addBenchmarkCase,
  addBenchmarkCaseFromSession,
  updateBenchmarkCaseEntry,
  deleteBenchmarkCaseEntry,
  launchBenchmarkRun,
  getBenchmarkRunProgress,
  getBenchmarkRunReport,
  pauseBenchmarkRun,
  resumeBenchmarkRun,
  stopBenchmarkRun,
  evaluateBenchmarkRun,
  getBenchmarkRunEvaluationReports,
  pauseBenchmarkEvaluation,
  resumeBenchmarkEvaluation,
  stopBenchmarkEvaluation,
  type BenchmarkRunProgress,
  type BenchmarkEvaluationReport,
} from "./benchmark.js";
import {
  getBenchmark,
  getBenchmarkCase,
  getBenchmarkRun,
  getBenchmarkEvaluation,
  listBenchmarkEvaluationsByRun,
} from "../persistence/benchmarkRepository.js";
import type {
  BenchmarkRecord,
  BenchmarkCaseRecord,
  BenchmarkRunRecord,
  BenchmarkEvaluationRecord,
} from "../domain/model.js";
import type {
  RunReport,
  CaseReport,
  SessionMetrics,
  PerToolCounts,
  PerToolRollup,
  NumberStats,
} from "./benchmarkMetrics.js";

// ── snake_case mappers ───────────────────────────────────────────────────────

function benchmarkToSnake(b: BenchmarkRecord) {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    created_at: b.createdAt,
    updated_at: b.updatedAt,
  };
}

function caseToSnake(c: BenchmarkCaseRecord) {
  return {
    id: c.id,
    benchmark_id: c.benchmarkId,
    name: c.name,
    prompt: c.prompt,
    order_index: c.orderIndex,
    expected_tools_called: c.expectedToolsCalled,
    expected_tools_not_called: c.expectedToolsNotCalled,
    rubric: c.rubric,
    source_session_id: c.sourceSessionId,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

function evaluationToSnake(e: BenchmarkEvaluationRecord) {
  return {
    id: e.id,
    run_id: e.runId,
    judge_model_config_id: e.judgeModelConfigId,
    judge_temperature: e.judgeTemperature,
    status: e.status,
    error: e.error,
    sessions: e.sessions.map((s) => ({
      run_session_id: s.runSessionId,
      analysis_session_id: s.analysisSessionId,
      status: s.status,
    })),
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  };
}

function evaluationReportToSnake(e: BenchmarkEvaluationReport) {
  return {
    ...evaluationToSnake(e),
    expected_sessions: e.expectedSessions,
    judged_sessions: e.judgedSessions,
    score: {
      overall_pct: e.score.overallPct,
      cases: e.score.cases.map((c) => ({
        source_case_id: c.sourceCaseId,
        name: c.name,
        pct_stats: numberStatsToSnake(c.pctStats),
        sessions: c.sessions.map((s) => ({
          run_session_id: s.runSessionId,
          analysis_session_id: s.analysisSessionId,
          source_case_id: s.sourceCaseId,
          status: s.status,
          awarded: s.awarded,
          max: s.max,
          pct: s.pct,
          criteria: s.criteria.map((cr) => ({
            id: cr.id,
            description: cr.description,
            max: cr.max,
            points: cr.points,
            note: cr.note,
          })),
        })),
      })),
    },
  };
}

function runToSnake(r: BenchmarkRunRecord) {
  return {
    id: r.id,
    benchmark_id: r.benchmarkId,
    benchmark_name: r.benchmarkName,
    status: r.status,
    model_config_id: r.modelConfigId,
    mcp_profile_ids: r.mcpProfileIds,
    repetitions: r.repetitions,
    max_tool_rounds: r.maxToolRounds,
    cases: r.cases.map((c) => ({
      source_case_id: c.sourceCaseId,
      name: c.name,
      prompt: c.prompt,
      expected_tools_called: c.expectedToolsCalled,
      expected_tools_not_called: c.expectedToolsNotCalled,
      rubric: c.rubric,
    })),
    sessions: r.sessions.map((s) => ({
      session_id: s.sessionId,
      source_case_id: s.sourceCaseId,
      repetition: s.repetition,
      status: s.status,
    })),
    error: r.error,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    started_at: r.startedAt,
    completed_at: r.completedAt,
  };
}

function progressToSnake(p: BenchmarkRunProgress) {
  return {
    run_id: p.runId,
    benchmark_id: p.benchmarkId,
    benchmark_name: p.benchmarkName,
    status: p.status,
    repetitions: p.repetitions,
    total_cases: p.totalCases,
    total_sessions: p.totalSessions,
    completed_sessions: p.completedSessions,
    failed_sessions: p.failedSessions,
    per_case: p.perCase.map((c) => ({
      source_case_id: c.sourceCaseId,
      name: c.name,
      completed: c.completed,
      total: c.total,
    })),
    current_session_id: p.currentSessionId,
    error: p.error,
    started_at: p.startedAt,
    completed_at: p.completedAt,
  };
}

function numberStatsToSnake(s: NumberStats | null) {
  if (s === null) return null;
  return { min: s.min, max: s.max, mean: s.mean, median: s.median, stddev: s.stddev };
}

function perToolCountsToSnake(p: PerToolCounts) {
  return {
    calls: p.calls,
    errors: p.errors,
    result_payload_chars: p.resultPayloadChars,
  };
}

function perToolMapToSnake(map: Record<string, PerToolCounts>) {
  return Object.fromEntries(
    Object.entries(map).map(([name, counts]) => [name, perToolCountsToSnake(counts)]),
  );
}

function sessionMetricsToSnake(m: SessionMetrics) {
  return {
    session_id: m.sessionId,
    terminal_status: m.terminalStatus,
    completed: m.completed,
    tool_call_count: m.toolCallCount,
    tool_error_count: m.toolErrorCount,
    tools_called: m.toolsCalled,
    per_tool: perToolMapToSnake(m.perTool),
    tokens: {
      prompt: m.tokens.prompt,
      completion: m.tokens.completion,
      reasoning: m.tokens.reasoning,
      total: m.tokens.total,
    },
    final_answer: m.finalAnswer,
    ...(m.error ? { error: m.error } : {}),
  };
}

function caseReportToSnake(c: CaseReport) {
  return {
    case_id: c.caseId,
    prompt: c.prompt,
    repetitions: c.repetitions,
    session_count: c.sessionCount,
    has_checks: c.hasChecks,
    pass_count: c.passCount,
    pass_at_k: c.passAtK,
    pass_hat_k: c.passHatK,
    success_rate: c.successRate,
    completed_count: c.completedCount,
    tool_error_count: c.toolErrorCount,
    tool_call_stats: numberStatsToSnake(c.toolCallStats),
    total_token_stats: numberStatsToSnake(c.totalTokenStats),
    per_tool: perToolMapToSnake(c.perTool),
    sessions: c.sessions.map(sessionMetricsToSnake),
  };
}

function perToolRollupToSnake(map: Record<string, PerToolRollup>) {
  return Object.fromEntries(
    Object.entries(map).map(([name, r]) => [
      name,
      {
        calls: r.calls,
        errors: r.errors,
        error_rate: r.errorRate,
        result_payload_chars: r.resultPayloadChars,
        cases_used_in: r.casesUsedIn,
      },
    ]),
  );
}

function runReportToSnake(report: RunReport) {
  return {
    run_id: report.runId,
    benchmark_id: report.benchmarkId,
    status: report.status,
    repetitions: report.repetitions,
    case_count: report.caseCount,
    session_count: report.sessionCount,
    cases: report.cases.map(caseReportToSnake),
    per_tool: perToolRollupToSnake(report.perTool),
  };
}

// ── Redesigned unified-inspect builders (B- / R- / E-) ───────────────────────
// These power the `inspect` tool (CLI/MCP). They are drill-oriented: each level
// shows compact children + IDs + the signal needed to pick what to inspect next;
// depth (rubric, results, scores, criteria) is recovered by inspecting the child
// directly. Distinct from the *-ToSnake builders above, which the dedicated
// benchmark_* operations keep using. See backlog/research/inspect-payloads/.

/** Compact case view for the suite payload: shape + a scorability hint, no rubric. */
function caseDigestToSnake(c: BenchmarkCaseRecord) {
  return {
    id: c.id,
    name: c.name,
    prompt: c.prompt,
    order_index: c.orderIndex,
    // Hint only; inspect the case (B-.N) for the full rubric and tool checks.
    rubric_criteria_count: c.rubric?.length ?? 0,
  };
}

/** How many of an evaluation's judge sessions actually completed (vs failed/pending). */
function countJudged(ev: BenchmarkEvaluationRecord): number {
  return ev.sessions.filter((s) => s.status === "complete").length;
}

/** Compact run view for the suite payload: status + completion + drill IDs. */
function runDigestForSuite(ctx: OperationContext, run: BenchmarkRunRecord) {
  const progress = getBenchmarkRunProgress(ctx.db, run.id);
  const evaluations = listBenchmarkEvaluationsByRun(ctx.db.connection, run.id);
  return {
    id: run.id,
    status: run.status,
    repetitions: run.repetitions,
    total_sessions: progress.totalSessions,
    completed_sessions: progress.completedSessions,
    failed_sessions: progress.failedSessions,
    // IDs to drill into; the suite payload carries no results.
    evaluation_ids: evaluations.map((e) => e.id),
  };
}

function buildBenchmarkInspect(ctx: OperationContext, id: string) {
  const detail = getBenchmarkDetail(ctx.db, id);
  return {
    benchmark: benchmarkToSnake(detail.benchmark),
    cases: detail.cases.map(caseDigestToSnake),
    runs: detail.runs.map((run) => runDigestForSuite(ctx, run)),
  };
}

function buildRunInspect(
  ctx: OperationContext,
  run: BenchmarkRunRecord,
  mode: "summary" | "full",
) {
  const progress = getBenchmarkRunProgress(ctx.db, run.id);
  const evaluations = listBenchmarkEvaluationsByRun(ctx.db.connection, run.id);

  const data: Record<string, unknown> = {
    run: {
      id: run.id,
      benchmark_id: run.benchmarkId,
      benchmark_name: run.benchmarkName,
      status: run.status,
      model_config_id: run.modelConfigId,
      mcp_profile_ids: run.mcpProfileIds,
      repetitions: run.repetitions,
      max_tool_rounds: run.maxToolRounds,
      error: run.error,
      started_at: run.startedAt,
      completed_at: run.completedAt,
    },
    progress: {
      total_sessions: progress.totalSessions,
      completed_sessions: progress.completedSessions,
      failed_sessions: progress.failedSessions,
      per_case: progress.perCase.map((c) => ({
        source_case_id: c.sourceCaseId,
        name: c.name,
        completed: c.completed,
        total: c.total,
      })),
    },
    evaluations: evaluations.map((e) => ({
      id: e.id,
      status: e.status,
      judge_model_config_id: e.judgeModelConfigId,
      judged_sessions: countJudged(e),
      expected_sessions: e.sessions.length,
    })),
  };

  if (mode !== "full") {
    // Summary: a flat, drillable session list (id + status + which case/rep).
    data.sessions = run.sessions.map((s) => ({
      session_id: s.sessionId,
      source_case_id: s.sourceCaseId,
      repetition: s.repetition,
      status: s.status,
    }));
    return data;
  }

  // Full: enrich each session with the metrics that help decide what to drill,
  // plus per-case pass rates and the per-tool rollup.
  const report = getBenchmarkRunReport(ctx.db, run.id).report;
  const metricsById = new Map<string, SessionMetrics>();
  for (const c of report.cases) {
    for (const m of c.sessions) metricsById.set(m.sessionId, m);
  }
  data.sessions = run.sessions.map((s) => {
    const m = metricsById.get(s.sessionId);
    return {
      session_id: s.sessionId,
      source_case_id: s.sourceCaseId,
      repetition: s.repetition,
      status: s.status,
      ...(m
        ? {
            terminal_status: m.terminalStatus,
            tool_call_count: m.toolCallCount,
            tool_error_count: m.toolErrorCount,
            total_tokens: m.tokens.total,
            ...(m.error ? { error: m.error } : {}),
          }
        : {}),
    };
  });
  data.per_case = report.cases.map((c) => ({
    case_id: c.caseId,
    pass_count: c.passCount,
    session_count: c.sessionCount,
    success_rate: c.successRate,
    pass_at_k: c.passAtK,
    pass_hat_k: c.passHatK,
    tool_call_stats: numberStatsToSnake(c.toolCallStats),
    total_token_stats: numberStatsToSnake(c.totalTokenStats),
  }));
  data.per_tool = perToolRollupToSnake(report.perTool);
  return data;
}

function buildEvaluationInspect(
  ev: BenchmarkEvaluationRecord,
  report: BenchmarkEvaluationReport,
  mode: "summary" | "full",
) {
  const flatSessions = report.score.cases.flatMap((c) =>
    c.sessions.map((s) => ({
      analysis_session_id: s.analysisSessionId,
      run_session_id: s.runSessionId,
      source_case_id: s.sourceCaseId,
      status: s.status,
      pct: s.pct,
      // Full adds the per-criterion grid; summary stays lean and drillable.
      ...(mode === "full"
        ? {
            awarded: s.awarded,
            max: s.max,
            criteria: s.criteria.map((cr) => ({
              id: cr.id,
              description: cr.description,
              max: cr.max,
              points: cr.points,
              note: cr.note,
            })),
          }
        : {}),
    })),
  );

  const data: Record<string, unknown> = {
    evaluation: {
      id: ev.id,
      run_id: ev.runId,
      judge_model_config_id: ev.judgeModelConfigId,
      judge_temperature: ev.judgeTemperature,
      status: ev.status,
      error: ev.error,
      expected_sessions: report.expectedSessions,
      judged_sessions: report.judgedSessions,
      incomplete: report.judgedSessions < report.expectedSessions,
      overall_pct: report.score.overallPct,
    },
    sessions: flatSessions,
  };

  if (mode === "full") {
    data.per_case = report.score.cases.map((c) => ({
      source_case_id: c.sourceCaseId,
      name: c.name,
      pct_stats: numberStatsToSnake(c.pctStats),
    }));
  }
  return data;
}

// ── Unified inspect dispatch ─────────────────────────────────────────────────
// The `inspect` operation (shared verbatim by the UI's id-pill lookup, the CLI,
// and the MCP tool) resolves runtime hierarchical IDs itself. Benchmark-family
// IDs (B- benchmark, B-X.N case, R- run, E- evaluation) are dispatched here so
// every surface inspects them through the *same* snake_case payloads as the
// dedicated benchmark_* operations — if one surface works, they all do.

export interface BenchmarkInspectResult {
  id: string;
  type: string;
  mode: string;
  data: Record<string, unknown>;
}

function benchmarkNotFound(kind: string, id: string): never {
  throw new OperationError(
    `${kind} not found: ${id}`,
    "hierarchical_id_not_found",
  );
}

/**
 * Resolve a benchmark-family ID to the same payload its dedicated operation
 * returns. Returns null when `id` is not a benchmark-family ID, so the caller
 * can fall through to the runtime hierarchical resolver.
 */
export function resolveBenchmarkInspect(
  ctx: OperationContext,
  id: string,
  mode: "summary" | "full",
): BenchmarkInspectResult | null {
  if (id.startsWith("B-")) {
    if (id.includes(".")) {
      // The case (B-.N) is the rubric/full-spec drill target — kept verbatim.
      const found = getBenchmarkCase(ctx.db.connection, id);
      if (!found) benchmarkNotFound("Benchmark case", id);
      return { id, type: "benchmark_case", mode, data: caseToSnake(found) };
    }
    if (!getBenchmark(ctx.db.connection, id)) benchmarkNotFound("Benchmark", id);
    // Suite view: case shapes + minimal run digests + drill IDs. No results.
    return {
      id,
      type: "benchmark",
      mode,
      data: buildBenchmarkInspect(ctx, id),
    };
  }
  if (id.startsWith("R-")) {
    const run = getBenchmarkRun(ctx.db.connection, id);
    if (!run) benchmarkNotFound("Benchmark run", id);
    // Summary: status + completion + evaluations + drillable session list.
    // Full: + per-session metrics (what to drill), per-case pass rates, per-tool.
    return { id, type: "benchmark_run", mode, data: buildRunInspect(ctx, run, mode) };
  }
  if (id.startsWith("E-")) {
    const ev = getBenchmarkEvaluation(ctx.db.connection, id);
    if (!ev) benchmarkNotFound("Benchmark evaluation", id);
    const report = getBenchmarkRunEvaluationReports(ctx.db, ev.runId).find(
      (r) => r.id === id,
    );
    if (!report) benchmarkNotFound("Benchmark evaluation", id);
    // Summary: status + scores + drillable judged-session list (no criteria grid).
    // Full: + per-criterion grid + per-case distribution.
    return {
      id,
      type: "benchmark_evaluation",
      mode,
      data: buildEvaluationInspect(ev, report, mode),
    };
  }
  return null;
}

// ── Shared zod output sub-shapes ─────────────────────────────────────────────

const benchmarkSummaryShape = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});

const rubricCriterionShape = z.object({
  id: z.number().int(),
  description: z.string(),
  points: z.number().int(),
});

const caseShape = z.object({
  id: z.string(),
  benchmark_id: z.string(),
  name: z.string().nullable(),
  prompt: z.string(),
  order_index: z.number(),
  expected_tools_called: z.array(z.string()),
  expected_tools_not_called: z.array(z.string()),
  rubric: z.array(rubricCriterionShape),
  source_session_id: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});

const runShape = z.object({
  id: z.string(),
  benchmark_id: z.string(),
  benchmark_name: z.string(),
  status: z.string(),
  model_config_id: z.string(),
  mcp_profile_ids: z.array(z.string()),
  repetitions: z.number(),
  max_tool_rounds: z.number(),
  cases: z.array(
    z.object({
      source_case_id: z.string(),
      name: z.string().nullable(),
      prompt: z.string(),
      expected_tools_called: z.array(z.string()),
      expected_tools_not_called: z.array(z.string()),
      rubric: z.array(rubricCriterionShape),
    }),
  ),
  sessions: z.array(
    z.object({
      session_id: z.string(),
      source_case_id: z.string(),
      repetition: z.number(),
      status: z.string(),
    }),
  ),
  error: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
  started_at: z.number().nullable(),
  completed_at: z.number().nullable(),
});

const progressShape = {
  run_id: z.string(),
  benchmark_id: z.string(),
  benchmark_name: z.string(),
  status: z.string(),
  repetitions: z.number(),
  total_cases: z.number(),
  total_sessions: z.number(),
  completed_sessions: z.number(),
  failed_sessions: z.number(),
  per_case: z.array(
    z.object({
      source_case_id: z.string(),
      name: z.string().nullable(),
      completed: z.number(),
      total: z.number(),
    }),
  ),
  current_session_id: z.string().nullable(),
  error: z.string().nullable(),
  started_at: z.number().nullable(),
  completed_at: z.number().nullable(),
};

// ── benchmark_create ─────────────────────────────────────────────────────────

export const benchmarkCreateInputSchema = z.object({
  name: z.string().min(1).describe("Human-readable benchmark name."),
  description: z
    .string()
    .nullable()
    .optional()
    .describe("Optional description."),
});
export type BenchmarkCreateInput = z.infer<typeof benchmarkCreateInputSchema>;

export const benchmarkCreateOutputSchema = { benchmark: benchmarkSummaryShape };

export const benchmarkCreateOperation = {
  id: "benchmark_create" as const,
  description:
    "Create a new (empty) benchmark blueprint. Returns the created benchmark.",
  schema: benchmarkCreateInputSchema,
  outputSchema: benchmarkCreateOutputSchema,
  async execute(ctx: OperationContext, input: BenchmarkCreateInput) {
    const record = createBenchmarkEntry(ctx.db, {
      name: input.name,
      description: input.description ?? null,
    });
    return { benchmark: benchmarkToSnake(record) };
  },
};

// ── benchmark_list ───────────────────────────────────────────────────────────

export const benchmarkListInputSchema = z.object({});
export type BenchmarkListInput = z.infer<typeof benchmarkListInputSchema>;

export const benchmarkListOutputSchema = {
  benchmarks: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      case_count: z.number(),
      run_count: z.number(),
      created_at: z.number(),
      updated_at: z.number(),
    }),
  ),
};

export const benchmarkListOperation = {
  id: "benchmark_list" as const,
  description:
    "List all benchmarks with their id, name, description, case count, and run count.",
  schema: benchmarkListInputSchema,
  outputSchema: benchmarkListOutputSchema,
  async execute(ctx: OperationContext, _input: BenchmarkListInput) {
    return {
      benchmarks: listBenchmarkEntries(ctx.db).map((b) => ({
        id: b.id,
        name: b.name,
        description: b.description,
        case_count: b.caseCount,
        run_count: b.runCount,
        created_at: b.createdAt,
        updated_at: b.updatedAt,
      })),
    };
  },
};

// ── benchmark_inspect ────────────────────────────────────────────────────────

export const benchmarkInspectInputSchema = z.object({
  benchmark_id: z.string().describe("Benchmark id to inspect."),
});
export type BenchmarkInspectInput = z.infer<typeof benchmarkInspectInputSchema>;

export const benchmarkInspectOutputSchema = {
  benchmark: benchmarkSummaryShape,
  cases: z.array(caseShape),
  runs: z.array(runShape),
};

export const benchmarkInspectOperation = {
  id: "benchmark_inspect" as const,
  description:
    "Inspect a benchmark: returns the benchmark, its cases, and its runs.",
  schema: benchmarkInspectInputSchema,
  outputSchema: benchmarkInspectOutputSchema,
  async execute(ctx: OperationContext, input: BenchmarkInspectInput) {
    const detail = getBenchmarkDetail(ctx.db, input.benchmark_id);
    return {
      benchmark: benchmarkToSnake(detail.benchmark),
      cases: detail.cases.map(caseToSnake),
      runs: detail.runs.map(runToSnake),
    };
  },
};

// ── benchmark_add_case ───────────────────────────────────────────────────────

export const benchmarkAddCaseInputSchema = z.object({
  benchmark_id: z.string().describe("Benchmark to add the case to."),
  prompt: z.string().min(1).describe("The user prompt the case sends."),
  name: z.string().nullable().optional().describe("Optional human label."),
  expected_tools_called: z
    .array(z.string())
    .optional()
    .describe("Tools that should be called (deterministic check)."),
  expected_tools_not_called: z
    .array(z.string())
    .optional()
    .describe("Tools that should NOT be called (deterministic check)."),
  rubric: z
    .array(rubricCriterionShape)
    .optional()
    .describe(
      "Optional scored rubric for LLM evaluation: ordered criteria, each {id, "
      + "description, points}. Judged by benchmark_evaluate against the session trace.",
    ),
});
export type BenchmarkAddCaseInput = z.infer<typeof benchmarkAddCaseInputSchema>;

export const benchmarkAddCaseOutputSchema = { case: caseShape };

export const benchmarkAddCaseOperation = {
  id: "benchmark_add_case" as const,
  description:
    "Add a case (prompt + optional tool-behavior expectations) to a benchmark.",
  schema: benchmarkAddCaseInputSchema,
  outputSchema: benchmarkAddCaseOutputSchema,
  async execute(ctx: OperationContext, input: BenchmarkAddCaseInput) {
    const record = addBenchmarkCase(ctx.db, input.benchmark_id, {
      prompt: input.prompt,
      name: input.name ?? null,
      ...(input.expected_tools_called !== undefined
        ? { expectedToolsCalled: input.expected_tools_called }
        : {}),
      ...(input.expected_tools_not_called !== undefined
        ? { expectedToolsNotCalled: input.expected_tools_not_called }
        : {}),
      ...(input.rubric !== undefined ? { rubric: input.rubric } : {}),
    });
    return { case: caseToSnake(record) };
  },
};

// ── benchmark_add_case_from_session ──────────────────────────────────────────

export const benchmarkAddCaseFromSessionInputSchema = z.object({
  benchmark_id: z.string().describe("Benchmark to add the case to."),
  session_id: z
    .string()
    .describe("Session to extract the initiating prompt from."),
  name: z.string().nullable().optional().describe("Optional human label."),
});
export type BenchmarkAddCaseFromSessionInput = z.infer<
  typeof benchmarkAddCaseFromSessionInputSchema
>;

export const benchmarkAddCaseFromSessionOutputSchema = { case: caseShape };

export const benchmarkAddCaseFromSessionOperation = {
  id: "benchmark_add_case_from_session" as const,
  description:
    "Create a benchmark case from an existing session: uses its first user "
    + "message as the prompt and pre-fills expected_tools_called with the tools "
    + "that session actually called (editable defaults).",
  schema: benchmarkAddCaseFromSessionInputSchema,
  outputSchema: benchmarkAddCaseFromSessionOutputSchema,
  async execute(
    ctx: OperationContext,
    input: BenchmarkAddCaseFromSessionInput,
  ) {
    const record = addBenchmarkCaseFromSession(
      ctx.db,
      input.benchmark_id,
      input.session_id,
      { name: input.name ?? null },
    );
    return { case: caseToSnake(record) };
  },
};

// ── benchmark_update_case ────────────────────────────────────────────────────

export const benchmarkUpdateCaseInputSchema = z.object({
  case_id: z.string().describe("Case to edit."),
  name: z
    .string()
    .nullable()
    .optional()
    .describe("New human label (null to clear)."),
  prompt: z.string().min(1).optional().describe("New prompt text."),
  order_index: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("New position within the suite."),
  expected_tools_called: z
    .array(z.string())
    .optional()
    .describe("Replace the tools-that-should-be-called check."),
  expected_tools_not_called: z
    .array(z.string())
    .optional()
    .describe("Replace the tools-that-should-NOT-be-called check."),
  rubric: z
    .array(rubricCriterionShape)
    .optional()
    .describe("Replace the scored rubric ({id, description, points}[])."),
});
export type BenchmarkUpdateCaseInput = z.infer<
  typeof benchmarkUpdateCaseInputSchema
>;

export const benchmarkUpdateCaseOutputSchema = { case: caseShape };

export const benchmarkUpdateCaseOperation = {
  id: "benchmark_update_case" as const,
  description:
    "Edit an existing case: any of name, prompt, order, tool-behavior checks, or "
    + "rubric. Only the fields you pass change; the rest are left as-is.",
  schema: benchmarkUpdateCaseInputSchema,
  outputSchema: benchmarkUpdateCaseOutputSchema,
  async execute(ctx: OperationContext, input: BenchmarkUpdateCaseInput) {
    const record = updateBenchmarkCaseEntry(ctx.db, input.case_id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
      ...(input.order_index !== undefined
        ? { orderIndex: input.order_index }
        : {}),
      ...(input.expected_tools_called !== undefined
        ? { expectedToolsCalled: input.expected_tools_called }
        : {}),
      ...(input.expected_tools_not_called !== undefined
        ? { expectedToolsNotCalled: input.expected_tools_not_called }
        : {}),
      ...(input.rubric !== undefined ? { rubric: input.rubric } : {}),
    });
    return { case: caseToSnake(record) };
  },
};

// ── benchmark_delete_case ────────────────────────────────────────────────────

export const benchmarkDeleteCaseInputSchema = z.object({
  case_id: z.string().describe("Case to delete."),
});
export type BenchmarkDeleteCaseInput = z.infer<
  typeof benchmarkDeleteCaseInputSchema
>;

export const benchmarkDeleteCaseOutputSchema = {
  case_id: z.string(),
  deleted: z.boolean(),
};

export const benchmarkDeleteCaseOperation = {
  id: "benchmark_delete_case" as const,
  description:
    "Delete a case from a benchmark. Past runs keep their own snapshot of the case.",
  schema: benchmarkDeleteCaseInputSchema,
  outputSchema: benchmarkDeleteCaseOutputSchema,
  async execute(ctx: OperationContext, input: BenchmarkDeleteCaseInput) {
    deleteBenchmarkCaseEntry(ctx.db, input.case_id);
    return { case_id: input.case_id, deleted: true };
  },
};

// ── benchmark_run ────────────────────────────────────────────────────────────

export const benchmarkRunInputSchema = z.object({
  benchmark_id: z.string().describe("Benchmark to run."),
  case_ids: z
    .array(z.string())
    .optional()
    .describe("Subset of case ids to run (default: all cases)."),
  repetitions: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Times to run each case (default: 1)."),
  model_config_id: z
    .string()
    .optional()
    .describe("Model config to use (default: the configured default)."),
  mcp_profile_ids: z
    .array(z.string())
    .optional()
    .describe("MCP profiles to enable (default: the configured defaults)."),
  max_tool_rounds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Max tool-call rounds per turn for every test session in the run (loop guard). Default: the backend default.",
    ),
});
export type BenchmarkRunInput = z.infer<typeof benchmarkRunInputSchema>;

export const benchmarkRunOutputSchema = { run: runShape };

export const benchmarkRunOperation = {
  id: "benchmark_run" as const,
  description:
    "Launch a benchmark run in the background. Returns the run immediately "
    + "(status 'pending'); poll benchmark_run_status for progress and "
    + "benchmark_run_report for the full metrics report.",
  schema: benchmarkRunInputSchema,
  outputSchema: benchmarkRunOutputSchema,
  async execute(ctx: OperationContext, input: BenchmarkRunInput) {
    const run = launchBenchmarkRun(ctx, {
      benchmarkId: input.benchmark_id,
      ...(input.case_ids !== undefined ? { caseIds: input.case_ids } : {}),
      ...(input.repetitions !== undefined
        ? { repetitions: input.repetitions }
        : {}),
      ...(input.model_config_id !== undefined
        ? { modelConfigId: input.model_config_id }
        : {}),
      ...(input.mcp_profile_ids !== undefined
        ? { mcpProfileIds: input.mcp_profile_ids }
        : {}),
      ...(input.max_tool_rounds !== undefined
        ? { maxToolRounds: input.max_tool_rounds }
        : {}),
    });
    return { run: runToSnake(run) };
  },
};

// ── benchmark_run_status ─────────────────────────────────────────────────────

export const benchmarkRunStatusInputSchema = z.object({
  run_id: z.string().describe("Run id to poll."),
});
export type BenchmarkRunStatusInput = z.infer<
  typeof benchmarkRunStatusInputSchema
>;

export const benchmarkRunStatusOutputSchema = progressShape;

export const benchmarkRunStatusOperation = {
  id: "benchmark_run_status" as const,
  description:
    "Get cheap, pollable progress for a benchmark run (derived from the run "
    + "record only — no session traces loaded). Shows overall and per-case "
    + "completion, the currently running session, and terminal status.",
  schema: benchmarkRunStatusInputSchema,
  outputSchema: benchmarkRunStatusOutputSchema,
  async execute(ctx: OperationContext, input: BenchmarkRunStatusInput) {
    return progressToSnake(getBenchmarkRunProgress(ctx.db, input.run_id));
  },
};

// ── benchmark_run_report ─────────────────────────────────────────────────────

export const benchmarkRunReportInputSchema = z.object({
  run_id: z.string().describe("Run id to report on."),
});
export type BenchmarkRunReportInput = z.infer<
  typeof benchmarkRunReportInputSchema
>;

const numberStatsShape = z
  .object({
    min: z.number(),
    max: z.number(),
    mean: z.number(),
    median: z.number(),
    stddev: z.number(),
  })
  .nullable();

const perToolCountsShape = z.object({
  calls: z.number(),
  errors: z.number(),
  result_payload_chars: z.number(),
});

export const benchmarkRunReportOutputSchema = {
  run: runShape,
  report: z.object({
    run_id: z.string(),
    benchmark_id: z.string(),
    status: z.string(),
    repetitions: z.number(),
    case_count: z.number(),
    session_count: z.number(),
    cases: z.array(
      z.object({
        case_id: z.string(),
        prompt: z.string(),
        repetitions: z.number(),
        session_count: z.number(),
        has_checks: z.boolean(),
        pass_count: z.number().nullable(),
        pass_at_k: z.boolean().nullable(),
        pass_hat_k: z.boolean().nullable(),
        success_rate: z.number().nullable(),
        completed_count: z.number(),
        tool_error_count: z.number(),
        tool_call_stats: numberStatsShape,
        total_token_stats: numberStatsShape,
        per_tool: z.record(z.string(), perToolCountsShape),
        sessions: z.array(
          z.object({
            session_id: z.string(),
            terminal_status: z.string().nullable(),
            completed: z.boolean(),
            tool_call_count: z.number(),
            tool_error_count: z.number(),
            tools_called: z.array(z.string()),
            per_tool: z.record(z.string(), perToolCountsShape),
            tokens: z.object({
              prompt: z.number().nullable(),
              completion: z.number().nullable(),
              reasoning: z.number().nullable(),
              total: z.number().nullable(),
            }),
            final_answer: z.string().nullable(),
            error: z
              .object({
                step_id: z.string().nullable(),
                error_kind: z.string().nullable(),
                message: z.string(),
              })
              .optional(),
          }),
        ),
      }),
    ),
    per_tool: z.record(
      z.string(),
      z.object({
        calls: z.number(),
        errors: z.number(),
        error_rate: z.number(),
        result_payload_chars: z.number(),
        cases_used_in: z.number(),
      }),
    ),
  }),
};

export const benchmarkRunReportOperation = {
  id: "benchmark_run_report" as const,
  description:
    "Get the full compute-on-read metrics report for a benchmark run: per-case "
    + "pass rates, tool-call/token stats, per-session metrics, and a cross-case "
    + "per-tool rollup. Heavier than benchmark_run_status (loads session traces).",
  schema: benchmarkRunReportInputSchema,
  outputSchema: benchmarkRunReportOutputSchema,
  async execute(ctx: OperationContext, input: BenchmarkRunReportInput) {
    const { run, report } = getBenchmarkRunReport(ctx.db, input.run_id);
    return { run: runToSnake(run), report: runReportToSnake(report) };
  },
};

// ── benchmark_evaluate ───────────────────────────────────────────────────────

const evaluationSessionShape = z.object({
  run_session_id: z.string(),
  analysis_session_id: z.string(),
  status: z.string(),
});

const evaluationShape = z.object({
  id: z.string(),
  run_id: z.string(),
  judge_model_config_id: z.string(),
  judge_temperature: z.number().nullable(),
  status: z.string(),
  error: z.string().nullable(),
  sessions: z.array(evaluationSessionShape),
  created_at: z.number(),
  updated_at: z.number(),
});

export const benchmarkEvaluateInputSchema = z.object({
  run_id: z.string().describe("Completed run to evaluate."),
  judge_model_config_id: z
    .string()
    .describe("Model config for the judge (a separate model; never the task model)."),
  temperature: z
    .number()
    .nullable()
    .optional()
    .describe(
      "Judge sampling temperature. Defaults to a small non-zero value so retries "
        + "of a looping judge session can escape (not bitwise-deterministic). "
        + "Pass null to send no temperature (use the provider's own default).",
    ),
});
export type BenchmarkEvaluateInput = z.infer<typeof benchmarkEvaluateInputSchema>;

export const benchmarkEvaluateOutputSchema = { evaluation: evaluationShape };

export const benchmarkEvaluateOperation = {
  id: "benchmark_evaluate" as const,
  description:
    "Launch an LLM evaluation pass over a completed run: a separate judge model "
    + "scores every session against its case rubric. Repeatable (0..N per run; "
    + "compare judge models). Returns immediately; poll benchmark_run_evaluations "
    + "for scores.",
  schema: benchmarkEvaluateInputSchema,
  outputSchema: benchmarkEvaluateOutputSchema,
  async execute(ctx: OperationContext, input: BenchmarkEvaluateInput) {
    const evaluation = evaluateBenchmarkRun(ctx, {
      runId: input.run_id,
      judgeModelConfigId: input.judge_model_config_id,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    });
    return { evaluation: evaluationToSnake(evaluation) };
  },
};

// ── benchmark_run_evaluations ────────────────────────────────────────────────

export const benchmarkRunEvaluationsInputSchema = z.object({
  run_id: z.string().describe("Run id whose evaluations to list."),
});
export type BenchmarkRunEvaluationsInput = z.infer<
  typeof benchmarkRunEvaluationsInputSchema
>;

export const benchmarkRunEvaluationsOutputSchema = {
  evaluations: z.array(
    evaluationShape.extend({
      expected_sessions: z.number(),
      judged_sessions: z.number(),
      score: z.object({
        overall_pct: z.number().nullable(),
        cases: z.array(
          z.object({
            source_case_id: z.string(),
            name: z.string().nullable(),
            pct_stats: numberStatsShape,
            sessions: z.array(
              z.object({
                run_session_id: z.string(),
                analysis_session_id: z.string(),
                source_case_id: z.string(),
                status: z.string(),
                awarded: z.number().nullable(),
                max: z.number().nullable(),
                pct: z.number().nullable(),
                criteria: z.array(
                  z.object({
                    id: z.number(),
                    description: z.string(),
                    max: z.number(),
                    points: z.number().nullable(),
                    note: z.string(),
                  }),
                ),
              }),
            ),
          }),
        ),
      }),
    }),
  ),
};

export const benchmarkRunEvaluationsOperation = {
  id: "benchmark_run_evaluations" as const,
  description:
    "List a run's evaluation passes, each with scores computed on read from the "
    + "judge verdicts: per-session pct, per-case distribution, and overall pct.",
  schema: benchmarkRunEvaluationsInputSchema,
  outputSchema: benchmarkRunEvaluationsOutputSchema,
  async execute(ctx: OperationContext, input: BenchmarkRunEvaluationsInput) {
    return {
      evaluations: getBenchmarkRunEvaluationReports(ctx.db, input.run_id).map(
        evaluationReportToSnake,
      ),
    };
  },
};

// ── benchmark_run_control ────────────────────────────────────────────────────

export const benchmarkRunControlInputSchema = z.object({
  run_id: z.string().describe("Run id to control."),
  action: z
    .enum(["pause", "resume", "stop"])
    .describe(
      "pause: hold after the current session finishes. stop: abort the in-flight "
        + "session now and rest at 'stopped' (resumable; partial results kept). "
        + "resume: re-launch the run over its remaining work.",
    ),
  mode: z
    .enum(["continue", "retry"])
    .optional()
    .describe(
      "Resume only. 'continue' (default) runs never-started sessions; 'retry' also "
        + "re-runs cancelled/errored ones.",
    ),
});
export type BenchmarkRunControlInput = z.infer<
  typeof benchmarkRunControlInputSchema
>;

export const benchmarkRunControlOutputSchema = { run: runShape };

export const benchmarkRunControlOperation = {
  id: "benchmark_run_control" as const,
  description:
    "Pause, resume, or stop a benchmark run. Stop rests the run at 'stopped' "
    + "(resumable, partial results kept); resume re-enqueues its remaining work "
    + "('continue') or also re-runs cancelled/errored sessions ('retry').",
  schema: benchmarkRunControlInputSchema,
  outputSchema: benchmarkRunControlOutputSchema,
  async execute(ctx: OperationContext, input: BenchmarkRunControlInput) {
    const run =
      input.action === "pause"
        ? pauseBenchmarkRun(ctx, input.run_id)
        : input.action === "stop"
          ? stopBenchmarkRun(ctx, input.run_id)
          : resumeBenchmarkRun(ctx, input.run_id, input.mode ?? "continue");
    return { run: runToSnake(run) };
  },
};

// ── benchmark_evaluation_control ─────────────────────────────────────────────

export const benchmarkEvaluationControlInputSchema = z.object({
  evaluation_id: z.string().describe("Evaluation pass id to control."),
  action: z
    .enum(["pause", "resume", "stop"])
    .describe(
      "pause: hold after the current judge finishes. stop: abort the in-flight "
        + "judge now and rest at 'stopped' (resumable; scored sessions kept). "
        + "resume: re-judge the pass's remaining sessions.",
    ),
  mode: z
    .enum(["continue", "retry"])
    .optional()
    .describe(
      "Resume only. 'continue' (default) judges never-judged sessions; 'retry' also "
        + "re-judges cancelled/errored ones.",
    ),
});
export type BenchmarkEvaluationControlInput = z.infer<
  typeof benchmarkEvaluationControlInputSchema
>;

export const benchmarkEvaluationControlOutputSchema = {
  evaluation: evaluationShape,
};

export const benchmarkEvaluationControlOperation = {
  id: "benchmark_evaluation_control" as const,
  description:
    "Pause, resume, or stop an LLM evaluation pass. Mirrors benchmark_run_control "
    + "for evaluations (the judging passes over a completed run).",
  schema: benchmarkEvaluationControlInputSchema,
  outputSchema: benchmarkEvaluationControlOutputSchema,
  async execute(ctx: OperationContext, input: BenchmarkEvaluationControlInput) {
    const evaluation =
      input.action === "pause"
        ? pauseBenchmarkEvaluation(ctx, input.evaluation_id)
        : input.action === "stop"
          ? stopBenchmarkEvaluation(ctx, input.evaluation_id)
          : resumeBenchmarkEvaluation(
              ctx,
              input.evaluation_id,
              input.mode ?? "continue",
            );
    return { evaluation: evaluationToSnake(evaluation) };
  },
};
