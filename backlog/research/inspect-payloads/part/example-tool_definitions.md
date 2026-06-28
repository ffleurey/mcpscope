# inspect example — part: tool_definitions

- **Source:** `9LJM.S.2-TD` — the **only** place with the full JSON tool schemas (containers show names + count only).
- **Captured:** rebuilt backend (Phase 2), read-only against `backend-data/`, 2026-06-28.

> Summary and full are identical for this type (a leaf — like a part). A direct lookup returns
> the full schemas; **2 of the 10 tools shown** below to illustrate the shape (the rest elided).

`mcpscope inspect 9LJM.S.2-TD`

```text
9LJM.S.2-TD  tool_definitions  (4650 tokens)
  [
    {
      "name": "ha_history_get_current_time",
      "description": "Returns the current date and time from the Home Assistant server (Oslo).\nCall this before time-based queries that use relative or named periods such as\n\"last month\", \"this winter\", \"yesterday\", or \"recently\".\nDo not rely on your training data to infer the current date — it will often be wrong.\nSkip only if an absolute ISO date range has already been stated in this conversation.",
      "inputSchema": {
        "type": "object",
        "properties": {},
        "required": []
      }
    },
    {
      "name": "ha_history_list_areas",
      "description": "Lists the areas (rooms and locations) defined in Oslo.\nUse when the user wants to explore areas or when you need the exact area name for ha_history_list_devices.\nNarrow by name with search.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "search": {
            "type": "string",
            "description": "Optional search term matched against area names (case-insensitive substring match)."
          },
          "max_results": {
            "type": "number",
            "description": "Maximum number of results to return. Default: all areas."
          }
        },
        "required": []
      }
    }
    … 8 more tools (ha_history_list_devices, …_list_device_entities, …_list_entities,
    …_get_state, …_get_sensor_stats, …_get_consumption, …_detect_sessions, …_get_state_history)
  ]
```
