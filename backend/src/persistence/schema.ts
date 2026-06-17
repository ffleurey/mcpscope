/**
 * Canonical persistence schema for the session-backed execution model.
 *
 * `initializeSchema` creates everything: the backend support tables
 * (schema_meta, model_profiles, mcp_profiles) and the runtime tables
 * (sessions/steps/turns/rounds/parts/raw_exchanges/artifacts), then records
 * the single schema version in schema_meta.
 *
 * Runtime table roles:
 *   - `sessions`       — sessions with generic params/state JSON, typed container ref
 *   - `steps`          — non-turn steps (workflow, compaction). child_index per-parent.
 *   - `turns`          — LLM turns. id is PK. No steps record for owned turns.
 *   - `rounds`         — Turn-owned rounds (linked to turn_id)
 *   - `parts`          — Turn-owned parts (linked to turn_id)
 *   - `raw_exchanges`  — diagnostics/replay layer (linked to turn_id)
 *   - `artifacts`      — content-oriented first-class persisted objects
 *
 * Editable configuration (LM connections, model configs, MCP profiles) is
 * loaded from the JSON config file in app.ts, not from SQLite. There is no
 * migration code: a fresh/empty database is initialized to the current schema.
 */

import type Database from "better-sqlite3";
import {
  compactionStrategyValues,
  contextStateValues,
  displayStateValues,
  partTypeValues,
  roundFinishReasonValues,
  roundStatusValues,
  sessionInitStatusValues,
  sessionStatusValues,
  tokenConfidenceValues,
  tokenSourceValues,
  turnStatusValues,
  benchmarkRunStatusValues,
  SCHEMA_VERSION,
} from "../domain/model.js";
import { ARTIFACT_TYPE } from "../domain/executionModel.js";

function sqlEnum(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(", ");
}

const artifactTypeValues = Object.values(ARTIFACT_TYPE) as string[];

