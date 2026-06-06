import { get, writable } from 'svelte/store'
import type { LmStudioConnection, ModelConfig, McpServerProfile, SessionCreationDefaults } from './types'
import {
  deleteLmConnection,
  deleteMcpProfile,
  deleteModelConfig,
  fetchHealth,
  getSessionCreationDefaults,
  listLmConnections,
  listMcpProfiles,
  listModelConfigs,
  putSessionCreationDefaults,
  upsertLmConnection,
  upsertMcpProfile as upsertBackendMcpProfile,
  upsertModelConfig as upsertBackendModelConfig,
} from './api/backendClient'

export const backendError = writable<string | null>(null)
export const appVersion = writable<string>('dev')

function sortByUpdatedAtDesc<T extends { updatedAt: number }>(records: T[]): T[] {
  return [...records].sort((left, right) => right.updatedAt - left.updatedAt)
}

// Connections
export const lmConnections = writable<LmStudioConnection[]>([])

export async function upsertConnection(c: LmStudioConnection): Promise<void> {
  const { lmConnection } = await upsertLmConnection(c)
  lmConnections.update(list => {
    const next = list.filter(x => x.id !== lmConnection.id)
    return sortByUpdatedAtDesc([lmConnection, ...next])
  })
}

export async function removeConnection(id: string): Promise<void> {
  await deleteLmConnection(id)
  lmConnections.update(list => list.filter(x => x.id !== id))
}

// Model Configs
export const modelConfigs = writable<ModelConfig[]>([])

export async function upsertModelConfig(c: ModelConfig): Promise<void> {
  const { modelConfig } = await upsertBackendModelConfig(c)
  modelConfigs.update(list => {
    const next = list.filter(x => x.id !== modelConfig.id)
    return sortByUpdatedAtDesc([modelConfig, ...next])
  })
}

export async function removeModelConfig(id: string): Promise<void> {
  await deleteModelConfig(id)
  modelConfigs.update(list => list.filter(x => x.id !== id))
}

// MCP Profiles
export const mcpProfiles = writable<McpServerProfile[]>([])

export async function upsertMcpProfile(p: McpServerProfile): Promise<void> {
  const { mcpProfile } = await upsertBackendMcpProfile({
    ...p,
    authType: p.authType ?? null,
    authValue: p.authValue ?? null,
  })
  mcpProfiles.update(list => {
    const next = list.filter(x => x.id !== mcpProfile.id)
    return sortByUpdatedAtDesc([mcpProfile, ...next])
  })
}

export async function removeMcpProfile(id: string): Promise<void> {
  await deleteMcpProfile(id)
  mcpProfiles.update(list => list.filter(x => x.id !== id))
}

// Session creation defaults
export const sessionCreationDefaults = writable<SessionCreationDefaults | null>(null)

export async function fetchSessionCreationDefaults(): Promise<void> {
  const { sessionCreationDefaults: defaults } = await getSessionCreationDefaults()
  sessionCreationDefaults.set(defaults)
}

export async function updateSessionCreationDefaults(input: {
  defaultModelConfigId: string | null
}): Promise<void> {
  const { sessionCreationDefaults: updated } = await putSessionCreationDefaults(input)
  sessionCreationDefaults.set(updated)
}

export async function setDefaultModelConfig(defaultModelConfigId: string | null): Promise<void> {
  await updateSessionCreationDefaults({
    defaultModelConfigId,
  })
}

export async function setDefaultMcpProfile(_defaultMcpProfileId: string | null): Promise<void> {
  // Default MCP selection is now per-profile (defaultEnabled field)
}

function getStoreDefaults(): SessionCreationDefaults {
  return get(sessionCreationDefaults) ?? {
    defaultModelConfigId: null,
    updatedAt: 0,
  }
}

export async function initConnectionStore(): Promise<void> {
  try {
    const [health, connectionsResponse, modelConfigsResponse, mcpProfilesResponse] = await Promise.all([
      fetchHealth(),
      listLmConnections(),
      listModelConfigs(),
      listMcpProfiles(),
    ])
    appVersion.set(health.version)
    lmConnections.set(sortByUpdatedAtDesc(connectionsResponse.lmConnections))
    modelConfigs.set(sortByUpdatedAtDesc(modelConfigsResponse.modelConfigs))
    mcpProfiles.set(sortByUpdatedAtDesc(mcpProfilesResponse.mcpProfiles))
  } catch (e) {
    backendError.set(e instanceof Error ? e.message : String(e))
    return
  }

  // Fetch defaults separately so a failure here doesn't break the main store init
  try {
    const defaultsResponse = await getSessionCreationDefaults()
    sessionCreationDefaults.set(defaultsResponse.sessionCreationDefaults)
  } catch {
    // Defaults endpoint may not be available yet (e.g. backend not restarted after upgrade)
    sessionCreationDefaults.set(null)
  }

}
