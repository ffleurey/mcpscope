import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildBackendApp } from './app.js'

describe('backend foundation', () => {
  let app: FastifyInstance | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
    fs.rmSync('.tmp-test-data', { recursive: true, force: true })
  })

  it('serves a health endpoint', async () => {
    app = await buildBackendApp({
      host: '127.0.0.1',
      port: 3030,
      corsOrigin: true,
      dataDir: '.tmp-test-data',
      sqlitePath: '.tmp-test-data/test.db',
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'ai-clientapp-backend',
    })
  })
})
