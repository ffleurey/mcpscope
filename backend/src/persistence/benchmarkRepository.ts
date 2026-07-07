// ─────────────────────────────────────────────────────────────────────────────
// Benchmark CRUD — benchmarks (suite), benchmark_cases (case), benchmark_runs (run).
// Mirrors the runtime CRUD style: inline prepared statements + row<->record mappers.
// ─────────────────────────────────────────────────────────────────────────────

import type { BackendConnection } from "./connection.js";
import type {
  BenchmarkRecord,
  BenchmarkCaseRecord,
  BenchmarkRunRecord,
  BenchmarkRunSession,
  BenchmarkEvaluationRecord,
  BenchmarkEvaluationSession,
  RubricCriterion,
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
  connection: BackendConnection,
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
  connection: BackendConnection,
  id: string,
): BenchmarkRecord | null {
  const row = connection
    .prepare(`SELECT * FROM benchmarks WHERE id = ?`)
    .get(id) as BenchmarkRow | undefined;
  return row ? mapBenchmarkRow(row) : null;
}

export function listBenchmarks(
  connection: BackendConnection,
): BenchmarkRecord[] {
  const rows = connection
    .prepare(`SELECT * FROM benchmarks ORDER BY created_at ASC`)
    .all() as unknown as BenchmarkRow[];
  return rows.map(mapBenchmarkRow);
}

