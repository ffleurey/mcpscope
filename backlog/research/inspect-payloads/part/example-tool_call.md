# inspect example — part: tool_call (+ folded tool_result)

- **Source:** `9LJM.1T.3.2-T` — the full `{ call, result }`; the `tool_result` is folded in.
- **Captured:** rebuilt backend (Phase 2), read-only against `backend-data/`, 2026-06-28.

> Summary and full are identical for this type (a leaf — like a part). One payload (the 90-row
> result table is truncated below to ~8 rows to keep this example compact).

`mcpscope inspect 9LJM.1T.3.2-T`

```text
9LJM.1T.3.2-T  tool_call  ha_history_get_sensor_stats  (1679 tokens)
  call  {"aggregations":["min"],"end_time":"2026-02-28","entity_ids":["sensor.ruuvitag_fc8f_temperature"],"interval":"day","start_time":"2025-12-01"}
  result
    Sensors: Ruuvi Outdoor Temperature
    Period: 2025-12-01 → 2026-03-01
    Aggregation: min per day
    Unit: °C
    Rows: 90

    time       | ruuvi outdoor temperature
    2025-12-01 | 6.2
    2025-12-02 | 2.7
    2025-12-03 | 5.1
    2025-12-04 | 4.4
    2025-12-05 | 4.2
    2025-12-06 | 4.6
    2025-12-07 | 4.4
    2025-12-08 | 0.4
    … 82 more daily rows through 2026-02-28 (coldest 2026-01-10 = -14.9)
```
