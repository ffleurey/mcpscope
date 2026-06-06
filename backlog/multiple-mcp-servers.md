# Implement support for multiple MCP servers in one session

> Example public MCP server for testing: https://open-meteo.caseyjhand.com/mcp — Meteo and Forecast service

## Goal

Replace the current single-MCP-server-per-session model with multi-server support. All registered MCP servers should be shown with a toggle in the session creation UI, and multiple can be enabled simultaneously.

**Status: IMPLEMENTED — PR #27**

## Design Decisions

### 1. Domain model: `McpProfileSnapshot` → `McpProfileSnapshot[]`
- `SessionRecord.mcpProfileSnapshot: McpProfileSnapshot | null` becomes `mcpProfileSnapshots: McpProfileSnapshot[]`
- Empty array = no MCP (replaces `null`)
- `SessionRecord` always has an array; no more nullable

### 2. Per-server default-enabled toggle
- `McpServerProfile` config record gains `defaultEnabled: boolean`
- The `session_creation_defaults.default_mcp_profile_id` is removed
- When creating a session via `from-defaults` (CLI/MCP path) or when no explicit `mcp_profile_ids` are given, all profiles with `defaultEnabled = true` are used
- This replaces the single-default model with a per-server on/off toggle

### 3. MCP runtime: parallel initialization, merged tool list
- `ensureMcpContext` initializes all selected servers, merges all tools into one combined list
- A `Map<toolName, serverUrl>` is built at init time for routing tool calls to the correct server
- On name collision (same tool name from two servers), the first server wins and a warning is logged

### 4. Setup parts
- Single combined `mcp-instructions` setup part (instructions concatenated per-server)
- Single combined `tool-definitions` setup part (all tools merged)
- Raw exchanges per-server (init + listTools for each)

### 5. Tool execution routing
- `createToolEnabledTurn` uses the tool→server map to route each `mcpGateway.callTool()` to the right URL
- `runDeterministicMcpToolCall` builds the same map if not already available (from `session.mcpProfileSnapshots`), no interface change needed

### 6. Frontend UI
- MCP server `<select>` dropdown replaced with a list of checkboxes/toggles
- Each profile shows a toggle; the `defaultEnabled` field drives initial checked state
- Session creation collects `mcp_profile_ids: string[]` (empty = no MCP)

### 7. Backend operation contracts
- `POST /api/session-constructors/primary`: `mcp_profile_id: string | null` → `mcp_profile_ids: string[]`
- `POST /api/sessions` (explicit): `mcpProfileSnapshot: Snapshot | null` → `mcpProfileSnapshots: Snapshot[]`
- `POST /api/sessions/from-defaults` (CLI/MCP): unchanged — always uses `defaultEnabled` profiles

### 8. Preflight
- `/api/sessions/preflight`: iterate over all selected MCP URLs, test each

### 9. CLI
- `mcpscope create` continues to use `defaultEnabled` profiles — no CLI flags change needed

### 10. Session summary
- `mcp_profile_snapshot: { name: string } | null` → `mcp_profile_snapshots: { name: string }[]`
- Multiple names listed in the summary

## Implementation Steps

### Step 1: Domain model — `McpServerProfile.defaultEnabled`
**Files:**
- `backend/src/domain/configuration.ts` — add `defaultEnabled: z.boolean().default(false)` to `mcpServerProfileSchema`
- `frontend/src/lib/types.ts` — add `defaultEnabled: boolean` to `McpServerProfile`
- `frontend/src/lib/backendTypes.ts` — add `defaultEnabled: z.boolean()` to `mcpServerProfileSchema`

**Acceptance:** `McpServerProfile` type has `defaultEnabled` field. Existing profiles deserialize without it (default `false`).

**Gate:** `npm run check:backend`

---

### Step 2: Domain model — `SessionRecord.mcpProfileSnapshots` array
**Files:**
- `backend/src/domain/model.ts`
  - `sessionRecordSchema`: `mcpProfileSnapshot: mcpProfileSnapshotSchema.nullable()` → `mcpProfileSnapshots: z.array(mcpProfileSnapshotSchema).default([])`
  - `sessionSummarySchema`: `mcp_profile_snapshot: z.object({ name: z.string() }).nullable()` → `mcp_profile_snapshots: z.array(z.object({ name: z.string() })).default([])`
- `backend/src/domain/apiSchemas.ts`
  - `mcpProfileSnapshotInputSchema` stays unchanged (shape of one snapshot)
  - `createExplicitInputSchema`: `mcpProfileSnapshot: mcpProfileSnapshotInputSchema.nullable().optional()` → `mcpProfileSnapshots: z.array(mcpProfileSnapshotInputSchema).default([])`
