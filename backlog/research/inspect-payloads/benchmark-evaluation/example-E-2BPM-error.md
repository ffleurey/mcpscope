# inspect example — benchmark_evaluation — error/incomplete (E-2BPM)

- **Source:** `E-2BPM` — an errored judge pass (Gemma 4 12B QAT, 20/22 judged).
- Flagged **`⚠ incomplete`**; the `incomplete` field marks `overall_pct` provisional (F11).

- **Captured:** rebuilt backend (Phase 2), read-only against `backend-data/`, 2026-06-28.

## Summary mode

`mcpscope inspect --short E-2BPM`

```text
E-2BPM  evaluation of R-RZNP  error  overall 59%
  judge       Gemma 4 12B QAT  temp 0.2
  judged      20/22  ⚠ incomplete
  error       2 of 22 judge sessions incomplete.

sessions (22)
  SATM  judges 9LJM  B-GUDP.1  complete  20%
  ZZHR  judges 7HVE  B-GUDP.1  complete  20%
  CNQV  judges 3VVQ  B-GUDP.1  complete  50%
  Y5GB  judges KG92  B-GUDP.1  complete  20%
  NP8E  judges ART6  B-GUDP.1  complete  20%
  3LCE  judges RGGR  B-GUDP.2  complete  40%
  ETTB  judges V3P3  B-GUDP.2  error
  SP7M  judges DR93  B-GUDP.2  complete  60%
  E5TS  judges XR2B  B-GUDP.2  error
  QE4H  judges VMLU  B-GUDP.3  complete  50%
  4ARS  judges 79YY  B-GUDP.3  complete  70%
  JBGE  judges XJ3F  B-GUDP.3  complete  50%
  VSMB  judges VU6C  B-GUDP.3  complete  80%
  TJTE  judges PRSD  B-GUDP.3  complete  60%
  2RY7  judges JF9U  B-GUDP.4  complete  100%
  Y7ML  judges AQK7  B-GUDP.4  complete  100%
  HZCR  judges ZNF9  B-GUDP.4  complete  80%
  WLD2  judges 8PYJ  B-GUDP.4  complete  100%
  KD73  judges FZ3S  B-GUDP.4  complete  100%
  PBPT  judges DZZ6  B-GUDP.5  complete  50%
  HPJW  judges ZQLE  B-GUDP.5  complete  50%
  8BHP  judges 73K7  B-GUDP.5  complete  50%
```

## Full mode

`mcpscope inspect E-2BPM`

```text
E-2BPM  evaluation of R-RZNP  error  overall 59%
  judge       Gemma 4 12B QAT  temp 0.2
  judged      20/22  ⚠ incomplete
  error       2 of 22 judge sessions incomplete.

per case
  B-GUDP.1  01 outdoor-winter-coldest-and-freezing  mean 26%
  B-GUDP.2  02 charger-energy-month  mean 50%
  B-GUDP.3  03 multiroom-climate-month  mean 62%
  B-GUDP.4  04 recent-motion-routines  mean 96%
  B-GUDP.5  05 whole-home-weekday-weekend  mean 50%

sessions (22)
  SATM  judges 9LJM  B-GUDP.1  complete  20%
    [0/3] (#1) States the coldest day = 2026-01-11 at about -14.9 °C.  — The final answer states the coldest day was January 9, 2026, at -12.4°C (9LJM.1T…
    [0/3] (#2) States the freezing-day count = exactly 63.  — The final answer states 68 days (9LJM.1T.4.1-A), but the rubric requires exactly…
    [0/2] (#3) A get_sensor_stats call sets filter_operator "<" and filter_value 0 (server-side threshold count).  — No call to get_sensor_stats was made with filter_operator '<' and filter_value 0…
    [1/1] (#4) A get_sensor_stats call sets aggregation "min".  — A call to get_sensor_stats in 9LJM.1T.3.2-T correctly sets aggregation to 'min'.
    [1/1] (#5) No raw state/history timeline is fetched (no get_state_history); the count comes from the server.  — No get_state_history call was made; the count was derived from the get_sensor_st…
  ZZHR  judges 7HVE  B-GUDP.1  complete  20%
    [0/3] (#1) States the coldest day = 2026-01-11 at about -14.9 °C.  — The final answer states the coldest day was 2026-01-09 at -12.4°C (7HVE.1T.3.1-A…
    [0/3] (#2) States the freezing-day count = exactly 63.  — The final answer states the temperature dropped below freezing on 64 days (7HVE.…
    [0/2] (#3) A get_sensor_stats call sets filter_operator "<" and filter_value 0 (server-side threshold count).  — The tool call ha_history_get_sensor_stats (7HVE.1T.2.2-T) does not include filte…
    [1/1] (#4) A get_sensor_stats call sets aggregation "min".  — The tool call ha_history_get_sensor_stats (7HVE.1T.2.2-T) correctly sets the agg…
    [1/1] (#5) No raw state/history timeline is fetched (no get_state_history); the count comes from the server.  — No ha_history_get_state_history tool call was made; the count was derived from t…
    … 18 more judged sessions (incl. the 2 errored judge sessions ETTB, E5TS — no criteria) (elided)
```
