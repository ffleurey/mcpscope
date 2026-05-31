import type Database from 'better-sqlite3'
import {
  DOMAIN_MODEL_VERSION,
  compactionStrategyValues,
  contextStateValues,
  displayStateValues,
  exchangeKindValues,
  parentKindValues,
  partTypeValues,
  roundFinishReasonValues,
  roundStatusValues,
  sessionInitStatusValues,
  sessionStatusValues,
  sessionTypeValues,
  tokenConfidenceValues,
  tokenSourceValues,
  turnStatusValues,
} from '../domain/model.js'

const SQLITE_SCHEMA_VERSION = 8

function sqlEnum(values: readonly string[]): string {
  return values.map(value => `'${value}'`).join(', ')
}

export function initializeBackendSchema(connection: Database.Database): void {
  connection.exec(`
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

    CREATE TABLE IF NOT EXISTS lm_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_server_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN (${sqlEnum(sessionStatusValues)})),
      init_status TEXT NOT NULL CHECK (init_status IN (${sqlEnum(sessionInitStatusValues)})),
      session_type TEXT NOT NULL DEFAULT 'primary' CHECK (session_type IN (${sqlEnum(sessionTypeValues)})),
      parent_kind TEXT CHECK (parent_kind IS NULL OR parent_kind IN (${sqlEnum(parentKindValues)})),
      parent_id TEXT,
      model_profile_snapshot_json TEXT NOT NULL,
      mcp_profile_snapshot_json TEXT,
      loaded_context_length INTEGER,
      system_prompt_tokens INTEGER,
      tool_definitions_tokens INTEGER,
      is_context_exhausted INTEGER NOT NULL DEFAULT 0,
      compaction_strategy TEXT NOT NULL DEFAULT 'strip-reasoning' CHECK (compaction_strategy IN (${sqlEnum(compactionStrategyValues)})),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      sequence_number INTEGER NOT NULL,
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
      completed_at INTEGER,
      UNIQUE (session_id, sequence_number)
    );

    CREATE TABLE IF NOT EXISTS rounds (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
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

    CREATE TABLE IF NOT EXISTS parts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
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
      stripped_by_compaction_at_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
      token_count INTEGER,
      token_source TEXT NOT NULL CHECK (token_source IN (${sqlEnum(tokenSourceValues)})),
      token_confidence TEXT NOT NULL CHECK (token_confidence IN (${sqlEnum(tokenConfidenceValues)})),
      token_note TEXT,
      provenance_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS raw_exchanges (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
      round_id TEXT REFERENCES rounds(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN (${sqlEnum(exchangeKindValues)})),
      request_url TEXT NOT NULL,
      request_method TEXT NOT NULL,
      request_headers_json TEXT,
      request_body TEXT,
      response_status INTEGER,
      response_headers_json TEXT,
      response_body TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_turns_session_id ON turns(session_id);
    CREATE INDEX IF NOT EXISTS idx_rounds_turn_id ON rounds(turn_id);
    CREATE INDEX IF NOT EXISTS idx_parts_session_id ON parts(session_id);
    CREATE INDEX IF NOT EXISTS idx_parts_turn_id ON parts(turn_id);
    CREATE INDEX IF NOT EXISTS idx_parts_round_id ON parts(round_id);
    CREATE INDEX IF NOT EXISTS idx_raw_exchanges_session_id ON raw_exchanges(session_id);
    CREATE INDEX IF NOT EXISTS idx_raw_exchanges_round_id ON raw_exchanges(round_id);

    CREATE TABLE IF NOT EXISTS session_creation_defaults (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      default_model_config_id TEXT,
      default_mcp_profile_id TEXT,
      updated_at INTEGER NOT NULL
    );

    INSERT OR IGNORE INTO session_creation_defaults (id, default_model_config_id, default_mcp_profile_id, updated_at)
    VALUES (1, NULL, NULL, 0);

  `)

  const upsertMeta = connection.prepare(`
    INSERT INTO schema_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)

  // Additive column migrations: always attempt, try/catch handles "column already exists".
  // Version-gating is intentionally avoided here — using it caused columns to be skipped
  // on DBs whose schema_meta version was advanced before all columns were applied.
  const migrate = (sql: string) => {
    try { connection.exec(sql) } catch { /* column already exists — safe to ignore */ }
  }
  migrate(`ALTER TABLE sessions ADD COLUMN compaction_strategy TEXT`)
  migrate(`ALTER TABLE turns ADD COLUMN context_tokens_at_turn_end INTEGER`)
  migrate(`ALTER TABLE turns ADD COLUMN context_tokens_after_compaction INTEGER`)
  migrate(`ALTER TABLE turns ADD COLUMN compaction_applied TEXT`)
  migrate(`ALTER TABLE turns ADD COLUMN compaction_tokens_removed INTEGER`)
  migrate(`ALTER TABLE parts ADD COLUMN stripped_by_compaction_at_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL`)
  migrate(`ALTER TABLE sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'primary' CHECK (session_type IN (${sqlEnum(sessionTypeValues)}))`)
  migrate(`ALTER TABLE sessions ADD COLUMN parent_kind TEXT CHECK (parent_kind IS NULL OR parent_kind IN (${sqlEnum(parentKindValues)}))`)
  migrate(`ALTER TABLE sessions ADD COLUMN parent_id TEXT`)
  migrate(`CREATE INDEX IF NOT EXISTS idx_sessions_session_type ON sessions(session_type)`)
  migrate(`CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_kind, parent_id)`)
  // Backfill: NULL compaction_strategy → 'strip-reasoning' (for rows predating this column)
  connection.exec(`UPDATE sessions SET compaction_strategy = 'strip-reasoning' WHERE compaction_strategy IS NULL`)
  // Backfill: NULL session_type → 'primary' (for rows predating this column)
  connection.exec(`UPDATE sessions SET session_type = 'primary' WHERE session_type IS NULL`)

  upsertMeta.run('sqlite_schema_version', String(SQLITE_SCHEMA_VERSION))
  upsertMeta.run('domain_model_version', String(DOMAIN_MODEL_VERSION))
}

export function initializeBackendSupportSchema(connection: Database.Database): void {
  connection.exec(`
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

    CREATE TABLE IF NOT EXISTS lm_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_server_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_creation_defaults (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      default_model_config_id TEXT,
      default_mcp_profile_id TEXT,
      updated_at INTEGER NOT NULL
    );

    INSERT OR IGNORE INTO session_creation_defaults (id, default_model_config_id, default_mcp_profile_id, updated_at)
    VALUES (1, NULL, NULL, 0);

  `)

  const upsertMeta = connection.prepare(`
    INSERT INTO schema_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)

  upsertMeta.run('sqlite_schema_version', String(SQLITE_SCHEMA_VERSION))
  upsertMeta.run('domain_model_version', String(DOMAIN_MODEL_VERSION))
}

