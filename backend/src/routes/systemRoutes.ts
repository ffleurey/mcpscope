import { healthResponseSchema } from '../domain/apiSchemas.js'
import { getDomainModelSummary } from '../domain/model.js'
import type { RouteDeps } from './types.js'

export function registerSystemRoutes({ app, config, database }: RouteDeps): void {
  app.get('/api/health', async () => {
    return healthResponseSchema.parse({
      status: 'ok',
      service: 'mcpscope-backend',
      version: config.appVersion ?? 'dev',
      sqlitePath: database.path,
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