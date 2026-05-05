import { openDB, type IDBPDatabase } from 'idb'
import type { ModelProfile, McpServerProfile } from './types'

const DB_NAME = 'ai-client-app'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase> | null = null

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('modelProfiles')) {
          db.createObjectStore('modelProfiles', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('mcpProfiles')) {
          db.createObjectStore('mcpProfiles', { keyPath: 'id' })
        }
      },
    })
  }
  return dbPromise
}

// ModelProfile CRUD
export async function getAllModelProfiles(): Promise<ModelProfile[]> {
  const db = await getDb()
  return db.getAll('modelProfiles')
}

export async function saveModelProfile(profile: ModelProfile): Promise<void> {
  const db = await getDb()
  await db.put('modelProfiles', profile)
}

export async function deleteModelProfile(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('modelProfiles', id)
}

// McpServerProfile CRUD
export async function getAllMcpProfiles(): Promise<McpServerProfile[]> {
  const db = await getDb()
  return db.getAll('mcpProfiles')
}

export async function saveMcpProfile(profile: McpServerProfile): Promise<void> {
  const db = await getDb()
  await db.put('mcpProfiles', profile)
}

export async function deleteMcpProfile(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('mcpProfiles', id)
}
