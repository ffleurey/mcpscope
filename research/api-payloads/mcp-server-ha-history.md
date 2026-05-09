# MCP Server: ha-history-oslo — Protocol Research

**Server:** `http://localhost:3001/mcp`  
**Server name:** `ha-history-oslo` v0.1.0  
**Date:** 2026-05-09  
**Protocol version:** 2025-06-18 (Streamable HTTP transport)

---

## 1. Endpoint Discovery

- MCP endpoint: `POST/GET http://localhost:3001/mcp`
- Root (`/`) returns 404 — do NOT POST to root
- All other paths return 404

---

## 2. Initialize Handshake

### Request
```
POST /mcp
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2025-06-18

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": { "name": "ai-clientapp", "version": "0.1.0" }
  }
}
```

### Response headers (key ones)
```
HTTP/1.1 200 OK
content-type: text/event-stream          ← SSE, even for simple responses
mcp-session-id: a804a2ba-b9c8-44cd-9cec-23eb76f71d35   ← capture this!
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: mcp-session-id            ← required for CORS
```

### Response body (SSE format)
```
event: message
data: {"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"ha-history-oslo","version":"0.1.0"},"instructions":"..."},"jsonrpc":"2.0","id":1}
```

**Key observations:**
- **All responses are SSE** (`text/event-stream`), not `application/json` — even simple ones
- Session ID comes in the HTTP **response header** `mcp-session-id` — must be captured from headers, not body
- `capabilities.tools: {}` — tools supported, no `listChanged` sub-capability
- `instructions` field in initialize result — server-provided system prompt guidance (should be appended to or shown alongside system prompt)

### Initialized notification
```
POST /mcp
mcp-session-id: <session-id>

{"jsonrpc":"2.0","method":"notifications/initialized"}

→ HTTP 202 (no body)
```

---

## 3. Session Management

**⚠️ Deviation from spec:** The spec says expired/unknown sessions return HTTP 404. This server returns HTTP 400:
```json
{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request: Server not initialized"},"id":null}
```

**Client must handle both 400 and 404 as "session lost — re-initialize".**

All requests after init must include:
```
mcp-session-id: <session-id>
MCP-Protocol-Version: 2025-06-18
Accept: application/json, text/event-stream
```

---

## 4. Tools/List

### Request
```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

### Response (SSE)
```
event: message
data: {"result":{"tools":[...]},"jsonrpc":"2.0","id":2}
```

### Available tools (5 total)

| Tool | Purpose |
|---|---|
| `ha_history_get_current_time` | Returns current Oslo date/time — call before any relative time query |
| `ha_history_list_entities` | Lists sensors with history data; resolves entity_ids |
| `ha_history_get_sensor_stats` | Stats for instantaneous sensors (temp, humidity, power W) |
| `ha_history_get_consumption` | Energy/resource consumption over period (kWh, etc.) |
| `ha_history_detect_sessions` | Detect discrete events/activity sessions |

No pagination (fewer than cursor threshold). All tools returned in one call.

---

## 5. Tools/Call

### Request
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "ha_history_get_current_time",
    "arguments": {}
  }
}
```

### Success response (SSE)
```
event: message
data: {"result":{"content":[{"type":"text","text":"Current time:  2026-05-09T12:30:39+02:00\nDate: Saturday 9 May 2026\n..."}]},"jsonrpc":"2.0","id":3}
```

### "Soft" error response (tool ran but found nothing)
```
event: message
data: {"result":{"content":[{"type":"text","text":"Entity \"sensor.nonexistent\" not found..."}]},"jsonrpc":"2.0","id":4}
```
Note: **`isError` field is NOT present** for soft errors on this server — it returns a friendly error message in `content` without `isError: true`. Clients should not rely on `isError` being set for all error cases.

### Content types observed
- `text` only (so far). No `image`, `resource_link`, or `structuredContent` observed.

---

## 6. Converting MCP Tools → OpenAI `tools[]` Format

For LM Studio, the `tools/list` result maps to:
```json
{
  "type": "function",
  "function": {
    "name": "<tool.name>",
    "description": "<tool.description>",
    "parameters": <tool.inputSchema>
  }
}
```

MCP `inputSchema` is already JSON Schema — used directly as `parameters`.

---

## 7. Converting MCP Tool Results → OpenAI `role: "tool"` Messages

After calling a tool, add to messages[]:
```json
{
  "role": "tool",
  "tool_call_id": "<id from assistant's tool_calls[i].id>",
  "content": "<tool result content as string>"
}
```

For multi-content results: join text items with `\n`. For non-text items: represent as `[image: mimeType]` or similar placeholder.

---

## 8. Server Instructions Field

The initialize response includes:
```
"instructions": "You are a data analyst for Oslo home automation data.\n\n## Responding\n..."
```

This is the server's guidance for how the model should use its tools. Options:
1. **Append to system prompt** (most effective for model behavior)
2. **Show in UI** as "MCP server instructions" 
3. **Both** — store it, append to LM request, show in info panel

Recommendation: append to system prompt as a second block, clearly labeled. Store in `mcpSnapshot.instructions`.

---

## 9. CORS

Server sets:
```
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: mcp-session-id
```

Browser can read the `mcp-session-id` header without issues. ✅

