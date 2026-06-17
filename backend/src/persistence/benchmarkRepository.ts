// ─────────────────────────────────────────────────────────────────────────────
// Benchmark CRUD — benchmarks (suite), benchmark_cases (case), benchmark_runs (run).
// Mirrors the runtime CRUD style: inline prepared statements + row<->record mappers.
// ─────────────────────────────────────────────────────────────────────────────

import type Database from "better-sqlite3";
import type {
  BenchmarkRecord,
  BenchmarkCaseRecord,
  BenchmarkRunRecord,
  BenchmarkRunSession,
} from "../domain/model.js";

// ── benchmarks ────────────────────────────────────────────────────────────────

interface BenchmarkRow {
  id: string;
  name: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

function mapBenchmarkRow(row: BenchmarkRow): BenchmarkRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createBenchmark(
  connection: Database.Database,
  benchmark: BenchmarkRecord,
): void {
  connection
    .prepare(
      `INSERT INTO benchmarks (id, name, description, created_at, updated_at)
       VALUES (@id, @name, @description, @createdAt, @updatedAt)`,
    )
    .run({
      id: benchmark.id,
      name: benchmark.name,
      description: benchmark.description,
      createdAt: benchmark.createdAt,
      updatedAt: benchmark.updatedAt,
    });
}

export function getBenchmark(
  connection: Database.Database,
  id: string,
): BenchmarkRecord | null {
  const row = connection
    .prepare(`SELECT * FROM benchmarks WHERE id = ?`)
    .get(id) as BenchmarkRow | undefined;
  return row ? mapBenchmarkRow(row) : null;
}

export function listBenchmarks(
  connection: Database.Database,
): BenchmarkRecord[] {
  const rows = connection
    .prepare(`SELECT * FROM benchmarks ORDER BY created_at ASC`)
    .all() as BenchmarkRow[];
  return rows.map(mapBenchmarkRow);
}

export function updateBenchmark(
  connection: Database.Database,
  benchmark: BenchmarkRecord,
): void {
  connection
    .prepare(
      `UPDATE benchmarks
       SET name = @name, description = @description, updated_at = @updatedAt
       WHERE id = @id`,
    )
    .run({
      id: benchmark.id,
      name: benchmark.name,
      description: benchmark.description,
      updatedAt: benchmark.updatedAt,
    });
}

export function deleteBenchmark(
  connection: Database.Database,
  id: string,
): void {
  // benchmark_cases and benchmark_runs cascade via FK ON DELETE CASCADE.
  connection.prepare(`DELETE FROM benchmarks WHERE id = ?`).run(id);
}

// ── benchmark_cases ─────────────────────────────────────────────────────────

interface BenchmarkCaseRow {
  id: string;
  benchmark_id: string;
  name: string | null;
  prompt: string;
  order_index: number;
  expected_tools_called_json: string;
  expected_tools_not_called_json: string;
  source_session_id: string | null;
  created_at: number;
  updated_at: number;
}

function mapBenchmarkCaseRow(row: BenchmarkCaseRow): BenchmarkCaseRecord {
  return {
    id: row.id,
    benchmarkId: row.benchmark_id,
    name: row.name,
    prompt: row.prompt,
    orderIndex: row.order_index,
    expectedToolsCalled: JSON.parse(row.expected_tools_called_json) as string[],
    expectedToolsNotCalled: JSON.parse(
      row.expected_tools_not_called_json,
    ) as string[],
    sourceSessionId: row.source_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createBenchmarkCase(
  connection: Database.Database,
  benchmarkCase: BenchmarkCaseRecord,
): void {
  connection
    .prepare(
      `INSERT INTO benchmark_cases (
         id, benchmark_id, name, prompt, order_index,
         expected_tools_called_json, expected_tools_not_called_json,
         source_session_id, created_at, updated_at
       ) VALUES (
         @id, @benchmarkId, @name, @prompt, @orderIndex,
         @expectedToolsCalled, @expectedToolsNotCalled,
         @sourceSessionId, @createdAt, @updatedAt
       )`,
    )
    .run({
      id: benchmarkCase.id,
      benchmarkId: benchmarkCase.benchmarkId,
      name: benchmarkCase.name,
      prompt: benchmarkCase.prompt,
      orderIndex: benchmarkCase.orderIndex,
      expectedToolsCalled: JSON.stringify(benchmarkCase.expectedToolsCalled),
      expectedToolsNotCalled: JSON.stringify(
        benchmarkCase.expectedToolsNotCalled,
      ),
      sourceSessionId: benchmarkCase.sourceSessionId,
      createdAt: benchmarkCase.createdAt,
      updatedAt: benchmarkCase.updatedAt,
    });
}

export function getBenchmarkCase(
  connection: Database.Database,
  id: string,
): BenchmarkCaseRecord | null {
  const row = connection
    .prepare(`SELECT * FROM benchmark_cases WHERE id = ?`)
    .get(id) as BenchmarkCaseRow | undefined;
  return row ? mapBenchmarkCaseRow(row) : null;
}

export function listBenchmarkCases(
  connection: Database.Database,
  benchmarkId: string,
): BenchmarkCaseRecord[] {
  const rows = connection
    .prepare(
      `SELECT * FROM benchmark_cases WHERE benchmark_id = ? ORDER BY order_index ASC`,
    )
    .all(benchmarkId) as BenchmarkCaseRow[];
  return rows.map(mapBenchmarkCaseRow);
}

export function updateBenchmarkCase(
  connection: Database.Database,
  benchmarkCase: BenchmarkCaseRecord,
): void {
  connection
    .prepare(
      `UPDATE benchmark_cases
       SET name = @name,
           prompt = @prompt,
           order_index = @orderIndex,
           expected_tools_called_json = @expectedToolsCalled,
           expected_tools_not_called_json = @expectedToolsNotCalled,
           updated_at = @updatedAt
       WHERE id = @id`,
    )
    .run({
      id: benchmarkCase.id,
      name: benchmarkCase.name,
      prompt: benchmarkCase.prompt,
      orderIndex: benchmarkCase.orderIndex,
      expectedToolsCalled: JSON.stringify(benchmarkCase.expectedToolsCalled),
      expectedToolsNotCalled: JSON.stringify(
        benchmarkCase.expectedToolsNotCalled,
      ),
      updatedAt: benchmarkCase.updatedAt,
    });
}

export function deleteBenchmarkCase(
  connection: Database.Database,
  id: string,
): void {
  connection.prepare(`DELETE FROM benchmark_cases WHERE id = ?`).run(id);
}

// ── benchmark_runs ────────────────────────────────────────────────────────────

interface BenchmarkRunRow {
  id: string;
  benchmark_id: string;
  status: string;
  model_config_id: string | null;
  mcp_profile_ids_json: string | null;
  case_ids_json: string;
  repetitions: number;
  sessions_json: string;
  error: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

function mapBenchmarkRunRow(row: BenchmarkRunRow): BenchmarkRunRecord {
  return {
    id: row.id,
    benchmarkId: row.benchmark_id,
    status: row.status as BenchmarkRunRecord["status"],
    modelConfigId: row.model_config_id,
    mcpProfileIds: row.mcp_profile_ids_json
      ? (JSON.parse(row.mcp_profile_ids_json) as string[])
      : null,
    caseIds: JSON.parse(row.case_ids_json) as string[],
    repetitions: row.repetitions,
    sessions: JSON.parse(row.sessions_json) as BenchmarkRunSession[],
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function createBenchmarkRun(
  connection: Database.Database,
  run: BenchmarkRunRecord,
): void {
  connection
    .prepare(
      `INSERT INTO benchmark_runs (
         id, benchmark_id, status, model_config_id, mcp_profile_ids_json,
         case_ids_json, repetitions, sessions_json, error,
         created_at, updated_at, started_at, completed_at
       ) VALUES (
         @id, @benchmarkId, @status, @modelConfigId, @mcpProfileIds,
         @caseIds, @repetitions, @sessions, @error,
         @createdAt, @updatedAt, @startedAt, @completedAt
       )`,
    )
    .run(serializeRun(run));
}

export function getBenchmarkRun(
  connection: Database.Database,
  id: string,
): BenchmarkRunRecord | null {
  const row = connection
    .prepare(`SELECT * FROM benchmark_runs WHERE id = ?`)
    .get(id) as BenchmarkRunRow | undefined;
  return row ? mapBenchmarkRunRow(row) : null;
}

export function listBenchmarkRuns(
  connection: Database.Database,
  benchmarkId: string,
): BenchmarkRunRecord[] {
  const rows = connection
    .prepare(
      `SELECT * FROM benchmark_runs WHERE benchmark_id = ? ORDER BY created_at DESC`,
    )
    .all(benchmarkId) as BenchmarkRunRow[];
  return rows.map(mapBenchmarkRunRow);
}

export function updateBenchmarkRun(
  connection: Database.Database,
  run: BenchmarkRunRecord,
): void {
  connection
    .prepare(
      `UPDATE benchmark_runs
       SET status = @status,
           sessions_json = @sessions,
           error = @error,
           updated_at = @updatedAt,
           started_at = @startedAt,
           completed_at = @completedAt
       WHERE id = @id`,
    )
    .run(serializeRun(run));
}

function serializeRun(run: BenchmarkRunRecord) {
  return {
    id: run.id,
    benchmarkId: run.benchmarkId,
    status: run.status,
    modelConfigId: run.modelConfigId,
    mcpProfileIds: run.mcpProfileIds ? JSON.stringify(run.mcpProfileIds) : null,
    caseIds: JSON.stringify(run.caseIds),
    repetitions: run.repetitions,
    sessions: JSON.stringify(run.sessions),
    error: run.error,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}
