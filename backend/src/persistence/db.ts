import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

export interface BackendDatabase {
  readonly path: string
  readonly connection: Database.Database
}

export function openBackendDatabase(sqlitePath: string): BackendDatabase {
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true })

  const connection = new Database(sqlitePath)
  connection.pragma('journal_mode = WAL')
  connection.pragma('foreign_keys = ON')

  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  return {
    path: sqlitePath,
    connection,
  }
}
