import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { initializeBackendSchema, querySchemaSummary } from './schema.js'
import { initializeNewSchema, validateNewSchema } from './schemaV2.js'

export interface BackendDatabase {
  readonly path: string
  readonly connection: Database.Database
  readonly schema: ReturnType<typeof querySchemaSummary>
}

export function openBackendDatabase(sqlitePath: string): BackendDatabase {
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true })

  const connection = new Database(sqlitePath)
  connection.pragma('journal_mode = WAL')
  connection.pragma('foreign_keys = ON')

  // initializeBackendSchema creates the config/singleton tables that are still
  // actively used: model_profiles, mcp_profiles, lm_connections, model_configs,
  // mcp_server_profiles, session_creation_defaults, analysis_profiles,
  // analysis_defaults, and schema_meta.  It also creates the legacy v1 session
  // tables (sessions, turns, rounds, parts, raw_exchanges) as empty scaffolding;
  // those tables are NOT the active persistence path — all session execution state
  // is written to the v2 tables initialized by initializeNewSchema below.
  initializeBackendSchema(connection)

  // initializeNewSchema creates the canonical v2 execution-model tables and
  // validates that all required v2 columns are present.
  initializeNewSchema(connection)
  validateNewSchema(connection)

  const schema = querySchemaSummary(connection)

  return {
    path: sqlitePath,
    connection,
    schema,
  }
}
