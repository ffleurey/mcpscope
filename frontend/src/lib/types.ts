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
  reasoning?: 'on' | 'off'
  createdAt: number
  updatedAt: number
}

export interface McpServerProfile {
  id: string
  name: string
  url: string
  transport: 'streamable-http'
  authType?: 'none' | 'bearer' | 'basic' | null
  authValue?: string | null
  createdAt: number
  updatedAt: number
}

export type NavView = 'chats' | 'connections' | 'model-configs' | 'mcp-profiles'

export interface ConnectionTestResult {
  status: 'idle' | 'testing' | 'success' | 'error'
  message: string
  details: string[]
}
