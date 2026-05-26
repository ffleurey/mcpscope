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
| `mcpscope_inspect`    | `mcpscope inspect`         | Inspect any object by hierarchical ID |

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
| `id`   | string  | ✓        | Hierarchical ID (e.g. `ABCD`, `ABCD.1`, `ABCD.1.2`, `ABCD.1.2.3-U`) |
| `short`| boolean |          | Token counts only, no part content |

## Tool results

All tools return structured results. Each tool registers an `outputSchema` (Zod shape) and returns:

- `structuredContent` — the full result object for clients that support structured output
- `content` — the same result as JSON text (fallback for clients that do not support `outputSchema`)

Error results set `isError: true` and include `{ error: { message, code? } }`.

Result field naming is snake_case throughout (same shapes as CLI `--json` mode). See [CLI.md](CLI.md) for exact result shapes and error codes per operation.

## Backend-owned operation catalog

The tool descriptions, input schemas, output schemas, and execution functions come from `backend/src/operations/`. MCP operations execute directly in the backend process — no loopback HTTP.

There is no separate shared package. The backend operation catalog is the single source of truth for both the CLI result types and the MCP tool surface.

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

## Future analysis-specific MCP work

`MCP.md` documents the **currently shipped** MCP interface only.

Future analysis-specific prompt guidance and the restricted analysis MCP tool subset are tracked with the session-analysis backlog increments:

- `backlog/session-analysis-agent.md`
- `backlog/session-analysis-launch-and-report.md`
