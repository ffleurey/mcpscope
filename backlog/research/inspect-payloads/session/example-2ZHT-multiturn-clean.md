# inspect example — multi-turn session, clean (2ZHT)

- **Source:** `2ZHT` — a clean 2-turn primary session (Gemini 2.5 Flash Lite + Meteo). The
  reference for a healthy multi-turn trace: per-turn header lines (rounds + token cost), a
  compaction step rendered **between** each turn (chronological order), and growing context
  (4061 → 5933 tokens). One full fetch carries both asks, both answers, and every tool call.
- **Captured:** rebuilt backend (Phase 2), live MCP/API against `backend-data/`, 2026-06-28.

## Summary mode

`mcpscope inspect --short 2ZHT`

```text
2ZHT  Multi-turn clean (Gemini Flash Lite + Meteo)
  model       Gemini 2.5 Flash Lite  google/gemini-2.5-flash-lite
  mcp         Meteo
  context     5933 / 1048576 tokens
  compaction  strip-reasoning
  tool rounds 20
  status      complete

2ZHT.S.1-MI  mcp_instructions  (490 tokens)
2ZHT.S.2-TD  tool_definitions  10 tools  (3415 tokens)
  openmeteo_geocode, openmeteo_get_elevation, openmeteo_get_forecast, openmeteo_get_historical, openmeteo_get_marine, openmeteo_get_air_quality, openmeteo_get_ensemble, openmeteo_get_flood, openmeteo_dataframe_query, openmeteo_dataframe_describe

2ZHT.1T  turn  complete  2 rounds  (4061 tokens)
2ZHT.1T.1.1-U  user_prompt  (16 tokens)
2ZHT.1T.1.2-T  tool_call  openmeteo_geocode  (10 tokens)
2ZHT.1T.2.1-A  assistant_answer  (25 tokens)

2ZHT.2C  compaction  complete  strip-reasoning  after turn 1

2ZHT.2T  turn  complete  3 rounds  (5933 tokens)
2ZHT.2T.1.1-U  user_prompt  (15 tokens)
2ZHT.2T.1.2-T  tool_call  openmeteo_geocode  (10 tokens)
2ZHT.2T.2.1-T  tool_call  openmeteo_get_forecast  (369 tokens)
2ZHT.2T.2.2-T  tool_call  openmeteo_get_forecast  (370 tokens)
2ZHT.2T.3.1-A  assistant_answer  (40 tokens)

2ZHT.4C  compaction  complete  strip-reasoning  after turn 2
```

## Full mode

`mcpscope inspect 2ZHT`

```text
2ZHT  Multi-turn clean (Gemini Flash Lite + Meteo)
  model       Gemini 2.5 Flash Lite  google/gemini-2.5-flash-lite
  mcp         Meteo
  context     5933 / 1048576 tokens
  compaction  strip-reasoning
  tool rounds 20
  status      complete

2ZHT.S.1-MI  mcp_instructions  (490 tokens)
2ZHT.S.2-TD  tool_definitions  10 tools  (3415 tokens)
  openmeteo_geocode, openmeteo_get_elevation, openmeteo_get_forecast, openmeteo_get_historical, openmeteo_get_marine, openmeteo_get_air_quality, openmeteo_get_ensemble, openmeteo_get_flood, openmeteo_dataframe_query, openmeteo_dataframe_describe

2ZHT.1T  turn  complete  2 rounds  (4061 tokens)
2ZHT.1T.1.1-U  user_prompt  (16 tokens)
  What's the current temperature in Oslo, Norway? Use the weather tools.
2ZHT.1T.1.2-T  tool_call  openmeteo_geocode  (10 tokens)
  {"name":"Oslo, Norway"}
2ZHT.1T.2.1-A  assistant_answer  (25 tokens)
  I can't get the *current* temperature, but I can get the forecast for today. Would you like that?

2ZHT.2C  compaction  complete  strip-reasoning  after turn 1

2ZHT.2T  turn  complete  3 rounds  (5933 tokens)
2ZHT.2T.1.1-U  user_prompt  (15 tokens)
  And what about Bergen — is it warmer or colder than Oslo right now?
2ZHT.2T.1.2-T  tool_call  openmeteo_geocode  (10 tokens)
  {"name":"Bergen, Norway"}
2ZHT.2T.2.1-T  tool_call  openmeteo_get_forecast  (369 tokens)
  {"forecast_days":1,"timezone":"Europe/Oslo","hourly_variables":["temperature_2m"],"longitude":10.74609,"latitude":59.91273}
2ZHT.2T.2.2-T  tool_call  openmeteo_get_forecast  (370 tokens)
  {"hourly_variables":["temperature_2m"],"longitude":5.32415,"latitude":60.39299,"forecast_days":1,"timezone":"Europe/Oslo"}
2ZHT.2T.3.1-A  assistant_answer  (40 tokens)
  It looks like Bergen is currently colder than Oslo. In Oslo, the temperature is around 22.2°C, while in Bergen it's about 17.1°C.

2ZHT.4C  compaction  complete  strip-reasoning  after turn 2
```