export function initializeSchema(connection: Database.Database): void {
  connection.exec(`
    -- ─────────────────────────────────────────────────────────────────────
    -- Backend support tables
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- ─────────────────────────────────────────────────────────────────────
    -- Sessions (generic params/state, typed container ref)
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      session_type_key TEXT NOT NULL,
      -- Container ownership: NULL = top-level; non-null = belongs to a container
      parent_container_type_key TEXT,
      parent_container_id TEXT,
      status TEXT NOT NULL CHECK (status IN (${sqlEnum(sessionStatusValues)})),
      init_status TEXT NOT NULL CHECK (init_status IN (${sqlEnum(sessionInitStatusValues)})),
      -- Generic parameter bag: model profile snapshot, MCP profile, etc.
      params_json TEXT NOT NULL DEFAULT '{}',
      -- Generic resumable state: context bookkeeping, etc.
      state_json TEXT NOT NULL DEFAULT '{}',
      -- Analysis workflow state: serialized AnalysisSessionState for session_analysis sessions
      analysis_state_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      -- Consistency: parent_container_type_key and parent_container_id must both be null or both non-null
      CHECK (
        (parent_container_type_key IS NULL) = (parent_container_id IS NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_type_key ON sessions(session_type_key);
    CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_container_type_key, parent_container_id);

    -- ─────────────────────────────────────────────────────────────────────
    -- Steps (non-turn steps: workflow, compaction)
    -- child_index is the position within the parent (session or parent step).
    -- Parent-less steps (parent_step_id IS NULL) are top-level children of the session.
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS steps (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      step_type_key TEXT NOT NULL,
      parent_step_id TEXT REFERENCES steps(id) ON DELETE CASCADE,
      child_index INTEGER NOT NULL,
      status TEXT NOT NULL,
      -- Generic step inputs
      params_json TEXT NOT NULL DEFAULT '{}',
      -- Generic step state (for resumability)
      state_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      UNIQUE (session_id, parent_step_id, child_index)
    );

    CREATE INDEX IF NOT EXISTS idx_steps_session_id ON steps(session_id);
    CREATE INDEX IF NOT EXISTS idx_steps_type_key ON steps(step_type_key);
    CREATE INDEX IF NOT EXISTS idx_steps_parent ON steps(parent_step_id);

    -- ─────────────────────────────────────────────────────────────────────
    -- Turns (LLM turn records — no steps record for owned turns)
    -- id is the canonical turn ID. turn_number is the position within
    -- the parent (owner_step or session for top-level turns).
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      owner_step_id TEXT REFERENCES steps(id) ON DELETE SET NULL,
      turn_number INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN (${sqlEnum(turnStatusValues)})),
      outcome TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      reasoning_tokens INTEGER,
      total_tokens INTEGER,
      context_tokens_at_turn_end INTEGER,
      context_tokens_after_compaction INTEGER,
      compaction_applied TEXT CHECK (compaction_applied IS NULL OR compaction_applied IN (${sqlEnum(compactionStrategyValues)})),
      compaction_tokens_removed INTEGER,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_turns_session_id ON turns(session_id);
    CREATE INDEX IF NOT EXISTS idx_turns_owner_step_id ON turns(owner_step_id);

    -- ─────────────────────────────────────────────────────────────────────
    -- Rounds (Turn-owned, linked to turn_id)
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS rounds (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      round_index INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN (${sqlEnum(roundStatusValues)})),
      finish_reason TEXT CHECK (finish_reason IS NULL OR finish_reason IN (${sqlEnum(roundFinishReasonValues)})),
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      reasoning_tokens INTEGER,
      total_tokens INTEGER,
      request_payload_json TEXT,
      response_trace_json TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      UNIQUE (turn_id, round_index)
    );

    CREATE INDEX IF NOT EXISTS idx_rounds_turn_id ON rounds(turn_id);
    CREATE INDEX IF NOT EXISTS idx_rounds_session_id ON rounds(session_id);

    -- ─────────────────────────────────────────────────────────────────────
    -- Parts (Turn-owned, linked to turn_id)
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS parts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      -- NULL for setup parts (not linked to any turn)
      turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
      round_id TEXT REFERENCES rounds(id) ON DELETE CASCADE,
      parent_part_id TEXT REFERENCES parts(id) ON DELETE SET NULL,
      ordinal INTEGER NOT NULL,
      part_type TEXT NOT NULL CHECK (part_type IN (${sqlEnum(partTypeValues)})),
      role_label TEXT,
      payload_text TEXT,
      payload_json TEXT,
      payload_mime_type TEXT,
      payload_summary TEXT,
      display_state TEXT NOT NULL CHECK (display_state IN (${sqlEnum(displayStateValues)})),
      collapsed_by_default INTEGER NOT NULL DEFAULT 0,
      context_state TEXT NOT NULL CHECK (context_state IN (${sqlEnum(contextStateValues)})),
      context_note TEXT,
      stripped_by_compaction_at_step_id TEXT REFERENCES steps(id) ON DELETE SET NULL,
      token_count INTEGER,
      token_source TEXT NOT NULL CHECK (token_source IN (${sqlEnum(tokenSourceValues)})),
      token_confidence TEXT NOT NULL CHECK (token_confidence IN (${sqlEnum(tokenConfidenceValues)})),
      token_note TEXT,
      provenance_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_parts_session_id ON parts(session_id);
    CREATE INDEX IF NOT EXISTS idx_parts_turn_id ON parts(turn_id);
    CREATE INDEX IF NOT EXISTS idx_parts_round_id ON parts(round_id);

    -- ─────────────────────────────────────────────────────────────────────
    -- Raw exchanges (diagnostics/replay layer, linked to turn_id)
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS raw_exchanges (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
      round_id TEXT REFERENCES rounds(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      request_url TEXT NOT NULL,
      request_method TEXT NOT NULL,
      request_headers_json TEXT,
      request_body TEXT,
      response_status INTEGER,
      response_headers_json TEXT,
      response_body TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_raw_exchanges_session_id ON raw_exchanges(session_id);
    CREATE INDEX IF NOT EXISTS idx_raw_exchanges_turn_id ON raw_exchanges(turn_id);
    CREATE INDEX IF NOT EXISTS idx_raw_exchanges_round_id ON raw_exchanges(round_id);

    -- ─────────────────────────────────────────────────────────────────────
    -- Artifacts (content-oriented, first-class persisted objects)
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      step_id TEXT REFERENCES steps(id) ON DELETE CASCADE,
      artifact_type_key TEXT NOT NULL CHECK (artifact_type_key IN (${sqlEnum(artifactTypeValues)})),
      content_text TEXT,
      content_json TEXT,
      content_data TEXT,
      mime_type TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_artifacts_session_id ON artifacts(session_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_step_id ON artifacts(step_id);

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
      prompt TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      expected_tools_called_json TEXT NOT NULL DEFAULT '[]',
      expected_tools_not_called_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_benchmark_cases_benchmark ON benchmark_cases(benchmark_id);

    CREATE TABLE IF NOT EXISTS benchmark_runs (
      id TEXT PRIMARY KEY,
      benchmark_id TEXT NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN (${sqlEnum(benchmarkRunStatusValues)})),
      model_config_id TEXT,
      mcp_profile_ids_json TEXT,
      case_ids_json TEXT NOT NULL DEFAULT '[]',
      repetitions INTEGER NOT NULL,
      sessions_json TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_benchmark_runs_benchmark ON benchmark_runs(benchmark_id);
  `);

  const upsertMeta = connection.prepare(`
    INSERT INTO schema_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  upsertMeta.run("schema_version", String(SCHEMA_VERSION));
}

export function validateSchema(connection: Database.Database): void {
  const getColumns = (table: string): Set<string> => {
    const rows = connection
      .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
      .all();
    return new Set(rows.map((r) => r.name));
  };

  const required: Record<string, string[]> = {
    sessions: [
      "id",
      "title",
      "session_type_key",
      "parent_container_type_key",
      "parent_container_id",
      "status",
      "init_status",
      "params_json",
      "state_json",
      "analysis_state_json",
      "created_at",
      "updated_at",
    ],
    steps: [
      "id",
      "session_id",
      "step_type_key",
      "parent_step_id",
      "child_index",
      "status",
      "params_json",
      "state_json",
      "created_at",
      "completed_at",
    ],
    turns: [
      "id",
      "session_id",
      "owner_step_id",
      "turn_number",
      "status",
      "outcome",
      "prompt_tokens",
      "completion_tokens",
      "reasoning_tokens",
      "total_tokens",
      "context_tokens_at_turn_end",
      "context_tokens_after_compaction",
      "compaction_applied",
      "compaction_tokens_removed",
      "created_at",
      "completed_at",
    ],
    rounds: [
      "id",
      "turn_id",
      "session_id",
      "round_index",
      "status",
      "finish_reason",
      "prompt_tokens",
      "completion_tokens",
      "reasoning_tokens",
      "total_tokens",
      "request_payload_json",
      "response_trace_json",
      "started_at",
      "completed_at",
    ],
    parts: [
      "id",
      "session_id",
      "turn_id",
      "round_id",
      "parent_part_id",
      "ordinal",
      "part_type",
      "role_label",
      "payload_text",
      "payload_json",
      "payload_mime_type",
      "payload_summary",
      "display_state",
      "collapsed_by_default",
      "context_state",
      "context_note",
      "stripped_by_compaction_at_step_id",
      "token_count",
      "token_source",
      "token_confidence",
      "token_note",
      "provenance_json",
      "created_at",
      "updated_at",
    ],
    raw_exchanges: [
      "id",
      "session_id",
      "turn_id",
      "round_id",
      "kind",
      "request_url",
      "request_method",
      "request_headers_json",
      "request_body",
      "response_status",
      "response_headers_json",
      "response_body",
      "created_at",
    ],
    artifacts: [
      "id",
      "session_id",
      "step_id",
      "artifact_type_key",
      "content_text",
      "content_json",
      "content_data",
      "mime_type",
      "metadata_json",
      "created_at",
    ],
    benchmarks: ["id", "name", "description", "created_at", "updated_at"],
    benchmark_cases: [
      "id",
      "benchmark_id",
      "prompt",
      "order_index",
      "expected_tools_called_json",
      "expected_tools_not_called_json",
      "created_at",
      "updated_at",
    ],
    benchmark_runs: [
      "id",
      "benchmark_id",
      "status",
      "model_config_id",
      "mcp_profile_ids_json",
      "case_ids_json",
      "repetitions",
      "sessions_json",
      "error",
      "created_at",
      "updated_at",
      "started_at",
      "completed_at",
    ],
  };

  const missing: string[] = [];
  for (const [table, columns] of Object.entries(required)) {
    const existing = getColumns(table);
    for (const col of columns) {
      if (!existing.has(col)) missing.push(`${table}.${col}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Schema validation failed — missing columns:\n  ${missing.join("\n  ")}\n` +
        `This indicates a failed or incomplete schema initialization.`,
    );
  }
}

export function querySchemaSummary(connection: Database.Database) {
  const rows = connection
    .prepare<[], { name: string }>(
      `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `,
    )
    .all();

  const metaRows = connection
    .prepare<[], { key: string; value: string }>(
      `
      SELECT key, value
      FROM schema_meta
      ORDER BY key
    `,
    )
    .all();

  return {
    tables: rows.map((row) => row.name),
    meta: Object.fromEntries(metaRows.map((row) => [row.key, row.value])),
  };
}
