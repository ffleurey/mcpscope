# Session creation defaults

This task defines the backend and UI support for **defaults used only when creating new sessions**.

It is a **prerequisite** for the CLI v3 session lifecycle MVP tracked in:

- [backlog/cli-for-llm-in-the-loop-test.md](cli-for-llm-in-the-loop-test.md)

## Status: implemented — branch `session-creation-defaults`

### What was delivered

**Backend — persistence**

- Added `session_creation_defaults` table (SQLite schema version bumped 4 → 5).
  - Single-row singleton with `id INTEGER PRIMARY KEY CHECK (id = 1)`.
  - Fields: `default_model_config_id TEXT`, `default_mcp_profile_id TEXT`, `updated_at INTEGER NOT NULL`.
  - Row is inserted with `INSERT OR IGNORE` on schema init so it always exists.
- Added `getSessionCreationDefaults` and `upsertSessionCreationDefaults` in `repository.ts`.

**Backend — API**

- `GET /api/session-creation-defaults` — returns `{ sessionCreationDefaults: { defaultModelConfigId, defaultMcpProfileId, updatedAt } }`.
- `PUT /api/session-creation-defaults` — accepts `{ defaultModelConfigId: string | null, defaultMcpProfileId: string | null }`.
  - Validates that referenced IDs exist; returns HTTP 422 with `default_model_config_not_found` / `default_mcp_profile_not_found`.
  - Either field may be set to `null` independently.
- `DELETE /api/model-configs/:id` — now rejects with HTTP 409 / `default_model_config_in_use` if the config is the current default.
- `DELETE /api/mcp-profiles/:id` — now rejects with HTTP 409 / `default_mcp_profile_in_use` if the profile is the current default.

**Frontend — store**

- Added `SessionCreationDefaults` type to `types.ts` and `backendTypes.ts`.
- Added `sessionCreationDefaults` Svelte writable store in `connectionStore.ts`.
- `initConnectionStore` fetches defaults separately (isolated `try/catch`) so a failure there does not prevent connections/configs from loading.
- Added `updateSessionCreationDefaults(input)` action.

**Frontend — New Session UI**

- Model and MCP selectors are kept; defaults are pre-selected on load via `$effect`.
- The default option is labelled `(default)` in each dropdown so it is visible.
- No structural change to the session creation flow.

**Frontend — Model Configs**

- "Set as default" button on each card; hidden for the current default.
- Current default card highlighted with accent border and `Default for new sessions` badge.

**Frontend — MCP Profiles**

- "Set as default" button on each card; becomes "Clear default" for the current default.
- Current default card highlighted with accent border and `Default for new sessions` badge.

**Tests**

- 7 new backend tests in `app.test.ts` (`session-creation-defaults API` describe block):
  - read defaults on fresh DB
  - set and clear defaults (model config + MCP profile)
  - reject unknown model config ID
  - reject unknown MCP profile ID
  - prevent deletion of in-use model config default
  - prevent deletion of in-use MCP profile default
  - allow deletion when not default
- Schema version assertion updated (4 → 5) in existing domain-model test.
- All 61 tests pass; 0 TS/Svelte errors; linters clean.

### Implementation decisions

- HTTP 422 (Unprocessable Entity) for unknown default IDs — the referenced ID is in the request body, not the URL path, so 422 is more accurate than 404.
- HTTP 409 (Conflict) for deletion of in-use defaults — consistent with the existing duplicate-session-id conflict pattern.
- Defaults fetch is isolated from the main `initConnectionStore` parallel fetch so old backends (pre-migration) don't break the UI.
- New Session panel keeps its per-session selectors — defaults provide the pre-selection only, the user can still override.

---



- data model support for session-creation defaults
- backend API to read and update those defaults
- validation around invalid or stale defaults
- UI controls to set and clear defaults
- simplifying the New Session UI to use and display those defaults

Out of scope:

- CLI commands for managing configs or defaults
- explicit model/MCP selection in the CLI
- multiple MCP profiles per session
- changing existing sessions when defaults change

## Product rules

### Defaults semantics

