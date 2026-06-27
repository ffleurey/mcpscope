// ─────────────────────────────────────────────────────────────────────────────
// Benchmark operations: benchmark/case CRUD, run launch + background coordinator,
// and the compute-on-read run report. Phase A (run + deterministic metrics).
// The agent-facing snake_case surface (benchmarkOperations.ts) wraps these functions
// and is registered in the operation catalog, so the capabilities are exposed
// identically via CLI and MCP. See backlog/completed/benchmark-v1.md.
// ─────────────────────────────────────────────────────────────────────────────

import type { BackendDatabase } from "../persistence/db.js";
import { DEFAULT_JUDGE_TEMPERATURE } from "../domain/model.js";
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
import { getLatestSessionErrorSummary } from "../analysis/analysisSessionPresentation.js";
import { SCHEMA_KEY as BENCHMARK_EVAL_KEY } from "../analysis/benchmarkEvaluation/schemas.js";
import type { OperationContext } from "./context.js";
import type { ExecutionScheduler, TerminalJob } from "../runtime/scheduler.js";
import { RunStoppedError, type RunController } from "../runtime/runControl.js";
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
  maxToolRounds?: number | undefined;
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
    maxToolRounds: input.maxToolRounds ?? ctx.maxToolRounds,
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

/** Resume mode for stopped/interrupted runs and evaluation passes. */
export type ResumeMode = "continue" | "retry";

/** A single (case, repetition) unit of benchmark work. */
interface BenchmarkTask {
  snapshot: BenchmarkRunCaseSnapshot;
  rep: number;
}

/**
 * Decide which (case, rep) tasks the coordinator should run, given the run's
 * existing per-session results and the resume mode, plus the stale session ids
 * to supersede (delete) before re-running them.
 *
 * - continue: run only tasks with NO session entry yet (the never-started ones).
 *   Existing 'cancelled'/'error' sessions are left untouched for review.
 * - retry: additionally re-run tasks whose only sessions are 'cancelled'/'error'
 *   (superseding those records). A task with a 'complete' session is never re-run.
 *
 * Stale 'running' entries are reconciled to 'cancelled' before this is called,
 * so they count as incomplete in both modes.
 */
function computeBenchmarkWorkList(
  run: BenchmarkRunRecord,
  mode: ResumeMode,
): { tasks: BenchmarkTask[]; supersede: string[] } {
  const tasks: BenchmarkTask[] = [];
  const supersede: string[] = [];
  for (const snapshot of run.cases) {
    for (let rep = 1; rep <= run.repetitions; rep++) {
      const entries = run.sessions.filter(
        (s) => s.sourceCaseId === snapshot.sourceCaseId && s.repetition === rep,
      );
      if (entries.some((s) => s.status === "complete")) continue; // done; never re-run
      if (entries.length === 0) {
        tasks.push({ snapshot, rep }); // never started → run in either mode
        continue;
      }
      // Only incomplete (cancelled/error) entries exist.
      if (mode === "retry") {
        for (const e of entries) supersede.push(e.sessionId);
        tasks.push({ snapshot, rep });
      }
      // continue mode: leave the incomplete entries for review, run nothing.
    }
  }
  return { tasks, supersede };
}

