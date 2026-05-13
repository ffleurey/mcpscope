# Context Statistics — Specification

**Status:** Superseded — this document guided early design work and has been overtaken by the backend-first implementation. See `ARCHITECTURE.md` for the current system design.

The LM Studio API observations in this document remain accurate: the `prompt_tokens` delta arithmetic, the `reasoning_tokens` field in `completion_tokens_details`, and the streaming usage payload shape are valid descriptions of the API behaviour and are still relevant when working on token attribution.

Key divergences from this spec to the current implementation:

- Token accounting is now attached to `PartRecord` entities persisted in SQLite, not to frontend `ChatMessage` structures.
- The type hierarchy (`ChatMessage`, `TokenSegment`, etc.) no longer exists; the canonical model is `Session → Turn → Round → Part → RawExchangeRecord`.
- The `SegmentType` / `TokenSegment` vocabulary from this spec was superseded by the `partType` field on `PartRecord` (see `ARCHITECTURE.md`). Note: LM Studio response blocks are still called `LmStudioAssistantSegment` internally — that is a service-layer type distinct from domain `Part` records.
- Prompt-token delta attribution for tool-enabled turns is implemented in `applyPendingPromptSuffixAttribution` in `backend/src/runtime/toolTurns.ts`, using the same delta arithmetic described here.
- Context bar visualization is driven by backend `context` data from `GET /api/sessions/:sessionId/trace`, not client-side segment arrays.

---

## Design decisions and limitations

**One chat = one experiment.**  
The model parameters (temperature, reasoning mode, system prompt, loaded context length) are captured once at session start and treated as fixed for the lifetime of that chat. If the user changes a ModelConfig or reloads a model mid-conversation, those changes do not affect ongoing sessions. This is a deliberate simplification — it makes statistics coherent and sessions reproducible. Future work may make sessions more dynamic if needed.

---

## 1. Session-level snapshot (captured at chat start)

### What to capture

At the moment the first user message is sent, we snapshot everything that defines the conditions of this conversation.

**Model configuration (already in `modelConfigSnapshot`):**
- `modelKey` — model used
- `modelDisplayName` — human name
- `connectionId` — which server
- `temperature` — actual temperature
- `reasoning` — on/off if applicable
- `systemPrompt` — system prompt text

**Live model state (NOT currently captured — must be added):**
- `loadedContextLength: number | null` — from `loaded_instances[0].config.context_length` via `/api/v1/models`. This is the hard limit for context window. Note: may differ greatly from `max_context_length` (architectural maximum).
- `systemPromptTokens: number | null` — see below.

### Measuring system prompt tokens

The API does not break down `prompt_tokens` by message. But we can probe it:

At session start (before the first user message), send a cheap API call with only the system prompt:
```json
{
  "model": "...",
  "messages": [{ "role": "system", "content": "...system prompt here..." }],
  "max_tokens": 1,
  "stream": false
}
```
→ `prompt_tokens` in the response = number of tokens in the system prompt.

If there is no system prompt, `systemPromptTokens = 0`.

This single-token call is cheap and gives us the denominator needed to decompose all subsequent per-turn token counts.

### Updated `ChatSession` type

```typescript
export interface ChatSession {
  id: string
  title: string
  modelConfigId: string
  modelConfigSnapshot: ModelConfig     // parameters as of first message
  mcpProfileId: string | null
  mcpSnapshot: McpServerProfile | null
  createdAt: number
  updatedAt: number
  // Context snapshot — captured at first message, never updated after
  loadedContextLength: number | null   // ADD: from native API at session start
  systemPromptTokens: number | null    // ADD: from probe call, or 0 if no system prompt
}
```

---

## 2. Per-response data: what the API gives us

### Data sources

There is **one** source of per-response statistics: the OpenAI-compatible `/v1/chat/completions` endpoint.

The native `/api/v1/` endpoint provides no post-completion data (404 on all probed endpoints: `/api/v1/stats`, `/api/v1/completions`).

### Fields in the usage chunk (streaming, with `stream_options.include_usage: true`)

```json
{
  "id": "chatcmpl-o8hjtriprmltj2asuxiboo",
  "object": "chat.completion.chunk",
  "created": 1778306695,
  "model": "qwen3.6-35b-a3b-apex",
  "system_fingerprint": "qwen3.6-35b-a3b-apex",
  "choices": [],
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 206,
    "total_tokens": 218,
    "completion_tokens_details": {
      "reasoning_tokens": 190
    }
  }
}
```

