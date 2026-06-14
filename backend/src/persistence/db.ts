import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  initializeBackendSupportSchema,
  querySchemaSummary,
} from "./schema.js";
import { initializeNewSchema, validateNewSchema } from "./schemaV2.js";

export interface BackendDatabase {
  readonly path: string;
  readonly connection: Database.Database;
  readonly schema: ReturnType<typeof querySchemaSummary>;
}

function removeLegacyCompactionDiagnosticParts(
  connection: Database.Database,
): void {
  connection
    .prepare(
      `
    DELETE FROM v2_parts
    WHERE part_type = 'diagnostic-note'
      AND turn_id IN (
        SELECT id
        FROM v2_turns
        WHERE compaction_applied IS NOT NULL
      )
  `,
    )
    .run();
}

export function openBackendDatabase(sqlitePath: string): BackendDatabase {
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });

  const connection = new Database(sqlitePath);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");

  // Normal startup creates schema_meta, snapshot tables (model_profiles,
  // mcp_profiles), and the canonical v2 execution-model tables.
  // Editable configuration (LM connections, model configs, MCP profiles) is
  // loaded from the JSON config file in app.ts, not from SQLite.
  initializeBackendSupportSchema(connection);

  // initializeNewSchema creates the canonical v2 execution-model tables and
  // validates that all required v2 columns are present.
  initializeNewSchema(connection);
  validateNewSchema(connection);
  removeLegacyCompactionDiagnosticParts(connection);

  const schema = querySchemaSummary(connection);

  return {
    path: sqlitePath,
    connection,
    schema,
  };
}
