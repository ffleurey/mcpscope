// Connection and model config stores.
import { writable } from 'svelte/store'
import type { LmStudioConnection, ModelConfig, McpServerProfile } from './types'
import {
  getAllConnections, saveConnection, deleteConnection as dbDeleteConnection,
  getAllModelConfigs, saveModelConfig, deleteModelConfig as dbDeleteModelConfig,
  getAllMcpProfiles, saveMcpProfile, deleteMcpProfile as dbDeleteMcpProfile,
} from './db'

export const dbError = writable<string | null>(null)

// Connections
export const lmConnections = writable<LmStudioConnection[]>([])

export async function upsertConnection(c: LmStudioConnection): Promise<void> {
  await saveConnection(c)
  lmConnections.update(list => {
    const idx = list.findIndex(x => x.id === c.id)
    return idx >= 0 ? list.map(x => x.id === c.id ? c : x) : [c, ...list]
  })
}

export async function removeConnection(id: string): Promise<void> {
  await dbDeleteConnection(id)
  lmConnections.update(list => list.filter(x => x.id !== id))
}

// Model Configs
export const modelConfigs = writable<ModelConfig[]>([])

export async function upsertModelConfig(c: ModelConfig): Promise<void> {
  await saveModelConfig(c)
  modelConfigs.update(list => {
    const idx = list.findIndex(x => x.id === c.id)
    return idx >= 0 ? list.map(x => x.id === c.id ? c : x) : [c, ...list]
  })
}

export async function removeModelConfig(id: string): Promise<void> {
  await dbDeleteModelConfig(id)
  modelConfigs.update(list => list.filter(x => x.id !== id))
}

// MCP Profiles
export const mcpProfiles = writable<McpServerProfile[]>([])

export async function upsertMcpProfile(p: McpServerProfile): Promise<void> {
  await saveMcpProfile(p)
  mcpProfiles.update(list => {
    const idx = list.findIndex(x => x.id === p.id)
    return idx >= 0 ? list.map(x => x.id === p.id ? p : x) : [p, ...list]
  })
}

export async function removeMcpProfile(id: string): Promise<void> {
  await dbDeleteMcpProfile(id)
  mcpProfiles.update(list => list.filter(x => x.id !== id))
}

export async function initConnectionStore(): Promise<void> {
  try {
    const [conns, configs, mcps] = await Promise.all([
      getAllConnections(),
      getAllModelConfigs(),
      getAllMcpProfiles(),
    ])
    lmConnections.set(conns)
    modelConfigs.set(configs)
    mcpProfiles.set(mcps)
  } catch (e) {
    dbError.set(e instanceof Error ? e.message : String(e))
  }
}
