// ─────────────────────────────────────────────────────────────────────────────
// Agent-facing benchmark operations — the snake_case catalog surface mirrored by
// CLI and MCP. Thin wrappers over the camelCase functions in benchmark.ts that
// map record fields to snake_case result shapes. Registered in the operation
// catalog (catalog.ts) so each is auto-exposed as an mcpscope_<id> MCP tool and
// gets a CLI/HTTP endpoint. See AGENTS.md (CLI/MCP parity, snake_case results).
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import type { OperationContext } from "./context.js";
import {
  createBenchmarkEntry,
  listBenchmarkEntries,
  getBenchmarkDetail,
  addBenchmarkCase,
  addBenchmarkCaseFromSession,
  launchBenchmarkRun,
  getBenchmarkRunProgress,
  getBenchmarkRunReport,
  type BenchmarkRunProgress,
} from "./benchmark.js";
import type {
  BenchmarkRecord,
  BenchmarkCaseRecord,
  BenchmarkRunRecord,
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
    source_session_id: c.sourceSessionId,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
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
    cases: r.cases.map((c) => ({
      source_case_id: c.sourceCaseId,
      name: c.name,
      prompt: c.prompt,
      expected_tools_called: c.expectedToolsCalled,
      expected_tools_not_called: c.expectedToolsNotCalled,
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

// ── Shared zod output sub-shapes ─────────────────────────────────────────────

const benchmarkSummaryShape = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});

const caseShape = z.object({
  id: z.string(),
  benchmark_id: z.string(),
  name: z.string().nullable(),
  prompt: z.string(),
  order_index: z.number(),
  expected_tools_called: z.array(z.string()),
  expected_tools_not_called: z.array(z.string()),
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
  cases: z.array(
    z.object({
      source_case_id: z.string(),
      name: z.string().nullable(),
      prompt: z.string(),
      expected_tools_called: z.array(z.string()),
      expected_tools_not_called: z.array(z.string()),
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
