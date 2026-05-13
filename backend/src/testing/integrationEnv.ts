import fs from 'node:fs'
import path from 'node:path'
import { config as loadDotEnv } from 'dotenv'
import { z } from 'zod'

const integrationEnvSchema = z.object({
  lmStudioBaseUrl: z.string().url(),
  lmStudioApiKey: z.string().min(1),
  lmStudioModel: z.string().min(1),
  mcpServerUrl: z.string().url(),
})

export type IntegrationEnv = z.infer<typeof integrationEnvSchema>

let loaded = false

function ensureEnvLoaded(): void {
  if (loaded) return

  const envPath = path.join(process.cwd(), '.env.dev')
  if (fs.existsSync(envPath)) {
    loadDotEnv({ path: envPath })
  }

  loaded = true
}

export function getIntegrationEnv(): IntegrationEnv {
  ensureEnvLoaded()

  return integrationEnvSchema.parse({
    lmStudioBaseUrl: process.env.LMSTUDIO_BASE_URL,
    lmStudioApiKey: process.env.LMSTUDIO_API_KEY,
    lmStudioModel: process.env.LMSTUDIO_MODEL,
    mcpServerUrl: process.env.MCP_SERVER_URL,
  })
}
