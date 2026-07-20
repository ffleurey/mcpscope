import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type BackendConnection } from './connection.js'
import {
  assertSchemaVersion,
  initializeSchema,
  querySchemaSummary,
  validateSchema,
} from './schema.js'

export interface BackendDatabase {
  readonly path: string
  readonly connection: BackendConnection
  readonly schema: ReturnType<typeof querySchemaSummary>
}

export function openBackendDatabase(sqlitePath: string): BackendDatabase {
  // ':memory:' is node:sqlite's in-memory database name, not a file path —
  // creating a directory for it would be wrong (and mkdirSync('.') noisy).
  if (sqlitePath !== ':memory:') {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true })
  }

  const connection = new DatabaseSync(sqlitePath)
  connection.exec('PRAGMA journal_mode = WAL')
  connection.exec('PRAGMA foreign_keys = ON')

  // better-sqlite3 silently ignored object keys that didn't match a named
  // parameter; node:sqlite throws "Unknown named parameter" instead. The
  // codebase relies on the lenient behaviour throughout — it passes whole
  // serialized row objects to statements that bind only a subset of columns
  // (e.g. an UPDATE that doesn't touch the immutable FK columns). Restore it by
  // enabling the flag on every statement this connection prepares.
  const prepare = connection.prepare.bind(connection)
  connection.prepare = ((sql: string) => {
    const statement = prepare(sql)
    statement.setAllowUnknownNamedParameters(true)
    return statement
  }) as typeof connection.prepare

  // Normal startup creates schema_meta, snapshot tables (model_profiles,
  // mcp_profiles), and the runtime tables (sessions/steps/turns/rounds/parts/
  // raw_exchanges/artifacts), then validates that all required columns exist.
  // Editable configuration (LM connections, model configs, MCP profiles) is
  // loaded from the JSON config file in app.ts, not from SQLite.
  assertSchemaVersion(connection, sqlitePath)
  initializeSchema(connection)
  validateSchema(connection)

  const schema = querySchemaSummary(connection)

  return {
    path: sqlitePath,
    connection,
    schema,
  }
}
