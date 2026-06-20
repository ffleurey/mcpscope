// ─────────────────────────────────────────────────────────────────────────────
// Benchmark operations: benchmark/case CRUD, run launch + background coordinator,
// and the compute-on-read run report. Phase A (run + deterministic metrics).
// The agent-facing snake_case surface (benchmarkOperations.ts) wraps these functions
// and is registered in the operation catalog, so the capabilities are exposed
// identically via CLI and MCP. See backlog/completed/benchmark-v1.md.
// ─────────────────────────────────────────────────────────────────────────────

import type { BackendDatabase } from "../persistence/db.js";
import type {
  BenchmarkRecord,
  BenchmarkCaseRecord,
  BenchmarkRunRecord,
  BenchmarkRunCaseSnapshot,
  BenchmarkEvaluationRecord,
  RubricCriterion,
} from "../domain/model.js";
import {
  createBenchmark,
  getBenchmark,
  listBenchmarks,
  updateBenchmark,
  deleteBenchmark,
  createBenchmarkCase,
  getBenchmarkCase,
  listBenchmarkCases,
  updateBenchmarkCase,
  deleteBenchmarkCase,
  createBenchmarkRun,
  getBenchmarkRun,
  listBenchmarkRuns,
  updateBenchmarkRun,
  deleteBenchmarkRun,
  createBenchmarkEvaluation,
  getBenchmarkEvaluation,
  listBenchmarkEvaluationsByRun,
  updateBenchmarkEvaluation,
  deleteBenchmarkEvaluation,
  getSessionRecord,
  deleteSessionRecord,
  listPartRecordsBySession,
  listTurnRecordsBySession,
} from "../persistence/repository.js";
import {
  generateBenchmarkId,
  generateRunId,
  generateEvaluationId,
  formatBenchmarkCaseId,
} from "../domain/hierarchicalIds.js";
import { createSession } from "../runtime/modelTurns.js";
import { executeAnalysisLaunch } from "./launchAnalysis.js";
import { ANALYSIS_WORKFLOW_KIND } from "../analysis/workflowKinds.js";
import { getLatestArtifactBySchemaKey } from "../analysis/artifactRepository.js";
import { SCHEMA_KEY as BENCHMARK_EVAL_KEY } from "../analysis/benchmarkEvaluation/schemas.js";
import type { OperationContext } from "./context.js";
import { OperationError } from "./errors.js";
import {
  mapSessionIdError,
  resolvePrimarySessionInputs,
} from "./sessionCreationShared.js";
import {
  deriveSessionMetrics,
  buildCaseReport,
  buildPerToolRollup,
  type CaseReport,
  type RunReport,
  type SessionMetrics,
} from "./benchmarkMetrics.js";
import {
  scorePct,
  aggregateEvaluationScore,
  type EvaluationScore,
  type EvaluationSessionScore,
} from "./benchmarkEvaluationMetrics.js";

function now(): number {
  return Date.now();
}

