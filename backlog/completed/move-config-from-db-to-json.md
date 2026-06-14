# Move configuration from SQLite to a JSON file

## Why

mcpscope stores four things in SQLite: sessions, session snapshots, configuration
(LM connections, model configs, MCP server profiles), and a singleton defaults row.
Sessions belong in SQLite — they are high-volume runtime data with relational structure.
Configuration does not. It is low-volume (typically 1–10 records per type), changes
infrequently, and benefits from being human-readable, scriptable, and version-controllable.

Moving configuration to a JSON file gives us:

- **Scriptability** — write a `mcpscope.config.json` from CI/CD, infra automation, or a
  shell script. A developer testing an MCP server can set up mcpscope with the right model
  and MCP servers by writing a config file, without ever hitting the UI.
- **Docker-friendly** — mount a config file as a volume (`-v ./config.json:/app/data/config.json`).
  No need for seed scripts or API calls after startup. Treat the file as a Docker secret
  for production use.
- **Clean separation** — back up sessions without configuration. Reset configuration
  without touching sessions. If a user messes up their config they delete the JSON file
  and start fresh.
- **Simpler dev setup** — `npm run seed:dev-config` becomes unnecessary. Developers just
  drop a config file in the data directory.

### Note on secrecy

The entire config file is treated as a personal, environment-specific artifact. API keys are
not separate from the rest of the configuration — they are mixed in because LM connections,
model configs, MCP server URLs, and auth tokens all describe one specific environment. The
file should not be committed to version control. It belongs in the per-instance data directory
next to the SQLite database, or mounted as a Docker secret. This avoids a false distinction
between "shareable config" and "secret config" — there is only one config and it is private
to the instance.

## What changes

### Config file structure

A single JSON file at a well-known path within the backend data directory
(default `backend-data/mcpscope.config.json`, overridable via `MCPSCOPE_CONFIG_PATH`
environment variable). This keeps config alongside the SQLite database, not in the
project root. The backend data directory is already gitignored.

```json
{
  "lm_connections": [
    {
      "id": "dev-lmstudio",
      "name": "Dev LM Studio",
      "baseUrl": "http://localhost:1234",
      "apiKey": "",
      "providerType": "lmstudio",
      "createdAt": 1700000000000,
      "updatedAt": 1700000000000
    }
  ],
  "model_configs": [
    {
      "id": "deepseek-v4-flash",
      "name": "DeepSeek V4 Flash",
      "connectionId": "dev-lmstudio",
      "modelKey": "deepseek-v4-flash",
      "modelDisplayName": "DeepSeek V4 Flash",
      "systemPrompt": "",
      "temperature": 0.7,
      "reasoning": "on",
      "createdAt": 1700000000000,
      "updatedAt": 1700000000000
    }
  ],
  "mcp_server_profiles": [
    {
      "id": "home-assistant",
      "name": "Home Assistant",
      "url": "http://host:8123/mcp",
      "transport": "streamable-http",
      "authType": null,
      "authValue": null,
      "defaultEnabled": true,
      "createdAt": 1700000000000,
      "updatedAt": 1700000000000
    }
  ],
  "session_creation_defaults": {
    "default_model_config_id": "deepseek-v4-flash"
  }
}
```

Arrays can be empty. `session_creation_defaults` can be `null` (no default set).
The `createdAt`/`updatedAt` fields serve as metadata; the file write time is the
authoritative timestamp.

### What stays in SQLite

- `v2_sessions`, `v2_steps`, `v2_turns`, `v2_rounds`, `v2_parts`, `v2_raw_exchanges`
- `artifacts`
- `session_containers`
- `model_profiles` and `mcp_profiles` — these are *snapshot* catalogs written at session
  creation time for historical inspectability, not editable configuration

The config tables (`lm_connections`, `model_configs`, `mcp_server_profiles`,
`session_creation_defaults`) are removed from the SQLite schema.

### Backend changes

**New module: `backend/src/config/configStore.ts`** — a singleton config store that:
- Loads the JSON file at startup, parses and validates it against Zod schemas
- Holds config in memory (`Map<string, LmStudioConnection>` etc.)
- Provides `list/upsert/delete/get` methods for each config type
- Flushes the full file on every mutation (single upsert → single file write)
  — the file is small (tens of lines), so per-operation writes are fine
- Returns API keys as-is from the list/get methods. Since the whole file is treated
  as a personal artifact, there is no benefit to masking keys in the API response
  while showing them in the file. If the user can read the file, they can see the key.

**`backend/src/persistence/repository.ts`** — the config CRUD functions delegate to
`configStore` instead of reading/writing SQLite:

