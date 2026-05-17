# mcpscope CLI

In-repo tool for reading and inspecting sessions. Talks to the backend API only.

## Connection

```
mcpscope --url http://host:3030 <command>    # explicit
MCPSCOPE_URL=http://host:3030 mcpscope …    # env var
mcpscope …                                  # default: http://localhost:3030
```

## Commands

### `mcpscope sessions list [--json]`

Lists all sessions. Text output is a columnar table (ID, title, status, model, updated).  
`--json` → `{ api_version: 1, sessions: [...] }`.

### `mcpscope inspect <id> [--short] [--json]`

Inspects any object by hierarchical ID. Calls `GET /api/lookup/:id`.

| ID format       | Type    | Example        |
|-----------------|---------|----------------|
| `SSS`           | session | `QGWA`         |
| `SSS.S`         | setup   | `QGWA.S`       |
| `SSS.N`         | turn    | `QGWA.1`       |
| `SSS.N.N`       | round   | `QGWA.1.2`     |
| `SSS.N.N.N-X`  | part    | `QGWA.1.2.3-U` |

`--short` omits part content (token counts only). Parts always return full content regardless of `--short`.

`tool_definitions` parts always show tool names; inspect the part ID directly for full schemas.

**Text output** — parts rendered ID-first, turns separated by blank lines:

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
```

Token counts are dimmed on TTY. `user_prompt` / `assistant_answer` content is bold.  
Stripped parts: `(N tokens - stripped)`.

**JSON output** passes through the raw lookup response: `{ id, type, mode, data }`.

## Flags

| Flag          | Applies to  | Effect                              |
|---------------|-------------|-------------------------------------|
| `--json`      | all         | emit JSON instead of text           |
| `--short`     | `inspect`   | token counts only, no content       |
| `--url <url>` | all         | backend URL (overrides MCPSCOPE_URL)|

## Exit codes

| Code | Meaning          |
|------|------------------|
| 0    | success          |
| 1    | runtime error    |
| 2    | usage / bad args |
