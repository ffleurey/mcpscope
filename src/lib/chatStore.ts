// Chat store: active chat sessions, messages, streaming state.
import { writable, get } from 'svelte/store'
import type { ChatSession, ChatMessage, ModelProfile } from './types'
import {
  getAllChatSessions,
  saveChatSession,
  deleteChatSession,
  getMessagesForSession,
  saveChatMessage,
} from './db'
import { streamChatCompletion } from './services/lmstudio'

export const chatSessions = writable<ChatSession[]>([])
export const activeChatId = writable<string | null>(null)
export const activeMessages = writable<ChatMessage[]>([])
export const isStreaming = writable<boolean>(false)

export async function initChatStore(): Promise<void> {
  try {
    const sessions = await getAllChatSessions()
    sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    chatSessions.set(sessions)
  } catch (e) {
    // Non-fatal — app still works, just starts with no chat history
    // eslint-disable-next-line no-console
    console.error('Failed to load chat sessions:', e)
  }
}

export async function createChat(modelProfile: ModelProfile): Promise<void> {
  const now = Date.now()
  const session: ChatSession = {
    id: crypto.randomUUID(),
    title: 'New chat',
    modelProfileId: modelProfile.id,
    modelSnapshot: modelProfile,
    mcpProfileId: null,
    mcpSnapshot: null,
    createdAt: now,
    updatedAt: now,
  }
  await saveChatSession(session)
  chatSessions.update(list => [session, ...list])
  activeChatId.set(session.id)
  activeMessages.set([])
}

export async function selectChat(id: string): Promise<void> {
  activeChatId.set(id)
  const msgs = await getMessagesForSession(id)
  msgs.sort((a, b) => a.timestamp - b.timestamp)
  activeMessages.set(msgs)
}

export async function deleteChat(id: string): Promise<void> {
  await deleteChatSession(id)
  chatSessions.update(list => list.filter(s => s.id !== id))
  if (get(activeChatId) === id) {
    activeChatId.set(null)
    activeMessages.set([])
  }
}

export async function sendMessage(userContent: string, modelProfile: ModelProfile): Promise<void> {
  const sessionId = get(activeChatId)
  if (!sessionId) return

  const sessions = get(chatSessions)
  let session = sessions.find(s => s.id === sessionId)
  if (!session) return

  // On first message: snapshot model and set title
  const isFirst = (await getMessagesForSession(sessionId)).length === 0
  if (isFirst) {
    session = {
      ...session,
      title: userContent.slice(0, 60),
      modelSnapshot: modelProfile,
      modelProfileId: modelProfile.id,
      updatedAt: Date.now(),
    }
    await saveChatSession(session)
    chatSessions.update(list => list.map(s => (s.id === sessionId ? session! : s)))
  }

  // Persist and add user message
  const userMsg: ChatMessage = {
    id: crypto.randomUUID(),
    sessionId,
    role: 'user',
    content: userContent,
    timestamp: Date.now(),
    status: 'complete',
  }
  await saveChatMessage(userMsg)
  activeMessages.update(msgs => [...msgs, userMsg])

  isStreaming.set(true)

  // Build message history for the API
  const history = get(activeMessages).map(m => ({ role: m.role, content: m.content }))
  const messages = [
    ...(modelProfile.systemPrompt ? [{ role: 'system', content: modelProfile.systemPrompt }] : []),
    ...history,
  ]

  // Create streaming assistant message
  const assistantMsg: ChatMessage = {
    id: crypto.randomUUID(),
    sessionId,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    status: 'streaming',
  }
  activeMessages.update(msgs => [...msgs, assistantMsg])

  try {
    const stream = streamChatCompletion(
      modelProfile.baseUrl,
      modelProfile.modelId,
      messages,
      modelProfile.temperature
    )

    let usage: ChatMessage['usage'] | undefined

    for await (const chunk of stream) {
      if (chunk.done) {
        if (chunk.usage) usage = chunk.usage
        break
      }
      assistantMsg.content += chunk.content
      activeMessages.update(msgs =>
        msgs.map(m => (m.id === assistantMsg.id ? { ...m, content: assistantMsg.content } : m))
      )
    }

    // Mark complete and persist
    assistantMsg.status = 'complete'
    if (usage) assistantMsg.usage = usage
    await saveChatMessage(assistantMsg)
    activeMessages.update(msgs =>
      msgs.map(m => (m.id === assistantMsg.id ? { ...m, status: 'complete', usage } : m))
    )

    // Update session timestamp
    const updatedSession = { ...session!, updatedAt: Date.now() }
    await saveChatSession(updatedSession)
    chatSessions.update(list => {
      const updated = list.map(s => (s.id === sessionId ? updatedSession : s))
      updated.sort((a, b) => b.updatedAt - a.updatedAt)
      return updated
    })
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    assistantMsg.status = 'error'
    assistantMsg.errorMessage = errorMessage
    await saveChatMessage(assistantMsg)
    activeMessages.update(msgs =>
      msgs.map(m =>
        m.id === assistantMsg.id ? { ...m, status: 'error', errorMessage } : m
      )
    )
  } finally {
    isStreaming.set(false)
  }
}
