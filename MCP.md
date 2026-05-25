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

Five tools mirror the shipped CLI surface exactly. Tool names are generated mechanically from the shared operation catalog using the `mcpscope_` prefix.

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

All tools return their result as JSON text content — the same machine-readable shapes as CLI `--json` mode. Error results set `isError: true` and include `{ error: { message, code? } }`.

See [CLI.md](CLI.md) for the exact result shapes and error codes per operation.

## Shared operation catalog

The tool descriptions and input schemas come from `shared/src/operations/`. CLI and MCP share the same source — no separate documentation or separate validation logic.

To verify parity: `npm test` — the parity test suite in `shared/src/operations/parity.test.ts` and `backend/src/mcp/mcp.test.ts` enforces:

- same operation IDs
- same schemas (no adapter-only flags)
- canonical snake\_case field naming
- same result shapes

## Configuration

The MCP interface is hosted on the same port as the backend API (`BACKEND_PORT`, default 3030). No separate process or port is needed. The MCP tools call the backend HTTP API via loopback.

Example connection string for an MCP client:

```
http://localhost:3030/mcp
```

Inside Docker:

```
http://localhost:3030/mcp
```