export function validateBackendSchema(connection: Database.Database): void {
  const getColumns = (table: string): Set<string> => {
    const rows = connection
      .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
      .all()
    return new Set(rows.map(r => r.name))
  }

  const required: Record<string, string[]> = {
    sessions: [
      'id', 'title', 'status', 'init_status',
      'session_type', 'parent_kind', 'parent_id',
      'model_profile_snapshot_json', 'mcp_profile_snapshot_json',
      'loaded_context_length', 'system_prompt_tokens', 'tool_definitions_tokens',
      'is_context_exhausted', 'compaction_strategy', 'created_at', 'updated_at',
    ],
    turns: [
      'id', 'session_id', 'sequence_number', 'status', 'outcome',
      'prompt_tokens', 'completion_tokens', 'reasoning_tokens', 'total_tokens',
      'context_tokens_at_turn_end', 'context_tokens_after_compaction',
      'compaction_applied', 'compaction_tokens_removed',
      'created_at', 'completed_at',
    ],
    parts: [
      'id', 'session_id', 'turn_id', 'round_id', 'parent_part_id',
      'ordinal', 'part_type', 'role_label',
      'payload_text', 'payload_json', 'payload_mime_type', 'payload_summary',
      'display_state', 'collapsed_by_default',
      'context_state', 'context_note', 'stripped_by_compaction_at_turn_id',
      'token_count', 'token_source', 'token_confidence', 'token_note',
      'provenance_json', 'created_at', 'updated_at',
    ],
  }

  const missing: string[] = []
  for (const [table, columns] of Object.entries(required)) {
    const existing = getColumns(table)
    for (const col of columns) {
      if (!existing.has(col)) missing.push(`${table}.${col}`)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `DB schema validation failed — missing columns:\n  ${missing.join('\n  ')}\n` +
      `This indicates a failed or incomplete migration. ` +
      `Delete the database file and restart, or repair manually.`,
    )
  }
}

export function querySchemaSummary(connection: Database.Database) {
  const rows = connection
    .prepare<[], { name: string }>(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `)
    .all()

  const metaRows = connection
    .prepare<[], { key: string; value: string }>(`
      SELECT key, value
      FROM schema_meta
      ORDER BY key
    `)
    .all()

  return {
    tables: rows.map(row => row.name),
    meta: Object.fromEntries(metaRows.map(row => [row.key, row.value])),
  }
}
