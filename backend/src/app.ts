import cors from '@fastify/cors'
import Fastify from 'fastify'
import { z } from 'zod'
import type { BackendConfig } from './config.js'
import { openBackendDatabase } from './persistence/db.js'

const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('ai-clientapp-backend'),
  sqlitePath: z.string(),
})

export async function buildBackendApp(config: BackendConfig) {
  const app = Fastify({
    logger: true,
  })

  await app.register(cors, {
    origin: config.corsOrigin,
  })

  const database = openBackendDatabase(config.sqlitePath)
  app.decorate('backendDb', database)

  app.get('/api/health', async () => {
    return healthResponseSchema.parse({
      status: 'ok',
      service: 'ai-clientapp-backend',
      sqlitePath: database.path,
    })
  })

  app.get('/api/runtime', async () => {
    return {
      mode: 'backend-foundation',
      persistence: 'sqlite',
      streamingTransport: 'http',
      reasoningRetention: 'full',
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
      },
    }
  })

  app.addHook('onClose', async () => {
    database.connection.close()
  })

  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    backendDb: ReturnType<typeof openBackendDatabase>
  }
}
