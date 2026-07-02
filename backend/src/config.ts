import path from 'node:path'
import { DEFAULT_MAX_TOOL_ROUNDS } from './domain/model.js'

export interface BackendConfig {
  host: string
  port: number
  corsOrigin: string | boolean
  dataDir: string
  sqlitePath: string
  maxToolRounds: number
  staticDir?: string | null
  appVersion?: string
}

const rootDir = process.cwd()
const defaultDataDir = path.join(rootDir, 'backend-data')

/**
 * Parse an integer env var, failing loudly on a non-numeric value instead of
 * silently propagating NaN. Falls back to `fallback` when the var is unset.
 */
function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name}: expected a number, got "${raw}"`)
  }
  return parsed
}

export function getBackendConfig(): BackendConfig {
  const host = process.env.BACKEND_HOST ?? '127.0.0.1'
  const port = parseIntEnv('BACKEND_PORT', 3030)
  const corsOrigin = process.env.BACKEND_CORS_ORIGIN ?? true
  const dataDir = process.env.BACKEND_DATA_DIR ?? defaultDataDir
  const sqlitePath = process.env.BACKEND_SQLITE_PATH ?? path.join(dataDir, 'mcpscope.db')
  // Deployment-wide default for new sessions that don't specify their own
  // max_tool_rounds; the per-session value is the source of truth at execution.
  const maxToolRounds = parseIntEnv('BACKEND_MAX_TOOL_ROUNDS', DEFAULT_MAX_TOOL_ROUNDS)
  const staticDir = process.env.BACKEND_STATIC_DIR ?? null
  const appVersion = process.env.APP_VERSION ?? 'dev'

  return {
    host,
    port,
    corsOrigin,
    dataDir,
    sqlitePath,
    maxToolRounds,
    staticDir,
    appVersion,
  }
}
