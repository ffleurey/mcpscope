/**
 * Canonical runtime schema for the current session-backed execution model.
 *
 * The `v2_` table names remain because they are the landed runtime storage
 * names for this branch. Normal startup initializes this runtime path plus the
 * shared config/default tables in schema.ts.
 *
 * Key design decisions:
 *   - `v2_sessions`         — sessions with generic params/state JSON, typed container ref
 *   - `v2_steps`            — non-turn steps (workflow, compaction). child_index per-parent.
 *   - `v2_turns`            — LLM turns. id is PK. No v2_steps record for owned turns.
 *   - `v2_rounds`           — Turn-owned rounds (linked to turn_id)
 *   - `v2_parts`            — Turn-owned parts (linked to turn_id)
 *   - `v2_raw_exchanges`    — diagnostics/replay layer (linked to turn_id)
 *   - `artifacts`           — content-oriented first-class persisted objects
 *
 * No backward migration is required for the current implementation increment.
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
} from "../domain/model.js";
import { ARTIFACT_TYPE } from "../domain/executionModel.js";

const NEW_SCHEMA_VERSION = 3;

function sqlEnum(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(", ");
}

const artifactTypeValues = Object.values(ARTIFACT_TYPE) as string[];

export function initializeNewSchema(connection: Database.Database): void {
  connection.exec(`
    -- ─────────────────────────────────────────────────────────────────────
    -- Sessions (generic params/state, typed container ref)
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS v2_sessions (
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

    CREATE INDEX IF NOT EXISTS idx_v2_sessions_type_key ON v2_sessions(session_type_key);
    CREATE INDEX IF NOT EXISTS idx_v2_sessions_parent ON v2_sessions(parent_container_type_key, parent_container_id);

    -- ─────────────────────────────────────────────────────────────────────
    -- Steps (non-turn steps: workflow, compaction)
    -- child_index is the position within the parent (session or parent step).
    -- Parent-less steps (parent_step_id IS NULL) are top-level children of the session.
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS v2_steps (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES v2_sessions(id) ON DELETE CASCADE,
      step_type_key TEXT NOT NULL,
      parent_step_id TEXT REFERENCES v2_steps(id) ON DELETE CASCADE,
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

    CREATE INDEX IF NOT EXISTS idx_v2_steps_session_id ON v2_steps(session_id);
    CREATE INDEX IF NOT EXISTS idx_v2_steps_type_key ON v2_steps(step_type_key);
    CREATE INDEX IF NOT EXISTS idx_v2_steps_parent ON v2_steps(parent_step_id);

    -- ─────────────────────────────────────────────────────────────────────
    -- Turns (LLM turn records — no v2_steps record for owned turns)
    -- id is the canonical turn ID. turn_number is the position within
    -- the parent (owner_step or session for top-level turns).
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS v2_turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES v2_sessions(id) ON DELETE CASCADE,
      owner_step_id TEXT REFERENCES v2_steps(id) ON DELETE SET NULL,
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

    CREATE INDEX IF NOT EXISTS idx_v2_turns_session_id ON v2_turns(session_id);
    CREATE INDEX IF NOT EXISTS idx_v2_turns_owner_step_id ON v2_turns(owner_step_id);

    -- ─────────────────────────────────────────────────────────────────────
    -- Rounds (Turn-owned, linked to turn_id)
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS v2_rounds (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL REFERENCES v2_turns(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES v2_sessions(id) ON DELETE CASCADE,
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

    CREATE INDEX IF NOT EXISTS idx_v2_rounds_turn_id ON v2_rounds(turn_id);
    CREATE INDEX IF NOT EXISTS idx_v2_rounds_session_id ON v2_rounds(session_id);

    -- ─────────────────────────────────────────────────────────────────────
    -- Parts (Turn-owned, linked to turn_id)
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS v2_parts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES v2_sessions(id) ON DELETE CASCADE,
      -- NULL for setup parts (not linked to any turn)
      turn_id TEXT REFERENCES v2_turns(id) ON DELETE CASCADE,
      round_id TEXT REFERENCES v2_rounds(id) ON DELETE CASCADE,
      parent_part_id TEXT REFERENCES v2_parts(id) ON DELETE SET NULL,
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
      stripped_by_compaction_at_step_id TEXT REFERENCES v2_steps(id) ON DELETE SET NULL,
      token_count INTEGER,
      token_source TEXT NOT NULL CHECK (token_source IN (${sqlEnum(tokenSourceValues)})),
      token_confidence TEXT NOT NULL CHECK (token_confidence IN (${sqlEnum(tokenConfidenceValues)})),
      token_note TEXT,
      provenance_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_v2_parts_session_id ON v2_parts(session_id);
    CREATE INDEX IF NOT EXISTS idx_v2_parts_turn_id ON v2_parts(turn_id);
    CREATE INDEX IF NOT EXISTS idx_v2_parts_round_id ON v2_parts(round_id);

    -- ─────────────────────────────────────────────────────────────────────
    -- Raw exchanges (diagnostics/replay layer, linked to turn_id)
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS v2_raw_exchanges (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES v2_sessions(id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES v2_turns(id) ON DELETE CASCADE,
      round_id TEXT REFERENCES v2_rounds(id) ON DELETE CASCADE,
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

    CREATE INDEX IF NOT EXISTS idx_v2_raw_exchanges_session_id ON v2_raw_exchanges(session_id);
    CREATE INDEX IF NOT EXISTS idx_v2_raw_exchanges_turn_id ON v2_raw_exchanges(turn_id);
    CREATE INDEX IF NOT EXISTS idx_v2_raw_exchanges_round_id ON v2_raw_exchanges(round_id);

    -- ─────────────────────────────────────────────────────────────────────
    -- Artifacts (content-oriented, first-class persisted objects)
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES v2_sessions(id) ON DELETE CASCADE,
      step_id TEXT REFERENCES v2_steps(id) ON DELETE CASCADE,
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
  `);

  // V2 → V3: remove CHECK constraint from v2_raw_exchanges.kind that was
  // too restrictive when exchange kinds grew from lmstudio-* to llm-*.
  // Only migrate if the old CHECK constraint still exists.
  try {
    const def = connection
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='v2_raw_exchanges'`,
      )
      .get() as { sql: string } | undefined;
    if (def && def.sql.includes("CHECK")) {
      connection.exec(`
        ALTER TABLE v2_raw_exchanges RENAME TO v2_raw_exchanges_old;
        CREATE TABLE v2_raw_exchanges (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES v2_sessions(id) ON DELETE CASCADE,
          turn_id TEXT REFERENCES v2_turns(id) ON DELETE CASCADE,
          round_id TEXT REFERENCES v2_rounds(id) ON DELETE CASCADE,
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
        INSERT INTO v2_raw_exchanges SELECT * FROM v2_raw_exchanges_old;
        DROP TABLE v2_raw_exchanges_old;
      `);
    }
  } catch {
    // Migration not needed or already applied
  }

  const upsertMeta = connection.prepare(`
    INSERT INTO schema_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  upsertMeta.run("new_schema_version", String(NEW_SCHEMA_VERSION));
}

export function validateNewSchema(connection: Database.Database): void {
  const getColumns = (table: string): Set<string> => {
    const rows = connection
      .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
      .all();
    return new Set(rows.map((r) => r.name));
  };

  const required: Record<string, string[]> = {
    v2_sessions: [
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
    v2_steps: [
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
    v2_turns: [
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
    v2_rounds: [
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
    v2_parts: [
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
    v2_raw_exchanges: [
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
      `New schema validation failed — missing columns:\n  ${missing.join("\n  ")}\n` +
        `This indicates a failed or incomplete new-schema initialization.`,
    );
  }
}
