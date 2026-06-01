# mcpscope MCP interface

mcpscope exposes an MCP tool surface via Streamable HTTP on the same Fastify server as the backend API.

## Transport

**Streamable HTTP** only. No stdio transport in this version.

| Method   | Path  | Purpose                                    |
|----------|-------|--------------------------------------------|
| `POST`   | `/mcp` | JSON-RPC tool calls (initialize, tools/call, etc.) |
| `GET`    | `/mcp` | SSE stream for server-initiated messages   |
| `DELETE` | `/mcp` | Session termination (stateless: no-op)     |

The transport operates in **stateless mode** — no server-side session is maintained between requests.

## Tool surface

Five tools mirror the shipped CLI surface exactly. Tool names are generated mechanically from the backend-owned operation catalog using the `mcpscope_` prefix.

| MCP tool name         | CLI command                | Description |
|-----------------------|----------------------------|-------------|
| `mcpscope_list`       | `mcpscope list`            | List all sessions |
| `mcpscope_create`     | `mcpscope create`          | Create a session from defaults |
| `mcpscope_send`       | `mcpscope send`            | Start a user turn |
| `mcpscope_status`     | `mcpscope status`          | Get session lifecycle state |
| `mcpscope_inspect`    | `mcpscope inspect`         | Inspect any object by hierarchical ID; use parent objects to map IDs, then inspect parts directly for detailed evidence |

## Tool inputs

Inputs use the same canonical field names as CLI commands (adapter-only flags like `--json`, `--url`, `--help` are not part of the shared schema).

### `mcpscope_list`

No inputs.

### `mcpscope_create`

| Field        | Type                              | Required | Description |
|--------------|-----------------------------------|----------|-------------|
| `title`      | string                            | ✓        | Session title |
| `id`         | string                            |          | Optional 4-char session ID |
| `compaction` | `"none"` \| `"strip-reasoning"`   |          | Compaction strategy |

### `mcpscope_send`

| Field        | Type   | Required | Description |
|--------------|--------|----------|-------------|
| `session_id` | string | ✓        | Target session ID |
| `prompt`     | string | ✓        | User prompt text |

### `mcpscope_status`

| Field        | Type   | Required | Description |
|--------------|--------|----------|-------------|
| `session_id` | string | ✓        | Session ID to check |

### `mcpscope_inspect`

| Field  | Type    | Required | Description |
|--------|---------|----------|-------------|
| `id`   | string  | ✓        | Hierarchical ID (e.g. `ABCD`, `ABCD.1`, `ABCD.1.2`, `ABCD.1.2.3-U`). Inspecting a session, setup, turn, or round is useful for finding child IDs; inspect the returned part IDs directly for full evidence such as tool payloads, tool results, and part content. |
| `short`| boolean |          | Token counts only, no part content |

## Tool results

All tools return structured results. Each tool registers an `outputSchema` (Zod shape) and returns:

- `structuredContent` — the full result object for clients that support structured output
- `content` — the same result as JSON text (fallback for clients that do not support `outputSchema`)

Error results set `isError: true` and include `{ error: { message, code? } }`.

Result field naming is snake_case throughout (same shapes as CLI `--json` mode). See [CLI.md](CLI.md) for exact result shapes and error codes per operation.

## Backend-owned operation catalog

The tool descriptions, input schemas, output schemas, and execution functions come from the shared backend operation catalog in `backend/src/operations/catalog.ts` and `backend/src/operations/index.ts`. MCP operations execute directly in the backend process — no loopback HTTP.

There is no separate shared package. The backend operation catalog is the single source of truth for both the CLI result types and the MCP tool surface. Backend-only HTTP operations may live nearby in `backend/src/operations/`, but they are not exposed to MCP unless added to the shared catalog.

To verify parity: `npm test` — the parity test suite in `backend/src/mcp/mcp.test.ts` enforces:

- same operation IDs and descriptions
- same input schemas (no adapter-only flags)
- canonical snake\_case field naming in all result shapes
- outputSchema defined for every operation

## Configuration

The MCP interface is hosted on the same port as the backend API (`BACKEND_PORT`, default 3030). No separate process or port is needed.

Example connection string for an MCP client:

```
http://localhost:3030/mcp
```

Inside Docker:

```
http://localhost:3030/mcp
```

## Internal analysis MCP endpoint

mcpscope also exposes an internal restricted MCP endpoint for analysis sessions:

```
http://localhost:3030/mcp/analysis
```

This endpoint is backend-owned and used by `session_analysis` sessions.

Its tool surface is intentionally restricted to:

- `mcpscope_inspect`
- `mcpscope_status`

It is not the general public MCP surface for normal agent use. Its purpose is to let the analysis
workflow inspect persisted mcpscope evidence without exposing broader session-management tools.

See `SESSION-ANALYSIS.md` for how this restricted endpoint is used in the shipped analysis
workflow.
