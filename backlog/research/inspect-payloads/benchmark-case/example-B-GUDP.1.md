# inspect example — benchmark case (B-GUDP.1)

- **Source object:** `B-GUDP.1`
- **Captured from:** live test instance (`localhost:3030`), benchmark run `R-RZNP` — Gemma 4 12B QAT on the HA Replay MCP profile.
- **Date:** 2026-06-27
- **Rendering:** ⚠️ JSON fallback. The CLI text renderer (`cli/src/commands/inspect.ts`) only handles runtime types; benchmark-family types (`B-`/`R-`/`E-`) fall through to a raw `JSON.stringify` dump. The MCP tool returns JSON for *all* types.

## Summary mode

`mcpscope inspect --short B-GUDP.1`  ·  MCP `{ id: "B-GUDP.1", short: true }`

```text
{
  "id": "B-GUDP.1",
  "type": "benchmark_case",
  "mode": "summary",
  "data": {
    "id": "B-GUDP.1",
    "benchmark_id": "B-GUDP",
    "name": "01 outdoor-winter-coldest-and-freezing",
    "prompt": "I'd like to understand how cold it got outside last winter — December 2025 through February 2026. Two things: (1) which day was the coldest, and how cold did it get? (2) on how many days that winter did the temperature drop below freezing at some point? Resolve the outdoor sensor yourself and keep it concise.",
    "order_index": 0,
    "expected_tools_called": [
      "ha_history_get_sensor_stats"
    ],
    "expected_tools_not_called": [
      "ha_history_get_state_history",
      "ha_history_detect_sessions",
      "ha_history_get_consumption"
    ],
    "rubric": [
      {
        "id": 1,
        "description": "States the coldest day = 2026-01-11 at about -14.9 °C.",
        "points": 3
      },
      {
        "id": 2,
        "description": "States the freezing-day count = exactly 63.",
        "points": 3
      },
      {
        "id": 3,
        "description": "A get_sensor_stats call sets filter_operator \"<\" and filter_value 0 (server-side threshold count).",
        "points": 2
      },
      {
        "id": 4,
        "description": "A get_sensor_stats call sets aggregation \"min\".",
        "points": 1
      },
      {
        "id": 5,
        "description": "No raw state/history timeline is fetched (no get_state_history); the count comes from the server.",
        "points": 1
      }
    ],
    "source_session_id": null,
    "created_at": 1782568558981,
    "updated_at": 1782568558981
  }
}

```

## Full mode

`mcpscope inspect B-GUDP.1`  ·  MCP `{ id: "B-GUDP.1" }`

```text
{
  "id": "B-GUDP.1",
  "type": "benchmark_case",
  "mode": "full",
  "data": {
    "id": "B-GUDP.1",
    "benchmark_id": "B-GUDP",
    "name": "01 outdoor-winter-coldest-and-freezing",
    "prompt": "I'd like to understand how cold it got outside last winter — December 2025 through February 2026. Two things: (1) which day was the coldest, and how cold did it get? (2) on how many days that winter did the temperature drop below freezing at some point? Resolve the outdoor sensor yourself and keep it concise.",
    "order_index": 0,
    "expected_tools_called": [
      "ha_history_get_sensor_stats"
    ],
    "expected_tools_not_called": [
      "ha_history_get_state_history",
      "ha_history_detect_sessions",
      "ha_history_get_consumption"
    ],
    "rubric": [
      {
        "id": 1,
        "description": "States the coldest day = 2026-01-11 at about -14.9 °C.",
        "points": 3
      },
      {
        "id": 2,
        "description": "States the freezing-day count = exactly 63.",
        "points": 3
      },
      {
        "id": 3,
        "description": "A get_sensor_stats call sets filter_operator \"<\" and filter_value 0 (server-side threshold count).",
        "points": 2
      },
      {
        "id": 4,
        "description": "A get_sensor_stats call sets aggregation \"min\".",
        "points": 1
      },
      {
        "id": 5,
        "description": "No raw state/history timeline is fetched (no get_state_history); the count comes from the server.",
        "points": 1
      }
    ],
    "source_session_id": null,
    "created_at": 1782568558981,
    "updated_at": 1782568558981
  }
}

```