- defaults apply only to **future session creation**
- changing defaults must not alter existing sessions
- the default model config is required for default-based session creation to succeed
- the default MCP profile is optional
- compaction is **not** part of the defaults record in this task

### Session model

Keep the current snapshot-based session model:

- `SessionRecord.modelProfileSnapshot`
- `SessionRecord.mcpProfileSnapshot`
- `SessionRecord.compactionStrategy`

This remains the correct long-term design because sessions should preserve the resolved configuration that existed when they were created.

## Data model specification

### New defaults record

Add one backend-owned defaults record for session creation.

Preferred persistence options:

1. a dedicated `session_creation_defaults` table with one logical row
2. a general `app_settings` table if the project wants a broader settings mechanism

For this task, a dedicated record is enough.

Minimum stored fields:

- `default_model_config_id TEXT NULL`
- `default_mcp_profile_id TEXT NULL`
- `updated_at INTEGER NOT NULL`

Behavior requirements:

- only one default model config can be selected at a time
- only one default MCP profile can be selected at a time
- the default model may be `null` until configured, but default-based session creation must fail clearly in that state
- the default MCP profile may be `null`

### Validation requirements

- a default model config ID must refer to an existing model config
- a default MCP profile ID must refer to an existing MCP profile
- deleting a model config currently used as the default should be rejected until the default is changed or cleared
- deleting an MCP profile currently used as the default should be rejected until the default is changed or cleared

Recommended additional tightening while touching this area:

- a model config should reference an existing LM connection
- deleting an LM connection still referenced by a model config should be rejected or prevented

## Backend API specification

### Read defaults

Add:

- `GET /api/session-creation-defaults`

Recommended response shape:

```json
{
  "defaultModelConfigId": "model-local-qwen",
  "defaultMcpProfileId": "ha-local"
}
```

### Update defaults

Add:

- `PUT /api/session-creation-defaults`

Recommended request shape:

```json
{
  "defaultModelConfigId": "model-local-qwen",
  "defaultMcpProfileId": "ha-local"
}
```

Behavior:

- either field may be `null`
- unknown model config IDs must be rejected
- unknown MCP profile IDs must be rejected
- response should return the persisted defaults record

Recommended error cases:

- `default_model_config_not_found`
- `default_mcp_profile_not_found`

### Deletion conflict behavior

When deleting a config/profile that is currently set as a default:

- reject the deletion with a conflict error
- return a clear message explaining that it is currently used as the default for new sessions

Recommended error codes:

- `default_model_config_in_use`
- `default_mcp_profile_in_use`

## UI specification

### Goal

The UI remains the place where reusable model and MCP configuration is managed. This task adds one more responsibility there: choosing which saved configurations are the defaults for **new session creation**.

### New Session UI

Simplify the New Session UI so it no longer requires per-session model and MCP selection.

The panel should show:

- session title
- optional session ID
- compaction strategy selector
- a read-only summary of the current defaults:
  - default model config name
  - default MCP profile name, or `None`

Behavior:

- if no default model is configured, session creation should be disabled
- the UI should show a clear hint telling the user to configure a default model first
- if no default MCP profile is configured, that is valid and should be shown as `None`

### Configuration UI

Add explicit controls in the existing configuration UI to manage defaults for new sessions.

Model config requirements:

- one model config can be marked as **Default for new sessions**
- the current default should be visibly labeled
- setting one model config as default should replace the previous default

MCP profile requirements:

- one MCP profile can be marked as **Default for new sessions**
- the current default should be visibly labeled
- the default MCP profile can be cleared so that new sessions use no MCP server by default

Implementation approach can be either:

1. actions in each config card/list item such as **Set as default**
2. a dedicated defaults section that selects from saved configs

For this task, either approach is acceptable as long as:

- the default is explicit
- the current default is visible
- clearing the default MCP profile is easy
- changing defaults does not affect existing sessions

## Expected follow-up

Once this task is complete, the CLI v3 task can assume that session creation defaults already exist and focus on:

- `mcpscope create`
- `mcpscope send`
- `mcpscope status`

Future iterations can later add:

- explicit CLI model/MCP selection
- CLI discovery commands
- support for multiple MCP profiles per session
