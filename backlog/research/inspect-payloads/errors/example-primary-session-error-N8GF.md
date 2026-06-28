# inspect example — error: primary session (N8GF)

- **Source object:** `N8GF` — `02 charger-energy-month (rep 3)`, terminal status **error**.
- **Captured from:** completed run `R-RZNP`, 2026-06-27. One of 3 failed sessions (with `U7WR`, `39RT`).
- **Rendering:** CLI text renderer.

**What happened:** the model never produced a final answer. It looped — repeatedly calling
`ha_history_get_consumption` / `ha_history_list_entities` across **20 rounds** — until the
turn hit the tool-round cap and was stopped. A classic non-determinism failure (other
reps of the same case succeeded). The failure is recorded as a trailing **`diagnostic`**
part (`N8GF.1T.21.1-DN`, see [../part/example-diagnostic.md](../part/example-diagnostic.md)).

**⚠️ Inspection gaps this example exposes (see [README](README.md)):**
- The session payload has **no top-level `status`/error field** — you cannot tell from the
  session header that it failed. The error lives on the **turn step** (`status:error`) and
  in the trailing `diagnostic` part. Where a primary session surfaces failure differs from
  how an analysis/judge session does (which carries a top-level `latest_error`).
- The text renderer does **not** print the turn step's status; you only see the failure by
  reading to the `diagnostic` part at the end.

## Summary mode

`mcpscope inspect --short N8GF`

```text
N8GF  02 charger-energy-month (rep 3)
  model       Gemma 4 12B QAT  google/gemma-4-12b-qat
  mcp         HA Replay
  context     ? / 8192 tokens
  compaction  strip-reasoning

N8GF.S.1-MI  mcp_instructions  (391 tokens)
N8GF.S.2-TD  tool_definitions  (4650 tokens)
  ha_history_get_current_time, ha_history_list_areas, ha_history_list_devices, ha_history_list_device_entities, ha_history_list_entities, ha_history_get_state, ha_history_get_sensor_stats, ha_history_get_consumption, ha_history_detect_sessions, ha_history_get_state_history

N8GF.1T.1.1-U  user_prompt  (89 tokens)
N8GF.1T.1.2-R  reasoning  (608 tokens)
N8GF.1T.1.3-T  tool_call  ha_history_list_entities  (418 tokens)
N8GF.1T.2.1-R  reasoning  (662 tokens)
N8GF.1T.2.2-T  tool_call  ha_history_get_current_time  (108 tokens)
N8GF.1T.3.1-R  reasoning  (210 tokens)
N8GF.1T.3.2-T  tool_call  ha_history_get_consumption  (306 tokens)
N8GF.1T.4.1-T  tool_call  ha_history_get_consumption  (700 tokens)
N8GF.1T.5.1-T  tool_call  ha_history_list_entities  (31 tokens)
N8GF.1T.6.1-T  tool_call  ha_history_get_consumption  (73 tokens)
N8GF.1T.7.1-R  reasoning  (184 tokens)
N8GF.1T.7.2-T  tool_call  ha_history_get_consumption  (59 tokens)
N8GF.1T.8.1-T  tool_call  ha_history_get_consumption  (61 tokens)
N8GF.1T.9.1-R  reasoning  (161 tokens)
N8GF.1T.9.2-T  tool_call  ha_history_list_entities  (22 tokens)
N8GF.1T.10.1-R  reasoning  (155 tokens)
N8GF.1T.10.2-T  tool_call  ha_history_list_entities  (22 tokens)
N8GF.1T.11.1-T  tool_call  ha_history_get_consumption  (64 tokens)
N8GF.1T.12.1-T  tool_call  ha_history_get_consumption  (64 tokens)
N8GF.1T.13.1-T  tool_call  ha_history_list_entities  (31 tokens)
N8GF.1T.14.1-T  tool_call  ha_history_get_consumption  (73 tokens)
N8GF.1T.15.1-R  reasoning  (222 tokens)
N8GF.1T.15.2-T  tool_call  ha_history_get_consumption  (59 tokens)
N8GF.1T.16.1-R  reasoning  (188 tokens)
N8GF.1T.16.2-T  tool_call  ha_history_list_entities  (22 tokens)
N8GF.1T.17.1-R  reasoning  (149 tokens)
N8GF.1T.17.2-T  tool_call  ha_history_list_entities  (22 tokens)
N8GF.1T.18.1-T  tool_call  ha_history_get_consumption  (64 tokens)
N8GF.1T.19.1-R  reasoning  (306 tokens)
N8GF.1T.19.2-T  tool_call  ha_history_get_consumption  (56 tokens)
N8GF.1T.20.1-R  reasoning  (220 tokens)
N8GF.1T.20.2-T  tool_call  ha_history_get_consumption
N8GF.1T.21.1-DN  diagnostic

```

