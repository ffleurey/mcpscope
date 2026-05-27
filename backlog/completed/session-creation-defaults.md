# Session creation defaults

This task added backend-owned defaults used only for **new session creation**.

It was completed on branch **`session-creation-defaults`** and serves as a prerequisite for the active CLI lifecycle work.

## Delivered

### Backend

- added persistent session-creation defaults storage via a singleton `session_creation_defaults` table
- added `GET /api/session-creation-defaults`
- added `PUT /api/session-creation-defaults`
- validated unknown default IDs with:
  - `default_model_config_not_found`
  - `default_mcp_profile_not_found`
- blocked deletion of records currently used as defaults with:
  - `default_model_config_in_use`
  - `default_mcp_profile_in_use`
- blocked deletion of an LM connection that is still referenced by one or more model configs with:
  - `lm_connection_in_use`

### Frontend

- added session-creation defaults state to the connection store
- added store-level helpers for updating:
  - default model config
  - default MCP profile
- added UI actions to set the default model config
- added UI actions to set or clear the default MCP profile
- kept per-session model and MCP selection in the New Session panel
- applied defaults as the **initial selection** for the New Session form
- labeled default options clearly in the selectors

### Behavior

- defaults apply only to **future** session creation
- changing defaults does **not** alter existing sessions
- existing sessions remain snapshot-based
- model/MCP defaults influence initial UI selection and backend default-based creation flows only

## Important implementation decisions

- **422** is used for unknown default IDs because the invalid reference is in the request body
- **409** is used for deletion conflicts and in-use defaults
- the New Session panel keeps manual override capability; defaults only supply the initial selection
- New Session selection now initializes from defaults and is not continuously forced back to them after the user changes it

## Validation

- backend tests updated to cover defaults read/update/conflict behavior
- regression test added for LM connection deletion while still referenced by model configs
- project checks and test suite passed after the follow-up cleanup

## Follow-up

The next active task can assume session-creation defaults already exist and focus on:

- `mcpscope create`
- `mcpscope send`
- `mcpscope status`

Future iterations may still add:

- explicit CLI model/MCP selection
- CLI discovery commands
- support for multiple MCP profiles per session
