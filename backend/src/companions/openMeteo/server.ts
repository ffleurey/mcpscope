import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchJson } from "../shared/http.js";
import {
  registerJsonTool,
  responseFormatSchema,
  type ResponseFormat,
} from "../shared/tool.js";

// Open-Meteo is keyless for non-commercial use. Three endpoints are used:
//   geocoding — resolve a place name to coordinates
//   forecast  — current conditions + up to 16-day daily/hourly forecast
//   archive   — ERA5 historical daily weather (1940–present)
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

const DAILY_VARIABLES =
  "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max";
const HOURLY_VARIABLES = "temperature_2m,precipitation,wind_speed_10m";
const CURRENT_VARIABLES =
  "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m";

// WMO weather interpretation codes → short human text (pre-chewed output so a
// small model never has to remember the code table).
const WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snowfall",
  73: "Moderate snowfall",
  75: "Heavy snowfall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function describeWeatherCode(code: unknown): string {
  return typeof code === "number"
    ? (WEATHER_CODES[code] ?? `Unknown (code ${code})`)
    : "Unknown";
}

/** Zip Open-Meteo's columnar `{ time:[], var:[] }` block into per-timestamp rows. */
function zipSeries(
  block: Record<string, unknown> | undefined,
): Array<Record<string, unknown>> {
  if (!block || !Array.isArray(block.time)) return [];
  const time = block.time as unknown[];
  const keys = Object.keys(block).filter((k) => k !== "time");
  return time.map((t, i) => {
    const row: Record<string, unknown> = { time: t };
    for (const key of keys) {
      const column = block[key];
      if (Array.isArray(column)) row[key] = column[i];
    }
    if ("weather_code" in row) row.conditions = describeWeatherCode(row.weather_code);
    return row;
  });
}

interface GeocodeResult {
  results?: Array<{
    name?: string;
    latitude?: number;
    longitude?: number;
    country?: string;
    admin1?: string;
    timezone?: string;
    population?: number;
  }>;
}

/**
 * Open-Meteo geocoding matches rigidly: the bare official place name OR a bare
 * postcode, nothing in between. A small model tends to echo the user's informal
 * phrasing ("St Martin de Sanzay, France 79290") and gets 0 matches, then burns
 * several calls guessing. This ladder does that guessing server-side: from the
 * raw input it derives an ordered, de-duplicated list of candidate queries
 * (as-is → drop trailing country/postcode → expand St→Saint etc. → bare postcode)
 * so one tool call normally resolves instead of six ("outcomes, not operations").
 */
function geocodeCandidates(raw: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (value: string): void => {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      candidates.push(trimmed);
    }
  };

  add(raw);
  // Drop a trailing country/postcode segment: "St Martin, France 79290" → "St Martin".
  const beforeComma = raw.split(",")[0] ?? raw;
  add(beforeComma);
  // Expand the abbreviations Open-Meteo spells out in official names.
  const expanded = beforeComma
    .replace(/\bSt\.?\b/gi, "Saint")
    .replace(/\bSte\.?\b/gi, "Sainte")
    .replace(/\bMt\.?\b/gi, "Mount")
    .replace(/\bFt\.?\b/gi, "Fort");
  add(expanded);
  // Fall back to a bare postcode anywhere in the input — Open-Meteo matches those.
  const postcode = raw.match(/\b\d{4,6}\b/)?.[0];
  if (postcode) add(postcode);

  return candidates;
}

