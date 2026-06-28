# inspect example — multi-turn session, mid-stream error (RH8P)

- **Source:** `RH8P` — a 2-turn primary session (GPT-4o-mini + Meteo) whose 2nd turn errored mid-stream (no diagnostic part). Shows per-turn header lines (rounds + token cost), chronological ordering (compaction renders **between** turns 1 and 2), and the synthesized header failure summary (`step-error: Turn 2 ended in error`).
- **Captured:** rebuilt backend (Phase 2), live MCP/API against `backend-data/`, 2026-06-28.

## Summary mode

`mcpscope inspect --short RH8P`

```text
RH8P  Multi-turn weather (gpt-4o-mini + Meteo)
  model       GPT-40-mini  openai/gpt-4o-mini
  mcp         Meteo
  context     6342 / 128000 tokens
  compaction  strip-reasoning
  tool rounds 20
  status      error
  error  step-error: Turn 2 ended in error.

RH8P.S.1-MI  mcp_instructions  (447 tokens)
RH8P.S.2-TD  tool_definitions  10 tools  (3951 tokens)
  openmeteo_geocode, openmeteo_get_elevation, openmeteo_get_forecast, openmeteo_get_historical, openmeteo_get_marine, openmeteo_get_air_quality, openmeteo_get_ensemble, openmeteo_get_flood, openmeteo_dataframe_query, openmeteo_dataframe_describe

RH8P.1T  turn  complete  3 rounds  (6342 tokens)
RH8P.1T.1.1-U  user_prompt  (27 tokens)
RH8P.1T.1.2-T  tool_call  openmeteo_geocode  (20 tokens)
RH8P.1T.2.1-T  tool_call  openmeteo_get_forecast  (1242 tokens)
RH8P.1T.3.1-A  assistant_answer  (30 tokens)

RH8P.2C  compaction  complete  strip-reasoning  after turn 1

RH8P.2T  turn  error (step-error)  1 round
RH8P.2T.1.1-U  user_prompt
```

## Full mode

`mcpscope inspect RH8P`

```text
RH8P  Multi-turn weather (gpt-4o-mini + Meteo)
  model       GPT-40-mini  openai/gpt-4o-mini
  mcp         Meteo
  context     6342 / 128000 tokens
  compaction  strip-reasoning
  tool rounds 20
  status      error
  error  step-error: Turn 2 ended in error.

RH8P.S.1-MI  mcp_instructions  (447 tokens)
RH8P.S.2-TD  tool_definitions  10 tools  (3951 tokens)
  openmeteo_geocode, openmeteo_get_elevation, openmeteo_get_forecast, openmeteo_get_historical, openmeteo_get_marine, openmeteo_get_air_quality, openmeteo_get_ensemble, openmeteo_get_flood, openmeteo_dataframe_query, openmeteo_dataframe_describe

RH8P.1T  turn  complete  3 rounds  (6342 tokens)
RH8P.1T.1.1-U  user_prompt  (27 tokens)
  What's the current temperature and wind speed in Oslo, Norway right now? Use the weather tools to look it up.
RH8P.1T.1.2-T  tool_call  openmeteo_geocode  (20 tokens)
  {"name":"Oslo, Norway"}
RH8P.1T.2.1-T  tool_call  openmeteo_get_forecast  (1242 tokens)
  {"latitude":59.91273,"longitude":10.74609,"hourly_variables":["temperature_2m","wind_speed_10m"],"timezone":"auto"}
RH8P.1T.3.1-A  assistant_answer  (30 tokens)
  The current temperature in Oslo, Norway is approximately **21.9°C** and the wind speed is about **13.7 km/h**.

RH8P.2C  compaction  complete  strip-reasoning  after turn 1

RH8P.2T  turn  error (step-error)  1 round
RH8P.2T.1.1-U  user_prompt
  Now compare that to Bergen — which of the two cities is warmer right now, and by how much?
```