async function runBenchmarkCoordinator(
  ctx: OperationContext,
  runId: string,
  mode: ResumeMode = "continue",
): Promise<void> {
  const { db } = ctx;
  const controller = ctx.runControl?.acquire(runId);

  // Sequential: each task is awaited to completion before the next starts. Soft
  // failures (init never reaches ready, tool errors, non-complete turns) are
  // recorded on the individual session and do NOT stop the run. A user stop
  // surfaces as a RunStoppedError and rests the run in the resumable 'stopped'
  // state; any other hard exception marks the whole run errored.
  try {
    const initial = getBenchmarkRun(db.connection, runId);
    if (!initial) return;

    // Reconcile any session left 'running' by an interrupted/orphaned pass to
    // 'cancelled', and mark the run running again (clearing a prior stop note).
    const reconciled: BenchmarkRunRecord = {
      ...initial,
      sessions: initial.sessions.map((s) =>
        s.status === "running" ? { ...s, status: "cancelled" } : s,
      ),
      status: "running",
      startedAt: initial.startedAt ?? now(),
      error: null,
      updatedAt: now(),
    };
    updateBenchmarkRun(db.connection, reconciled);

    const { tasks, supersede } = computeBenchmarkWorkList(reconciled, mode);

    // Supersede the stale sessions being re-run on retry: drop their run-session
    // entries and delete the underlying session records.
    if (supersede.length > 0) {
      const supersedeSet = new Set(supersede);
      const pruned = getBenchmarkRun(db.connection, runId);
      if (pruned) {
        updateBenchmarkRun(db.connection, {
          ...pruned,
          sessions: pruned.sessions.filter(
            (s) => !supersedeSet.has(s.sessionId),
          ),
          updatedAt: now(),
        });
      }
      for (const sessionId of supersede) {
        try {
          deleteSessionRecord(db.connection, sessionId);
        } catch {
          // best-effort cleanup of the superseded session record
        }
      }
    }

    for (const task of tasks) {
      if (controller) await controller.checkpoint();
      await runOneRepetition(ctx, runId, task.snapshot, task.rep, controller);
    }

    const done = getBenchmarkRun(db.connection, runId);
    if (done) {
      // 'complete' only when no task was left interrupted. A 'continue' resume
      // deliberately leaves prior 'cancelled' sessions untouched, so the run rests
      // at the resumable 'stopped' state (retry can still re-run them).
      const hasCancelled = done.sessions.some((s) => s.status === "cancelled");
      const erroredSessions = done.sessions.filter((s) => s.status === "error");
      const erroredCount = erroredSessions.length;
      const completedCount = done.sessions.filter((s) => s.status === "complete").length;
      // Surface failures: a run where every session failed is itself a failure
      // ('error' with a summary); a partial failure stays 'complete' but carries a
      // summary so the failure is visible rather than silent. Include the first
      // session's actual error so the run-level message is actionable on its own.
      let failureSummary: string | null = null;
      if (erroredCount > 0) {
        const first = erroredSessions[0]!;
        const firstRecord = getSessionRecord(db.connection, first.sessionId);
        const firstError = firstRecord
          ? getLatestSessionErrorSummary(db.connection, firstRecord)
          : null;
        const detail = firstError
          ? ` First error (${first.sessionId}): ${firstError.message}`
          : " See per-session errors.";
        failureSummary = `${erroredCount} of ${done.sessions.length} session(s) failed.${detail}`;
      }
      const status = hasCancelled
        ? "stopped"
        : completedCount === 0 && erroredCount > 0
          ? "error"
          : "complete";
      updateBenchmarkRun(db.connection, {
        ...done,
        status,
        error: hasCancelled ? null : failureSummary,
        completedAt: status === "complete" || status === "error" ? now() : done.completedAt,
        updatedAt: now(),
      });
    }
  } catch (err) {
    const current = getBenchmarkRun(db.connection, runId);
    if (current) {
      if (err instanceof RunStoppedError) {
        // User stop: rest in the resumable 'stopped' state, keeping partial results.
        updateBenchmarkRun(db.connection, {
          ...current,
          status: "stopped",
          error: null,
          updatedAt: now(),
        });
      } else {
        updateBenchmarkRun(db.connection, {
          ...current,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          completedAt: now(),
          updatedAt: now(),
        });
      }
    }
  } finally {
    ctx.runControl?.release(runId);
  }
}

/**
 * Await a scheduler job, but bail out immediately if the run is stopped — even if
 * the job itself never settles (a model/MCP call that ignores the abort signal).
 * Returns { stopped: true } when the stop wins the race, so the coordinator can
 * unwind to 'stopped' without waiting on a possibly-hung job.
 */
