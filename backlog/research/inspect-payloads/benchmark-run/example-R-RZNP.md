# inspect example — benchmark_run (R-RZNP)

- **Source:** `R-RZNP` — a completed run (25 sessions, 3 failed, 2 evaluation passes). Model + judges show **friendly names**; the eval digest carries the headline **`overall_pct`** for at-a-glance run comparison (UC-5). Summary = status + progress + evaluations + drillable session list; full adds per-case pass rates, per-tool rollup, per-session metrics.
- **Captured:** rebuilt backend (Phase 2), live MCP/API against `backend-data/`, 2026-06-28.

> The 25-session list is trimmed below to a few rows + the 3 failures (the rest follow the same
> shape: `<id>  <case> rep N  <status>`, with `tool calls, tokens` in full mode).

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
    … (cases 2–5 also 5/5)

evaluations
  E-2BPM  error  overall 59%  judged 20/22 ⚠  judge Gemma 4 12B QAT
  E-FE7K  complete  overall 50%  judged 22/22  judge Kimi K2.5

sessions (25)
  9LJM  B-GUDP.1 rep 1  complete
  7HVE  B-GUDP.1 rep 2  complete
  N8GF  B-GUDP.2 rep 3  error
  U7WR  B-GUDP.5 rep 2  error
  39RT  B-GUDP.5 rep 5  error
  … 20 more (complete)
```

## Full mode

`mcpscope inspect R-RZNP` — adds per-case pass rates, the per-tool rollup, and per-session metrics:

```text
… (run header + progress + evaluations, as above)

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
  … 5 more tools (all 0 errors)

sessions (25)
  9LJM  B-GUDP.1 rep 1  complete  3 calls, 7094 tok
  DR93  B-GUDP.2 rep 2  complete  18 calls, 8192 tok
  N8GF  B-GUDP.2 rep 3  error  20 calls
  U7WR  B-GUDP.5 rep 2  error  20 calls
  39RT  B-GUDP.5 rep 5  error  20 calls
  … 20 more (complete, with their tool-call + token counts)
```
