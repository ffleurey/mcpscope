import { healthResponseSchema } from 'mcpscope-engine/domain/apiSchemas.js'
import { getDomainModelSummary } from 'mcpscope-engine/domain/model.js'
import type { RouteDeps } from './types.js'

/**
 * Host part of a URL a client on this machine can actually connect to: wildcard
 * binds (0.0.0.0 / ::) are reachable via localhost, IPv6 literals need brackets.
 */
function connectableHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') return 'localhost'
  return host.includes(':') ? `[${host}]` : host
}

export function registerSystemRoutes({ app, config, database }: RouteDeps): void {
  app.get('/api/health', async () => {
    const url = `http://${connectableHost(config.host)}:${config.port}`
    return healthResponseSchema.parse({
      status: 'ok',
      service: 'mcpscope-backend',
      version: config.appVersion ?? 'dev',
      sqlitePath: database.path,
      host: config.host,
      port: config.port,
      url,
      mcpUrl: `${url}/mcp`,
    })
  })

  app.get('/api/runtime', async () => {
    return {
      mode: 'backend-domain-model',
      persistence: 'sqlite',
      streamingTransport: 'http',
      reasoningRetention: 'full',
      mcpSessionLifecycle: 'per-turn',
      maxToolRounds: config.maxToolRounds,
    }
  })

  app.get('/api/domain-model', async () => {
    return {
      ...getDomainModelSummary(),
      schema: database.schema,
    }
  })

  app.get('/api/config-summary', async () => {
    return {
      backend: {
        host: config.host,
        port: config.port,
      },
      storage: {
        sqlitePath: database.path,
        tables: database.schema.tables,
      },
    }
  })
}