The finish chunk (just before usage) provides `finish_reason`:
```json
{ "choices": [{ "delta": {}, "finish_reason": "stop" }] }
```

`created` is the request start time (Unix seconds, 1-second precision). Not reliable for timing — we must use wall-clock time measured in the streaming loop.

`stats: {}` is always empty in LM Studio — no additional data.

### What each field means

| Field | Meaning |
|---|---|
| `prompt_tokens` | All input tokens this request: system prompt + all prior turns' content (not reasoning) + current user message |
| `completion_tokens` | Everything generated: reasoning tokens + response content tokens |
| `completion_tokens_details.reasoning_tokens` | Chain-of-thought tokens, NOT forwarded to subsequent turns |
| `total_tokens` | `prompt_tokens + completion_tokens` |
| `created` | Request start (Unix seconds, same value on all chunks) |
| `finish_reason` | `"stop"` = normal, `"length"` = max_tokens hit |
| `system_fingerprint` | Set to the model key by LM Studio |

---

## 3. Accumulated (derived) metrics

These are calculated client-side and stored on `ChatMessage`. They cannot be read directly from the API.

### Token decomposition per turn

Let N = turn index (1-based).  
Let PT(N) = `prompt_tokens`, CT(N) = `completion_tokens`, RT(N) = `reasoning_tokens`.  
Let CONT(N) = `content_tokens` = CT(N) - RT(N).

**Derivation:**

```
CONT(N) = CT(N) - RT(N)                              // content added to next turn's prompt

user_1_tokens  = PT(1) - systemPromptTokens          // from session snapshot
user_N_tokens  = PT(N) - PT(N-1) - CONT(N-1)        // for N ≥ 2
```

This works because the prompt at turn N = system + u1 + a1_content + u2 + a2_content + … + u(N-1) + a(N-1)_content + uN. The delta from turn N-1 to N adds: `a(N-1)_content + uN`.

### Response speed

```
tokensPerSecond = completionTokens / streamingDurationSeconds
```

Where `streamingDurationSeconds` is measured as wall-clock time from first byte received to last byte (the `[DONE]` marker). This includes both reasoning and content generation phases.

### Cumulative context fill

```
cumulativeTokens(N) = total_tokens(N)  // = PT(N) + CT(N)
```

After each turn, `total_tokens` is the total context consumed including the just-generated response. This is the `X` in the `X / loadedContextLength` display. It grows each turn (by user_N + CT(N)).

---

## 4. Per-message stored data

### Token segments (for context bar)

Each message stores a list of segments representing its contribution to the context window.

```typescript
export type SegmentType =
  | 'system-prompt'       // system prompt (first message only, from probe)
  | 'user'                // user message text
  | 'reasoning'           // chain-of-thought output
  | 'content'             // response content
  // Future MCP segments:
  | 'tool-definitions'    // tool schemas sent in system context
  | 'tool-call'           // individual tool invocation
  | 'tool-response'       // tool result returned

export interface TokenSegment {
  type: SegmentType
  tokens: number
}
```

**Segments per turn:**

Turn 1 (first user message):
```
[{ type: 'system-prompt', tokens: systemPromptTokens }]  // from session probe
[{ type: 'user',          tokens: user_1_tokens }]        // PT(1) - systemPromptTokens
[{ type: 'reasoning',     tokens: RT(1) }]
[{ type: 'content',       tokens: CONT(1) }]
```

Turn N (N ≥ 2):
```
[{ type: 'user',      tokens: user_N_tokens }]   // PT(N) - PT(N-1) - CONT(N-1)
[{ type: 'reasoning', tokens: RT(N) }]
[{ type: 'content',   tokens: CONT(N) }]
```

Future MCP turns will add `tool-definitions`, `tool-call`, `tool-response` segments.

### Updated `ChatMessage` type

```typescript
export interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  status: 'complete' | 'streaming' | 'error'
  errorMessage?: string
  thinking?: string

  // Token accounting — only on completed assistant messages
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    reasoningTokens?: number
  }
  segments?: TokenSegment[]      // ADD: breakdown for context bar
  streamingDurationMs?: number   // ADD: wall-clock duration of streaming
  tokensPerSecond?: number       // ADD: completionTokens / (durationMs/1000)

  // Raw API response metadata — for the "details" dialog
  trace?: {
    completionId: string
    model: string
    systemFingerprint: string
    created: number
    finishReason: string
    rawUsage: unknown            // the usage object as returned by the API, verbatim
  }
}
```

