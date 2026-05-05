import { openDB, type IDBPDatabase } from 'idb'
import type { ModelProfile, McpServerProfile, ChatSession, ChatMessage } from './types'

const DB_NAME = 'ai-client-app'
const DB_VERSION = 2

let dbPromise: Promise<IDBPDatabase> | null = null

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('modelProfiles', { keyPath: 'id' })
          db.createObjectStore('mcpProfiles', { keyPath: 'id' })
        }
        if (oldVersion < 2) {
          db.createObjectStore('chatSessions', { keyPath: 'id' })
          const msgStore = db.createObjectStore('chatMessages', { keyPath: 'id' })
          msgStore.createIndex('by-session', 'sessionId')
        }
      },
      blocked() {
        // Another tab has the DB open at an older version — reload to clear it
        window.location.reload()
      },
      blocking() {
        // This tab is blocking another tab from upgrading — close our connection
        dbPromise = null
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

// ChatSession CRUD
export async function getAllChatSessions(): Promise<ChatSession[]> {
  const db = await getDb()
  return db.getAll('chatSessions')
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  const db = await getDb()
  await db.put('chatSessions', session)
}

export async function deleteChatSession(id: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['chatSessions', 'chatMessages'], 'readwrite')
  await tx.objectStore('chatSessions').delete(id)
  const index = tx.objectStore('chatMessages').index('by-session')
  let cursor = await index.openCursor(IDBKeyRange.only(id))
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

// ChatMessage CRUD
export async function getMessagesForSession(sessionId: string): Promise<ChatMessage[]> {
  const db = await getDb()
  return db.getAllFromIndex('chatMessages', 'by-session', sessionId)
}

export async function saveChatMessage(msg: ChatMessage): Promise<void> {
  const db = await getDb()
  await db.put('chatMessages', msg)
}

export async function deleteChatMessage(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('chatMessages', id)
}
