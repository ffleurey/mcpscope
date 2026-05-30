import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { initializeBackendSchema, querySchemaSummary, validateBackendSchema } from './schema.js'
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
  initializeBackendSchema(connection)
  validateBackendSchema(connection)
  initializeNewSchema(connection)
  validateNewSchema(connection)
  const schema = querySchemaSummary(connection)

  return {
    path: sqlitePath,
    connection,
    schema,
  }
}
