const DEFAULT_BACKEND_URL = 'http://localhost:3066'

export function resolveBackendUrl(flagUrl?: string): string {
  if (flagUrl) return flagUrl.replace(/\/$/, '')
  if (process.env['MCPSCOPE_URL']) return process.env['MCPSCOPE_URL'].replace(/\/$/, '')
  return DEFAULT_BACKEND_URL
}
