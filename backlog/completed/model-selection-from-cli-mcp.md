# Model and MCP profile selection from CLI and MCP

## Problem

The `mcpscope create` command and `mcpscope_create` MCP tool can only create sessions using
the UI-configured defaults — the default model config and all default-enabled MCP profiles.
A coding agent driving mcpscope through CLI or MCP has no way to select a different model or
a different set of MCP servers for a session.

To make that possible we need two things:

1. **Discovery** — CLI commands and MCP tools to list available model configs and MCP profiles
2. **Selection** — the ability to pass the chosen IDs to `create`

Before we can do either, we need to settle what those IDs look like, because the current
identifiers are not usable for CLI or MCP workflows.

## Current situation

### How model config and MCP profile IDs work today

Both `modelConfigSchema` and `mcpServerProfileSchema` (in `domain/configuration.ts`) define
`id` as a plain `z.string()` — no format constraint.

When the frontend creates a new model config or MCP profile through the UI forms, the ID is
generated client-side with `crypto.randomUUID()`. This produces identifiers like:

```
f47ac10b-58cc-4372-a567-0e02b2c3d479
```

These are stored in the database and used as API resource identifiers (`PUT /api/model-configs/:id`,
`DELETE /api/model-configs/:id`, etc.). They are also used as the `connectionId` field when
referencing an LM connection from a model config.

### How sessions handle IDs

Sessions use a short canonical ID format: 4 characters from an unambiguous alphabet
(A-Z excluding O/I, 2-9 excluding 0/1). Example: `QGWA`, `CXQJ`, `LS8K`. These are auto-generated
but users can also pass an explicit `--id` to override.

### The gap

Model config and MCP profile IDs are UUIDs because:

- there was never a requirement to type them or pass them through CLI/MCP
- the UI only displays resource names, never exposes the raw IDs to the user
- the only machine-to-machine use is the backend API, and UUIDs work fine there

This breaks down once we want to use them from CLI or MCP:

- typing or pasting a UUID into a CLI flag is a bad experience
- a coding agent receiving a UUID in JSON output then piping it into another command is
  fragile and hard to debug
- there is no way to map a human-readable name (e.g. "Dev Smoke Model") back to its UUID
  without listing all configs and matching by name

## Requirement

We need IDs that are **human-readable at a glance**. When you see `deepseek-v4` as a
`--model-config` argument, you should immediately know which model config it refers to.
When you see `home-assistant` as a `--mcp-profile` argument, you should immediately know
which MCP server profile it refers to.

The requirements:

- **User-defined** — the person creating the resource chooses its ID
- **Meaningful** — the ID should describe the resource, not be a random string
- **Stable** — does not change between listing and using it
- **URL-safe** — must work in CLI flags, MCP tool inputs, and API resource paths
- **Unique within its resource type** — no duplicate IDs among model configs or MCP profiles
- **Backward-compatible** — existing UUID-based resources keep their existing IDs

## Design direction

### User-defined IDs

Instead of auto-generating short random codes (like session IDs), users define the ID
themselves when creating a model config or MCP profile in the UI. The ID is a short,
meaningful string that the user chooses. Default: a slugified version of the name
(lowercase with hyphens).

#### Examples for model configs

| Name | Default ID |
|---|---|
| `DeepSeek V4 Flash` | `deepseek-v4-flash` |
| `Gemma 4 4b` | `gemma-4-4b` |
| `Qwen 3.6` | `qwen-3-6` |

#### Examples for MCP profiles

| Name | Default ID |
|---|---|
| `Home Assistant` | `home-assistant` |
| `Weather MCP` | `weather-mcp` |
| `Filesystem Server` | `filesystem-server` |

### Why this approach

- **Self-documenting commands** — `mcpscope create "test" --model-config deepseek-v4` is
  readable without having to look up what `MCAB` means
- **No extra discovery step** — the ID tells you what it is; the list commands are still
  useful for seeing what's available, but you can often guess the ID
- **User control** — if the default slug is good enough, accept it; if not, override it

### Collision handling for auto-generated IDs

When a new resource gets its default slug from the name and that slug is already taken
by an existing resource of the same type, append a number to disambiguate:

