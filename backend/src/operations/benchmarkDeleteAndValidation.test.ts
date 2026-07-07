/**
 * Regression tests for a dogfooding incident:
 *
 *   1. The /api/operations/* HTTP handlers must reject invalid input with a
 *      structured 400 — the exact string-rubric-id payload that used to be
 *      persisted silently and detonate later at benchmark_evaluate.
 *   2. The catalog delete operations (benchmark_delete / benchmark_delete_run /
 *      benchmark_delete_evaluation) exist over HTTP, work, and refuse to delete
 *      an active run.
 */
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildBackendApp } from "../app.js";
import { openBackendDatabase } from "../persistence/db.js";
import { createBenchmarkRun } from "../persistence/benchmarkRepository.js";
import type { BenchmarkRunRecord } from "../domain/model.js";

function makeTestConfig() {
  const dataDir = `.tmp-test-data/${crypto.randomUUID()}`;
  return {
    host: "127.0.0.1",
    port: 3030,
    corsOrigin: true as const,
    dataDir,
    sqlitePath: `${dataDir}/test.db`,
    maxToolRounds: 5,
    appVersion: "test",
  };
}

function makeRunRecord(
  id: string,
  benchmarkId: string,
  status: BenchmarkRunRecord["status"],
): BenchmarkRunRecord {
  return {
    id,
    benchmarkId,
    benchmarkName: "validation-test",
    status,
    modelConfigId: "mc-test",
    mcpProfileIds: [],
    cases: [],
    repetitions: 1,
    maxToolRounds: 5,
    sessions: [],
    error: null,
    createdAt: 1,
    updatedAt: 1,
    startedAt: null,
    completedAt: null,
  };
}

let app: FastifyInstance | null = null;
let dataDir: string | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  dataDir = null;
});

async function makeApp() {
  const config = makeTestConfig();
  dataDir = config.dataDir;
  app = await buildBackendApp(config);
  return { app, config };
}

async function createBenchmarkViaHttp(app: FastifyInstance): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/api/operations/benchmark-create",
    payload: { name: "validation-test" },
  });
  expect(created.statusCode).toBe(200);
  return (created.json() as { benchmark: { id: string } }).benchmark.id;
}

describe("operations HTTP input validation (adapter parity with MCP)", () => {
  it("rejects a string rubric id on benchmark_update_case with a structured 400", async () => {
    const { app } = await makeApp();
    const benchmarkId = await createBenchmarkViaHttp(app);

    const added = await app.inject({
      method: "POST",
      url: "/api/operations/benchmark-add-case",
      payload: { benchmark_id: benchmarkId, prompt: "What is the weather?" },
    });
    expect(added.statusCode).toBe(200);
    const caseId = (added.json() as { case: { id: string } }).case.id;

    // The exact payload from the incident: string ids instead of integers.
    const invalid = await app.inject({
      method: "POST",
      url: "/api/operations/benchmark-update-case",
      payload: {
        case_id: caseId,
        rubric: [
          { id: "trend", description: "Describes the trend", points: 3 },
          { id: "clarity", description: "Concise answer", points: 2 },
        ],
      },
    });
    expect(invalid.statusCode).toBe(400);
    const error = (invalid.json() as { error: { code?: string; message?: string } }).error;
    expect(error.code).toBe("benchmark_invalid_input");
    expect(error.message).toContain("rubric");

    // The same rubric with integer ids is accepted.
    const valid = await app.inject({
      method: "POST",
      url: "/api/operations/benchmark-update-case",
      payload: {
        case_id: caseId,
        rubric: [
          { id: 1, description: "Describes the trend", points: 3 },
          { id: 2, description: "Concise answer", points: 2 },
        ],
      },
    });
    expect(valid.statusCode).toBe(200);
    const updated = valid.json() as { case: { rubric: { id: number }[] } };
    expect(updated.case.rubric.map((r) => r.id)).toEqual([1, 2]);
  });

  it("rejects a malformed benchmark_create body with a structured 400", async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/operations/benchmark-create",
      payload: { name: 123 },
    });
    expect(response.statusCode).toBe(400);
    expect(
      (response.json() as { error: { code?: string } }).error.code,
    ).toBe("benchmark_invalid_input");
  });
});

