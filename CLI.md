# mcpscope CLI

The `mcpscope` CLI is an in-repo tool for reading and inspecting sessions from the backend. It talks exclusively to the backend API — it never reads SQLite directly.

## Connection

```bash
mcpscope --url http://host:3030 <command>   # explicit URL
MCPSCOPE_URL=http://host:3030 mcpscope <command>  # env var
mcpscope <command>                          # default: http://localhost:3030
```

Priority: `--url` flag > `MCPSCOPE_URL` env var > default.

## Output flags (apply to all commands)

| Flag     | Effect                                    |
|----------|-------------------------------------------|
| `--json` | Emit clean JSON to stdout instead of text |
| `--short`| Return summary only (no part content)     |

Default: text output, full content.

Color: ANSI highlighting is applied when stdout is a TTY. Suppressed by `NO_COLOR` env var; forced by `FORCE_COLOR`.

---

## `mcpscope sessions list`

List all sessions from the backend.

```bash
mcpscope sessions list [--json] [--url <url>]
```

**Default (text):** columnar table — ID, title, status, model, last updated.

**`--json`:** `{ api_version: 1, sessions: [...] }` — full session summary objects from `GET /api/sessions`.

---

## `mcpscope inspect <id>`

Inspect any object by its hierarchical ID.

```bash
mcpscope inspect <id> [--short] [--json] [--url <url>]
```

Accepts: session ID, setup ID, turn ID, round ID, or part ID.  
Calls: `GET /api/lookup/:id?mode=summary|full` (`--short` maps to `summary`).

### ID formats (from DATA-MODEL.md)

| Type    | Format            | Example        |
|---------|-------------------|----------------|
| session | `SSS`             | `QGWA`         |
| setup   | `SSS.S`           | `QGWA.S`       |
| turn    | `SSS.N`           | `QGWA.1`       |
| round   | `SSS.N.N`         | `QGWA.1.2`     |
| part    | `SSS.N.N.N-X`     | `QGWA.1.2.3-T` |

### What each type returns

#### Session

**Default (full):**
- session metadata: id, title, model, MCP profile, context window usage, compaction strategy
- setup parts with token counts; `tool_definitions` part shows tool names (not full schemas)
- all turns flattened to their parts, with full text content for `user_prompt` and `assistant_answer`

**`--short`:**
- same metadata
- setup parts with token counts only (no content)
- turn parts with token counts only (no content)

#### Setup (`SSS.S`)

**Default (full):**
- all setup parts with token counts and full text content
- `tool_definitions`: tool names only (use direct part lookup for full schemas)

**`--short`:**
- setup parts with token counts only

#### Turn (`SSS.N`)

**Default (full):**
- all parts across all rounds, with full text content for `user_prompt` and `assistant_answer`

**`--short`:**
- all parts across all rounds, token counts only

#### Round (`SSS.N.N`)

**Default (full):**
- all parts in the round with full content and tool call/result payloads

**`--short`:**
- all parts in the round, token counts only

#### Part (`SSS.N.N.N-X`)

Always returns full content regardless of `--short`.  
`tool_definitions` parts return the complete tool schema array.

### Text output format

Parts are rendered one per line, ID-first:

```
QGWA.S.1-SP  system_prompt  (167 tokens)
QGWA.S.2-MI  mcp_instructions  (371 tokens)
QGWA.S.3-TD  tool_definitions  (4169 tokens)
  ha_history_list_entities, ha_history_get, ha_forecast_get

QGWA.1.1.1-U  user_prompt  (33 tokens)
  Hello! what is the current temp outside?

QGWA.1.1.2-A  assistant_answer  (112 tokens)
  The current outdoor temperature is 14°C.

QGWA.1.1.3-T  tool_call  ha_history_list_entities  (824 tokens)
QGWA.1.1.4-T  tool_call  ha_history_get  (310 tokens)
```

Token counts are dimmed when the terminal supports color.  
`user_prompt` and `assistant_answer` content is bold.  
Stripped context parts are annotated: `(N tokens - stripped)`.  
Turns are separated by blank lines.

### JSON output

Passes through the raw `GET /api/lookup/:id` response:

```json
{
  "id": "QGWA",
  "type": "session",
  "mode": "full",
  "data": { ... }
}
```

---

## Exit codes

| Code | Meaning           |
|------|-------------------|
| 0    | success           |
| 1    | runtime error     |
| 2    | usage / bad args  |
