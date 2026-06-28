# inspect example — benchmark (B-GUDP)

- **Source:** `B-GUDP` — `HA History V3 (oracle-pinned)`, 5 cases.
- Real summary/full split (F5): summary = case/run **nav ids** only; full adds prompts, rubric size, run completion + eval IDs. No results.

- **Captured:** rebuilt backend (Phase 2), read-only against `backend-data/`, 2026-06-28.

## Summary mode

`mcpscope inspect --short B-GUDP`

```text
B-GUDP  HA History V3 (oracle-pinned)
  V3 server-evaluation set (5 cases). Tests the MCP server (tools/params/descriptions), not the model — model failures are server/description findings. Two focuses per case: answer correctness (exact, vs the independent snapshot oracle scripts/v3-oracle.ts) and server tool-use from the call trace (tool selection, parameters/filters, payload size). Frozen snapshot oslo-20260623, now=2026-06-23, tz Europe/Oslo. Run against the replay server (profile ha-replay, port 3021). See evaluation/prompts/v3/ and MCPSCOPE.md.

cases (5)
  B-GUDP.1  01 outdoor-winter-coldest-and-freezing
  B-GUDP.2  02 charger-energy-month
  B-GUDP.3  03 multiroom-climate-month
  B-GUDP.4  04 recent-motion-routines
  B-GUDP.5  05 whole-home-weekday-weekend

runs (1)
  R-RZNP  complete
```

## Full mode

`mcpscope inspect B-GUDP`

```text
B-GUDP  HA History V3 (oracle-pinned)
  V3 server-evaluation set (5 cases). Tests the MCP server (tools/params/descriptions), not the model — model failures are server/description findings. Two focuses per case: answer correctness (exact, vs the independent snapshot oracle scripts/v3-oracle.ts) and server tool-use from the call trace (tool selection, parameters/filters, payload size). Frozen snapshot oslo-20260623, now=2026-06-23, tz Europe/Oslo. Run against the replay server (profile ha-replay, port 3021). See evaluation/prompts/v3/ and MCPSCOPE.md.

cases (5)
  B-GUDP.1  01 outdoor-winter-coldest-and-freezing  [5 criteria]
    I'd like to understand how cold it got outside last winter — December 2025 through February 2026. Tw…
  B-GUDP.2  02 charger-energy-month  [7 criteria]
    Give me a rundown of the car charger's electricity use for February 2026 — it's on a metered outdoor…
  B-GUDP.3  03 multiroom-climate-month  [7 criteria]
    Compare the temperatures across my home for February 2026 — cover the Cave, Kitchen, Salon, and Outd…
  B-GUDP.4  04 recent-motion-routines  [5 criteria]
    For the last 7 days, how busy were the stairs in my home? Give me a per-day count of how many times …
  B-GUDP.5  05 whole-home-weekday-weekend  [5 criteria]
    For March 2026, is our household using more electricity on weekends than on weekdays? Compare the we…

runs (1)
  R-RZNP  complete  25/25 sessions (3 failed)  evals: E-2BPM, E-FE7K
```
