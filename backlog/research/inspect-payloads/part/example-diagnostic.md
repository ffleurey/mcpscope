# inspect example — part: diagnostic

- **Source:** `N8GF.1T.21.1-DN` — the stop-reason marker in the errored session N8GF.
- This same reason now also surfaces at the **session header** as the failure summary (F9).

- **Captured:** rebuilt backend (Phase 2), read-only against `backend-data/`, 2026-06-28.

> Summary and full are identical for this type (a leaf — like a part). One payload:

`mcpscope inspect N8GF.1T.21.1-DN`

```text
N8GF.1T.21.1-DN  diagnostic
  Turn stopped: reached the maximum of 20 tool-call rounds without a final assistant response. Raise this session's max tool rounds (currently 20) — or the BACKEND_MAX_TOOL_ROUNDS default — if this is too low for your workflow.
```
