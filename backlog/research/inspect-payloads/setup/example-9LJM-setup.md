# inspect example — setup (9LJM.S)

- **Source object:** `9LJM.S`
- **Captured from:** live test instance (`localhost:3030`), benchmark run `R-RZNP` — Gemma 4 12B QAT on the HA Replay MCP profile.
- **Date:** 2026-06-27
- **Rendering:** CLI text renderer (`mcpscope inspect`). Note the MCP tool returns this same data as raw JSON, not this text.

## Summary mode

`mcpscope inspect --short 9LJM.S`  ·  MCP `{ id: "9LJM.S", short: true }`

```text
9LJM.S.1-MI  mcp_instructions  (391 tokens)
9LJM.S.2-TD  tool_definitions  (4650 tokens)
  ha_history_get_current_time, ha_history_list_areas, ha_history_list_devices, ha_history_list_device_entities, ha_history_list_entities, ha_history_get_state, ha_history_get_sensor_stats, ha_history_get_consumption, ha_history_detect_sessions, ha_history_get_state_history

```

## Full mode

`mcpscope inspect 9LJM.S`  ·  MCP `{ id: "9LJM.S" }`

```text
9LJM.S.1-MI  mcp_instructions  (391 tokens)
  [HA Replay]
  You are a data analyst for Oslo home automation data.
  
  Answer from tool results only. State sensor, period, and aggregation. Keep answers short and factual.
  
  Never guess entity_ids. Resolve them first. Prefer ha_history_list_entities with area/areas, device, and device_class/device_classes; use search only for remaining name words.
  For multi-area climate comparisons, one call with areas=[...] and device_classes=["temperature","humidity"] should usually find the needed entities.
  For people or phone location history, use ha_history_list_entities with domain="person" or domain="device_tracker" first; if needed, domains=["person","device_tracker"] is acceptable.
  Use ha_history_list_devices only when the device or area is still unclear, ha_history_list_device_entities only for one-device inspection, and ha_history_list_areas only when the exact area name is unknown.
  If discovery returns weak or ambiguous matches, retry with a tighter area, device, or search filter before asking the user.
  
  Tool choice: ha_history_get_sensor_stats for instantaneous measurements, ha_history_get_consumption for cumulative meters, ha_history_detect_sessions for threshold-based activity, ha_history_get_state_history for discrete-state timelines, ha_history_get_state for current state.
  
  Time formats: relative ("7d","30d","24h"), named ("last month","yesterday","Q1"), or ISO date ("2026-04-01"). Default start: 30d. Default end: now. "overnight" for detect_sessions means 22:00 yesterday to 06:00 today.
9LJM.S.2-TD  tool_definitions  (4650 tokens)
  ha_history_get_current_time, ha_history_list_areas, ha_history_list_devices, ha_history_list_device_entities, ha_history_list_entities, ha_history_get_state, ha_history_get_sensor_stats, ha_history_get_consumption, ha_history_detect_sessions, ha_history_get_state_history

```
