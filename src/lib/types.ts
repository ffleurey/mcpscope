export interface ModelProfile {
  id: string
  name: string
  modelId: string
  baseUrl: string
  apiKey?: string
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

export type NavView = 'chats' | 'model-profiles' | 'mcp-profiles'

export interface ConnectionTestResult {
  status: 'idle' | 'testing' | 'success' | 'error'
  message: string
  details: string[]
}

export interface ChatSession {
  id: string
  title: string
  modelProfileId: string
  modelSnapshot: ModelProfile
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
  thinking?: string   // accumulated reasoning_content from model
  trace?: unknown
}