| Name | Existing ID | Generated ID |
|---|---|---|
| `Home Assistant` | `home-assistant` | `home-assistant-2` |
| `Home Assistant` (third) | `home-assistant`, `home-assistant-2` | `home-assistant-3` |
| `Weather MCP` | (none) | `weather-mcp` |

The numbering starts at 2 and increments until an unused ID is found. This keeps IDs
predictable and avoids the need for UUID fallbacks. The user can still override the
generated ID manually in the form before saving.

### Existing UUID-based resources

Resources that already exist with UUIDs keep their UUIDs — this is a backwards-compatible
change. The CLI list commands show them alongside new slug-based resources. Users who want
meaningful IDs can delete and recreate those resources through the UI. No migration layer
is needed; the old UUIDs continue to work for session creation and API access.

## UI changes

### New Model Config form

Add an ID text field to `ModelConfigForm.svelte`, placed right after the Name field.
It defaults to a slugified version of the name as the user types, but stays editable.

```
Name:     DeepSeek V4 Flash
ID:       deepseek-v4-flash      [editable, defaults to slug of name]
```

Validation: the ID must be non-empty, use only URL-safe characters (`[a-zA-Z0-9_-]`),
and be unique across all model configs.

### New MCP Profile form

Same change for `McpProfileForm.svelte`.

```
Name:     Home Assistant
ID:       home-assistant         [editable, defaults to slug of name]
```

Validation: same rules — non-empty, URL-safe, unique across all MCP profiles.

### ID is set at creation time

The ID is set once when the resource is created and cannot be changed afterwards. If a user
wants a resource with a different ID, they delete the old one and create a new one with the
desired ID.

This keeps the implementation simple:
- the ID is the primary key of the resource, used in API URL paths
- no need for two-step create+delete sequences or migration logic
- the UI form for editing an existing resource shows the ID as read-only
- users who created a resource with a UUID before this change can delete and recreate it

## CLI commands

### `mcpscope list-model-configs [--json]`

Lists all model configs with their ID, name, connection, model key, and provider type.

```
$ mcpscope list-model-configs
deepseek-v4-flash   DeepSeek V4 Flash      OpenRouter   deepseek/deepseek-v4-flash   openrouter
gemma-4-4b          Gemma 4 4b             LM Studio    gemma-4-4b                   lmstudio
qwen-3-6            Qwen 3.6               Ollama       qwen3.6                      ollama
```

`--json` returns the full resource records including any existing UUID-based IDs.

### `mcpscope list-mcp-profiles [--json]`

Lists all MCP server profiles with their ID, name, URL, and default-enabled status.

```
$ mcpscope list-mcp-profiles
home-assistant   Home Assistant    http://host:8123/mcp   enabled
weather-mcp      Weather MCP       http://host:8000/mcp   disabled
```

`--json` returns the full resource records.

### Why list commands are still needed

Even with meaningful IDs, the list commands are necessary because:

- you may not remember the exact ID (was it `deepseek-v4` or `deepseek-v4-flash`?)
- existing UUID-based resources need to be discoverable
- the list shows you what resources actually exist on the connected backend

## MCP tools

Two new MCP tools mirroring the CLI commands, generated from the shared operation catalog
with the `mcpscope_` prefix:

### `mcpscope_list_model_configs`

No inputs. Returns a list of all model configs with id, name, connection name, model key,
and provider type.

### `mcpscope_list_mcp_profiles`

No inputs. Returns a list of all MCP server profiles with id, name, URL, and default-enabled
status.

## Updated create command

### CLI

Extend `mcpscope create` with two optional flags:

```
mcpscope create <title> [--model-config <id>] [--mcp-profile <id>...]
```

Examples:

```
# Use the default model and default-enabled MCPs (current behavior)
mcpscope create "Test run"

# Use a specific model with default-enabled MCPs
mcpscope create "Test Gemma on HA" --model-config gemma-4-4b

# Use a specific model and specific MCP profiles
mcpscope create "Gemma on Weather only" --model-config gemma-4-4b --mcp-profile weather-mcp

# Compare two models against the same MCP server
mcpscope create "DeepSeek on HA" --model-config deepseek-v4-flash --mcp-profile home-assistant
mcpscope create "Gemma on HA" --model-config gemma-4-4b --mcp-profile home-assistant
```