async function awaitJobOrStop(
  scheduler: ExecutionScheduler,
  controller: RunController | undefined,
  jobId: string,
): Promise<{ stopped: boolean; terminal: TerminalJob | null }> {
  if (!controller) {
    return { stopped: false, terminal: await scheduler.awaitJob(jobId) };
  }
  return Promise.race([
    scheduler.awaitJob(jobId).then((terminal) => ({ stopped: false, terminal })),
    controller.whenStopRequested.then(() => ({ stopped: true, terminal: null })),
  ]);
}

/** Patch a single run-session entry (matched by sessionId) in place. */
function setRunSessionStatus(
  db: BackendDatabase,
  runId: string,
  sessionId: string,
  status: "running" | "complete" | "error" | "cancelled",
  error: string | null = null,
): void {
  const current = getBenchmarkRun(db.connection, runId);
  if (!current) return;
  updateBenchmarkRun(db.connection, {
    ...current,
    sessions: current.sessions.map((s) =>
      s.sessionId === sessionId ? { ...s, status, error } : s,
    ),
    updatedAt: now(),
  });
}

async function runOneRepetition(
  ctx: OperationContext,
  runId: string,
  snapshot: BenchmarkRunCaseSnapshot,
  rep: number,
  controller: RunController | undefined,
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
        // Every test session in the run shares the run's snapshotted budget.
        maxToolRounds: run?.maxToolRounds,
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
          error: null,
        },
      ],
      updatedAt: now(),
    });
  }

  const owner = { kind: "benchmark-run" as const, id: runId };
  try {
    const initJob = scheduler.enqueueInit(ctx, session.id, owner);
    controller?.setActiveJob(initJob.jobId);
    const initWait = await awaitJobOrStop(scheduler, controller, initJob.jobId);
    controller?.clearActiveJob();
    // A stop signalled during init unwinds the run immediately (even if the init
    // job never settles); record the partial session as cancelled (kept for review).
    if (initWait.stopped || controller?.isStopping()) {
      setRunSessionStatus(db, runId, session.id, "cancelled");
      throw new RunStoppedError(runId);
    }

    // Only run the prompt if initialization succeeded; a failed-init session is
    // recorded as errored with the reason so the failure is never silent.
    const initialized = getSessionRecord(db.connection, session.id);
    if (initialized?.initStatus !== "ready") {
      setRunSessionStatus(
        db,
        runId,
        session.id,
        "error",
        initWait.terminal?.error ??
          "Initialization failed — the MCP server may be unreachable or the model unavailable.",
      );
      return session.id;
    }

    const turnJob = scheduler.enqueueSession(ctx, session.id, snapshot.prompt, owner);
    controller?.setActiveJob(turnJob.jobId);
    const turnWait = await awaitJobOrStop(scheduler, controller, turnJob.jobId);
    controller?.clearActiveJob();
    if (turnWait.stopped || controller?.isStopping()) {
      setRunSessionStatus(db, runId, session.id, "cancelled");
      throw new RunStoppedError(runId);
    }

    // The job settling does NOT mean the turn succeeded: a failed model call is
    // either recorded on the turn (status 'error') or surfaces as a failed job.
    // The session is 'complete' only if its last turn actually completed.
    const lastTurn = listTurnRecordsBySession(db.connection, session.id)
      .sort((a, b) => a.turnNumber - b.turnNumber)
      .at(-1);
    if (lastTurn?.status === "complete") {
      setRunSessionStatus(db, runId, session.id, "complete");
    } else {
      setRunSessionStatus(
        db,
        runId,
        session.id,
        "error",
        turnWait.terminal?.error ??
          (lastTurn?.outcome ? `Turn failed (${lastTurn.outcome}).` : "Turn did not complete."),
      );
    }
  } catch (err) {
    controller?.clearActiveJob();
    if (err instanceof RunStoppedError) throw err;
    setRunSessionStatus(
      db,
      runId,
      session.id,
      "error",
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }

  return session.id;
}

// ── Run control: pause / resume / stop ───────────────────────────────────────

