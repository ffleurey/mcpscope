# inspect example — turn (9LJM.1T)

- **Source:** `9LJM.1T` — the single turn of session 9LJM. The header gives round count + turn token cost.

- **Captured:** rebuilt backend (Phase 2), read-only against `backend-data/`, 2026-06-28.

## Summary mode

`mcpscope inspect --short 9LJM.1T`

```text
9LJM.1T  turn  complete  4 rounds  (7094 tokens)
9LJM.1T.1.1-U  user_prompt  (81 tokens)
9LJM.1T.1.2-R  reasoning  (314 tokens - stripped)
9LJM.1T.1.3-T  tool_call  ha_history_list_entities  (128 tokens)
9LJM.1T.2.1-R  reasoning  (236 tokens - stripped)
9LJM.1T.2.2-T  tool_call  ha_history_get_sensor_stats  (64 tokens)
9LJM.1T.3.1-R  reasoning  (382 tokens - stripped)
9LJM.1T.3.2-T  tool_call  ha_history_get_sensor_stats  (1679 tokens)
9LJM.1T.4.1-A  assistant_answer  (100 tokens)
```

## Full mode

`mcpscope inspect 9LJM.1T`

```text
9LJM.1T  turn  complete  4 rounds  (7094 tokens)
9LJM.1T.1.1-U  user_prompt  (81 tokens)
  I'd like to understand how cold it got outside last winter — December 2025 through February 2026. Two things: (1) which day was the coldest, and how cold did it get? (2) on how many days that winter did the temperature drop below freezing at some point? Resolve the outdoor sensor yourself and keep it concise.
9LJM.1T.1.2-R  reasoning  (314 tokens - stripped)
9LJM.1T.1.3-T  tool_call  ha_history_list_entities  (128 tokens)
  {"device_classes":["temperature"],"search":"outdoor"}
9LJM.1T.2.1-R  reasoning  (236 tokens - stripped)
9LJM.1T.2.2-T  tool_call  ha_history_get_sensor_stats  (64 tokens)
  {}
9LJM.1T.3.1-R  reasoning  (382 tokens - stripped)
9LJM.1T.3.2-T  tool_call  ha_history_get_sensor_stats  (1679 tokens)
  {"aggregations":["min"],"end_time":"2026-02-28","entity_ids":["sensor.ruuvitag_fc8f_temperature"],"interval":"day","start_time":"2025-12-01"}
9LJM.1T.4.1-A  assistant_answer  (100 tokens)
  The coldest day was January 9, 2026, when the temperature dropped to -12.4°C.
  
  During the winter period (December 2025 through February 2026), the temperature dropped below freezing on 68 days.
  
  Sensor: Ruuvi Outdoor Temperature
  Period: 2025-12-01 to 2026-02-28
  Aggregation: Daily minimum
```