---

## 5. Stats bar display (after each assistant message)

Primary line (always shown when usage is available):
```
Context: 218 / 16,384 (1.3%)  ·  Round: +124 tokens  ·  42 tok/s
```

Where:
- `218` = `total_tokens(N)` — full context size after this turn
- `16,384` = `session.loadedContextLength`
- `1.3%` = percentage
- `+124` = user_N_tokens + CT(N) = tokens added this round (prompt delta + completion)
- `42 tok/s` = `completionTokens / streamingDurationSeconds`

Secondary line (when reasoning is present):
```
Generated: 16 content + 190 reasoning
```

If `loadedContextLength` is unknown:
```
Total: 218 tokens  ·  Round: +124 tokens  ·  42 tok/s
```

**⋯ raw** button opens `JsonDialog` with `message.trace` — the raw API metadata object (completion_id, model, finish_reason, and unmodified usage JSON). This is genuinely different from the processed display: it shows what the API actually sent, field names and all.

---

## 6. Context bar visualization

### Position and layout

A horizontal bar spanning the full width of the chat, placed **just above the input box**. Always visible when a model config is active. Height: approximately 12px.

### What it represents

The total width = `session.loadedContextLength` tokens.  
The bar fills left to right as the conversation accumulates context.  
Each filled segment corresponds to a `TokenSegment` from a message.

### Segment colors

| Segment type | Color | Description |
|---|---|---|
| `system-prompt` | Dark slate (#475569) | System prompt, static from session start |
| `user` | Steel blue (#3b82f6) | User messages |
| `reasoning` | Amber (#f59e0b) | Model chain-of-thought |
| `content` | Emerald (#10b981) | Model response content |
| `tool-definitions` | Purple (#8b5cf6) | MCP tool schemas (future) |
| `tool-call` | Orange (#f97316) | Tool invocations (future) |
| `tool-response` | Light orange (#fb923c) | Tool results (future) |

Unfilled portion: dark background, no color.

### Segment ordering in the bar

Segments are laid out in conversation order:

```
[system-prompt][user_1][reasoning_1][content_1][user_2][reasoning_2][content_2]…
```

The "system-prompt" segment is fixed at the left. Each subsequent turn appends its segments.

### Interaction

- Hovering over a segment shows a tooltip: segment type, token count, turn number
- No click interaction in the initial implementation

### When `loadedContextLength` is unknown

Show the bar without a fixed width — just the filled segments as relative widths, no "empty" portion shown. Or show only the stats text and hide the bar.

---

## 7. Implementation plan (without MCP)

### Phase 1 — Data capture (prerequisite for everything else)

1. **Session probe call**: At first-message time, call the API with only the system prompt to get `systemPromptTokens`. If no system prompt, skip. Store on `ChatSession`.
2. **Load `loadedContextLength`**: Fetch from native API at session start, store on `ChatSession`.
3. **Streaming timing**: Record `streamingStartedAt = Date.now()` when first byte arrives, `streamingCompletedAt` when `[DONE]` is received.
4. **Capture full trace**: Store `completionId`, `model`, `systemFingerprint`, `created`, `finishReason` from finish chunk alongside raw usage.
5. **Compute segments**: In `chatStore.sendMessage`, after each response, derive `TokenSegment[]` using the derivation formulas above. Store on the message.

### Phase 2 — Stats bar (per-message)

Replace current stats bar with:
```
Context: X / Y (Z%)  ·  Round: +N tokens  ·  T tok/s
[Generated: C content + R reasoning]  [⋯ raw]
```

### Phase 3 — Context bar (session-level)

Render the bar above the input box. Read all `activeMessages`, flatten their `segments` arrays in order, and render as colored strips proportional to token count relative to `loadedContextLength`.

### Phase 4 — MCP extension (future)

When MCP tool calls are added, extend `SegmentType` with tool-related types. Tool definition tokens (from the system context + tool schemas) will be captured in `systemPromptTokens` or as a separate `toolDefinitionsTokens` on the session. Per-tool-call segments will be added to each message's `segments` array.
