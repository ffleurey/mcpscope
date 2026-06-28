# inspect example — part: diagnostic

- **Source object:** `N8GF.1T.21.1-DN` — the failure marker in error session `N8GF`.
- **Captured from:** completed run `R-RZNP`, 2026-06-27.
- **Rendering:** CLI text renderer. (Like all parts, `--short` is ignored — always full.)

A `diagnostic` part is emitted when a turn cannot complete normally. It is the
canonical, human-readable explanation of *why a primary session failed* — here, the
model spiralled into repeated tool calls and hit the round cap. Note `context_state:
excluded` (it is not fed back to the model) and `token_count: null`.

## Payload

`mcpscope inspect N8GF.1T.21.1-DN`

```text
N8GF.1T.21.1-DN  diagnostic
  Turn stopped: reached the maximum of 20 tool-call rounds without a final assistant response. Raise this session's max tool rounds (currently 20) — or the BACKEND_MAX_TOOL_ROUNDS default — if this is too low for your workflow.

```
