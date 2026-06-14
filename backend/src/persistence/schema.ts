import type Database from "better-sqlite3";
import {
  DOMAIN_MODEL_VERSION,
  parentKindValues,
  sessionTypeValues,
} from "../domain/model.js";

const SQLITE_SCHEMA_VERSION = 8;

function sqlEnum(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
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

  `);

  const upsertMeta = connection.prepare(`
    INSERT INTO schema_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  // Additive column migrations: always attempt, try/catch handles "column already exists".
  // Version-gating is intentionally avoided here — using it caused columns to be skipped
  // on DBs whose schema_meta version was advanced before all columns were applied.
  const migrate = (sql: string) => {
    try {
      connection.exec(sql);
    } catch {
      /* column already exists — safe to ignore */
    }
  };
  migrate(`ALTER TABLE sessions ADD COLUMN compaction_strategy TEXT`);
  migrate(
    `ALTER TABLE sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'primary' CHECK (session_type IN (${sqlEnum(sessionTypeValues)}))`,
  );
  migrate(
    `ALTER TABLE sessions ADD COLUMN parent_kind TEXT CHECK (parent_kind IS NULL OR parent_kind IN (${sqlEnum(parentKindValues)}))`,
  );
  migrate(`ALTER TABLE sessions ADD COLUMN parent_id TEXT`);
  migrate(
    `CREATE INDEX IF NOT EXISTS idx_sessions_session_type ON sessions(session_type)`,
  );
  migrate(
    `CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_kind, parent_id)`,
  );
  // Backfill: NULL compaction_strategy → 'strip-reasoning' (for rows predating this column)
  connection.exec(
    `UPDATE sessions SET compaction_strategy = 'strip-reasoning' WHERE compaction_strategy IS NULL`,
  );
  // Backfill: NULL session_type → 'primary' (for rows predating this column)
  connection.exec(
    `UPDATE sessions SET session_type = 'primary' WHERE session_type IS NULL`,
  );

  upsertMeta.run("sqlite_schema_version", String(SQLITE_SCHEMA_VERSION));
  upsertMeta.run("domain_model_version", String(DOMAIN_MODEL_VERSION));
}

export function initializeBackendSupportSchema(
  connection: Database.Database,
): void {
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

  `);

  const upsertMeta = connection.prepare(`
    INSERT INTO schema_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  upsertMeta.run("sqlite_schema_version", String(SQLITE_SCHEMA_VERSION));
  upsertMeta.run("domain_model_version", String(DOMAIN_MODEL_VERSION));
}

export function validateBackendSchema(connection: Database.Database): void {
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
      "status",
      "init_status",
      "session_type",
      "parent_kind",
      "parent_id",
      "model_profile_snapshot_json",
      "mcp_profile_snapshot_json",
      "loaded_context_length",
      "system_prompt_tokens",
      "tool_definitions_tokens",
      "is_context_exhausted",
      "compaction_strategy",
      "created_at",
      "updated_at",
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
      `DB schema validation failed — missing columns:\n  ${missing.join("\n  ")}\n` +
        `This indicates a failed or incomplete migration. ` +
        `Delete the database file and restart, or repair manually.`,
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
