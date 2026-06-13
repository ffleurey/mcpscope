# Model Configuration UI Specification

**Purpose:** Design reference for the create, read, update, and delete screens for model configurations. This document defines the data model, the available API operations, and the screens/dialogs that need to exist.

---

## Data Model

A **model configuration** (`ModelConfig`) binds a specific model (from a provider) to parameter presets that are used when creating sessions.

### ModelConfig Record

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | ✓ | Unique identifier, generated on create |
| `name` | `string` | ✓ | Human-readable label for this config (e.g. "Gemma Creative") |
| `connectionId` | `string` (UUID) | ✓ | References a provider connection |
| `modelKey` | `string` | ✓ | The model identifier used by the provider (e.g. `google/gemma-4-e4b`) |
| `modelDisplayName` | `string` | ✓ | Human-readable model name (e.g. `Gemma 4 E4B (Q8_0)`, includes quantization when available) |
| `systemPrompt` | `string` | ✓ | System prompt text (can be empty) |
| `temperature` | `number` | ✓ | 0.0–2.0 |
| `reasoning` | `"on"` \| `"off"` | — | Only present when the selected model supports chain-of-thought reasoning |
| `contextSize` | `number` (positive int) | — | Context window size in tokens. When absent/empty, the provider default is used. Preset values: 16384, 24576, 32768, 49152, 65536, 81920, 98304, 131072, or any custom number. |
| `createdAt` | `number` (epoch ms) | ✓ | Creation timestamp |
| `updatedAt` | `number` (epoch ms) | ✓ | Last modification timestamp |

### Related Entities (read-only context on the screen)

The model config references a **provider connection** (`LmStudioConnection`):

| Field | Description |
|---|---|
| `id` | Connection UUID |
| `name` | Connection display name (e.g. "Local LM Studio") |
| `providerType` | `"lmstudio"` \| `"openrouter"` \| `"ollama"` |
| `baseUrl` | API base URL |

The model config's model is resolved via the connection to get **live model metadata** (`LmStudioModel`):

| Field | Description |
|---|---|
| `key` | Provider model key |
| `displayName` | Full display name with quantization |
| `maxContextLength` | Architectural maximum context window (tokens) |
| `loadedContextLength` | Currently loaded context window (LM Studio only) |
| `isLoaded` | Whether the model is loaded into memory (LM Studio only) |
| `supportsReasoning` | Whether the model supports chain-of-thought |
| `defaultReasoningOn` | Whether reasoning is on by default for this model |
| `raw` | Full provider metadata (shown in Details dialog) |

---

## API Operations

All endpoints are under the backend at the configured host (default `http://localhost:3030`).

### List Model Configs

```
GET /api/model-configs
```

**Response:**
```json
{
  "modelConfigs": [
    {
      "id": "uuid",
      "name": "Gemma Creative",
      "connectionId": "conn-uuid",
      "modelKey": "google/gemma-4-e4b",
      "modelDisplayName": "Gemma 4 E4B (Q8_0)",
      "systemPrompt": "You are a helpful assistant.",
      "temperature": 0.7,
      "reasoning": "on",
      "contextSize": 32768,
      "createdAt": 1700000000000,
      "updatedAt": 1700000000000
    }
  ]
}
```

### Create or Update Model Config

```
PUT /api/model-configs/:id
```

**Body:** Full `ModelConfig` record (see fields above). For create, generate a new UUID as `id`. For update, send the existing `id`.

**Response:** `{ "modelConfig": { ... } }` with the persisted record.

### Delete Model Config

```
DELETE /api/model-configs/:id
```

Returns `204 No Content` on success. Returns `409 Conflict` if the config is currently set as the default for new sessions.

### Set as Default for New Sessions

```
PUT /api/session-creation-defaults
```

**Body:** `{ "defaultModelConfigId": "uuid" }`  
Setting to `null` clears the default.

### List Provider Connections (context for connection dropdown)

```
GET /api/lm-connections
```

**Response:** `{ "lmConnections": [...] }`

### List Models for a Connection (context for model dropdown)

```
POST /api/lm-connections/models
```

**Body:** `{ "baseUrl": "...", "providerType": "..." }`  
**Response:** `{ "models": [{ "uid", "key", "displayName", "maxContextLength", "loadedContextLength", "isLoaded", "supportsReasoning", "defaultReasoningOn", "raw" }] }`

