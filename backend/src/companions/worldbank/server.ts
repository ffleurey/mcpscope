import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CompanionError, fetchJson } from "../shared/http.js";
import { registerJsonTool } from "../shared/tool.js";

// The World Bank open data API v2 is keyless. Every endpoint returns a two-element
// JSON array: [ pagination-metadata, data-rows ]. On a bad request it returns a
// single-element array whose meta carries a `message`.
const WB_BASE = "https://api.worldbank.org/v2";

// Indicator full-text search is not offered by the API, so search_indicators works
// over the curated World Development Indicators set (source=2, ~1500 indicators) —
// small enough to fetch once and filter locally. Cached module-level (the list is
// static) so repeated searches don't re-download it.
let wdiIndicatorsCache: Array<{ id: string; name: string }> | null = null;

/** Extract the data-rows array from a World Bank `[meta, rows]` response. */
function wbData<T>(resp: unknown): T[] {
  if (!Array.isArray(resp)) {
    throw new CompanionError("World Bank API returned an unexpected response");
  }
  const meta = resp[0] as { message?: Array<{ value?: string }> } | undefined;
  if (meta?.message?.length) {
    throw new CompanionError(
      `World Bank API error: ${meta.message[0]?.value ?? "unknown"}`,
    );
  }
  const rows = resp[1];
  return Array.isArray(rows) ? (rows as T[]) : [];
}

interface WbIndicator {
  id: string;
  name: string;
}

interface WbDataRow {
  date?: string;
  value?: number | null;
  unit?: string;
  indicator?: { id?: string; value?: string };
  country?: { id?: string; value?: string };
}

interface WbCountry {
  id?: string;
  iso2Code?: string;
  name?: string;
  region?: { value?: string };
  incomeLevel?: { value?: string };
  capitalCity?: string;
}

async function loadWdiIndicators(): Promise<Array<{ id: string; name: string }>> {
  if (wdiIndicatorsCache) return wdiIndicatorsCache;
  const resp = await fetchJson<unknown>(`${WB_BASE}/indicator`, {
    params: { format: "json", per_page: 2000, source: 2 },
  });
  wdiIndicatorsCache = wbData<WbIndicator>(resp).map((i) => ({
    id: i.id,
    name: i.name,
  }));
  return wdiIndicatorsCache;
}

export function createWorldBankServer(): McpServer {
  const server = new McpServer(
    { name: "mcpscope-worldbank", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  registerJsonTool(
    server,
    "search_indicators",
    "Find World Bank indicator codes by keyword (over the World Development " +
      "Indicators set). Indicators are the metrics you can fetch — e.g. searching " +
      "'gdp per capita' returns code 'NY.GDP.PCAP.CD'. Use this FIRST to get the exact " +
      "`code`, then pass it with a country_code to get_indicator. Returns [{ code, " +
      "name }].",
    {
      query: z
        .string()
        .min(1)
        .describe("Keyword to match against indicator names, e.g. 'population'."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe("Maximum number of matches, 1–50 (default 20)."),
    },
    async ({ query, limit }) => {
      const indicators = await loadWdiIndicators();
      const q = query.toLowerCase();
      const matches = indicators
        .filter(
          (i) =>
            i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q),
        )
        .slice(0, limit)
        .map((i) => ({ code: i.id, name: i.name }));
      return {
        query,
        count: matches.length,
        indicators: matches,
        next_step:
          matches.length > 0
            ? "Pass a code (e.g. 'NY.GDP.MKTP.CD') and a country_code to get_indicator."
            : "No indicators matched — try a broader keyword like 'gdp', 'population', or 'life expectancy'.",
      };
    },
  );

  registerJsonTool(
    server,
    "get_indicator",
    "Get a yearly time series for one indicator in one country. Provide a " +
      "`country_code` (ISO-3166 alpha-2 or alpha-3, e.g. 'US' or 'USA') and an " +
      "`indicator_code` from search_indicators (e.g. 'NY.GDP.MKTP.CD'). Optionally " +
      "restrict to a year range. Returns the series oldest-first — fetch two series " +
      "(or two countries) and compute a ratio/trend yourself. Values with no data are " +
      "omitted.",
    {
      country_code: z
        .string()
        .min(2)
        .describe("Country code, ISO alpha-2 or alpha-3, e.g. 'US' or 'USA'."),
      indicator_code: z
        .string()
        .min(1)
        .describe("Indicator code from search_indicators, e.g. 'NY.GDP.MKTP.CD'."),
      start_year: z
        .number()
        .int()
        .optional()
        .describe("First year to include (inclusive)."),
      end_year: z
        .number()
        .int()
        .optional()
        .describe("Last year to include (inclusive)."),
    },
    async ({ country_code, indicator_code, start_year, end_year }) => {
      const date =
        start_year !== undefined && end_year !== undefined
          ? `${start_year}:${end_year}`
          : start_year !== undefined
            ? `${start_year}:${start_year}`
            : end_year !== undefined
              ? `${end_year}:${end_year}`
              : undefined;
      const resp = await fetchJson<unknown>(
        `${WB_BASE}/country/${encodeURIComponent(country_code)}/indicator/${encodeURIComponent(indicator_code)}`,
        { params: { format: "json", per_page: 500, date } },
      );
      const rows = wbData<WbDataRow>(resp);
      if (rows.length === 0) {
        throw new CompanionError(
          `No data for indicator '${indicator_code}' in '${country_code}'. Verify the codes with search_indicators and list_countries.`,
        );
      }
      const series = rows
        .filter((r) => r.value !== null && r.value !== undefined)
        .map((r) => ({ year: r.date, value: r.value }))
        .sort((a, b) => Number(a.year) - Number(b.year));
      const first = rows[0];
      return {
        country: first?.country?.value,
        country_code,
        indicator: first?.indicator?.value,
        indicator_code,
        observations: series.length,
        series,
      };
    },
  );

  registerJsonTool(
    server,
    "list_countries",
    "List World Bank countries with their codes, region, income level, and capital. " +
      "Use the two- or three-letter `code` with get_indicator. Optionally pass " +
      "`region` to filter by region name (a case-insensitive substring, e.g. 'europe' " +
      "or 'sub-saharan'). Aggregate/region rows are excluded — only real countries are " +
      "returned.",
    {
      region: z
        .string()
        .optional()
        .describe(
          "Filter by region name substring, e.g. 'europe'. Omit to list all countries.",
        ),
    },
    async ({ region }) => {
      const resp = await fetchJson<unknown>(`${WB_BASE}/country`, {
        params: { format: "json", per_page: 400 },
      });
      let countries = wbData<WbCountry>(resp).filter(
        (c) => c.region?.value && c.region.value !== "Aggregates",
      );
      if (region) {
        const rq = region.toLowerCase();
        countries = countries.filter((c) =>
          c.region?.value?.toLowerCase().includes(rq),
        );
      }
      const list = countries.map((c) => ({
        code: c.id,
        iso2: c.iso2Code,
        name: c.name,
        region: c.region?.value,
        income_level: c.incomeLevel?.value,
        capital: c.capitalCity || undefined,
      }));
      return {
        region: region ?? "all",
        count: list.length,
        countries: list,
        next_step:
          "Pass a country code (e.g. 'USA') and an indicator_code to get_indicator.",
      };
    },
  );

  return server;
}
