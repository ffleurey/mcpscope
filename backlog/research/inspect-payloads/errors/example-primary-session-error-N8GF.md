# inspect example — error: primary session (N8GF)

- **Source:** `N8GF` — `02 charger-energy-month (rep 3)`, terminal status **error** (looped to the 20-round cap).
- **Fixed (F9/F10):** the header shows `status error` + the failure reason; no need to read to the trailing `diagnostic` part.
- **Captured:** rebuilt backend (Phase 2), read-only against `backend-data/`, 2026-06-28.

## Summary mode (the 20-round loop is trimmed to a few rounds below)

`mcpscope inspect --short N8GF`

```text
N8GF  02 charger-energy-month (rep 3)
  model       Gemma 4 12B QAT  google/gemma-4-12b-qat
  mcp         HA Replay
  context     ? / 8192 tokens
  compaction  strip-reasoning
  tool rounds 20
  parent      benchmark R-RZNP
  status      error
  error  Turn stopped: reached the maximum of 20 tool-call rounds without a final assistant response. Raise this session's max tool rounds (currently 20) — or the BACKEND_MAX_TOOL_ROUNDS default — if this is too low for your workflow.

N8GF.S.1-MI  mcp_instructions  (391 tokens)
N8GF.S.2-TD  tool_definitions  10 tools  (4650 tokens)
  ha_history_get_current_time, ha_history_list_areas, … (10 tools)

N8GF.1T  turn  error  21 rounds
N8GF.1T.1.1-U  user_prompt  (89 tokens)
N8GF.1T.1.2-R  reasoning  (608 tokens)
N8GF.1T.1.3-T  tool_call  ha_history_list_entities  (418 tokens)
N8GF.1T.2.1-R  reasoning  (662 tokens)
N8GF.1T.2.2-T  tool_call  ha_history_get_current_time  (108 tokens)
N8GF.1T.3.2-T  tool_call  ha_history_get_consumption  (306 tokens)
… rounds 4–20: the model loops, repeatedly calling ha_history_get_consumption /
  ha_history_list_entities without ever emitting an assistant_answer
N8GF.1T.20.2-T  tool_call  ha_history_get_consumption
N8GF.1T.21.1-DN  diagnostic
```

## Full mode

Identical to the summary trace, plus the `user_prompt` text inlined (the model never produced
an `assistant_answer` — it looped to the cap). The stop reason is the trailing `N8GF.1T.21.1-DN`
`diagnostic` part, now also surfaced as the header failure summary.