### Fetch Model Details (for Details dialog)

```
POST /api/lm-connections/models/details
```

**Body:** `{ "baseUrl": "...", "modelKey": "...", "providerType": "..." }`  
**Response:** `{ "details": { ... } }` — full provider metadata

### Load / Eject Model (LM Studio only)

```
POST /api/lm-connections/models/load
POST /api/lm-connections/models/unload
```

---

## Screens and Dialogs

### 1. Model Configs List (main view)

**Purpose:** Browse, manage, and act on all model configurations.

**Elements:**
- Header: "Model Configs" title, "↻ Refresh" button, "+ New Model Config" button
- List of cards, each showing:
  - **Card title:** config `name`
  - **Subtitle:** `modelDisplayName`
  - **Default badge** if this config is the default for new sessions
  - **Action buttons:**
    - Load / Eject (LM Studio only, shown when model metadata is available)
    - "Details" (opens modal with raw model metadata)
    - "Set as default" (makes this config the default for new sessions)
    - "Edit" (opens edit form inline)
    - "Delete"

- **Detail rows** (below the action bar):
  - **Connection:** connection `name`
  - **Model Key:** the provider's model identifier (code style)
  - **Context Size:** the configured value (e.g. "32K (32,768)"), shown only when set
  - **Temperature:** displayed as a badge
  - **Reasoning:** displayed as a badge, shown only when set
  - **System Prompt:** preview of the first 120 characters, truncated with "…"

### 2. New / Edit Model Config (form)

**Purpose:** Create a new model config or edit an existing one. Rendered inline (replaces card or appears above the list).

**Elements:**
- **Title:** "New Model Config" or "Edit Model Config"
- **Name** — text input, required, placeholder: "e.g. Qwen3 · Creative"
- **Connection** — dropdown of all connections, selecting a connection triggers model list loading
- **Model** — searchable text filter + dropdown of models from the selected connection. Shows loaded indicator (●) for LM Studio loaded models. "Load" button for unloaded LM Studio models.
- **Model hint text** — shows loaded/not-loaded status for LM Studio, context window info for all providers
- **Temperature** — number input, 0.0–2.0
- **Reasoning** — dropdown with "On" / "Off", only visible when the selected model supports reasoning
- **Context Size** — dropdown with preset values, optional:
  - Auto (provider default)
  - 16K (16,384)
  - 24K (24,576)
  - 32K (32,768)
  - 48K (49,152)
  - 64K (65,536)
  - 80K (81,920)
  - 96K (98,304)
  - 128K (131,072)
  - Custom… (shows number input field)
  - Hint shows the model's architectural max context
- **System Prompt** — textarea, placeholder: "Optional system prompt"
- **Save** and **Cancel** buttons

### 3. Delete Confirmation (behavior)

**Current:** No confirmation dialog — delete is immediate.  
**Consider:** Add a confirmation dialog before deleting.

### 4. Model Details (modal)

**Purpose:** Show raw provider metadata for a model.

**Current:** Opens a JSON viewer (`JsonDialog`) with the model's raw metadata.

### 5. Connection Test (shared)

**Purpose:** Test a connection from the Connections view (separate from model configs, but referenced concept).

---

## Provider-Specific Behavior

| Feature | LM Studio | OpenRouter | Ollama |
|---|---|---|---|
| Load / Eject buttons | ✓ Shown | ✗ Hidden | ✗ Hidden |
| Loaded indicator (●) | ✓ Shown | ✗ Hidden | ✗ Hidden |
| Reasoning parameter in request | `reasoning: "on"\|"off"` | `reasoning: {}, include_reasoning: true` | Not sent (handled natively) |
| Context size parameter | Set at model load time (read-only) | Server default (read-only) | `options.num_ctx` in request body |
| Model list source | Native `/api/v1/models` → OAI `/v1/models` | OAI `/v1/models` | OAI `/v1/models` |
| Details source | Native model data | OAI model data | OAI model data + native `/api/show` |

---

## Design Notes

- The form is currently displayed **inline** (replaces or appears within the list), not as a separate page or modal
- Provider metadata (loaded status, context limits) is fetched live via the **Refresh** button
- The configured parameters (name, temperature, reasoning, context size, system prompt) come from the **stored config**, not from live model data
- All times are epoch milliseconds
- Machine-readable IDs (UUIDs, model keys) are shown in code/monospace style
- The default config is highlighted with a distinct border color