describe("catalog delete operations (benchmark / run / evaluation)", () => {
  it("benchmark_delete removes the blueprint; inspect then 404s", async () => {
    const { app } = await makeApp();
    const benchmarkId = await createBenchmarkViaHttp(app);

    const deleted = await app.inject({
      method: "POST",
      url: "/api/operations/benchmark-delete",
      payload: { benchmark_id: benchmarkId },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ benchmark_id: benchmarkId, deleted: true });

    const inspect = await app.inject({
      method: "GET",
      url: `/api/operations/benchmarks/${benchmarkId}`,
    });
    expect(inspect.statusCode).toBe(404);
  });

  it("benchmark_delete_run refuses an active run (409) and deletes a terminal one", async () => {
    const { app, config } = await makeApp();
    const benchmarkId = await createBenchmarkViaHttp(app);

    // Insert run snapshots directly (launching a real run needs a live model).
    const db = openBackendDatabase(config.sqlitePath);
    createBenchmarkRun(db.connection, makeRunRecord("R-ACT1", benchmarkId, "running"));
    createBenchmarkRun(db.connection, makeRunRecord("R-DONE", benchmarkId, "complete"));

    const active = await app.inject({
      method: "POST",
      url: "/api/operations/benchmark-delete-run",
      payload: { run_id: "R-ACT1" },
    });
    expect(active.statusCode).toBe(409);
    expect(
      (active.json() as { error: { code?: string } }).error.code,
    ).toBe("benchmark_run_active");

    const terminal = await app.inject({
      method: "POST",
      url: "/api/operations/benchmark-delete-run",
      payload: { run_id: "R-DONE" },
    });
    expect(terminal.statusCode).toBe(200);
    expect(terminal.json()).toEqual({ run_id: "R-DONE", deleted: true });

    const status = await app.inject({
      method: "GET",
      url: "/api/operations/benchmark-runs/R-DONE/status",
    });
    expect(status.statusCode).toBe(404);
  });

  it("benchmark_evaluate refuses a run whose snapshot has no rubric'd case (422)", async () => {
    const { app, config } = await makeApp();
    const benchmarkId = await createBenchmarkViaHttp(app);
    const db = openBackendDatabase(config.sqlitePath);
    // Completed run, one session, case snapshot without a rubric.
    const run = makeRunRecord("R-NORB", benchmarkId, "complete");
    run.cases = [
      {
        sourceCaseId: `${benchmarkId}.1`,
        name: "no-rubric-case",
        prompt: "What is the weather?",
        expectedToolsCalled: [],
        expectedToolsNotCalled: [],
        rubric: [],
      },
    ];
    run.sessions = [
      {
        sessionId: "AAAA",
        sourceCaseId: `${benchmarkId}.1`,
        repetition: 1,
        status: "complete",
        error: null,
      },
    ];
    createBenchmarkRun(db.connection, run);

    const response = await app.inject({
      method: "POST",
      url: "/api/operations/benchmark-evaluate",
      payload: { run_id: "R-NORB", judge_model_config_id: "mc-judge" },
    });
    expect(response.statusCode).toBe(422);
    const error = (response.json() as { error: { code?: string; message?: string } }).error;
    expect(error.code).toBe("benchmark_no_rubric");
    expect(error.message).toContain("rubric");
  });

  it("benchmark_delete_run and benchmark_delete_evaluation 404 on unknown ids", async () => {
    const { app } = await makeApp();

    const run = await app.inject({
      method: "POST",
      url: "/api/operations/benchmark-delete-run",
      payload: { run_id: "R-NOPE" },
    });
    expect(run.statusCode).toBe(404);

    const evaluation = await app.inject({
      method: "POST",
      url: "/api/operations/benchmark-delete-evaluation",
      payload: { evaluation_id: "E-NOPE" },
    });
    expect(evaluation.statusCode).toBe(404);
    expect(
      (evaluation.json() as { error: { code?: string } }).error.code,
    ).toBe("benchmark_evaluation_not_found");
  });
});