| Function | Current | After |
|---|---|---|
| `listLmConnections(db)` | `SELECT record_json FROM lm_connections` | `configStore.listLmConnections()` |
| `upsertLmConnection(db, rec)` | `INSERT OR REPLACE INTO lm_connections` | `configStore.upsertLmConnection(rec)` + flush file |
| `deleteLmConnection(db, id)` | `DELETE FROM lm_connections` | `configStore.deleteLmConnection(id)` + flush file |
| `listModelConfigs(db)` | same pattern | same change |
| `upsertModelConfig(db, rec)` | same pattern | same change |
| `deleteModelConfig(db, id)` | same pattern | same change |
| `listMcpServerProfiles(db)` | same pattern | same change |
| `upsertMcpServerProfile(db, rec)` | same pattern | same change |
| `deleteMcpServerProfile(db, id)` | same pattern | same change |
| `getSessionCreationDefaults(db)` | `SELECT default_model_config_id FROM session_creation_defaults` | `configStore.getSessionCreationDefaults()` |
| `upsertSessionCreationDefaults(db, d)` | `UPDATE session_creation_defaults` | `configStore.upsertSessionCreationDefaults(d)` + flush file |

The function signatures change: they no longer need the `Database.Database` parameter
for config operations.

**`backend/src/persistence/schema.ts`** — remove `CREATE TABLE` statements for
`lm_connections`, `model_configs`, `mcp_server_profiles`, `session_creation_defaults`
from both `initializeBackendSupportSchema()` and `initializeBackendSchema()`.

**`backend/src/routes/configurationRoutes.ts`** — no structural change. The routes call
the same repository functions by name. The only change is that the `Database.Database`
parameter is no longer passed for config operations.

**`backend/src/operations/create.ts`** — config reads happen outside the session creation
transaction, since config is now in-memory and does not need DB access. The config values
are read before the transaction starts (or the `Database.Database` parameter is simply
no longer passed to config repository functions).

**`backend/src/operations/launchAnalysis.ts`** — same pattern as `create.ts`.

**`backend/src/operations/launchPrimarySession.ts`** — same pattern.

**`backend/src/dev/seedDevConfig.ts`** — instead of writing to the database, this script
generates a `mcpscope.config.json` file at `{dataDir}/mcpscope.config.json` with the seeded
values from environment variables.

### Startup flow

1. Backend starts
2. Opens SQLite database for session tables
3. Looks for `mcpscope.config.json` at the configured path
4. If found:
   - Parse as JSON — if malformed, log the parse error and the file path and exit
   - Validate each section against its Zod schema — if invalid, log which section has
     what errors and the file path and exit
   - Validate cross-references (each model config's `connectionId` points to an existing
     LM connection ID) — if broken, log which model config references a missing connection
     and exit
   - On success, load configs into memory
5. If not found: start with empty config (no connections, no model configs, no MCP profiles).
   Log a clear info message that no config file was found and the config UI will be empty.
6. Serve config through the usual API routes

### Error message examples

```
ERROR: Failed to load config from backend-data/mcpscope.config.json
       Parse error at line 14, column 5: Expected ',' or ']' after object element
```

```
ERROR: Config validation failed in section "model_configs"
       model_configs[0].connectionId: "dev-lmstudio" does not match any existing LM connection ID
       Existing LM connection IDs: [dev-lmstudio-ollama]
```

```
INFO: No config file found at backend-data/mcpscope.config.json
      Starting with empty configuration. Use the Settings UI to configure
      LM connections, model configs, and MCP server profiles.
```

### Frontend

No changes needed. The frontend talks to the API, which reads from the in-memory config
store backed by the JSON file. Editing config through the UI still works — the API
writes to the JSON file when the user saves.

### Config file in Docker

The Docker image sets `BACKEND_DATA_DIR=/data`. The config file path resolves to
`/data/mcpscope.config.json`, which is inside the mounted data volume.

| Scenario | Behavior |
|---|---|
| No config file provided | Backend starts with empty config. User configures via the Settings UI. Config persists in the data volume (`mcpscope-data`). Same as today. |
| Config file mounted externally | Mount the file at the config path. The mount overrides that specific file inside the data volume. The rest of the data volume is unaffected. |
| Full config injection | `docker run -v /host/config.json:/data/mcpscope.config.json -v mcpscope-data:/data mcpscope` |
| Config via env override | `docker run -e MCPSCOPE_CONFIG_PATH=/custom/path/config.json -v /host/config.json:/custom/path/config.json -v mcpscope-data:/data mcpscope` |
| Config as Docker secret | `docker run --secret mcpscope-config,target=/data/mcpscope.config.json mcpscope` |

