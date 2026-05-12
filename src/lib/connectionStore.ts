import { writable } from 'svelte/store'
import type { LmStudioConnection, ModelConfig, McpServerProfile } from './types'
import {
  deleteLmConnection,
  deleteMcpProfile,
  deleteModelConfig,
  listLmConnections,
  listMcpProfiles,
  listModelConfigs,
  upsertLmConnection,
  upsertMcpProfile as upsertBackendMcpProfile,
  upsertModelConfig as upsertBackendModelConfig,
} from './api/backendClient'

export const backendError = writable<string | null>(null)

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

export async function initConnectionStore(): Promise<void> {
  try {
    const [connectionsResponse, modelConfigsResponse, mcpProfilesResponse] = await Promise.all([
      listLmConnections(),
      listModelConfigs(),
      listMcpProfiles(),
    ])
    lmConnections.set(sortByUpdatedAtDesc(connectionsResponse.lmConnections))
    modelConfigs.set(sortByUpdatedAtDesc(modelConfigsResponse.modelConfigs))
    mcpProfiles.set(sortByUpdatedAtDesc(mcpProfilesResponse.mcpProfiles))
  } catch (e) {
    backendError.set(e instanceof Error ? e.message : String(e))
  }
}
