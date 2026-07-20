// Central SQLite connection types and helpers for the backend.
//
// We use Node's built-in `node:sqlite` (DatabaseSync) rather than the native
// `better-sqlite3` addon: it ships inside the Node binary (including musl/alpine
// and Electron's bundled Node), so no native compile / electron-rebuild is needed.
//
// The suppression import MUST come before `node:sqlite` — ESM evaluates imported
// modules in source order, so this installs the warning filter before the first
// DatabaseSync use emits the experimental warning.
import './suppressSqliteWarning.js'
import { createRequire } from 'node:module'
// Type-only import: fully erased at runtime, so it creates NO static link to
// node:sqlite (and thus no link-time warning) — it only provides the types.
import type * as NodeSqlite from 'node:sqlite'

// Load node:sqlite via require() rather than a static `import`. A static import
// makes Node *link* node:sqlite during the link phase — before any module body
// runs — and on Node 22 that link emits the experimental warning before our
// suppression above can install. require() defers the load to this module's
// evaluation (after the suppression import has run), so the warning is
// intercepted on every supported Node version. Re-exporting the constructor from
// here also guarantees callers can't obtain DatabaseSync without this ordering.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof NodeSqlite

export { DatabaseSync }

// One shared alias for the connection type so call sites don't depend directly
// on node:sqlite (previously `Database.Database` from better-sqlite3).
export type BackendConnection = NodeSqlite.DatabaseSync

// node:sqlite has no `db.transaction()` wrapper (unlike better-sqlite3), so we
// provide one. It mirrors better-sqlite3's behaviour: returns the callback's
// value, and is savepoint-aware so nested calls on the same connection compose
// correctly (outer = BEGIN/COMMIT/ROLLBACK, inner = SAVEPOINT/RELEASE/ROLLBACK TO).
const transactionDepth = new WeakMap<BackendConnection, number>()

export function runInTransaction<T>(connection: BackendConnection, fn: () => T): T {
  const depth = transactionDepth.get(connection) ?? 0
  const nested = depth > 0
  const savepoint = `mcpscope_sp_${depth}`

  connection.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN')
  transactionDepth.set(connection, depth + 1)
  try {
    const result = fn()
    connection.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT')
    return result
  } catch (error) {
    if (nested) {
      // ROLLBACK TO rewinds but keeps the savepoint, so RELEASE to pop it.
      connection.exec(`ROLLBACK TO ${savepoint}`)
      connection.exec(`RELEASE ${savepoint}`)
    } else {
      connection.exec('ROLLBACK')
    }
    throw error
  } finally {
    transactionDepth.set(connection, depth)
  }
}
