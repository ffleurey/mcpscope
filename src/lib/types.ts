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
  createdAt: number
  updatedAt: number
}

export type NavView = 'chats' | 'connections' | 'model-configs' | 'mcp-profiles'

export interface ConnectionTestResult {
  status: 'idle' | 'testing' | 'success' | 'error'
  message: string
  details: string[]
}

// ---- MCP tool types ----

// A tool definition as returned by MCP tools/list, stored on the session
export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>  // JSON Schema object
}

// Status of a single tool call execution
export type ToolCallStatus = 'pending' | 'running' | 'done' | 'error'

// A single tool call made by the model, with its execution result
export interface ToolCallBlock {
  id: string             // matches assistant message tool_calls[i].id
  name: string
  argumentsJson: string  // raw JSON string as streamed from the model
  status: ToolCallStatus
  startedAt?: number     // Date.now() when callTool was invoked
  completedAt?: number   // Date.now() when callTool returned
  result?: string        // tool result text (joined if multiple content items)
  isError?: boolean      // true if tool returned isError: true
  mcpRaw?: unknown       // raw MCP tools/call response for ⋯ raw dialog
  thinkingBefore?: string  // model reasoning that led to this tool call (for traceability)
}

// ---- Context bar segment types ----

export type SegmentType =
  | 'system-prompt'      // system prompt text
  | 'user'               // user message
  | 'reasoning'          // model chain-of-thought (not forwarded to next turn)
  | 'content'            // model response content
  | 'tool-definitions'   // MCP tool schemas sent in tools[] array
  | 'tool-call'          // MCP tool invocation (assistant tool_calls message)
  | 'tool-response'      // MCP tool result (role: "tool" message)

export interface TokenSegment {
  type: SegmentType
  tokens: number
}

// Raw API response metadata captured per completion
export interface MessageTrace {
  completionId: string
  model: string
  systemFingerprint: string
  created: number        // Unix seconds (from API — 1s precision)
  finishReason: string
  rawUsage: unknown      // usage object verbatim from API
}

// ---- Chat types ----

export interface ChatSession {
  id: string
  title: string
  modelConfigId: string
  modelConfigSnapshot: ModelConfig
  mcpProfileId: string | null
  mcpSnapshot: McpServerProfile | null
  createdAt: number
  updatedAt: number
  // Context snapshot — captured at first message, never updated after
  loadedContextLength: number | null   // from native API loaded_instances[0].config.context_length
  systemPromptTokens: number | null    // from probe API call; 0 if no system prompt; null if probe failed
  // Set to true when the context window is full and no further messages can be sent
  isContextExhausted?: boolean
  // MCP session state — initialized at first message, persists for session lifetime
  mcpSessionId?: string                // Mcp-Session-Id header from initialize response
  mcpTools?: McpToolDefinition[]       // tools fetched at session init
  mcpInstructions?: string             // server instructions from initialize response
  toolDefinitionsTokens?: number       // estimated token cost of the tools[] schemas
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  status: 'complete' | 'streaming' | 'error' | 'aborted'
  errorMessage?: string
  thinking?: string

  // For user messages: token count for this message (back-filled when the assistant response arrives)
  tokens?: number

  // Token accounting — only on completed assistant messages
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    reasoningTokens?: number
  }

  // Whether this assistant turn's reasoning (thinking) is being forwarded in the context.
  // False by default — reasoning is stripped from history. Set to true to include reasoning_content
  // when this message is sent back to the API in subsequent turns.
  thinkingInContext?: boolean

  // Wall-clock timestamps for generation speed tracking
  streamingStartedAt?: number    // Date.now() when first token received
  streamingCompletedAt?: number  // Date.now() when [DONE] received

  // Raw API response metadata (for the ⋯ raw dialog)
  trace?: MessageTrace

  // Tool calls made by this assistant message (only present if the model called tools)
  toolCalls?: ToolCallBlock[]

  // Estimated token counts for tool-related content in this message
  // (back-calculated from promptTokens delta across tool rounds)
  toolCallTokens?: number       // tokens used by tool_calls[] in the assistant message
  toolResponseTokens?: number   // tokens used by tool result messages
}