/** Next stable 1-based case number for a benchmark (max existing trailing number + 1). */
function nextCaseNumber(existing: BenchmarkCaseRecord[]): number {
  let max = 0;
  for (const c of existing) {
    // Case ids are `<benchmarkId>.<n>`; match the trailing number explicitly so a
    // future id-format change can't silently parse to a wrong value.
    const match = /\.(\d+)$/.exec(c.id);
    const n = match ? Number(match[1]) : NaN;
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}

function requireGeneratedId(
  id: string | null,
  kind: string,
  detail?: string,
): string {
  if (!id) {
    throw new OperationError(
      `Failed to generate a unique ${kind} id${detail ? ` (${detail})` : ""}.`,
      "benchmark_id_generation_failed",
    );
  }
  return id;
}

function requireBenchmark(
  db: BackendDatabase,
  id: string,
): BenchmarkRecord {
  const benchmark = getBenchmark(db.connection, id);
  if (!benchmark) {
    throw new OperationError(`Benchmark "${id}" not found.`, "benchmark_not_found");
  }
  return benchmark;
}

// ── Benchmark CRUD ────────────────────────────────────────────────────────────

export function createBenchmarkEntry(
  db: BackendDatabase,
  input: { name: string; description?: string | null | undefined },
): BenchmarkRecord {
  const ts = now();
  const record: BenchmarkRecord = {
    id: requireGeneratedId(
      generateBenchmarkId((c) => getBenchmark(db.connection, c) !== null),
      "benchmark",
      `name "${input.name}"`,
    ),
    name: input.name,
    description: input.description ?? null,
    createdAt: ts,
    updatedAt: ts,
  };
  createBenchmark(db.connection, record);
  return record;
}

export interface BenchmarkListEntry extends BenchmarkRecord {
  caseCount: number;
  runCount: number;
}

export function listBenchmarkEntries(db: BackendDatabase): BenchmarkListEntry[] {
  return listBenchmarks(db.connection).map((b) => ({
    ...b,
    caseCount: listBenchmarkCases(db.connection, b.id).length,
    runCount: listBenchmarkRuns(db.connection, b.id).length,
  }));
}

export interface BenchmarkDetail {
  benchmark: BenchmarkRecord;
  cases: BenchmarkCaseRecord[];
  runs: BenchmarkRunRecord[];
}

export function getBenchmarkDetail(
  db: BackendDatabase,
  id: string,
): BenchmarkDetail {
  const benchmark = requireBenchmark(db, id);
  return {
    benchmark,
    cases: listBenchmarkCases(db.connection, id),
    runs: listBenchmarkRuns(db.connection, id),
  };
}

export function updateBenchmarkEntry(
  db: BackendDatabase,
  id: string,
  input: { name?: string | undefined; description?: string | null | undefined },
): BenchmarkRecord {
  const existing = requireBenchmark(db, id);
  const updated: BenchmarkRecord = {
    ...existing,
    name: input.name ?? existing.name,
    description:
      input.description !== undefined ? input.description : existing.description,
    updatedAt: now(),
  };
  updateBenchmark(db.connection, updated);
  return updated;
}

export function deleteBenchmarkEntry(db: BackendDatabase, id: string): void {
  requireBenchmark(db, id);
  // A benchmark is an editable blueprint; its runs are independent snapshots and
  // are intentionally NOT deleted with it (no cascade). Cases cascade via FK.
  deleteBenchmark(db.connection, id);
}

export function deleteBenchmarkRunEntry(db: BackendDatabase, runId: string): void {
  const run = getBenchmarkRun(db.connection, runId);
  if (!run) {
    throw new OperationError(
      `Benchmark run "${runId}" not found.`,
      "benchmark_run_not_found",
    );
  }
  // Each evaluation's judge sessions are generic session children (no FK cascade) →
  // delete them and the evaluation rows explicitly before the run goes.
  for (const evaluation of listBenchmarkEvaluationsByRun(db.connection, runId)) {
    for (const judge of evaluation.sessions) {
      try {
        deleteSessionRecord(db.connection, judge.analysisSessionId);
      } catch {
        // best-effort cleanup
      }
    }
    deleteBenchmarkEvaluation(db.connection, evaluation.id);
  }
  // Remove the produced sessions (generic untyped parent ref → no cascade), then the run.
  for (const session of run.sessions) {
    try {
      deleteSessionRecord(db.connection, session.sessionId);
    } catch {
      // best-effort cleanup
    }
  }
  deleteBenchmarkRun(db.connection, runId);
}

/**
 * Delete a single evaluation pass and the judge analysis sessions it spawned. The
 * underlying run, its sessions, and their verdict-bearing analysis stay untouched.
 */
export function deleteBenchmarkEvaluationEntry(
  db: BackendDatabase,
  evaluationId: string,
): void {
  const evaluation = getBenchmarkEvaluation(db.connection, evaluationId);
  if (!evaluation) {
    throw new OperationError(
      `Benchmark evaluation "${evaluationId}" not found.`,
      "benchmark_evaluation_not_found",
    );
  }
  for (const judge of evaluation.sessions) {
    try {
      deleteSessionRecord(db.connection, judge.analysisSessionId);
    } catch {
      // best-effort cleanup
    }
  }
  deleteBenchmarkEvaluation(db.connection, evaluationId);
}

// ── Case CRUD ─────────────────────────────────────────────────────────────────

export function addBenchmarkCase(
  db: BackendDatabase,
  benchmarkId: string,
  input: {
    prompt: string;
    name?: string | null | undefined;
    expectedToolsCalled?: string[] | undefined;
    expectedToolsNotCalled?: string[] | undefined;
    rubric?: RubricCriterion[] | undefined;
  },
): BenchmarkCaseRecord {
  requireBenchmark(db, benchmarkId);
  const existing = listBenchmarkCases(db.connection, benchmarkId);
  const ts = now();
  const record: BenchmarkCaseRecord = {
    id: formatBenchmarkCaseId(benchmarkId, nextCaseNumber(existing)),
    benchmarkId,
    name: input.name ?? null,
    prompt: input.prompt,
    orderIndex: existing.length,
    expectedToolsCalled: input.expectedToolsCalled ?? [],
    expectedToolsNotCalled: input.expectedToolsNotCalled ?? [],
    rubric: input.rubric ?? [],
    sourceSessionId: null,
    createdAt: ts,
    updatedAt: ts,
  };
  createBenchmarkCase(db.connection, record);
  return record;
}

/**
 * Create a case by extracting the initiating prompt from an existing session.
 * V1: uses the first user-message part, and pre-fills expectedToolsCalled with
 * the distinct tools that session actually called (an editable default).
 */
export function addBenchmarkCaseFromSession(
  db: BackendDatabase,
  benchmarkId: string,
  sessionId: string,
  input?: { name?: string | null | undefined },
): BenchmarkCaseRecord {
  requireBenchmark(db, benchmarkId);
  const session = getSessionRecord(db.connection, sessionId);
  if (!session) {
    throw new OperationError(
      `Session "${sessionId}" not found.`,
      "session_not_found",
    );
  }
  const parts = listPartRecordsBySession(db.connection, sessionId);
  const prompt = parts
    .find((p) => p.partType === "user-message")
    ?.payload.text?.trim();
  if (!prompt) {
    throw new OperationError(
      `Session "${sessionId}" has no user message to extract a case from.`,
      "benchmark_invalid_input",
    );
  }
  const expectedToolsCalled = Array.from(
    new Set(
      parts
        .filter((p) => p.partType === "tool-call")
        .map((p) => {
          const json = p.payload.json as { name?: unknown } | null;
          return (
            (typeof json?.name === "string" ? json.name : null) ??
            p.payload.summary ??
            null
          );
        })
        .filter((n): n is string => typeof n === "string"),
    ),
  );
  const existing = listBenchmarkCases(db.connection, benchmarkId);
  const ts = now();
  const record: BenchmarkCaseRecord = {
    id: formatBenchmarkCaseId(benchmarkId, nextCaseNumber(existing)),
    benchmarkId,
    name: input?.name ?? null,
    prompt,
    orderIndex: existing.length,
    expectedToolsCalled,
    expectedToolsNotCalled: [],
    rubric: [],
    sourceSessionId: sessionId,
    createdAt: ts,
    updatedAt: ts,
  };
  createBenchmarkCase(db.connection, record);
  return record;
}

export function updateBenchmarkCaseEntry(
  db: BackendDatabase,
  caseId: string,
  input: {
    name?: string | null | undefined;
    prompt?: string | undefined;
    orderIndex?: number | undefined;
    expectedToolsCalled?: string[] | undefined;
    expectedToolsNotCalled?: string[] | undefined;
    rubric?: RubricCriterion[] | undefined;
  },
): BenchmarkCaseRecord {
  const existing = getBenchmarkCase(db.connection, caseId);
  if (!existing) {
    throw new OperationError(
      `Benchmark case "${caseId}" not found.`,
      "benchmark_case_not_found",
    );
  }
  const updated: BenchmarkCaseRecord = {
    ...existing,
    name: input.name !== undefined ? input.name : existing.name,
    prompt: input.prompt ?? existing.prompt,
    orderIndex: input.orderIndex ?? existing.orderIndex,
    expectedToolsCalled:
      input.expectedToolsCalled ?? existing.expectedToolsCalled,
    expectedToolsNotCalled:
      input.expectedToolsNotCalled ?? existing.expectedToolsNotCalled,
    rubric: input.rubric ?? existing.rubric,
    updatedAt: now(),
  };
  updateBenchmarkCase(db.connection, updated);
  return updated;
}

export function deleteBenchmarkCaseEntry(
  db: BackendDatabase,
  caseId: string,
): void {
  const existing = getBenchmarkCase(db.connection, caseId);
  if (!existing) {
    throw new OperationError(
      `Benchmark case "${caseId}" not found.`,
      "benchmark_case_not_found",
    );
  }
  deleteBenchmarkCase(db.connection, caseId);
}

// ── Run launch + coordinator ──────────────────────────────────────────────────

export interface LaunchBenchmarkRunInput {
  benchmarkId: string;
  caseIds?: string[] | undefined;
  repetitions?: number | undefined;
  modelConfigId?: string | undefined;
  mcpProfileIds?: string[] | undefined;
}

export function launchBenchmarkRun(
  ctx: OperationContext,
  input: LaunchBenchmarkRunInput,
): BenchmarkRunRecord {
  const { db } = ctx;
  const benchmark = requireBenchmark(db, input.benchmarkId);
  const allCases = listBenchmarkCases(db.connection, input.benchmarkId);
  if (allCases.length === 0) {
    throw new OperationError(
      "Benchmark has no cases to run.",
      "benchmark_empty",
    );
  }
  const selectedIds =
    input.caseIds && input.caseIds.length > 0
      ? input.caseIds
      : allCases.map((c) => c.id);
  const known = new Set(allCases.map((c) => c.id));
  const unknown = selectedIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new OperationError(
      `Unknown case id(s): ${unknown.join(", ")}`,
      "benchmark_case_not_found",
    );
  }
  const repetitions = input.repetitions ?? 1;
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new OperationError(
      "repetitions must be a positive integer.",
      "benchmark_invalid_input",
    );
  }
  if (!ctx.scheduler) {
    throw new OperationError(
      "Execution scheduler is not available.",
      "scheduler_unavailable",
    );
  }

  // Resolve the effective model/MCP now: fail fast on bad config and record the
  // concrete selection so the run is self-describing and stable across reps.
  const resolved = resolvePrimarySessionInputs({
    modelConfigId: input.modelConfigId,
    mcpProfileIds: input.mcpProfileIds,
  });
  if (!resolved.ok) throw resolved.error;

  // Snapshot the selected cases at launch so later edits/deletes never alter this run.
  const caseSnapshots: BenchmarkRunCaseSnapshot[] = selectedIds.map((id) => {
    const c = allCases.find((x) => x.id === id)!;
    return {
      sourceCaseId: c.id,
      name: c.name,
      prompt: c.prompt,
      expectedToolsCalled: c.expectedToolsCalled,
      expectedToolsNotCalled: c.expectedToolsNotCalled,
      rubric: c.rubric,
    };
  });

  const ts = now();
  const run: BenchmarkRunRecord = {
    id: requireGeneratedId(
      generateRunId((c) => getBenchmarkRun(db.connection, c) !== null),
      "run",
      `benchmark ${input.benchmarkId}`,
    ),
    benchmarkId: input.benchmarkId,
    benchmarkName: benchmark.name,
    status: "pending",
    modelConfigId: resolved.modelConfigId,
    mcpProfileIds: resolved.mcpProfileSnapshots.map((s) => s.id),
    cases: caseSnapshots,
    repetitions,
    sessions: [],
    error: null,
    createdAt: ts,
    updatedAt: ts,
    startedAt: null,
    completedAt: null,
  };
  createBenchmarkRun(db.connection, run);

  // Fire-and-forget background coordinator. The HTTP caller gets the run id
  // immediately and polls GET /api/benchmark-runs/:id for status + report.
  void runBenchmarkCoordinator(ctx, run.id).catch((err) => {
    ctx.logger?.error(
      { err: err instanceof Error ? err.message : String(err), runId: run.id },
      "benchmark run coordinator crashed",
    );
  });

  return run;
}

