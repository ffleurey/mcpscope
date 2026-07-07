# Configuration reference — `mcpscope.config.json`

All of mcpscope's editable configuration lives in **one JSON file**: LM connections, model
configs, MCP server profiles, the default model, and the companion API keys. The Web UI's
Configuration screens read and write this file; you can also edit it by hand — which is how you
do a fully **headless setup** (no Web UI step at all, see [below](#headless-setup-no-web-ui)).

Sessions, traces, and benchmarks are *not* in this file — they live in the SQLite database next
to it.

## Location

`{dataDir}/mcpscope.config.json`, where the data directory is:

| Install | Config file path |
|---|---|
| npm / desktop app (default) | `~/.mcpscope/mcpscope.config.json` |
| `mcpscope serve --data-dir <path>` | `<path>/mcpscope.config.json` |
| Docker (volume `mcpscope-data:/data`) | `/data/mcpscope.config.json` |
| From source (`npm run dev`) | `backend-data/mcpscope.config.json` in the checkout |

## Editing rules

- **Strict JSON** — no comments, no trailing commas (`JSON.parse`).
- The file is read **once at startup**. After hand-editing, restart mcpscope (`Ctrl-C`,
  `mcpscope serve`). Changes made through the Web UI are saved and applied immediately.
- A missing file is fine — mcpscope starts empty and creates it on the first save from the UI.
- A malformed file fails **loudly at startup** with the exact validation issue and path — fix
  the reported line and restart.
- `id` fields are yours to choose (letters, digits, `-`, `_`) and are what you pass to
  `--model-config` / `--mcp-profile` on the CLI.

## Full example

```json
{
  "lm_connections": [
    {
      "id": "lmstudio-local",
      "name": "LM Studio",
      "baseUrl": "http://localhost:1234/v1",
      "providerType": "lmstudio",
      "autoSwapModel": true
    },
    {
      "id": "openrouter",
      "name": "OpenRouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "sk-or-...",
      "providerType": "openrouter"
    }
  ],
  "model_configs": [
    {
      "id": "qwen-local",
      "name": "Qwen 3.5 9B",
      "connectionId": "lmstudio-local",
      "modelKey": "qwen/qwen3.5-9b",
      "systemPrompt": "You are a helpful assistant.",
      "reasoning": "off",
      "contextSize": 65536
    }
  ],
  "mcp_server_profiles": [
    {
      "id": "my-server",
      "name": "My MCP server",
      "url": "http://localhost:3001/mcp",
      "transport": "streamable-http",
      "defaultEnabled": true
    }
  ],
  "session_creation_defaults": {
    "default_model_config_id": "qwen-local"
  },
  "companions": {
    "guardian": { "api_key": null },
    "brave": { "api_key": null }
  }
}
```

## Sections

### `lm_connections` — where your LLM backend lives

| Field | Required | Notes |
|---|---|---|
| `id`, `name` | ✓ | `id` is the stable reference used by model configs |
| `baseUrl` | ✓ | LM Studio: `http://localhost:1234/v1` · Ollama: `http://localhost:11434` · OpenRouter: `https://openrouter.ai/api/v1` |
| `providerType` | | `"lmstudio"` (default) \| `"ollama"` \| `"openrouter"` — see [Provider notes](#provider-notes) below |
| `apiKey` | | Required for OpenRouter; optional elsewhere |
| `autoSwapModel` | | LM Studio only: unload other models before serving a request for a different one, so one VRAM-limited instance can serve CLI/MCP runs unattended |

### `model_configs` — a model on a connection, plus how to call it

| Field | Required | Notes |
|---|---|---|
| `id`, `name`, `connectionId`, `modelKey` | ✓ | `connectionId` must match an `lm_connections` entry (validated at startup); `modelKey` is the provider's model id (e.g. `qwen/qwen3.5-9b`) |
| `systemPrompt` | | Defaults to empty |
| `temperature` | | Omit entirely to use the provider default (`0` is a real value, not "unset") |
| `reasoning` | | `"on"` \| `"off"` — providers differ; see [Provider notes](#provider-notes) |
| `contextSize` | | Context length to load the model with (used by auto-load and the context bar) |

### `mcp_server_profiles` — the servers under test

| Field | Required | Notes |
|---|---|---|
| `id`, `name`, `url` | ✓ | `transport` is always `"streamable-http"` |
| `authType` / `authValue` | | `"bearer"` (token sent verbatim) or `"basic"` (`username:password`, base64-encoded per RFC 7617) |
| `defaultEnabled` | | `true` = selected automatically when `create`/`benchmark_run` are called without `--mcp-profile` |

The bundled **companion servers** ([COMPANIONS.md](COMPANIONS.md)) are *not* in this file — their
`builtin-*` profiles are synthesized at runtime so URLs never go stale, and they can never be
`defaultEnabled` (select them explicitly per session).

### Provider notes

What differs between the three providers, from a setup point of view:

- **LM Studio** — `reasoning: "on"/"off"` is supported; `contextSize` is applied when the model
  is loaded; `autoSwapModel` (see above) lets one VRAM-limited instance serve whichever model a
  session asks for.
- **Ollama** — reasoning is supported (Ollama's "think" mode); `contextSize` is sent per request;
  reasoning token counts are estimated and shown with a `~` prefix.
- **OpenRouter** — hosted, so `apiKey` is required and there is no model loading; reasoning works
  where the underlying model supports it; the context window is read from the model listing when
  `contextSize` is not set.

The full behavior reference (exact request parameters, token counting, probing fallbacks) is
[docs/PROVIDERS.md](docs/PROVIDERS.md).

### `session_creation_defaults`

`default_model_config_id` — the model used when `create`/`benchmark_run` are called without
`--model-config`. This is the one thing the CLI cannot work without; set it here or in the UI.

### `companions` — upstream API keys for key-gated companions

`guardian.api_key` and `brave.api_key` unlock The Guardian and Web Search companions. These are
companion→upstream credentials (never sent anywhere else). Until set, the profile is listed but
disabled with a tooltip naming the exact key. Details: [COMPANIONS.md](COMPANIONS.md#api-keys).

## Headless setup (no Web UI)

The complete zero-UI path — write the config, start, drive from the CLI (or hand these steps to
a coding agent):

```bash
mkdir -p ~/.mcpscope
cat > ~/.mcpscope/mcpscope.config.json <<'EOF'
{
  "lm_connections": [
    { "id": "lmstudio-local", "name": "LM Studio", "baseUrl": "http://localhost:1234/v1", "providerType": "lmstudio" }
  ],
  "model_configs": [
    { "id": "local-model", "name": "Local model", "connectionId": "lmstudio-local", "modelKey": "<your-model-id>" }
  ],
  "mcp_server_profiles": [],
  "session_creation_defaults": { "default_model_config_id": "local-model" }
}
EOF
mcpscope serve --no-open &

mcpscope create "first-session" --mcp-profile builtin-open-meteo --wait
mcpscope send <SESSION_ID> "What's the weather in Paris this week?" --wait
mcpscope inspect <SESSION_ID>.1T
```

Replace `<your-model-id>` with the model id loaded in LM Studio (shown in its Developer tab, or
via `mcpscope` once a connection exists). `--wait` blocks until init / the turn completes, so
there is no polling loop.
