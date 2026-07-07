import { getBackendConfig } from './config.js'
import { buildBackendApp } from './app.js'

async function start() {
  const config = getBackendConfig()
  const app = await buildBackendApp(config)

  try {
    await app.listen({
      host: config.host,
      port: config.port,
    })
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }

  // Graceful shutdown: run the app's onClose hooks (DB cleanup) on SIGINT/
  // SIGTERM. WAL + startup recovery make an unclean exit survivable, but a
  // clean close is still preferable.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app
        .close()
        .catch(() => {})
        .finally(() => process.exit(0))
    })
  }
}

start().catch((error: unknown) => {
  // Startup failures (e.g. a malformed config file or a schema-version
  // mismatch) must be loud and readable, not an unhandled rejection dump.
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