export function updateBenchmark(
  connection: BackendConnection,
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
  connection: BackendConnection,
  id: string,
): void {
  // benchmark_cases cascade via FK ON DELETE CASCADE. benchmark_runs
  // deliberately have NO FK to benchmarks — runs are immutable snapshots that
  // survive deletion of their blueprint (see DATABASE-SCHEMA.md).
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
  rubric_json: string;
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
    rubric: JSON.parse(row.rubric_json) as RubricCriterion[],
    sourceSessionId: row.source_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createBenchmarkCase(
  connection: BackendConnection,
  benchmarkCase: BenchmarkCaseRecord,
): void {
  connection
    .prepare(
      `INSERT INTO benchmark_cases (
         id, benchmark_id, name, prompt, order_index,
         expected_tools_called_json, expected_tools_not_called_json, rubric_json,
         source_session_id, created_at, updated_at
       ) VALUES (
         @id, @benchmarkId, @name, @prompt, @orderIndex,
         @expectedToolsCalled, @expectedToolsNotCalled, @rubric,
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
      rubric: JSON.stringify(benchmarkCase.rubric),
      sourceSessionId: benchmarkCase.sourceSessionId,
      createdAt: benchmarkCase.createdAt,
      updatedAt: benchmarkCase.updatedAt,
    });
}

export function getBenchmarkCase(
  connection: BackendConnection,
  id: string,
): BenchmarkCaseRecord | null {
  const row = connection
    .prepare(`SELECT * FROM benchmark_cases WHERE id = ?`)
    .get(id) as BenchmarkCaseRow | undefined;
  return row ? mapBenchmarkCaseRow(row) : null;
}

export function listBenchmarkCases(
  connection: BackendConnection,
  benchmarkId: string,
): BenchmarkCaseRecord[] {
  const rows = connection
    .prepare(
      `SELECT * FROM benchmark_cases WHERE benchmark_id = ? ORDER BY order_index ASC`,
    )
    .all(benchmarkId) as unknown as BenchmarkCaseRow[];
  return rows.map(mapBenchmarkCaseRow);
}

export function updateBenchmarkCase(
  connection: BackendConnection,
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
           rubric_json = @rubric,
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
      rubric: JSON.stringify(benchmarkCase.rubric),
      updatedAt: benchmarkCase.updatedAt,
    });
}

export function deleteBenchmarkCase(
  connection: BackendConnection,
  id: string,
): void {
  connection.prepare(`DELETE FROM benchmark_cases WHERE id = ?`).run(id);
}

// ── benchmark_runs ────────────────────────────────────────────────────────────

interface BenchmarkRunRow {
  id: string;
  benchmark_id: string;
  benchmark_name: string;
  status: string;
  model_config_id: string;
  mcp_profile_ids_json: string;
  cases_json: string;
  repetitions: number;
  max_tool_rounds: number;
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
    benchmarkName: row.benchmark_name,
    status: row.status as BenchmarkRunRecord["status"],
    modelConfigId: row.model_config_id,
    mcpProfileIds: JSON.parse(row.mcp_profile_ids_json) as string[],
    cases: JSON.parse(row.cases_json) as BenchmarkRunRecord["cases"],
    repetitions: row.repetitions,
    maxToolRounds: row.max_tool_rounds,
    sessions: JSON.parse(row.sessions_json) as BenchmarkRunSession[],
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function createBenchmarkRun(
  connection: BackendConnection,
  run: BenchmarkRunRecord,
): void {
  connection
    .prepare(
      `INSERT INTO benchmark_runs (
         id, benchmark_id, benchmark_name, status, model_config_id, mcp_profile_ids_json,
         cases_json, repetitions, max_tool_rounds, sessions_json, error,
         created_at, updated_at, started_at, completed_at
       ) VALUES (
         @id, @benchmarkId, @benchmarkName, @status, @modelConfigId, @mcpProfileIds,
         @cases, @repetitions, @maxToolRounds, @sessions, @error,
         @createdAt, @updatedAt, @startedAt, @completedAt
       )`,
    )
    .run(serializeRun(run));
}

export function getBenchmarkRun(
  connection: BackendConnection,
  id: string,
): BenchmarkRunRecord | null {
  const row = connection
    .prepare(`SELECT * FROM benchmark_runs WHERE id = ?`)
    .get(id) as BenchmarkRunRow | undefined;
  return row ? mapBenchmarkRunRow(row) : null;
}

export function listBenchmarkRuns(
  connection: BackendConnection,
  benchmarkId: string,
): BenchmarkRunRecord[] {
  const rows = connection
    .prepare(
      `SELECT * FROM benchmark_runs WHERE benchmark_id = ? ORDER BY created_at DESC`,
    )
    .all(benchmarkId) as unknown as BenchmarkRunRow[];
  return rows.map(mapBenchmarkRunRow);
}

export function updateBenchmarkRun(
  connection: BackendConnection,
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

export function deleteBenchmarkRun(
  connection: BackendConnection,
  id: string,
): void {
  connection.prepare(`DELETE FROM benchmark_runs WHERE id = ?`).run(id);
}

function serializeRun(run: BenchmarkRunRecord) {
  return {
    id: run.id,
    benchmarkId: run.benchmarkId,
    benchmarkName: run.benchmarkName,
    status: run.status,
    modelConfigId: run.modelConfigId,
    mcpProfileIds: JSON.stringify(run.mcpProfileIds),
    cases: JSON.stringify(run.cases),
    repetitions: run.repetitions,
    maxToolRounds: run.maxToolRounds,
    sessions: JSON.stringify(run.sessions),
    error: run.error,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

// ── benchmark_evaluations ─────────────────────────────────────────────────────

interface BenchmarkEvaluationRow {
  id: string;
  run_id: string;
  judge_model_config_id: string;
  judge_temperature: number | null;
  status: string;
  sessions_json: string;
  error: string | null;
  created_at: number;
  updated_at: number;
}

function mapBenchmarkEvaluationRow(
  row: BenchmarkEvaluationRow,
): BenchmarkEvaluationRecord {
  return {
    id: row.id,
    runId: row.run_id,
    judgeModelConfigId: row.judge_model_config_id,
    judgeTemperature: row.judge_temperature,
    status: row.status as BenchmarkEvaluationRecord["status"],
    sessions: JSON.parse(row.sessions_json) as BenchmarkEvaluationSession[],
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeEvaluation(evaluation: BenchmarkEvaluationRecord) {
  return {
    id: evaluation.id,
    runId: evaluation.runId,
    judgeModelConfigId: evaluation.judgeModelConfigId,
    judgeTemperature: evaluation.judgeTemperature,
    status: evaluation.status,
    sessions: JSON.stringify(evaluation.sessions),
    error: evaluation.error,
    createdAt: evaluation.createdAt,
    updatedAt: evaluation.updatedAt,
  };
}

export function createBenchmarkEvaluation(
  connection: BackendConnection,
  evaluation: BenchmarkEvaluationRecord,
): void {
  connection
    .prepare(
      `INSERT INTO benchmark_evaluations (
         id, run_id, judge_model_config_id, judge_temperature, status, sessions_json, error,
         created_at, updated_at
       ) VALUES (
         @id, @runId, @judgeModelConfigId, @judgeTemperature, @status, @sessions, @error,
         @createdAt, @updatedAt
       )`,
    )
    .run(serializeEvaluation(evaluation));
}

export function getBenchmarkEvaluation(
  connection: BackendConnection,
  id: string,
): BenchmarkEvaluationRecord | null {
  const row = connection
    .prepare(`SELECT * FROM benchmark_evaluations WHERE id = ?`)
    .get(id) as BenchmarkEvaluationRow | undefined;
  return row ? mapBenchmarkEvaluationRow(row) : null;
}

export function listBenchmarkEvaluationsByRun(
  connection: BackendConnection,
  runId: string,
): BenchmarkEvaluationRecord[] {
  const rows = connection
    .prepare(
      `SELECT * FROM benchmark_evaluations WHERE run_id = ? ORDER BY created_at ASC`,
    )
    .all(runId) as unknown as BenchmarkEvaluationRow[];
  return rows.map(mapBenchmarkEvaluationRow);
}

export function updateBenchmarkEvaluation(
  connection: BackendConnection,
  evaluation: BenchmarkEvaluationRecord,
): void {
  connection
    .prepare(
      `UPDATE benchmark_evaluations
       SET status = @status,
           sessions_json = @sessions,
           error = @error,
           updated_at = @updatedAt
       WHERE id = @id`,
    )
    .run(serializeEvaluation(evaluation));
}

export function deleteBenchmarkEvaluation(
  connection: BackendConnection,
  id: string,
): void {
  connection.prepare(`DELETE FROM benchmark_evaluations WHERE id = ?`).run(id);
}