export function createOpenMeteoServer(): McpServer {
  const server = new McpServer(
    { name: "mcpscope-open-meteo", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  registerJsonTool(
    server,
    "geocode_place",
    "Resolve a place name to geographic coordinates. Weather tools take " +
      "latitude/longitude, not names, so call this FIRST for any name-based " +
      "question, then pass a result's latitude/longitude to get_current_weather, " +
      "get_forecast, or get_historical_weather. Pass the BARE official place name " +
      "(e.g. 'Berlin', 'Saint-Martin-de-Sanzay') OR a postal code alone (e.g. " +
      "'79290') — do NOT append the country or postcode to the name. The server " +
      "automatically retries common variations (dropping a trailing country/postcode, " +
      "expanding 'St'→'Saint', then the postal code), so one call is normally enough. " +
      "Returns up to `count` ranked matches.",
    {
      name: z.string().min(1).describe("Place name to look up, e.g. 'Berlin'."),
      count: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe("Maximum number of matches to return (default 5)."),
    },
    async ({ name, count }) => {
      // Walk the normalization ladder, stopping at the first query that matches.
      let resolvedQuery = name;
      let matches: Array<Record<string, unknown>> = [];
      for (const candidate of geocodeCandidates(name)) {
        const data = await fetchJson<GeocodeResult>(GEOCODING_URL, {
          params: { name: candidate, count, language: "en", format: "json" },
        });
        const found = (data.results ?? []).map((r) => ({
          name: r.name,
          country: r.country,
          admin1: r.admin1,
          latitude: r.latitude,
          longitude: r.longitude,
          timezone: r.timezone,
          population: r.population,
        }));
        if (found.length > 0) {
          resolvedQuery = candidate;
          matches = found;
          break;
        }
      }
      return {
        query: name,
        resolved_query: resolvedQuery,
        match_count: matches.length,
        matches,
        next_step:
          matches.length > 0
            ? "Pass a match's latitude and longitude to get_current_weather / get_forecast / get_historical_weather."
            : "No matches. Retry with ONLY the bare official place name (expand abbreviations like 'St'→'Saint') OR the postal code alone — never combine the name with a country or postcode.",
      };
    },
  );

  registerJsonTool(
    server,
    "get_current_weather",
    "Get the CURRENT weather at a coordinate (temperature, apparent temperature, " +
      "humidity, precipitation, wind, and a plain-text condition). Use get_forecast " +
      "for future days and get_historical_weather for past dates. Coordinates come " +
      "from geocode_place.",
    {
      latitude: z.number().describe("Latitude in decimal degrees."),
      longitude: z.number().describe("Longitude in decimal degrees."),
    },
    async ({ latitude, longitude }) => {
      const data = await fetchJson<{
        current?: Record<string, unknown>;
        current_units?: Record<string, unknown>;
        timezone?: string;
      }>(FORECAST_URL, {
        params: {
          latitude,
          longitude,
          current: CURRENT_VARIABLES,
          timezone: "auto",
        },
      });
      const current = data.current ?? {};
      return {
        location: { latitude, longitude, timezone: data.timezone },
        current: { ...current, conditions: describeWeatherCode(current.weather_code) },
        units: data.current_units,
      };
    },
  );

  registerJsonTool(
    server,
    "get_forecast",
    "Get a daily weather forecast (1–16 days) for a coordinate: per-day high/low " +
      "temperature, precipitation, max wind, and a plain-text condition. " +
      "response_format='detailed' additionally returns the hour-by-hour series, which " +
      "is much larger. Coordinates come from geocode_place.",
    {
      latitude: z.number().describe("Latitude in decimal degrees."),
      longitude: z.number().describe("Longitude in decimal degrees."),
      days: z
        .number()
        .int()
        .min(1)
        .max(16)
        .default(7)
        .describe("Number of forecast days, 1–16 (default 7)."),
      response_format: responseFormatSchema,
    },
    async ({ latitude, longitude, days, response_format }) => {
      const detailed: boolean = (response_format as ResponseFormat) === "detailed";
      const data = await fetchJson<{
        daily?: Record<string, unknown>;
        daily_units?: Record<string, unknown>;
        hourly?: Record<string, unknown>;
        timezone?: string;
      }>(FORECAST_URL, {
        params: {
          latitude,
          longitude,
          forecast_days: days,
          daily: DAILY_VARIABLES,
          hourly: detailed ? HOURLY_VARIABLES : undefined,
          timezone: "auto",
        },
      });
      const result: Record<string, unknown> = {
        location: { latitude, longitude, timezone: data.timezone },
        days: zipSeries(data.daily),
        units: data.daily_units,
      };
      if (detailed) result.hourly = zipSeries(data.hourly);
      return result;
    },
  );

  registerJsonTool(
    server,
    "get_historical_weather",
    "Get PAST daily weather (high/low temperature, precipitation) for a coordinate " +
      "over a date range, from the ERA5 archive (1940–present). Dates are " +
      "YYYY-MM-DD and must be in the past. Use get_forecast for upcoming days. " +
      "Coordinates come from geocode_place.",
    {
      latitude: z.number().describe("Latitude in decimal degrees."),
      longitude: z.number().describe("Longitude in decimal degrees."),
      start_date: z.string().describe("Start date, inclusive, YYYY-MM-DD."),
      end_date: z.string().describe("End date, inclusive, YYYY-MM-DD."),
    },
    async ({ latitude, longitude, start_date, end_date }) => {
      const data = await fetchJson<{
        daily?: Record<string, unknown>;
        daily_units?: Record<string, unknown>;
        timezone?: string;
      }>(ARCHIVE_URL, {
        params: {
          latitude,
          longitude,
          start_date,
          end_date,
          daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum",
          timezone: "auto",
        },
      });
      return {
        location: { latitude, longitude, timezone: data.timezone },
        range: { start_date, end_date },
        days: zipSeries(data.daily),
        units: data.daily_units,
      };
    },
  );

  return server;
}
