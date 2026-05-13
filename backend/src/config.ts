import path from 'node:path'

export interface BackendConfig {
  host: string
  port: number
  corsOrigin: string | boolean
  dataDir: string
  sqlitePath: string
  maxToolRounds: number
}

const rootDir = process.cwd()
const defaultDataDir = path.join(rootDir, 'backend-data')

export function getBackendConfig(): BackendConfig {
  const host = process.env.BACKEND_HOST ?? '127.0.0.1'
  const port = Number(process.env.BACKEND_PORT ?? '3030')
  const corsOrigin = process.env.BACKEND_CORS_ORIGIN ?? true
  const dataDir = process.env.BACKEND_DATA_DIR ?? defaultDataDir
  const sqlitePath = process.env.BACKEND_SQLITE_PATH ?? path.join(dataDir, 'ai-clientapp.db')
  const maxToolRounds = Number(process.env.BACKEND_MAX_TOOL_ROUNDS ?? '10')

  return {
    host,
    port,
    corsOrigin,
    dataDir,
    sqlitePath,
    maxToolRounds,
  }
}
