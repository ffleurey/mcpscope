# Open-Meteo companion

Keyless weather over the [Open-Meteo](https://open-meteo.com) API. Illustrates simple tool
chaining: resolve a place name to coordinates first, then fetch weather.

## Tools

- `geocode_place(name, count=5)` — place name → ranked coordinates (call this first).
  Open-Meteo geocoding matches rigidly (bare official name **or** bare postcode), so the tool
  runs a small normalization ladder server-side — as-is → drop a trailing country/postcode →
  expand `St`→`Saint` → bare postcode — and returns the first query that matches (reported as
  `resolved_query`). This turns a small model's trial-and-error into one call.
- `get_current_weather(latitude, longitude)` — current conditions.
- `get_forecast(latitude, longitude, days=7, response_format=concise|detailed)` — daily
  forecast; `detailed` additionally returns the token-heavy hourly series.
- `get_historical_weather(latitude, longitude, start_date, end_date)` — ERA5 daily archive.

WMO weather codes are translated to plain-text conditions in the payload.

## Endpoints (no API key for non-commercial use)

- Geocoding: `https://geocoding-api.open-meteo.com/v1/search`
- Forecast: `https://api.open-meteo.com/v1/forecast`
- Archive: `https://archive-api.open-meteo.com/v1/archive`

## Attribution & fair use

Weather data by [Open-Meteo.com](https://open-meteo.com), licensed **CC BY 4.0**. Non-commercial
use is free and keyless (fair-use ceiling ~10,000 requests/day). Requests identify mcpscope via
the shared companion `User-Agent`.
