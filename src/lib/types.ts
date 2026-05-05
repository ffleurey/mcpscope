export interface ModelProfile {
  id: string
  name: string
  modelId: string
  baseUrl: string
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
