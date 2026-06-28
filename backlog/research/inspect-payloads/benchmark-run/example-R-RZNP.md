# inspect example — benchmark_run (R-RZNP)

- **Source:** `R-RZNP` — a completed run (25 sessions, 3 failed, 2 evaluation passes).
- Model + judges show **friendly names** (resolved from session snapshots). Summary = status + progress + evaluations + drillable session list; full adds per-case pass rates, the per-tool rollup, and per-session metrics.

- **Captured:** rebuilt backend (Phase 2), read-only against `backend-data/`, 2026-06-28.

## Summary mode

`mcpscope inspect --short R-RZNP`

```text
R-RZNP  HA History V3 (oracle-pinned)  complete
  model       Gemma 4 12B QAT
  mcp         ha-replay
  reps        5  max tool rounds 20
  error       3 of 25 session(s) failed. See per-session errors.
  progress    25/25 sessions, 3 failed
    B-GUDP.1 01 outdoor-winter-coldest-and-freezing: 5/5
    B-GUDP.2 02 charger-energy-month: 5/5
    B-GUDP.3 03 multiroom-climate-month: 5/5
    B-GUDP.4 04 recent-motion-routines: 5/5
    B-GUDP.5 05 whole-home-weekday-weekend: 5/5

evaluations
  E-2BPM  error  judged 20/22  judge Gemma 4 12B QAT
  E-FE7K  complete  judged 22/22  judge Kimi K2.5

sessions (25)
  9LJM  B-GUDP.1 rep 1  complete
  7HVE  B-GUDP.1 rep 2  complete
  3VVQ  B-GUDP.1 rep 3  complete
  KG92  B-GUDP.1 rep 4  complete
  ART6  B-GUDP.1 rep 5  complete
  V3P3  B-GUDP.2 rep 1  complete
  DR93  B-GUDP.2 rep 2  complete
  N8GF  B-GUDP.2 rep 3  error
  XR2B  B-GUDP.2 rep 4  complete
  RGGR  B-GUDP.2 rep 5  complete
  VMLU  B-GUDP.3 rep 1  complete
  79YY  B-GUDP.3 rep 2  complete
  XJ3F  B-GUDP.3 rep 3  complete
  VU6C  B-GUDP.3 rep 4  complete
  PRSD  B-GUDP.3 rep 5  complete
  JF9U  B-GUDP.4 rep 1  complete
  AQK7  B-GUDP.4 rep 2  complete
  ZNF9  B-GUDP.4 rep 3  complete
  8PYJ  B-GUDP.4 rep 4  complete
  FZ3S  B-GUDP.4 rep 5  complete
  DZZ6  B-GUDP.5 rep 1  complete
  U7WR  B-GUDP.5 rep 2  error
  ZQLE  B-GUDP.5 rep 3  complete
  73K7  B-GUDP.5 rep 4  complete
  39RT  B-GUDP.5 rep 5  error
```

## Full mode

`mcpscope inspect R-RZNP`

```text
R-RZNP  HA History V3 (oracle-pinned)  complete
  model       Gemma 4 12B QAT
  mcp         ha-replay
  reps        5  max tool rounds 20
  error       3 of 25 session(s) failed. See per-session errors.
  progress    25/25 sessions, 3 failed
    B-GUDP.1 01 outdoor-winter-coldest-and-freezing: 5/5
    B-GUDP.2 02 charger-energy-month: 5/5
    B-GUDP.3 03 multiroom-climate-month: 5/5
    B-GUDP.4 04 recent-motion-routines: 5/5
    B-GUDP.5 05 whole-home-weekday-weekend: 5/5

evaluations
  E-2BPM  error  judged 20/22  judge Gemma 4 12B QAT
  E-FE7K  complete  judged 22/22  judge Kimi K2.5

per case
  B-GUDP.1  pass 5/5 (100%)  pass@k 1  pass^k 1
  B-GUDP.2  pass 4/5 (80%)  pass@k 1  pass^k 0
  B-GUDP.3  pass 5/5 (100%)  pass@k 1  pass^k 1
  B-GUDP.4  pass 4/5 (80%)  pass@k 1  pass^k 0
  B-GUDP.5  pass 3/5 (60%)  pass@k 1  pass^k 0

per tool
  ha_history_list_entities  69 calls, 0 errors (0%), 91667 chars
  ha_history_get_sensor_stats  14 calls, 0 errors (0%), 21099 chars
  ha_history_get_consumption  47 calls, 0 errors (0%), 59579 chars
  ha_history_get_current_time  4 calls, 0 errors (0%), 576 chars
  ha_history_list_devices  11 calls, 0 errors (0%), 13618 chars
  ha_history_list_areas  11 calls, 0 errors (0%), 2157 chars
  ha_history_get_state_history  10 calls, 0 errors (0%), 4888 chars
  ha_history_list_device_entities  7 calls, 0 errors (0%), 3546 chars

sessions (25)
  9LJM  B-GUDP.1 rep 1  complete  3 calls, 7094 tok
  7HVE  B-GUDP.1 rep 2  complete  2 calls, 7025 tok
  3VVQ  B-GUDP.1 rep 3  complete  3 calls, 7095 tok
  KG92  B-GUDP.1 rep 4  complete  3 calls, 7156 tok
  ART6  B-GUDP.1 rep 5  complete  2 calls, 7039 tok
  V3P3  B-GUDP.2 rep 1  complete  3 calls, 8192 tok
  DR93  B-GUDP.2 rep 2  complete  18 calls, 8192 tok
  N8GF  B-GUDP.2 rep 3  error  20 calls
  XR2B  B-GUDP.2 rep 4  complete  6 calls, 8192 tok
  RGGR  B-GUDP.2 rep 5  complete  6 calls, 6646 tok
  VMLU  B-GUDP.3 rep 1  complete  2 calls, 7739 tok
  79YY  B-GUDP.3 rep 2  complete  2 calls, 7562 tok
  XJ3F  B-GUDP.3 rep 3  complete  2 calls, 6995 tok
  VU6C  B-GUDP.3 rep 4  complete  3 calls, 6250 tok
  PRSD  B-GUDP.3 rep 5  complete  2 calls, 6176 tok
  JF9U  B-GUDP.4 rep 1  complete  8 calls, 6792 tok
  AQK7  B-GUDP.4 rep 2  complete  10 calls, 7463 tok
  ZNF9  B-GUDP.4 rep 3  complete  8 calls, 7084 tok
  8PYJ  B-GUDP.4 rep 4  complete  8 calls, 6813 tok
  FZ3S  B-GUDP.4 rep 5  complete  8 calls, 6792 tok
  DZZ6  B-GUDP.5 rep 1  complete  4 calls, 8192 tok
  U7WR  B-GUDP.5 rep 2  error  20 calls
  ZQLE  B-GUDP.5 rep 3  complete  8 calls, 6762 tok
  73K7  B-GUDP.5 rep 4  complete  2 calls, 6592 tok
  39RT  B-GUDP.5 rep 5  error  20 calls
```
