import { writable } from 'svelte/store'
import type { ModelProfile, McpServerProfile, NavView } from './types'
import {
  getAllModelProfiles,
  saveModelProfile,
  deleteModelProfile,
  getAllMcpProfiles,
  saveMcpProfile,
  deleteMcpProfile,
} from './db'

export const currentView = writable<NavView>('model-profiles')

export const modelProfiles = writable<ModelProfile[]>([])
export const mcpProfiles = writable<McpServerProfile[]>([])
export const dbError = writable<string | null>(null)

export async function initStores(): Promise<void> {
  try {
    const [models, mcps] = await Promise.all([getAllModelProfiles(), getAllMcpProfiles()])
    modelProfiles.set(models)
    mcpProfiles.set(mcps)
  } catch (e) {
    dbError.set(e instanceof Error ? e.message : String(e))
  }
}

export async function upsertModelProfile(profile: ModelProfile): Promise<void> {
  await saveModelProfile(profile)
  modelProfiles.update(list => {
    const idx = list.findIndex(p => p.id === profile.id)
    if (idx >= 0) {
      list[idx] = profile
      return [...list]
    }
    return [...list, profile]
  })
}

export async function removeModelProfile(id: string): Promise<void> {
  await deleteModelProfile(id)
  modelProfiles.update(list => list.filter(p => p.id !== id))
}

export async function upsertMcpProfile(profile: McpServerProfile): Promise<void> {
  await saveMcpProfile(profile)
  mcpProfiles.update(list => {
    const idx = list.findIndex(p => p.id === profile.id)
    if (idx >= 0) {
      list[idx] = profile
      return [...list]
    }
    return [...list, profile]
  })
}

export async function removeMcpProfile(id: string): Promise<void> {
  await deleteMcpProfile(id)
  mcpProfiles.update(list => list.filter(p => p.id !== id))
}