### Config file in local dev

| Scenario | Behavior |
|---|---|
| `npm run dev` (no config) | Backend starts, logs info that no config was found. Config UI shows empty lists. |
| `npm run seed:dev-data` | Generates `backend-data/mcpscope.config.json` from `.env.dev` variables. Config is loaded on next backend restart. |
| Manual config | Drop a `mcpscope.config.json` in `backend-data/` (or set `MCPSCOPE_CONFIG_PATH`). Config is loaded on startup. |
| Edit via UI | Changes are written back to the JSON file on the filesystem. |

## What this does not change

- The API surface (`GET /api/model-configs`, `PUT /api/model-configs/:id`, etc.)
- The frontend UI for configuration
- How session creation resolves model configs and MCP profiles
- How snapshots are persisted at session creation time (`model_profiles`, `mcp_profiles`)
- The session data model or runtime behavior

## Documentation updates

| Document | Change |
|---|---|
| `DATABASE-SCHEMA.md` | Remove config tables (`lm_connections`, `model_configs`, `mcp_server_profiles`, `session_creation_defaults`) from the schema ER diagram and table descriptions. Keep the snapshot tables (`model_profiles`, `mcp_profiles`) — they stay. |
| `backend-data/README.md` | Document that `mcpscope.config.json` lives alongside `mcpscope.db` in the data directory, and that it is the configuration file for LM connections, model configs, and MCP profiles. |
| `TUTORIAL.md` | No changes needed — the tutorial uses `npm run seed:dev-data` which will continue to work. If the tutorial documents manual config, update to reference the JSON file path. |
| `CLI.md` | No changes needed — the CLI talks to the API, the API serves from the config store. |
| `MCP.md` | No changes needed — same reasoning. |
| `docker-compose.yml` | No structural change — the data volume covers both SQLite and the config file. Add a commented-out example of mounting a config file for discoverability. |
| `Dockerfile` | No change needed — `BACKEND_DATA_DIR=/data` already controls where the config file lives. |

## Testing

### Unit tests for `configStore.ts`

| Test | What it covers |
|---|---|
| Parse valid config file | Load a well-formed config file; verify all four sections are parsed correctly |
| Parse malformed JSON | File with syntax error → configStore throws with file path and parse error details |
| Validate schema violations | File with wrong field types (e.g. `temperature: "hot"`) → configStore throws with section name and field-level errors |
| Validate missing sections | File missing `lm_connections` or `model_configs` → validated against Zod defaults or accepted as empty array |
| Validate cross-references | Model config references a non-existent `connectionId` → configStore throws with the broken model config ID and the set of valid connection IDs |
| CRUD operations | `list/upsert/delete` for each config type round-trips correctly through the in-memory store |
| Uniqueness enforcement | Upserting a model config with a duplicate ID replaces the existing record; ID collision across different types is allowed |
| File flush after mutation | After upsert, read the file back from disk and verify it contains the updated record |
| Empty config | Load from non-existent path → configStore initializes with empty in-memory state (no error thrown) |

Tests should use a temporary directory to avoid touching the real `backend-data/`.

### Updated route tests

The existing configuration route tests in `app.test.ts` exercise `GET /api/model-configs`,
`PUT /api/model-configs/:id`, `DELETE /api/model-configs/:id`, and the equivalent for
MCP profiles and LM connections. These tests currently rely on seeded DB data before each
test block. They need to be updated to:

