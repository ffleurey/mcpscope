import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { initializeBackendSupportSchema, querySchemaSummary } from './schema.js'
import { initializeNewSchema, validateNewSchema } from './schemaV2.js'

export interface BackendDatabase {
  readonly path: string
  readonly connection: Database.Database
  readonly schema: ReturnType<typeof querySchemaSummary>
}

function removeLegacyCompactionDiagnosticParts(connection: Database.Database): void {
  connection.prepare(`
    DELETE FROM v2_parts
    WHERE part_type = 'diagnostic-note'
      AND step_id IN (
        SELECT id
        FROM v2_steps
        WHERE step_type_key = 'compaction'
      )
  `).run()
}

export function openBackendDatabase(sqlitePath: string): BackendDatabase {
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true })

  const connection = new Database(sqlitePath)
  connection.pragma('journal_mode = WAL')
  connection.pragma('foreign_keys = ON')

  // Normal startup keeps shared config/default tables and runtime tables on
  // separate paths. The active runtime state is initialized only via the v2
  // execution-model schema below.
  initializeBackendSupportSchema(connection)

  // initializeNewSchema creates the canonical v2 execution-model tables and
  // validates that all required v2 columns are present.
  initializeNewSchema(connection)
  validateNewSchema(connection)
  removeLegacyCompactionDiagnosticParts(connection)

  const schema = querySchemaSummary(connection)

  return {
    path: sqlitePath,
    connection,
    schema,
  }
}
