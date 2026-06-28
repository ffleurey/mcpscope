# inspect example — benchmark_evaluation — complete (E-FE7K)

- **Source:** `E-FE7K` — a complete judge pass (Kimi K2.5, 22/22, overall 50%).
- Summary = score + completeness + drillable judged-session list; full adds per-case distribution + the per-criterion grid with judge notes (F5).

- **Captured:** rebuilt backend (Phase 2), read-only against `backend-data/`, 2026-06-28.

## Summary mode

`mcpscope inspect --short E-FE7K`

```text
E-FE7K  evaluation of R-RZNP  complete  overall 50%
  judge       Kimi K2.5  temp 0.2
  judged      22/22

sessions (22)
  ZTJE  judges 9LJM  B-GUDP.1  complete  20%
  GSP6  judges 7HVE  B-GUDP.1  complete  20%
  DNCL  judges 3VVQ  B-GUDP.1  complete  50%
  MECG  judges KG92  B-GUDP.1  complete  20%
  BGAL  judges ART6  B-GUDP.1  complete  20%
  S686  judges V3P3  B-GUDP.2  complete  0%
  HWM5  judges DR93  B-GUDP.2  complete  30%
  E693  judges XR2B  B-GUDP.2  complete  0%
  J8FZ  judges RGGR  B-GUDP.2  complete  20%
  BKYM  judges VMLU  B-GUDP.3  complete  50%
  J34F  judges 79YY  B-GUDP.3  complete  80%
  2ESU  judges XJ3F  B-GUDP.3  complete  60%
  BX45  judges VU6C  B-GUDP.3  complete  80%
  BUSW  judges PRSD  B-GUDP.3  complete  60%
  HMZ3  judges JF9U  B-GUDP.4  complete  80%
  LKBJ  judges AQK7  B-GUDP.4  complete  100%
  QKJD  judges ZNF9  B-GUDP.4  complete  80%
  BC73  judges 8PYJ  B-GUDP.4  complete  100%
  ATF6  judges FZ3S  B-GUDP.4  complete  100%
  H7L7  judges DZZ6  B-GUDP.5  complete  30%
  9CDS  judges ZQLE  B-GUDP.5  complete  50%
  DYXR  judges 73K7  B-GUDP.5  complete  50%
```

## Full mode

`mcpscope inspect E-FE7K`

```text
E-FE7K  evaluation of R-RZNP  complete  overall 50%
  judge       Kimi K2.5  temp 0.2
  judged      22/22

per case
  B-GUDP.1  01 outdoor-winter-coldest-and-freezing  mean 26%
  B-GUDP.2  02 charger-energy-month  mean 13%
  B-GUDP.3  03 multiroom-climate-month  mean 66%
  B-GUDP.4  04 recent-motion-routines  mean 92%
  B-GUDP.5  05 whole-home-weekday-weekend  mean 43%

sessions (22)
  ZTJE  judges 9LJM  B-GUDP.1  complete  20%
    [0/3] (#1) States the coldest day = 2026-01-11 at about -14.9 °C.  — The final answer states the coldest day was January 9, 2026 at -12.4°C, not 2026…
    [0/3] (#2) States the freezing-day count = exactly 63.  — The final answer states the temperature dropped below freezing on 68 days, not e…
    [0/2] (#3) A get_sensor_stats call sets filter_operator "<" and filter_value 0 (server-side threshold count).  — No get_sensor_stats call in the trace sets filter_operator or filter_value. The …
    [1/1] (#4) A get_sensor_stats call sets aggregation "min".  — The get_sensor_stats call in 9LJM.1T.3.2-T sets aggregations to ["min"]. Evidenc…
    [1/1] (#5) No raw state/history timeline is fetched (no get_state_history); the count comes from the server.  — No get_state_history call appears in the trace. The tools used are ha_history_li…
  GSP6  judges 7HVE  B-GUDP.1  complete  20%
    [0/3] (#1) States the coldest day = 2026-01-11 at about -14.9 °C.  — The assistant reported the coldest day as 2026-01-09 at -12.4°C, but the rubric …
    [0/3] (#2) States the freezing-day count = exactly 63.  — The assistant reported 64 freezing days, but the rubric requires exactly 63. Man…
    [0/2] (#3) A get_sensor_stats call sets filter_operator "<" and filter_value 0 (server-side threshold count).  — No get_sensor_stats call used filter_operator '<' and filter_value 0. The only g…
    [1/1] (#4) A get_sensor_stats call sets aggregation "min".  — The get_sensor_stats call at 7HVE.1T.2.2-T correctly sets aggregations to ['min'…
    [1/1] (#5) No raw state/history timeline is fetched (no get_state_history); the count comes from the server.  — No get_state_history call was made. The session only used ha_history_list_entiti…
    … 20 more judged sessions, each with its per-criterion grid (elided for brevity)
```