- `frontend/src/lib/backendTypes.ts`
  - `sessionRecordSchema`: same change: `mcpProfileSnapshots: z.array(mcpProfileSnapshotSchema).default([])`
  - `sessionSummarySchema`: `mcp_profile_snapshots: z.array(z.object({ name: z.string() })).default([])`

**Acceptance:** `SessionRecord` always has `mcpProfileSnapshots: McpProfileSnapshot[]`. Empty array = no MCP.

**Gate:** `npm run check:backend` + `npm run check`

---

### Step 3: Persistence — schema changes
**Files:**
- `backend/src/persistence/schema.ts`
  - Remove `default_mcp_profile_id` column from `session_creation_defaults` (additive migration: `ALTER TABLE session_creation_defaults DROP COLUMN default_mcp_profile_id` — drop only, keep model_config_id)
  - Add additive migration for `default_enabled` on `mcp_server_profiles`? Since profiles are stored as JSON blobs, no schema change needed — just update the record schema
- `backend/src/persistence/repository.ts`
  - `SessionCreationDefaults`: remove `defaultMcpProfileId`
  - `getSessionCreationDefaults`: remove `default_mcp_profile_id` from SQL
  - `upsertSessionCreationDefaults`: remove `defaultMcpProfileId` param
  - `listMcpServerProfiles`: no change (JSON column carries `defaultEnabled`)
  - `upsertMcpServerProfile`: no change (JSON column)
- `backend/src/persistence/repositoryRuntime.ts`
  - `V2SessionParams`: `mcpProfileSnapshot: McpProfileSnapshot | null` → `mcpProfileSnapshots: McpProfileSnapshot[]`
  - `buildSessionParams`: serialize array
  - `mapV2SessionRow`: deserialize array
  - `createSessionRecord` / `mcp_profiles` insert: iterate array, insert each profile

**Acceptance:** Sessions serialize/deserialize correctly with empty and non-empty snapshots arrays.

**Gate:** `npm test` (existing runtime tests pass with updated schema types)

---

### Step 4: Session creation operations
**Files:**
- `backend/src/operations/launchPrimarySession.ts`
  - Input: `mcp_profile_id: z.string().nullable().optional()` → `mcp_profile_ids: z.array(z.string()).optional()`
  - Execution: iterate `mcp_profile_ids`, resolve each from DB, build `McpProfileSnapshot[]`
  - If `mcp_profile_ids` is omitted, use all profiles where `defaultEnabled = true`
- `backend/src/operations/create.ts` (CLI/MCP path)
  - Remove `defaultMcpProfileId` fallback; instead collect all profiles with `defaultEnabled = true`
- `backend/src/operations/createExplicit.ts`
  - Input: `mcpProfileSnapshot` → `mcpProfileSnapshots`
  - Pass to `createSession`
- `backend/src/runtime/modelTurns.ts`
  - `CreateSessionInput`: `mcpProfileSnapshot` → `mcpProfileSnapshots: McpProfileSnapshot[]`
  - `createSession`: store array

**Files (routes):**
- `backend/src/routes/sessionRoutes.ts`
  - `buildSessionSummaryPayload`: serialize array instead of nullable single
- `backend/src/routes/configurationRoutes.ts`
  - Delete MCP profile guard: remove `defaultMcpProfileId` check (no longer exists)

**Acceptance:** A session can be created with 0, 1, or multiple MCP profiles via the API.

**Gate:** `npm test`

---

### Step 5: MCP runtime — multi-server context initialization
**Files:**
- `backend/src/runtime/toolTurns.ts`
  - `ensureMcpContext`: iterate `session.mcpProfileSnapshots`, initialize each, merge tools, build `Map<toolName, serverUrl>`, return merged context
  - `McpContext` return type: add `toolServerMap: Map<string, string>` and `serverContexts: Map<string, { sessionId: string | null, instructions: string | null }>`
  - Setup parts: combine `mcp-instructions` from all servers; combine `tool-definitions` from all servers
  - `createToolEnabledTurn`: use merged tool list for LLM; on tool execution, look up server URL from `toolServerMap`
  - `runDeterministicMcpToolCall`: build toolServerMap from `session.mcpProfileSnapshots` if not provided

**Acceptance:** A session with multiple MCP profiles can execute tool-enabled turns, routing each tool call to the correct server.

