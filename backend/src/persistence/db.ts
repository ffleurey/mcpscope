import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  initializeSchema,
  querySchemaSummary,
  validateSchema,
} from "./schema.js";

export interface BackendDatabase {
  readonly path: string;
  readonly connection: Database.Database;
  readonly schema: ReturnType<typeof querySchemaSummary>;
}

export function openBackendDatabase(sqlitePath: string): BackendDatabase {
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });

  const connection = new Database(sqlitePath);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");

  // Normal startup creates schema_meta, snapshot tables (model_profiles,
  // mcp_profiles), and the runtime tables (sessions/steps/turns/rounds/parts/
  // raw_exchanges/artifacts), then validates that all required columns exist.
  // Editable configuration (LM connections, model configs, MCP profiles) is
  // loaded from the JSON config file in app.ts, not from SQLite.
  initializeSchema(connection);
  validateSchema(connection);

  const schema = querySchemaSummary(connection);

  return {
    path: sqlitePath,
    connection,
    schema,
  };
}
