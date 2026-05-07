export interface LmStudioConnection {
  id: string
  name: string
  baseUrl: string
  apiKey?: string
  createdAt: number
  updatedAt: number
}

export interface ModelConfig {
  id: string
  name: string
  connectionId: string
  modelKey: string
  modelDisplayName: string
  systemPrompt: string
  temperature: number
  contextWindowSize: number | null
  createdAt: number
  updatedAt: number
}

export interface McpServerProfile {
  id: string
  name: string
  url: string
  transport: 'streamable-http'
  createdAt: number
  updatedAt: number
}

export type NavView = 'chats' | 'connections' | 'model-configs' | 'mcp-profiles'

export interface ConnectionTestResult {
  status: 'idle' | 'testing' | 'success' | 'error'
  message: string
  details: string[]
}

export interface ChatSession {
  id: string
  title: string
  modelConfigId: string
  modelConfigSnapshot: ModelConfig
  mcpProfileId: string | null
  mcpSnapshot: McpServerProfile | null
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  status: 'complete' | 'streaming' | 'error'
  errorMessage?: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  thinking?: string
  trace?: unknown
}