**Gate:** `npm test` (update replay tests if needed)

---

### Step 6: Preflight endpoint
**Files:**
- `backend/src/routes/configurationRoutes.ts`
  - `/api/sessions/preflight`: `mcpProfileSnapshot: { url: string } | null` → `mcpProfileSnapshots: { url: string }[]`
  - Loop over all snapshots, test each URL

**Files (frontend):**
- `frontend/src/lib/api/backendClient.ts`
  - `preflightSession`: `mcpProfileSnapshot` → `mcpProfileSnapshots: { url: string }[]`
- `frontend/src/lib/sessionStore.ts`
  - `startSession`: build array of snapshots

**Acceptance:** Preflight tests connectivity to all selected MCP servers.

**Gate:** `npm run check:backend`

---

### Step 7: Frontend UI — multi-select MCP servers
**Files:**
- `frontend/src/lib/components/PrimarySessionLaunchModal.svelte`
  - Replace `<select>` with a checkbox list:
    ```
    {#each $mcpProfiles as profile (profile.id)}
      <label>
        <input type="checkbox" bind:group={selectedMcpProfileIds} value={profile.id} />
        {profile.name}
        {profile.defaultEnabled ? '(default)' : ''}
      </label>
    {/each}
    ```
  - `selectedMcpProfileId: string` → `selectedMcpProfileIds: string[]`
  - Initialize from `defaultEnabled` profiles
  - `handleStart`: pass `mcpProfileIds` array
- `frontend/src/lib/sessionStore.ts`
  - `startSession` input: `mcpProfileId?: string | null` → `mcpProfileIds?: string[]`
  - Resolve each ID to a snapshot
  - Call `createPrimarySession` with `mcp_profile_ids`
- `frontend/src/lib/api/backendClient.ts`
  - `createPrimarySession`: `mcp_profile_id` → `mcp_profile_ids`
- `frontend/src/lib/sessionStore.test.ts`
  - Update test fixtures and assertions

**Acceptance:** User can toggle multiple MCP servers on/off in the session launch dialog. Session is created with the selected servers.

**Gate:** `npm run check` + `npm test`

---

### Step 8: Session summary (frontend)
**Files:**
- `frontend/src/lib/sessionStore.ts`
  - `toSessionSummary` / `upsertSessionSummary`: `mcpProfileSnapshot` → `mcpProfileSnapshots`
  - Build `mcp_profile_snapshots: array of { name }`
- Any component rendering MCP info in session list (search for `mcp_profile_snapshot` in frontend)

**Acceptance:** Session list shows all MCP server names.

**Gate:** `npm run check`

---

### Step 9: Backend config routes — default-enabled management
**Files:**
- `backend/src/routes/configurationRoutes.ts`
  - Remove `defaultMcpProfileId` from defaults routes
  - Update MCP profile delete guard: no longer references defaults
- `backend/src/dev/seedDevConfig.ts`
  - Update seed to include `defaultEnabled: true` on dev MCP profile
  - Remove `defaultMcpProfileId` from defaults seeding

**Acceptance:** Default MCP behavior is driven by `defaultEnabled` on each profile, not by a single default ID.

**Gate:** `npm test`

---

### Step 10: CLI — remove `defaultMcpProfileId` usage
**Files:**
- `cli/src/commands/create.ts` — no change needed (already relies on backend)
- `cli/src/types.ts` — no change needed

The CLI delegates to `POST /api/sessions/from-defaults` which backend now resolves from `defaultEnabled` profiles. No CLI changes.

**Acceptance:** `mcpscope create` uses all `defaultEnabled` profiles.

**Gate:** `npm run check:cli`

---

### Step 11: Tests
**Files:**
- `backend/src/runtime/toolTurns.test.ts` — update tests for multi-server `ensureMcpContext`
- `backend/src/operations/launchPrimarySession.test.ts` — update for `mcp_profile_ids`
- `backend/src/app.test.ts` — update MCP-related integration tests
- `backend/src/testing/replayHarness.ts` — update MCP gateway mock for multi-server
- `frontend/src/lib/sessionStore.test.ts` — update for array APIs

**Acceptance:** All tests pass with the new multi-server model.

**Gate:** `npm test` + `npm run check`

---

### Step 12: Quick smoke test
- Run `npm run dev`
- Open frontend at `localhost:5173`
- Configure two MCP server profiles (e.g., the real meteo server + a local test server)
- Toggle both on in session creation
- Send a message that triggers tools
- Verify both servers' tools are available and execute correctly
