# World Bank companion

Keyless economics & development statistics over the [World Bank open data API
v2](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392). Illustrates
numeric-series retrieval and natural "fetch two series → compute a ratio/trend" chaining
(e.g. GDP per capita, or one country vs. another).

## Tools

- `search_indicators(query, limit=20)` — find indicator codes by keyword (over the World
  Development Indicators set), returning `[{ code, name }]` (e.g. `NY.GDP.MKTP.CD`).
- `get_indicator(country_code, indicator_code, start_year?, end_year?)` — a country's yearly
  series for one indicator, oldest-first, missing years omitted.
- `list_countries(region?)` — countries with code, region, income level, and capital; filter by
  region name substring. Aggregate rows are excluded.

The API offers no indicator text search, so `search_indicators` fetches the curated WDI set
(source 2, ~1500 indicators) once, caches it, and filters locally.

## Endpoint (no API key)

- `https://api.worldbank.org/v2/` — responses are `[metadata, rows]` JSON arrays.

## Attribution & fair use

Data from the [World Bank](https://data.worldbank.org), provided as open data (CC BY 4.0).
Requests identify mcpscope via the shared companion `User-Agent`.