async function runBenchmarkCoordinator(
  ctx: OperationContext,
  runId: string,
): Promise<void> {
  const { db } = ctx;
  const initial = getBenchmarkRun(db.connection, runId);
  if (!initial) return;

  updateBenchmarkRun(db.connection, {
    ...initial,
    status: "running",
    startedAt: now(),
    updatedAt: now(),
  });

  // Sequential: each repetition is awaited to completion before the next starts,
  // and its session status (complete/error) is recorded before the next begins.
  // Soft failures (init never reaches ready, tool errors, non-complete turns) are
  // recorded on the individual session and do NOT stop the run; only a hard
  // exception (scheduler / createSession / awaitJob) propagates here and marks the
  // whole run errored via the catch below.
  try {
    for (const snapshot of initial.cases) {
      for (let rep = 1; rep <= initial.repetitions; rep++) {
        await runOneRepetition(ctx, runId, snapshot, rep);
      }
    }
    const done = getBenchmarkRun(db.connection, runId);
    if (done) {
      updateBenchmarkRun(db.connection, {
        ...done,
        status: "complete",
        completedAt: now(),
        updatedAt: now(),
      });
    }
  } catch (err) {
    const current = getBenchmarkRun(db.connection, runId);
    if (current) {
      updateBenchmarkRun(db.connection, {
        ...current,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        completedAt: now(),
        updatedAt: now(),
      });
    }
  }
}