- `--model-config` accepts one ID — selecting a model config
- `--mcp-profile` is repeatable — each occurrence adds one MCP profile; when present, it
  replaces the default-enabled selection entirely (the session gets exactly the listed profiles)

### MCP

Extend `mcpscope_create` with two optional input fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | ✓ | Session title |
| `id` | string | | Optional explicit 4-char session ID |
| `compaction` | string | | Compaction strategy |
| `model_config_id` | string | | Optional model config ID to use instead of the default |
| `mcp_profile_ids` | string[] | | Optional list of MCP profile IDs; when provided, replaces default-enabled selection |

If both are omitted, the current default-resolving behavior is preserved unchanged.

## Error handling

### List commands

No error cases beyond the standard backend connection errors.

### Create with explicit selection

| Condition | Error code | Message |
|---|---|---|
| `model_config_id` provided but not found | `model_config_not_found` | "Model config with id X not found." |
| `model_config_id` provided but its LM connection is missing | `model_config_connection_not_found` | "LM connection for model config X no longer exists." |
| `mcp_profile_ids` contains an ID not found | `mcp_profile_not_found` | "MCP profile with id X not found." |

These errors mirror the existing validation errors that occur when defaults are missing.

## Backend changes

### Operation catalog

- Add `listModelConfigs` and `listMcpProfiles` operations to the shared backend operation catalog
- Extend the `create` operation input schema with optional `model_config_id` and `mcp_profile_ids`
- Update the create logic to validate and resolve explicit IDs when provided, falling back to
  defaults when omitted

### ID validation

Add a shared validation rule for user-facing IDs: must be non-empty, must match
`[a-zA-Z0-9_-]+` (or a similar URL-safe charset). This applies both in the backend
route validation and in the frontend form.

### Backend request flow for create with explicit IDs

```
create({ model_config_id: "deepseek-v4", mcp_profile_ids: ["home-assistant"] })
  → validate: model_config_id exists in DB?
  → validate: its connection exists?
  → validate: each mcp_profile_id exists in DB?
  → resolve snapshots from the DB records (same logic as defaults path)
  → create session (same as today)
```

### Idempotency and existing UUIDs

The backend does not validate ID format beyond the basic charset rule. A model config
with a UUID ID (`f47ac10b-58cc-4372-a567-0e02b2c3d479`) is still valid and can be
listed and passed to `create`. The charset constraint only applies to newly created
resources via the UI forms. Existing UUIDs continue to work without any migration.

## Out of scope

- Configuring models, providers, or MCP servers from CLI/MCP — remains GUI-only
- Deleting or editing model configs or MCP profiles from CLI/MCP
- Analysis launch from CLI/MCP (separate work)

## Status

### ✅ Completed

| Area | Details |
|---|---|
| Backend `list_model_configs` operation | `listConfigs.ts` — returns ID, name, connection, model key, provider type |
| Backend `list_mcp_profiles` operation | `listConfigs.ts` — returns ID, name, URL, default-enabled |
| Backend `create` operation | Extended with optional `model_config_id` and `mcp_profile_ids` |
| Route `/api/sessions/from-defaults` | Accepts `modelConfigId` and `mcpProfileIds` |
| Error codes | `model_config_not_found`, `lm_connection_not_found`, `mcp_profile_not_found` → 422 |
| MCP tools | `mcpscope_list_model_configs`, `mcpscope_list_mcp_profiles`, extended `mcpscope_create` |
| CLI `list_model_configs` | Text + `--json` output |
| CLI `list_mcp_profiles` | Text + `--json` output |
| CLI `create` | Extended with `--model-config <id>` and `--mcp-profile <id>` (repeatable) |
| Frontend `ModelConfigForm.svelte` | ID field with auto-slugify from name, collision detection (`-2`, `-3`), read-only on edit |
| Frontend `McpProfileForm.svelte` | Same pattern |
| CLI test | Updated `commandCatalog.test.ts` for 7 operations |
| MCP test | Updated `mcp.test.ts` for 7 tools |
| Documentation | `CLI.md` and `MCP.md` updated with new commands, flags, inputs |