1. Initialize the config store from a temp JSON file (or start empty)
2. Use the API to populate and query config (same as today — the API surface doesn't change)

The test structure stays the same; only the setup path changes.

### Startup integration tests

| Test | What it covers |
|---|---|
| Startup with valid config | Backend starts, config is served through the API |
| Startup with missing config | Backend starts, config endpoints return empty lists |
| Startup with broken config | Backend fails to start with a clear error message pointing to the file and the specific problem |

These require the backend to be started as a subprocess or the startup logic to be
injectable. If a subprocess approach is too heavy, cover the configStore validation
path separately in unit tests and leave the full startup test as a manual check.

## Migration

This is a breaking change for anyone who has stored config in their SQLite database.
There is no automatic migration script — the old SQLite tables are simply no longer
created or read. Users export their existing config through the API or manually
recreate it in the JSON file.

For the mcpscope development workflow, `seedDevConfig.ts` is updated to generate a
config file instead of writing to SQLite, so `npm run seed:dev-data` continues to work.

The config file path (`backend-data/mcpscope.config.json`) is already covered by the
root `.gitignore` (`backend-data/*` ignores everything in that directory except the
README and test-artifacts) — it will not be accidentally committed.

## Files to change

| File | Change |
|---|---|
| `backend/src/config/configStore.ts` | **New** — singleton config store that loads from JSON file, validates, and serves in-memory |
| `backend/src/persistence/schema.ts` | Remove config table creation from `initializeBackendSupportSchema()` and `initializeBackendSchema()` |
| `backend/src/persistence/repository.ts` | Delegate config CRUD to `configStore` instead of SQLite; drop `Database.Database` param from config functions |
| `backend/src/operations/create.ts` | Drop `Database.Database` param from config function calls |
| `backend/src/operations/launchAnalysis.ts` | Drop `Database.Database` param from config function calls |
| `backend/src/operations/launchPrimarySession.ts` | Drop `Database.Database` param from config function calls |
| `backend/src/routes/configurationRoutes.ts` | Drop `Database.Database` param from config function calls |
| `backend/src/dev/seedDevConfig.ts` | Generate `mcpscope.config.json` in data directory instead of writing to SQLite |
| `backend/src/app.ts` | Initialize `configStore` at startup (load file, validate) |
| `DATABASE-SCHEMA.md` | Remove config tables from schema docs |
| `backend-data/README.md` | Document config file path alongside `mcpscope.db` |

## Status

### ✅ Completed

| File | What changed |
|---|---|
| `backend/src/config/configStore.ts` | **New** — `ConfigStore` class with file load, Zod validation, cross-reference checks, in-memory Maps, file flush on mutation, `ConfigFileError`, `initializeConfigStore()`/`getConfigStore()` module-level helpers, and 12 standalone wrapper functions re-exported by `repository.ts` |
| `backend/src/persistence/repository.ts` | Deleted `upsertJsonRecord`/`listJsonRecords`/`deleteJsonRecord` helpers (150 lines). Replaced all 12 config CRUD functions with re-exports from `configStore.ts`. Removed `import type Database`. |
| `backend/src/persistence/schema.ts` | Removed `lm_connections`, `model_configs`, `mcp_server_profiles`, `session_creation_defaults` table creation + singleton insert from both `initializeBackendSchema()` and `initializeBackendSupportSchema()`. |
| `backend/src/app.ts` | Added config store init block: compute path (default `{dataDir}/mcpscope.config.json` or `MCPSCOPE_CONFIG_PATH`), check existence and log info message, call `initializeConfigStore()`, catch `ConfigFileError` as fatal. |
| `backend/src/routes/configurationRoutes.ts` | Dropped `database` from destructured RouteDeps (only `app` needed now). Removed 12 `database.connection` arguments from config function calls. |
| `backend/src/operations/create.ts` | Removed 4 `db.connection` arguments from config function calls inside the transaction. |
| `backend/src/operations/launchAnalysis.ts` | Removed 3 `db.connection` arguments from config function calls. |
| `backend/src/operations/launchPrimarySession.ts` | Removed 4 `db.connection` arguments from config function calls. |
| `backend/src/dev/seedDevConfig.ts` | Rewritten: no longer opens a database connection. Writes `mcpscope.config.json` directly via `fs.writeFileSync`. Uses `MCPSCOPE_CONFIG_PATH` env override. |
| `backend/src/sessionMetadata.test.ts` | Removed assertion that `session_creation_defaults` table exists in schema (no longer created). |
| `backend/src/app.test.ts` | Removed `session_creation_defaults` from expected table list in domain-model endpoint test. |

### ❌ Remaining

| Area | Details |
|---|---|
| Unit tests for `configStore.ts` | 9 test cases from the spec: parse valid, malformed JSON, schema violations, missing sections, cross-references, CRUD round-trip, uniqueness, file flush after mutation, empty config. |
| Update route tests in `app.test.ts` | Existing config route tests use seeded DB data before each block. They need to initialize the config store from a temp JSON file (or start empty) before exercising the API. The test structure stays the same; only the setup path changes. |
| Startup integration tests | Test backend starts with valid config, missing config, broken config. If subprocess approach is too heavy, covered by the unit tests. |
| `DATABASE-SCHEMA.md` | Remove config tables (`lm_connections`, `model_configs`, `mcp_server_profiles`, `session_creation_defaults`) from ER diagram and table descriptions. Keep `model_profiles` and `mcp_profiles` snapshot tables. |
| `backend-data/README.md` | Document that `mcpscope.config.json` lives alongside `mcpscope.db` as the configuration file. |
| `docker-compose.yml` | Add commented-out example of mounting a custom config file for discoverability. |