function requireRunRecord(
  ctx: OperationContext,
  runId: string,
): BenchmarkRunRecord {
  const run = getBenchmarkRun(ctx.db.connection, runId);
  if (!run) {
    throw new OperationError(
      `Benchmark run "${runId}" not found.`,
      "benchmark_run_not_found",
    );
  }
  return run;
}

/** Pause a running benchmark run cleanly (holds before the next task). */
export function pauseBenchmarkRun(
  ctx: OperationContext,
  runId: string,
): BenchmarkRunRecord {
  const run = requireRunRecord(ctx, runId);
  if (!ctx.runControl?.pause(runId)) {
    throw new OperationError(
      `Benchmark run "${runId}" is not running (status '${run.status}').`,
      "benchmark_run_not_pausable",
    );
  }
  const updated: BenchmarkRunRecord = {
    ...run,
    status: "paused",
    updatedAt: now(),
  };
  updateBenchmarkRun(ctx.db.connection, updated);
  return updated;
}

/**
 * Stop a running/paused benchmark run. The live coordinator aborts the in-flight
 * job and persists 'stopped' as it unwinds; if no coordinator is live (e.g. the
 * record is orphaned) the status is reconciled to 'stopped' directly.
 */
export function stopBenchmarkRun(
  ctx: OperationContext,
  runId: string,
): BenchmarkRunRecord {
  const run = requireRunRecord(ctx, runId);
  const signalled = ctx.runControl?.stop(runId) ?? false;
  if (signalled) {
    // Coordinator will persist 'stopped' shortly; report it optimistically.
    return { ...run, status: "stopped" };
  }
  if (run.status === "running" || run.status === "paused") {
    const updated: BenchmarkRunRecord = {
      ...run,
      status: "stopped",
      updatedAt: now(),
    };
    updateBenchmarkRun(ctx.db.connection, updated);
    return updated;
  }
  throw new OperationError(
    `Benchmark run "${runId}" is not running (status '${run.status}').`,
    "benchmark_run_not_stoppable",
  );
}

/**
 * Resume a paused or stopped benchmark run.
 *
 * - A live, paused coordinator is simply un-paused (mode ignored).
 * - A stopped/errored run is re-launched over its remaining work: 'continue'
 *   runs only never-started tasks; 'retry' also re-runs cancelled/errored ones.
 */