/** Patch a single run-session entry (matched by sessionId) in place. */
function setRunSessionStatus(
  db: BackendDatabase,
  runId: string,
  sessionId: string,
  status: "running" | "complete" | "error",
): void {
  const current = getBenchmarkRun(db.connection, runId);
  if (!current) return;
  updateBenchmarkRun(db.connection, {
    ...current,
    sessions: current.sessions.map((s) =>
      s.sessionId === sessionId ? { ...s, status } : s,
    ),
    updatedAt: now(),
  });
}

async function runOneRepetition(
  ctx: OperationContext,
  runId: string,
  snapshot: BenchmarkRunCaseSnapshot,
  rep: number,
): Promise<string> {
  const { db, scheduler } = ctx;
  if (!scheduler) throw new OperationError("scheduler unavailable", "scheduler_unavailable");
  const run = getBenchmarkRun(db.connection, runId);

  const session = db.connection.transaction(() => {
    const resolved = resolvePrimarySessionInputs({
      modelConfigId: run?.modelConfigId ?? undefined,
      mcpProfileIds: run?.mcpProfileIds ?? undefined,
    });
    if (!resolved.ok) throw resolved.error;
    try {
      return createSession(db, {
        title: `${snapshot.name ?? snapshot.sourceCaseId} (rep ${rep})`,
        modelProfileSnapshot: resolved.modelProfileSnapshot,
        mcpProfileSnapshots: resolved.mcpProfileSnapshots,
        compactionStrategy: "strip-reasoning",
        sessionType: "primary",
        parentKind: "benchmark",
        parentId: runId,
      });
    } catch (error) {
      const mapped = mapSessionIdError(error);
      if (mapped) throw mapped;
      throw error;
    }
  })();

  // Record the session as in-flight immediately so progress polling can see it
  // before init/turn complete.
  const current = getBenchmarkRun(db.connection, runId);
  if (current) {
    updateBenchmarkRun(db.connection, {
      ...current,
      sessions: [
        ...current.sessions,
        {
          sessionId: session.id,
          sourceCaseId: snapshot.sourceCaseId,
          repetition: rep,
          status: "running",
        },
      ],
      updatedAt: now(),
    });
  }

  try {
    const initJob = scheduler.enqueueInit(ctx, session.id);
    await scheduler.awaitJob(initJob.jobId);

    // Only run the prompt if initialization succeeded; a failed-init session is
    // still recorded and surfaces as a non-completed session in the report.
    const initialized = getSessionRecord(db.connection, session.id);
    if (initialized?.initStatus === "ready") {
      const turnJob = scheduler.enqueueSession(ctx, session.id, snapshot.prompt);
      await scheduler.awaitJob(turnJob.jobId);
      setRunSessionStatus(db, runId, session.id, "complete");
    } else {
      // Init did not reach ready — mark the session as errored.
      setRunSessionStatus(db, runId, session.id, "error");
    }
  } catch (err) {
    setRunSessionStatus(db, runId, session.id, "error");
    throw err;
  }

  return session.id;
}

