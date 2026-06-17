// ─────────────────────────────────────────────────────────────────────────────
// Benchmark operations: benchmark/case CRUD, run launch + background coordinator,
// and the compute-on-read run report. Phase A (run + deterministic metrics).
// HTTP/CLI surface only for now (not registered in the MCP operation catalog).
// See backlog/specification/benchmark-v1.md.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import type { BackendDatabase } from "../persistence/db.js";
import type {
  BenchmarkRecord,
  BenchmarkCaseRecord,
  BenchmarkRunRecord,
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
  getSessionRecord,
  deleteSessionRecord,
  listPartRecordsBySession,
  listTurnRecordsBySession,
} from "../persistence/repository.js";
import { createSession } from "../runtime/modelTurns.js";
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

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function now(): number {
  return Date.now();
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
    id: newId("bm"),
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
  // Run-sessions are not cascade-deleted (generic untyped parent ref), so remove
  // them explicitly; cases and runs cascade via FK.
  for (const run of listBenchmarkRuns(db.connection, id)) {
    for (const session of run.sessions) {
      try {
        deleteSessionRecord(db.connection, session.sessionId);
      } catch {
        // best-effort cleanup
      }
    }
  }
  deleteBenchmark(db.connection, id);
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
  },
): BenchmarkCaseRecord {
  requireBenchmark(db, benchmarkId);
  const existing = listBenchmarkCases(db.connection, benchmarkId);
  const ts = now();
  const record: BenchmarkCaseRecord = {
    id: newId("bc"),
    benchmarkId,
    name: input.name ?? null,
    prompt: input.prompt,
    orderIndex: existing.length,
    expectedToolsCalled: input.expectedToolsCalled ?? [],
    expectedToolsNotCalled: input.expectedToolsNotCalled ?? [],
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
    id: newId("bc"),
    benchmarkId,
    name: input?.name ?? null,
    prompt,
    orderIndex: existing.length,
    expectedToolsCalled,
    expectedToolsNotCalled: [],
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
  requireBenchmark(db, input.benchmarkId);
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

  const ts = now();
  const run: BenchmarkRunRecord = {
    id: newId("br"),
    benchmarkId: input.benchmarkId,
    status: "pending",
    modelConfigId: resolved.modelConfigId,
    mcpProfileIds: resolved.mcpProfileSnapshots.map((s) => s.id),
    caseIds: selectedIds,
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

  try {
    for (const caseId of initial.caseIds) {
      const benchmarkCase = getBenchmarkCase(db.connection, caseId);
      if (!benchmarkCase) continue;
      for (let rep = 1; rep <= initial.repetitions; rep++) {
        const sessionId = await runOneRepetition(ctx, runId, benchmarkCase, rep);
        const current = getBenchmarkRun(db.connection, runId);
        if (!current) return;
        updateBenchmarkRun(db.connection, {
          ...current,
          sessions: [...current.sessions, { sessionId, caseId, repetition: rep }],
          updatedAt: now(),
        });
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

async function runOneRepetition(
  ctx: OperationContext,
  runId: string,
  benchmarkCase: BenchmarkCaseRecord,
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
        title: `Benchmark case ${benchmarkCase.orderIndex + 1} (rep ${rep})`,
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

  const initJob = scheduler.enqueueInit(ctx, session.id);
  await scheduler.awaitJob(initJob.jobId);

  // Only run the prompt if initialization succeeded; a failed-init session is
  // still recorded and surfaces as a non-completed session in the report.
  const initialized = getSessionRecord(db.connection, session.id);
  if (initialized?.initStatus === "ready") {
    const turnJob = scheduler.enqueueSession(ctx, session.id, benchmarkCase.prompt);
    await scheduler.awaitJob(turnJob.jobId);
  }

  return session.id;
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

  const byCase = new Map<string, typeof run.sessions>();
  for (const entry of run.sessions) {
    const list = byCase.get(entry.caseId) ?? [];
    list.push(entry);
    byCase.set(entry.caseId, list);
  }

  const cases: CaseReport[] = [];
  for (const caseId of run.caseIds) {
    const benchmarkCase = getBenchmarkCase(db.connection, caseId);
    if (!benchmarkCase) continue;
    const entries = (byCase.get(caseId) ?? []).sort(
      (a, b) => a.repetition - b.repetition,
    );
    const sessionMetrics: SessionMetrics[] = entries.map((entry) =>
      deriveSessionMetrics(
        entry.sessionId,
        listPartRecordsBySession(db.connection, entry.sessionId),
        listTurnRecordsBySession(db.connection, entry.sessionId),
      ),
    );
    cases.push(
      buildCaseReport(
        benchmarkCase.id,
        benchmarkCase.prompt,
        {
          expectedToolsCalled: benchmarkCase.expectedToolsCalled,
          expectedToolsNotCalled: benchmarkCase.expectedToolsNotCalled,
        },
        run.repetitions,
        sessionMetrics,
      ),
    );
  }

  return {
    run,
    report: {
      runId: run.id,
      benchmarkId: run.benchmarkId,
      status: run.status,
      repetitions: run.repetitions,
      caseCount: run.caseIds.length,
      sessionCount: run.sessions.length,
      cases,
      perTool: buildPerToolRollup(cases),
    },
  };
}