## Full mode

`mcpscope inspect N8GF`

```text
N8GF  02 charger-energy-month (rep 3)
  model       Gemma 4 12B QAT  google/gemma-4-12b-qat
  mcp         HA Replay
  context     ? / 8192 tokens
  compaction  strip-reasoning

N8GF.S.1-MI  mcp_instructions  (391 tokens)
N8GF.S.2-TD  tool_definitions  (4650 tokens)
  ha_history_get_current_time, ha_history_list_areas, ha_history_list_devices, ha_history_list_device_entities, ha_history_list_entities, ha_history_get_state, ha_history_get_sensor_stats, ha_history_get_consumption, ha_history_detect_sessions, ha_history_get_state_history

N8GF.1T.1.1-U  user_prompt  (89 tokens)
  Give me a rundown of the car charger's electricity use for February 2026 — it's on a metered outdoor plug. How much energy did it use in total that month? Which single day was the highest, and how much? On which days did it use more than 20 kWh? And roughly how does February compare to January? Resolve the charger entity yourself and keep it concise.
N8GF.1T.1.2-R  reasoning  (608 tokens)
N8GF.1T.1.3-T  tool_call  ha_history_list_entities  (418 tokens)
N8GF.1T.2.1-R  reasoning  (662 tokens)
N8GF.1T.2.2-T  tool_call  ha_history_get_current_time  (108 tokens)
N8GF.1T.3.1-R  reasoning  (210 tokens)
N8GF.1T.3.2-T  tool_call  ha_history_get_consumption  (306 tokens)
N8GF.1T.4.1-T  tool_call  ha_history_get_consumption  (700 tokens)
N8GF.1T.5.1-T  tool_call  ha_history_list_entities  (31 tokens)
N8GF.1T.6.1-T  tool_call  ha_history_get_consumption  (73 tokens)
N8GF.1T.7.1-R  reasoning  (184 tokens)
N8GF.1T.7.2-T  tool_call  ha_history_get_consumption  (59 tokens)
N8GF.1T.8.1-T  tool_call  ha_history_get_consumption  (61 tokens)
N8GF.1T.9.1-R  reasoning  (161 tokens)
N8GF.1T.9.2-T  tool_call  ha_history_list_entities  (22 tokens)
N8GF.1T.10.1-R  reasoning  (155 tokens)
N8GF.1T.10.2-T  tool_call  ha_history_list_entities  (22 tokens)
N8GF.1T.11.1-T  tool_call  ha_history_get_consumption  (64 tokens)
N8GF.1T.12.1-T  tool_call  ha_history_get_consumption  (64 tokens)
N8GF.1T.13.1-T  tool_call  ha_history_list_entities  (31 tokens)
N8GF.1T.14.1-T  tool_call  ha_history_get_consumption  (73 tokens)
N8GF.1T.15.1-R  reasoning  (222 tokens)
N8GF.1T.15.2-T  tool_call  ha_history_get_consumption  (59 tokens)
N8GF.1T.16.1-R  reasoning  (188 tokens)
N8GF.1T.16.2-T  tool_call  ha_history_list_entities  (22 tokens)
N8GF.1T.17.1-R  reasoning  (149 tokens)
N8GF.1T.17.2-T  tool_call  ha_history_list_entities  (22 tokens)
N8GF.1T.18.1-T  tool_call  ha_history_get_consumption  (64 tokens)
N8GF.1T.19.1-R  reasoning  (306 tokens)
N8GF.1T.19.2-T  tool_call  ha_history_get_consumption  (56 tokens)
N8GF.1T.20.1-R  reasoning  (220 tokens)
N8GF.1T.20.2-T  tool_call  ha_history_get_consumption
N8GF.1T.21.1-DN  diagnostic

```

## Where the failure is actually exposed (JSON)

The session header omits status; the turn step carries it, and the diagnostic part is the last child:

```json
{
  "session_top_level_status_field": "(absent)",
  "turn_id": "N8GF.1T",
  "turn_status": "error",
  "turn_latest_error": "(null)",
  "diagnostic_part": [
    {
      "id": "N8GF.1T.21.1-DN",
      "type": "diagnostic"
    }
  ]
}
```
