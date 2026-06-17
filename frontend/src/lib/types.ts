export type {
  LmStudioConnection,
  ModelConfig,
  McpServerProfile,
  SessionCreationDefaults,
} from './backendTypes'

export type ProviderType = 'lmstudio' | 'openrouter' | 'ollama'

export type NavView =
  | 'chats'
  | 'connections'
  | 'model-configs'
  | 'mcp-profiles'
  | 'benchmarks'
  | 'design'