// ── Cheap, pollable run progress ─────────────────────────────────────────────

export interface BenchmarkRunProgressPerCase {
  sourceCaseId: string;
  name: string | null;
  completed: number;
  total: number;
}

export interface BenchmarkRunProgress {
  runId: string;
  benchmarkId: string;
  benchmarkName: string;
  status: string;
  repetitions: number;
  totalCases: number;
  totalSessions: number;
  completedSessions: number;
  failedSessions: number;
  perCase: BenchmarkRunProgressPerCase[];
  currentSessionId: string | null;
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

/**
 * Derive cheap, pollable progress from the run record ONLY — no session traces
 * are loaded (unlike the heavy compute-on-read report). Suitable for frequent
 * polling while a run is in flight.
 */
export function getBenchmarkRunProgress(
  db: BackendDatabase,
  runId: string,
): BenchmarkRunProgress {
  const run = getBenchmarkRun(db.connection, runId);
  if (!run) {
    throw new OperationError(
      `Benchmark run "${runId}" not found.`,
      "benchmark_run_not_found",
    );
  }

  const totalCases = run.cases.length;
  const totalSessions = totalCases * run.repetitions;
  const completedSessions = run.sessions.filter(
    (s) => s.status === "complete" || s.status === "error",
  ).length;
  const failedSessions = run.sessions.filter(
    (s) => s.status === "error",
  ).length;

  const perCase: BenchmarkRunProgressPerCase[] = run.cases.map((snapshot) => {
    const completed = run.sessions.filter(
      (s) =>
        s.sourceCaseId === snapshot.sourceCaseId &&
        (s.status === "complete" || s.status === "error"),
    ).length;
    return {
      sourceCaseId: snapshot.sourceCaseId,
      name: snapshot.name,
      completed,
      total: run.repetitions,
    };
  });

  const currentSessionId =
    run.sessions.find((s) => s.status === "running")?.sessionId ?? null;

  return {
    runId: run.id,
    benchmarkId: run.benchmarkId,
    benchmarkName: run.benchmarkName,
    status: run.status,
    repetitions: run.repetitions,
    totalCases,
    totalSessions,
    completedSessions,
    failedSessions,
    perCase,
    currentSessionId,
    error: run.error,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

// ── Compute-on-read report ──────────────────────────────────────────────────

export interface BenchmarkRunReport {
  run: BenchmarkRunRecord;
  report: RunReport;
}

export function getBenchmarkRunReport(
  db: BackendDatabase,
  runId: string,
): BenchmarkRunReport {
  const run = getBenchmarkRun(db.connection, runId);
  if (!run) {
    throw new OperationError(
      `Benchmark run "${runId}" not found.`,
      "benchmark_run_not_found",
    );
  }

  // Evaluate against the run's case SNAPSHOTS (not the live, possibly-edited cases).
  const byCase = new Map<string, typeof run.sessions>();
  for (const entry of run.sessions) {
    const list = byCase.get(entry.sourceCaseId) ?? [];
    list.push(entry);
    byCase.set(entry.sourceCaseId, list);
  }

  const cases: CaseReport[] = run.cases.map((snapshot) => {
    const entries = (byCase.get(snapshot.sourceCaseId) ?? []).sort(
      (a, b) => a.repetition - b.repetition,
    );
    const sessionMetrics: SessionMetrics[] = entries.map((entry) =>
      deriveSessionMetrics(
        entry.sessionId,
        listPartRecordsBySession(db.connection, entry.sessionId),
        listTurnRecordsBySession(db.connection, entry.sessionId),
      ),
    );
    return buildCaseReport(
      snapshot.sourceCaseId,
      snapshot.prompt,
      {
        expectedToolsCalled: snapshot.expectedToolsCalled,
        expectedToolsNotCalled: snapshot.expectedToolsNotCalled,
      },
      run.repetitions,
      sessionMetrics,
    );
  });

  return {
    run,
    report: {
      runId: run.id,
      benchmarkId: run.benchmarkId,
      status: run.status,
      repetitions: run.repetitions,
      caseCount: run.cases.length,
      sessionCount: run.sessions.length,
      cases,
      perTool: buildPerToolRollup(cases),
    },
  };
}

// ── Evaluation: judge a completed run with the benchmark_evaluation analysis ───

export interface EvaluateBenchmarkRunInput {
  runId: string;
  judgeModelConfigId: string;
  /** Judge sampling temperature; defaults to 0 (deterministic). */
  temperature?: number;
}

/**
 * Launch a new evaluation pass over a COMPLETED run: judge every completed
 * run-session against its snapshotted rubric with the chosen judge model
 * (reusing the benchmark_evaluation analysis type). Repeatable — a run carries
 * 0..N evaluations. Returns immediately; a background coordinator drives the
 * per-session judges sequentially through the scheduler.
 */
export function evaluateBenchmarkRun(
  ctx: OperationContext,
  input: EvaluateBenchmarkRunInput,
): BenchmarkEvaluationRecord {
  const { db } = ctx;
  const run = getBenchmarkRun(db.connection, input.runId);
  if (!run) {
    throw new OperationError(
      `Benchmark run "${input.runId}" not found.`,
      "benchmark_run_not_found",
    );
  }
  if (run.status !== "complete" && run.status !== "error") {
    throw new OperationError(
      `Benchmark run "${input.runId}" is not finished (status '${run.status}').`,
      "benchmark_run_not_finished",
    );
  }
  if (!ctx.scheduler) {
    throw new OperationError(
      "Execution scheduler is not available.",
      "scheduler_unavailable",
    );
  }

  const ts = now();
  const evaluation: BenchmarkEvaluationRecord = {
    id: requireGeneratedId(
      generateEvaluationId((c) => getBenchmarkEvaluation(db.connection, c) !== null),
      "evaluation",
      `run ${input.runId}`,
    ),
    runId: input.runId,
    judgeModelConfigId: input.judgeModelConfigId,
    judgeTemperature: input.temperature ?? 0,
    status: "pending",
    sessions: [],
    error: null,
    createdAt: ts,
    updatedAt: ts,
  };
  createBenchmarkEvaluation(db.connection, evaluation);

  // Fire-and-forget; the HTTP caller gets the evaluation id and polls.
  void runEvaluationCoordinator(ctx, evaluation.id).catch((err) => {
    ctx.logger?.error(
      {
        err: err instanceof Error ? err.message : String(err),
        evaluationId: evaluation.id,
      },
      "benchmark evaluation coordinator crashed",
    );
  });

  return evaluation;
}

/**
 * Re-run a failed/incomplete evaluation: re-judges only the run-sessions that don't
 * yet have a verdict (clearing their stale judge sessions first), keeping the scored
 * ones. The recovery path for a transient failure (e.g. the judge model wasn't loaded)
 * — judging goes through the same init+step launch, so a now-loaded model succeeds.
 */
export function retryBenchmarkEvaluation(
  ctx: OperationContext,
  evaluationId: string,
): BenchmarkEvaluationRecord {
  const { db } = ctx;
  const evaluation = getBenchmarkEvaluation(db.connection, evaluationId);
  if (!evaluation) {
    throw new OperationError(
      `Benchmark evaluation "${evaluationId}" not found.`,
      "benchmark_evaluation_not_found",
    );
  }
  if (!ctx.scheduler) {
    throw new OperationError(
      "Execution scheduler is not available.",
      "scheduler_unavailable",
    );
  }

  void runEvaluationCoordinator(ctx, evaluationId, { retry: true }).catch((err) => {
    ctx.logger?.error(
      {
        err: err instanceof Error ? err.message : String(err),
        evaluationId,
      },
      "benchmark evaluation retry coordinator crashed",
    );
  });

  return { ...evaluation, status: "running", error: null };
}

export interface BenchmarkEvaluationReport extends BenchmarkEvaluationRecord {
  /** Computed-on-read scores from the per-session verdict artifacts. */
  score: EvaluationScore;
  /** Run sessions the pass should judge (the run's completed sessions). */
  expectedSessions: number;
  /** How many of those produced a verdict. The pass is incomplete when < expected. */
  judgedSessions: number;
}

/**
 * List a run's evaluations, each enriched with scores computed on read from its
 * per-session verdict artifacts (Σ awarded / Σ max → pct, with per-case
 * distribution). Nothing is cached.
 */
export function getBenchmarkRunEvaluationReports(
  db: BackendDatabase,
  runId: string,
): BenchmarkEvaluationReport[] {
  const run = getBenchmarkRun(db.connection, runId);
  if (!run) {
    throw new OperationError(
      `Benchmark run "${runId}" not found.`,
      "benchmark_run_not_found",
    );
  }
  const caseNames = new Map(run.cases.map((c) => [c.sourceCaseId, c.name]));
  const runSessionToCase = new Map(
    run.sessions.map((s) => [s.sessionId, s.sourceCaseId]),
  );
  // A pass should judge every completed run-session; it is incomplete (and
  // retryable) until each of those has a verdict.
  const expectedSessions = run.sessions.filter(
    (s) => s.status === "complete",
  ).length;

  return listBenchmarkEvaluationsByRun(db.connection, runId).map((ev) => {
    const sessions: EvaluationSessionScore[] = ev.sessions.map((es) => {
      const verdict = getLatestArtifactBySchemaKey(
        db.connection,
        es.analysisSessionId,
        BENCHMARK_EVAL_KEY.VERDICT,
      );
      const meta = verdict?.metadata as
        | { awarded_points?: number; max_points?: number }
        | undefined;
      const awarded =
        typeof meta?.awarded_points === "number" ? meta.awarded_points : null;
      const max = typeof meta?.max_points === "number" ? meta.max_points : null;
      return {
        runSessionId: es.runSessionId,
        analysisSessionId: es.analysisSessionId,
        sourceCaseId: runSessionToCase.get(es.runSessionId) ?? "",
        status: es.status,
        awarded,
        max,
        pct: scorePct(awarded, max),
      };
    });
    const judgedSessions = sessions.filter((s) => s.pct != null).length;
    return {
      ...ev,
      score: aggregateEvaluationScore(sessions, caseNames),
      expectedSessions,
      judgedSessions,
    };
  });
}

async function runEvaluationCoordinator(
  ctx: OperationContext,
  evaluationId: string,
  opts: { retry?: boolean } = {},
): Promise<void> {
  const { db } = ctx;
  const initial = getBenchmarkEvaluation(db.connection, evaluationId);
  if (!initial) return;

  updateBenchmarkEvaluation(db.connection, {
    ...initial,
    status: "running",
    error: null,
    updatedAt: now(),
  });

  // Sequential, mirroring the run coordinator: each run-session is judged to
  // completion before the next. A per-session failure (model not loaded, launch /
  // scheduler error, or no verdict produced) is recorded on that session entry and
  // does NOT abort the pass; the evaluation ends `error` if any session failed. On
  // retry (opts.retry) sessions that already produced a verdict are kept, and only the
  // failed/incomplete ones are re-judged (after clearing their stale judge session) —
  // so a now-loaded model recovers. We never auto-recover here.
  try {
    const run = getBenchmarkRun(db.connection, initial.runId);
    if (!run) throw new Error(`Run "${initial.runId}" not found`);
    const completed = run.sessions.filter((s) => s.status === "complete");

    let lastError: string | null = null;
    for (const runSession of completed) {
      if (opts.retry) {
        const current = getBenchmarkEvaluation(db.connection, evaluationId);
        const entry = current?.sessions.find(
          (e) => e.runSessionId === runSession.sessionId,
        );
        const verdict = entry
          ? getLatestArtifactBySchemaKey(
              db.connection,
              entry.analysisSessionId,
              BENCHMARK_EVAL_KEY.VERDICT,
            )
          : null;
        // Keep any session that already produced a verdict (even if its entry
        // status is stale, e.g. left 'running' by an interrupted pass); re-judge
        // only the genuinely missing/failed ones.
        if (verdict) continue;
        if (entry) {
          try {
            deleteSessionRecord(db.connection, entry.analysisSessionId);
          } catch {
            // best-effort cleanup of the stale judge session
          }
          removeEvaluationSessionEntry(db, evaluationId, runSession.sessionId);
        }
      }
      try {
        await judgeOneSession(
          ctx,
          evaluationId,
          run,
          runSession,
          initial.judgeModelConfigId,
          initial.judgeTemperature,
        );
      } catch (err) {
        // judgeOneSession marks the session entry 'error' before throwing; keep going.
        lastError = err instanceof Error ? err.message : String(err);
        ctx.logger?.error(
          { err: lastError, evaluationId, runSessionId: runSession.sessionId },
          "benchmark judge session failed (continuing)",
        );
      }
    }

    const done = getBenchmarkEvaluation(db.connection, evaluationId);
    if (done) {
      // The pass attempted every session. It is 'error' if any judge session failed
      // (or never got recorded), otherwise 'complete'. Failed judge sessions are
      // retried individually; this status reflects the pass outcome.
      const failed = done.sessions.filter((s) => s.status === "error").length;
      const missing = completed.length - done.sessions.length;
      const anyError = failed > 0 || missing > 0;
      updateBenchmarkEvaluation(db.connection, {
        ...done,
        status: anyError ? "error" : "complete",
        error: anyError
          ? (lastError ??
            `${failed + missing} of ${completed.length} judge sessions failed.`)
          : null,
        updatedAt: now(),
      });
    }
  } catch (err) {
    // Setup-level failure (e.g. run missing) — hard error for the whole pass.
    const current = getBenchmarkEvaluation(db.connection, evaluationId);
    if (current) {
      updateBenchmarkEvaluation(db.connection, {
        ...current,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        updatedAt: now(),
      });
    }
  }
}

/** Append or patch a single evaluation-session entry (matched by analysisSessionId). */
function upsertEvaluationSession(
  db: BackendDatabase,
  evaluationId: string,
  entry: {
    runSessionId: string;
    analysisSessionId: string;
    status: "running" | "complete" | "error";
  },
): void {
  const current = getBenchmarkEvaluation(db.connection, evaluationId);
  if (!current) return;
  const exists = current.sessions.some(
    (s) => s.analysisSessionId === entry.analysisSessionId,
  );
  const sessions = exists
    ? current.sessions.map((s) =>
        s.analysisSessionId === entry.analysisSessionId ? entry : s,
      )
    : [...current.sessions, entry];
  updateBenchmarkEvaluation(db.connection, {
    ...current,
    sessions,
    updatedAt: now(),
  });
}

/** Drop the session entry for a run-session (used before re-judging it on retry). */
function removeEvaluationSessionEntry(
  db: BackendDatabase,
  evaluationId: string,
  runSessionId: string,
): void {
  const current = getBenchmarkEvaluation(db.connection, evaluationId);
  if (!current) return;
  updateBenchmarkEvaluation(db.connection, {
    ...current,
    sessions: current.sessions.filter((s) => s.runSessionId !== runSessionId),
    updatedAt: now(),
  });
}

async function judgeOneSession(
  ctx: OperationContext,
  evaluationId: string,
  run: BenchmarkRunRecord,
  runSession: BenchmarkRunRecord["sessions"][number],
  judgeModelConfigId: string,
  judgeTemperature: number,
): Promise<void> {
  const { db, scheduler } = ctx;
  if (!scheduler)
    throw new OperationError("scheduler unavailable", "scheduler_unavailable");

  // The run-session's last completed turn is the analysis target.
  const lastTurn = listTurnRecordsBySession(db.connection, runSession.sessionId)
    .filter((t) => t.status === "complete")
    .sort((a, b) => a.turnNumber - b.turnNumber)
    .at(-1);
  const snapshot = run.cases.find(
    (c) => c.sourceCaseId === runSession.sourceCaseId,
  );
  // A completed run-session always has a completed turn + a snapshotted case;
  // skip defensively if not (cannot judge).
  if (!lastTurn || !snapshot) return;

  const { session: analysisSession } = await executeAnalysisLaunch(
    ctx,
    runSession.sessionId,
    {
      target_turn_id: lastTurn.id,
      model_config_id: judgeModelConfigId,
      workflow_kind: ANALYSIS_WORKFLOW_KIND.BENCHMARK_EVALUATION,
      analysis_goal: "Score the session against the rubric.",
      rubric: snapshot.rubric,
      temperature: judgeTemperature,
    },
  );

  upsertEvaluationSession(db, evaluationId, {
    runSessionId: runSession.sessionId,
    analysisSessionId: analysisSession.id,
    status: "running",
  });

  try {
    const job = scheduler.enqueueSession(ctx, analysisSession.id);
    await scheduler.awaitJob(job.jobId);
  } catch (err) {
    upsertEvaluationSession(db, evaluationId, {
      runSessionId: runSession.sessionId,
      analysisSessionId: analysisSession.id,
      status: "error",
    });
    throw err;
  }

  // Soft success criterion: a verdict artifact was produced for this session.
  const verdict = getLatestArtifactBySchemaKey(
    db.connection,
    analysisSession.id,
    BENCHMARK_EVAL_KEY.VERDICT,
  );
  upsertEvaluationSession(db, evaluationId, {
    runSessionId: runSession.sessionId,
    analysisSessionId: analysisSession.id,
    status: verdict ? "complete" : "error",
  });
}
