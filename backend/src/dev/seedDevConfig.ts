import fs from 'node:fs'
import path from 'node:path'
import { config as loadDotEnv } from 'dotenv'
import { z } from 'zod'
import { getBackendConfig } from '../config.js'
import { openBackendDatabase } from '../persistence/db.js'
import {
  listLmConnections,
  listMcpServerProfiles,
  listModelConfigs,
  upsertLmConnection,
  upsertMcpServerProfile,
  upsertModelConfig,
} from '../persistence/repository.js'

const envSchema = z.object({
  lmStudioBaseUrl: z.string().url(),
  lmStudioApiKey: z.string().min(1),
  lmStudioModel: z.string().min(1),
  mcpServerUrl: z.string().url(),
})

const DEV_CONNECTION_ID = 'dev-lmstudio-connection'
const DEV_MODEL_CONFIG_ID = 'dev-lmstudio-model'
const DEV_MCP_PROFILE_ID = 'dev-mcp-profile'

function ensureEnvLoaded(): void {
  const envPath = path.join(process.cwd(), '.env.dev')
  if (fs.existsSync(envPath)) {
    loadDotEnv({ path: envPath })
  }
}

function now(): number {
  return Date.now()
}

function createdAtFor<T extends { id: string; createdAt: number }>(records: T[], id: string, fallback: number): number {
  return records.find((record) => record.id === id)?.createdAt ?? fallback
}

function main(): void {
  ensureEnvLoaded()

  const env = envSchema.parse({
    lmStudioBaseUrl: process.env.LMSTUDIO_BASE_URL,
    lmStudioApiKey: process.env.LMSTUDIO_API_KEY,
    lmStudioModel: process.env.LMSTUDIO_MODEL,
    mcpServerUrl: process.env.MCP_SERVER_URL,
  })

  const config = getBackendConfig()
  const database = openBackendDatabase(config.sqlitePath)
  const timestamp = now()

  try {
    const existingConnections = listLmConnections(database.connection)
    const existingModelConfigs = listModelConfigs(database.connection)
    const existingMcpProfiles = listMcpServerProfiles(database.connection)

    upsertLmConnection(database.connection, {
      id: DEV_CONNECTION_ID,
      name: 'Dev LM Studio',
      baseUrl: env.lmStudioBaseUrl,
      apiKey: env.lmStudioApiKey,
      createdAt: createdAtFor(existingConnections, DEV_CONNECTION_ID, timestamp),
      updatedAt: timestamp,
    })

    upsertModelConfig(database.connection, {
      id: DEV_MODEL_CONFIG_ID,
      name: 'Dev Smoke Model',
      connectionId: DEV_CONNECTION_ID,
      modelKey: env.lmStudioModel,
      modelDisplayName: env.lmStudioModel,
      systemPrompt: '',
      temperature: 0.7,
      reasoning: 'on',
      createdAt: createdAtFor(existingModelConfigs, DEV_MODEL_CONFIG_ID, timestamp),
      updatedAt: timestamp,
    })

    upsertMcpServerProfile(database.connection, {
      id: DEV_MCP_PROFILE_ID,
      name: 'Dev MCP Server',
      url: env.mcpServerUrl,
      transport: 'streamable-http',
      authType: null,
      authValue: null,
      defaultEnabled: true,
      createdAt: createdAtFor(existingMcpProfiles, DEV_MCP_PROFILE_ID, timestamp),
      updatedAt: timestamp,
    })

    console.log(`Seeded backend dev config in ${database.path}`)
    console.log(`- LM Studio connection: Dev LM Studio`)
    console.log(`- Model config: Dev Smoke Model`)
    console.log(`- MCP profile: Dev MCP Server`)
  } finally {
    database.connection.close()
  }
}

main()
