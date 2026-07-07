import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openBackendDatabase } from './db.js'

describe('schema version guard', () => {
  const cleanupDirs = new Set<string>()

  function makeSqlitePath() {
    const dir = path.join('.tmp-test-data', `schema-version-test-${crypto.randomUUID()}`)
    cleanupDirs.add(dir)
    return path.join(dir, 'test.db')
  }

  afterEach(() => {
    cleanupDirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }))
    cleanupDirs.clear()
  })

  it('reopens a same-version database without complaint', () => {
    const sqlitePath = makeSqlitePath()
    openBackendDatabase(sqlitePath).connection.close()
    const reopened = openBackendDatabase(sqlitePath)
    expect(reopened.schema).toBeTruthy()
    reopened.connection.close()
  })

  it('fails loudly on a database stamped with a different schema version', () => {
    const sqlitePath = makeSqlitePath()
    const db = openBackendDatabase(sqlitePath)
    db.connection
      .prepare("UPDATE schema_meta SET value = '5' WHERE key = 'schema_version'")
      .run()
    db.connection.close()
    expect(() => openBackendDatabase(sqlitePath)).toThrow(/schema version mismatch/i)
  })
})