export function resumeBenchmarkRun(
  ctx: OperationContext,
  runId: string,
  mode: ResumeMode = "continue",
): BenchmarkRunRecord {
  const run = requireRunRecord(ctx, runId);
  if (!ctx.scheduler) {
    throw new OperationError(
      "Execution scheduler is not available.",
      "scheduler_unavailable",
    );
  }

  // Live, paused coordinator → un-pause in place.
  if (ctx.runControl?.resume(runId)) {
    const updated: BenchmarkRunRecord = {
      ...run,
      status: "running",
      updatedAt: now(),
    };
    updateBenchmarkRun(ctx.db.connection, updated);
    return updated;
  }

  if (run.status === "running" || run.status === "paused") {
    throw new OperationError(
      `Benchmark run "${runId}" is already running.`,
      "benchmark_run_already_running",
    );
  }
  if (run.status === "pending") {
    throw new OperationError(
      `Benchmark run "${runId}" is still starting.`,
      "benchmark_run_already_running",
    );
  }
  if (run.status === "complete") {
    throw new OperationError(
      `Benchmark run "${runId}" is already complete.`,
      "benchmark_run_complete",
    );
  }

  // status is 'stopped' or 'error' → re-launch over the remaining work.
  void runBenchmarkCoordinator(ctx, runId, mode).catch((err) => {
    ctx.logger?.error(
      { err: err instanceof Error ? err.message : String(err), runId },
      "benchmark run resume coordinator crashed",
    );
  });
  return { ...run, status: "running", error: null };
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
  // A session is "processed" once it reaches any terminal state, including
  // 'cancelled' (interrupted by a user stop) — only 'running' is still in flight.
  const isProcessed = (s: { status: string }) =>
    s.status === "complete" || s.status === "error" || s.status === "cancelled";
  const completedSessions = run.sessions.filter(isProcessed).length;
  const failedSessions = run.sessions.filter(
    (s) => s.status === "error",
  ).length;

  const perCase: BenchmarkRunProgressPerCase[] = run.cases.map((snapshot) => {
    const completed = run.sessions.filter(
      (s) => s.sourceCaseId === snapshot.sourceCaseId && isProcessed(s),
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
    const sessionMetrics: SessionMetrics[] = entries.map((entry) => {
      const metrics = deriveSessionMetrics(
        entry.sessionId,
        listPartRecordsBySession(db.connection, entry.sessionId),
        listTurnRecordsBySession(db.connection, entry.sessionId),
      );
      // Surface why a failed session failed (e.g. MCP init failure), so the
      // report explains the failure instead of just showing empty metrics.
      if (entry.status === "error") {
        const record = getSessionRecord(db.connection, entry.sessionId);
        metrics.error = record
          ? getLatestSessionErrorSummary(db.connection, record)
          : null;
      }
      return metrics;
    });
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
  /**
   * Judge sampling temperature. Omit to use DEFAULT_JUDGE_TEMPERATURE; pass null
   * to send no temperature so the judge's provider uses its own default.
   */
  temperature?: number | null;
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
    // Omitted (undefined) => default; explicit null => provider default (no temperature).
    judgeTemperature:
      input.temperature === undefined ? DEFAULT_JUDGE_TEMPERATURE : input.temperature,
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

function requireEvaluationRecord(
  ctx: OperationContext,
  evaluationId: string,
): BenchmarkEvaluationRecord {
  const evaluation = getBenchmarkEvaluation(ctx.db.connection, evaluationId);
  if (!evaluation) {
    throw new OperationError(
      `Benchmark evaluation "${evaluationId}" not found.`,
      "benchmark_evaluation_not_found",
    );
  }
  return evaluation;
}

/**
 * Re-run a failed/incomplete evaluation: re-judges every run-session without a
 * verdict (clearing stale judge sessions first), keeping the scored ones. Thin
 * alias for resumeBenchmarkEvaluation(..., 'retry') — the recovery path for a
 * transient failure (e.g. the judge model wasn't loaded).
 */
export function retryBenchmarkEvaluation(
  ctx: OperationContext,
  evaluationId: string,
): BenchmarkEvaluationRecord {
  return resumeBenchmarkEvaluation(ctx, evaluationId, "retry");
}

/** Pause a running evaluation pass cleanly (holds before the next judge session). */
export function pauseBenchmarkEvaluation(
  ctx: OperationContext,
  evaluationId: string,
): BenchmarkEvaluationRecord {
  const evaluation = requireEvaluationRecord(ctx, evaluationId);
  if (!ctx.runControl?.pause(evaluationId)) {
    throw new OperationError(
      `Benchmark evaluation "${evaluationId}" is not running (status '${evaluation.status}').`,
      "benchmark_evaluation_not_pausable",
    );
  }
  const updated: BenchmarkEvaluationRecord = {
    ...evaluation,
    status: "paused",
    updatedAt: now(),
  };
  updateBenchmarkEvaluation(ctx.db.connection, updated);
  return updated;
}

/** Stop a running/paused evaluation pass (resumable; partial verdicts kept). */
export function stopBenchmarkEvaluation(
  ctx: OperationContext,
  evaluationId: string,
): BenchmarkEvaluationRecord {
  const evaluation = requireEvaluationRecord(ctx, evaluationId);
  const signalled = ctx.runControl?.stop(evaluationId) ?? false;
  if (signalled) {
    return { ...evaluation, status: "stopped" };
  }
  if (evaluation.status === "running" || evaluation.status === "paused") {
    const updated: BenchmarkEvaluationRecord = {
      ...evaluation,
      status: "stopped",
      updatedAt: now(),
    };
    updateBenchmarkEvaluation(ctx.db.connection, updated);
    return updated;
  }
  throw new OperationError(
    `Benchmark evaluation "${evaluationId}" is not running (status '${evaluation.status}').`,
    "benchmark_evaluation_not_stoppable",
  );
}

/**
 * Resume a paused or stopped evaluation pass.
 *
 * - A live, paused coordinator is simply un-paused (mode ignored).
 * - A stopped/errored pass is re-launched over the run-sessions still lacking a
 *   verdict: 'continue' judges only never-judged sessions; 'retry' also re-judges
 *   cancelled/errored ones.
 */
export function resumeBenchmarkEvaluation(
  ctx: OperationContext,
  evaluationId: string,
  mode: ResumeMode = "continue",
): BenchmarkEvaluationRecord {
  const evaluation = requireEvaluationRecord(ctx, evaluationId);
  if (!ctx.scheduler) {
    throw new OperationError(
      "Execution scheduler is not available.",
      "scheduler_unavailable",
    );
  }

  if (ctx.runControl?.resume(evaluationId)) {
    const updated: BenchmarkEvaluationRecord = {
      ...evaluation,
      status: "running",
      updatedAt: now(),
    };
    updateBenchmarkEvaluation(ctx.db.connection, updated);
    return updated;
  }

  if (evaluation.status === "running" || evaluation.status === "paused") {
    throw new OperationError(
      `Benchmark evaluation "${evaluationId}" is already running.`,
      "benchmark_evaluation_already_running",
    );
  }

  void runEvaluationCoordinator(ctx, evaluationId, mode).catch((err) => {
    ctx.logger?.error(
      { err: err instanceof Error ? err.message : String(err), evaluationId },
      "benchmark evaluation resume coordinator crashed",
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
  // Snapshot rubric per case — joined with each verdict to build the per-criterion grid.
  const caseRubric = new Map(run.cases.map((c) => [c.sourceCaseId, c.rubric]));

  return listBenchmarkEvaluationsByRun(db.connection, runId).map((ev) => {
    const sessions: EvaluationSessionScore[] = ev.sessions.map((es) => {
      const sourceCaseId = runSessionToCase.get(es.runSessionId) ?? "";
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

      // Per-criterion breakdown: rubric criteria (order + description + max) joined
      // with the judge's awarded points + note (clamped). Empty when no verdict.
      const verdictContent = verdict?.content as
        | { criteria?: Array<{ id: number; points: number; note: string }> }
        | undefined;
      const byId = new Map(
        (verdictContent?.criteria ?? []).map((c) => [c.id, c]),
      );
      const criteria = (caseRubric.get(sourceCaseId) ?? []).map((rc) => {
        const v = byId.get(rc.id);
        return {
          id: rc.id,
          description: rc.description,
          max: rc.points,
          points: v ? Math.max(0, Math.min(rc.points, Math.round(v.points))) : null,
          note: v?.note ?? "",
        };
      });

      return {
        runSessionId: es.runSessionId,
        analysisSessionId: es.analysisSessionId,
        sourceCaseId,
        status: es.status,
        awarded,
        max,
        pct: scorePct(awarded, max),
        criteria,
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

/**
 * Decide which completed run-sessions a pass should judge, plus the stale judge
 * sessions to supersede before re-judging. Completion criterion = a verdict
 * artifact exists (mirrors how scores are computed on read).
 *
 * - continue: judge only run-sessions with NO entry yet. Existing unjudged
 *   entries (cancelled/error) are left for review.
 * - retry: additionally re-judge run-sessions whose entry lacks a verdict,
 *   superseding the stale judge session.
 */
function computeEvaluationWorkList(
  db: BackendDatabase,
  evaluation: BenchmarkEvaluationRecord,
  completedRunSessions: BenchmarkRunRecord["sessions"],
  mode: ResumeMode,
): {
  tasks: BenchmarkRunRecord["sessions"];
  supersede: { runSessionId: string; analysisSessionId: string }[];
} {
  const tasks: BenchmarkRunRecord["sessions"] = [];
  const supersede: { runSessionId: string; analysisSessionId: string }[] = [];
  for (const runSession of completedRunSessions) {
    const entry = evaluation.sessions.find(
      (e) => e.runSessionId === runSession.sessionId,
    );
    const verdict = entry
      ? getLatestArtifactBySchemaKey(
          db.connection,
          entry.analysisSessionId,
          BENCHMARK_EVAL_KEY.VERDICT,
        )
      : null;
    if (verdict) continue; // already judged
    if (!entry) {
      tasks.push(runSession); // never judged → judge in either mode
      continue;
    }
    if (mode === "retry") {
      supersede.push({
        runSessionId: runSession.sessionId,
        analysisSessionId: entry.analysisSessionId,
      });
      tasks.push(runSession);
    }
    // continue: leave the unjudged entry for review.
  }
  return { tasks, supersede };
}

async function runEvaluationCoordinator(
  ctx: OperationContext,
  evaluationId: string,
  mode: ResumeMode = "continue",
): Promise<void> {
  const { db } = ctx;
  const controller = ctx.runControl?.acquire(evaluationId);

  // Sequential, mirroring the run coordinator: each run-session is judged to
  // completion before the next. A per-session failure (model not loaded, launch /
  // scheduler error, or no verdict produced) is recorded on that session entry and
  // does NOT abort the pass; the evaluation ends 'error' if any session is unjudged.
  // A user stop surfaces as RunStoppedError → resumable 'stopped' state.
  try {
    const initial = getBenchmarkEvaluation(db.connection, evaluationId);
    if (!initial) return;

    // Reconcile any entry left 'running' by an interrupted/orphaned pass to
    // 'cancelled', and mark the pass running again (clearing a prior stop note).
    const reconciled: BenchmarkEvaluationRecord = {
      ...initial,
      sessions: initial.sessions.map((s) =>
        s.status === "running" ? { ...s, status: "cancelled" } : s,
      ),
      status: "running",
      error: null,
      updatedAt: now(),
    };
    updateBenchmarkEvaluation(db.connection, reconciled);

    const run = getBenchmarkRun(db.connection, reconciled.runId);
    if (!run) throw new Error(`Run "${reconciled.runId}" not found`);
    const completed = run.sessions.filter((s) => s.status === "complete");

    const { tasks, supersede } = computeEvaluationWorkList(
      db,
      reconciled,
      completed,
      mode,
    );
    for (const s of supersede) {
      try {
        deleteSessionRecord(db.connection, s.analysisSessionId);
      } catch {
        // best-effort cleanup of the stale judge session
      }
      removeEvaluationSessionEntry(db, evaluationId, s.runSessionId);
    }

    let lastError: string | null = null;
    for (const runSession of tasks) {
      if (controller) await controller.checkpoint();
      try {
        await judgeOneSession(
          ctx,
          evaluationId,
          run,
          runSession,
          reconciled.judgeModelConfigId,
          reconciled.judgeTemperature,
          controller,
        );
      } catch (err) {
        if (err instanceof RunStoppedError) throw err;
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
      const judged = completed.filter((rs) => {
        const entry = done.sessions.find(
          (e) => e.runSessionId === rs.sessionId,
        );
        return (
          entry &&
          getLatestArtifactBySchemaKey(
            db.connection,
            entry.analysisSessionId,
            BENCHMARK_EVAL_KEY.VERDICT,
          )
        );
      }).length;
      // A 'continue' resume leaves prior 'cancelled' judge sessions untouched →
      // rest at the resumable 'stopped' state. Otherwise: 'complete' if every
      // run-session was judged, else 'error' (retry/resume can fill the rest).
      const hasCancelled = done.sessions.some((s) => s.status === "cancelled");
      const incomplete = judged < completed.length;
      updateBenchmarkEvaluation(db.connection, {
        ...done,
        status: hasCancelled ? "stopped" : incomplete ? "error" : "complete",
        error:
          !hasCancelled && incomplete
            ? (lastError ??
              `${completed.length - judged} of ${completed.length} judge sessions incomplete.`)
            : null,
        updatedAt: now(),
      });
    }
  } catch (err) {
    const current = getBenchmarkEvaluation(db.connection, evaluationId);
    if (current) {
      if (err instanceof RunStoppedError) {
        updateBenchmarkEvaluation(db.connection, {
          ...current,
          status: "stopped",
          error: null,
          updatedAt: now(),
        });
      } else {
        // Setup-level failure (e.g. run missing) — hard error for the whole pass.
        updateBenchmarkEvaluation(db.connection, {
          ...current,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          updatedAt: now(),
        });
      }
    }
  } finally {
    ctx.runControl?.release(evaluationId);
  }
}

/** Append or patch a single evaluation-session entry (matched by analysisSessionId). */
function upsertEvaluationSession(
  db: BackendDatabase,
  evaluationId: string,
  entry: {
    runSessionId: string;
    analysisSessionId: string;
    status: "running" | "complete" | "error" | "cancelled";
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
  judgeTemperature: number | null,
  controller: RunController | undefined,
): Promise<void> {
  const { db, scheduler } = ctx;
  if (!scheduler)
    throw new OperationError("scheduler unavailable", "scheduler_unavailable");

  // Analysis target: the last completed turn, else the last turn of any status — so a
  // run-session that errored (e.g. hit the tool-round cap with no final answer) is still
  // judged against what it produced; the rubric scores it accordingly. Throwing when a
  // session is genuinely unjudgeable surfaces it as a failed judge (counted by the
  // coordinator) rather than a silent skip that leaves the pass mysteriously incomplete.
  const turns = listTurnRecordsBySession(
    db.connection,
    runSession.sessionId,
  ).sort((a, b) => a.turnNumber - b.turnNumber);
  // Prefer the last completed turn; else the last terminal (error/aborted) turn so a
  // failed run-session is judged against what it produced. Never an in-flight turn.
  const lastTurn =
    turns.filter((t) => t.status === "complete").at(-1) ??
    turns.filter((t) => t.status === "error" || t.status === "aborted").at(-1);
  const snapshot = run.cases.find(
    (c) => c.sourceCaseId === runSession.sourceCaseId,
  );
  if (!snapshot) {
    throw new Error(
      `No case snapshot for run-session ${runSession.sessionId} (case ${runSession.sourceCaseId}).`,
    );
  }
  if (!lastTurn) {
    throw new Error(`Run-session ${runSession.sessionId} has no turn to judge.`);
  }

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
      // A failed run-session's last turn is terminal-but-not-complete; judge it anyway.
      allow_incomplete_target: true,
    },
  );

  upsertEvaluationSession(db, evaluationId, {
    runSessionId: runSession.sessionId,
    analysisSessionId: analysisSession.id,
    status: "running",
  });

  let stopped: boolean;
  try {
    const job = scheduler.enqueueSession(ctx, analysisSession.id, undefined, {
      kind: "benchmark-evaluation",
      id: evaluationId,
    });
    controller?.setActiveJob(job.jobId);
    const wait = await awaitJobOrStop(scheduler, controller, job.jobId);
    controller?.clearActiveJob();
    stopped = wait.stopped || (controller?.isStopping() ?? false);
  } catch (err) {
    controller?.clearActiveJob();
    upsertEvaluationSession(db, evaluationId, {
      runSessionId: runSession.sessionId,
      analysisSessionId: analysisSession.id,
      status: "error",
    });
    throw err;
  }

  // A stop signalled during judging unwinds the pass immediately (even if the
  // judge job never settles); record the partial judge session as cancelled.
  if (stopped) {
    upsertEvaluationSession(db, evaluationId, {
      runSessionId: runSession.sessionId,
      analysisSessionId: analysisSession.id,
      status: "cancelled",
    });
    throw new RunStoppedError(evaluationId);
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
