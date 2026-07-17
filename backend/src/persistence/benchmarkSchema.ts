/**
 * Benchmark schema extension — the workbench-owned DDL for the benchmark
 * suite/case/run/evaluation tables, registered into the engine's schema-
 * extension registry (see `registerSchemaExtension` in `schema.ts`).
 *
 * `registerBenchmarkSchema()` must run BEFORE `openBackendDatabase`, which
 * applies the DDL and validates the schema on open. `buildBackendApp` calls it
 * right before opening the database; tests that open a database directly and
 * touch benchmark tables must call it in their setup (mirroring
 * `registerBenchmarkInspectResolver()` in `benchmarkOperations.ts`).
 */

import type { BackendConnection } from "mcpscope-engine/persistence/connection.js";
import { registerSchemaExtension, sqlEnum } from "mcpscope-engine/persistence/schema.js";
import { benchmarkRunStatusValues } from "mcpscope-engine/domain/model.js";

function applyBenchmarkDdl(connection: BackendConnection): void {
  connection.exec(`
    -- ─────────────────────────────────────────────────────────────────────
    -- Benchmarks (static test suite), cases, and runs
    -- A run produces normal primary sessions with parent_container_type_key
    -- = 'benchmark' and parent_container_id = the run id.
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS benchmarks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS benchmark_cases (
      id TEXT PRIMARY KEY,
      benchmark_id TEXT NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
      name TEXT,
      prompt TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      expected_tools_called_json TEXT NOT NULL DEFAULT '[]',
      expected_tools_not_called_json TEXT NOT NULL DEFAULT '[]',
      rubric_json TEXT NOT NULL DEFAULT '[]',
      source_session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_benchmark_cases_benchmark ON benchmark_cases(benchmark_id);

    -- A run is independent of its source benchmark (no cascade): a benchmark is an
    -- editable blueprint, a run is an immutable snapshot spawned from it.
    CREATE TABLE IF NOT EXISTS benchmark_runs (
      id TEXT PRIMARY KEY,
      benchmark_id TEXT NOT NULL,
      benchmark_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN (${sqlEnum(benchmarkRunStatusValues)})),
      model_config_id TEXT NOT NULL,
      mcp_profile_ids_json TEXT NOT NULL DEFAULT '[]',
      cases_json TEXT NOT NULL DEFAULT '[]',
      repetitions INTEGER NOT NULL,
      max_tool_rounds INTEGER NOT NULL DEFAULT 20, -- see DEFAULT_MAX_TOOL_ROUNDS; inserts always set it explicitly
      sessions_json TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_benchmark_runs_benchmark ON benchmark_runs(benchmark_id);

    -- A run carries 0..N evaluations (judging passes). Thin grouping/index over the
    -- reused session_analysis children; verdicts live in analysis artifacts.
    CREATE TABLE IF NOT EXISTS benchmark_evaluations (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
      judge_model_config_id TEXT NOT NULL,
      judge_temperature REAL, -- nullable: NULL => send no temperature (provider default). Otherwise see DEFAULT_JUDGE_TEMPERATURE.
      status TEXT NOT NULL CHECK (status IN (${sqlEnum(benchmarkRunStatusValues)})),
      sessions_json TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_benchmark_evaluations_run ON benchmark_evaluations(run_id);
  `);
}

const benchmarkRequiredColumns: Record<string, readonly string[]> = {
  benchmarks: ["id", "name", "description", "created_at", "updated_at"],
  benchmark_cases: [
    "id",
    "benchmark_id",
    "name",
    "prompt",
    "order_index",
    "expected_tools_called_json",
    "expected_tools_not_called_json",
    "rubric_json",
    "source_session_id",
    "created_at",
    "updated_at",
  ],
  benchmark_runs: [
    "id",
    "benchmark_id",
    "benchmark_name",
    "status",
    "model_config_id",
    "mcp_profile_ids_json",
    "cases_json",
    "repetitions",
    "max_tool_rounds",
    "sessions_json",
    "error",
    "created_at",
    "updated_at",
    "started_at",
    "completed_at",
  ],
  benchmark_evaluations: [
    "id",
    "run_id",
    "judge_model_config_id",
    "judge_temperature",
    "status",
    "sessions_json",
    "error",
    "created_at",
    "updated_at",
  ],
};

/** Register the benchmark tables in the engine's schema-extension registry (idempotent). */
export function registerBenchmarkSchema(): void {
  registerSchemaExtension("benchmark", {
    apply: applyBenchmarkDdl,
    requiredColumns: benchmarkRequiredColumns,
  });
}
