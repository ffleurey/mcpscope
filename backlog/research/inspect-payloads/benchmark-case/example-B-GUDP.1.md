# inspect example — benchmark_case (B-GUDP.1)

- **Source:** `B-GUDP.1` — the full case spec (prompt + tool checks + rubric + provenance).
- A **leaf** like a part: summary == full by design (it *is* the full-spec drill target).

- **Captured:** rebuilt backend (Phase 2), read-only against `backend-data/`, 2026-06-28.

> Summary and full are identical for this type (a leaf — like a part). One payload:

`mcpscope inspect B-GUDP.1`

```text
B-GUDP.1  01 outdoor-winter-coldest-and-freezing
  expects called      ha_history_get_sensor_stats
  expects not called  ha_history_get_state_history, ha_history_detect_sessions, ha_history_get_consumption

prompt
  I'd like to understand how cold it got outside last winter — December 2025 through February 2026. Two things: (1) which day was the coldest, and how cold did it get? (2) on how many days that winter did the temperature drop below freezing at some point? Resolve the outdoor sensor yourself and keep it concise.

rubric
  [3 pts] (#1) States the coldest day = 2026-01-11 at about -14.9 °C.
  [3 pts] (#2) States the freezing-day count = exactly 63.
  [2 pts] (#3) A get_sensor_stats call sets filter_operator "<" and filter_value 0 (server-side threshold count).
  [1 pts] (#4) A get_sensor_stats call sets aggregation "min".
  [1 pts] (#5) No raw state/history timeline is fetched (no get_state_history); the count comes from the server.
```
