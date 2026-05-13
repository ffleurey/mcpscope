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
}

void start()
