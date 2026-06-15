export type ProviderType = "lmstudio" | "openrouter" | "ollama";

export interface LmStudioConnection {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  providerType: ProviderType;
  createdAt: number;
  updatedAt: number;
}

export interface ModelConfig {
  id: string;
  name: string;
  connectionId: string;
  modelKey: string;
  modelDisplayName: string;
  systemPrompt: string;
  temperature: number;
  reasoning?: "on" | "off";
  contextSize?: number;
  createdAt: number;
  updatedAt: number;
}

export interface McpServerProfile {
  id: string;
  name: string;
  url: string;
  transport: "streamable-http";
  authType?: "none" | "bearer" | "basic" | null;
  authValue?: string | null;
  defaultEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SessionCreationDefaults {
  defaultModelConfigId: string | null;
  updatedAt: number;
}

export type NavView =
  | "chats"
  | "connections"
  | "model-configs"
  | "mcp-profiles"
  | "design";
