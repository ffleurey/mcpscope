import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOpenMeteoServer } from "./server.js";

type StubResponse = { ok?: boolean; status?: number; json: unknown };

function stubFetch(handler: (url: string) => StubResponse): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const r = handler(String(input));
      return {
        ok: r.ok ?? true,
        status: r.status ?? 200,
        statusText: "",
        json: async () => r.json,
      } as Response;
    }),
  );
}

async function connectClient(): Promise<Client> {
  const server = createOpenMeteoServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

async function callJson(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  const first = content[0];
  const text = first && first.type === "text" ? (first.text ?? "") : "";
  return { data: JSON.parse(text), isError: result.isError === true };
}

afterEach(() => vi.unstubAllGlobals());

describe("open-meteo companion server", () => {
  it("exposes the expected tools", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "geocode_place",
      "get_current_weather",
      "get_forecast",
      "get_historical_weather",
    ]);
  });

  it("geocode_place returns compact matches with a next-step hint", async () => {
    stubFetch((url) => {
      expect(url).toContain("geocoding-api.open-meteo.com");
      return {
        json: {
          results: [
            {
              name: "Oslo",
              latitude: 59.91,
              longitude: 10.75,
              country: "Norway",
              admin1: "Oslo",
              timezone: "Europe/Oslo",
              population: 1000000,
            },
          ],
        },
      };
    });
    const client = await connectClient();
    const { data, isError } = await callJson(client, "geocode_place", {
      name: "Oslo",
    });
    expect(isError).toBe(false);
    const parsed = data as {
      match_count: number;
      resolved_query: string;
      matches: Array<{ latitude: number }>;
      next_step: string;
    };
    expect(parsed.match_count).toBe(1);
    expect(parsed.resolved_query).toBe("Oslo");
    expect(parsed.matches[0]?.latitude).toBe(59.91);
    expect(parsed.next_step).toContain("latitude");
  });

  it("geocode_place walks the normalization ladder to resolve informal input in one call", async () => {
    // Only the expanded, comma-stripped official name matches; the raw informal
    // query yields nothing. The ladder should find it within a single tool call.
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const name = url.searchParams.get("name") ?? "";
      const results =
        name === "Saint-Martin-de-Sanzay"
          ? [
              {
                name: "Saint-Martin-de-Sanzay",
                latitude: 47.09,
                longitude: -0.15,
                country: "France",
              },
            ]
          : [];
      return {
        ok: true,
        status: 200,
        statusText: "",
        json: async () => ({ results }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await connectClient();
    const { data, isError } = await callJson(client, "geocode_place", {
      name: "St-Martin-de-Sanzay, France 79290",
    });
    expect(isError).toBe(false);
    const parsed = data as {
      match_count: number;
      resolved_query: string;
      matches: Array<{ name: string }>;
    };
    expect(parsed.match_count).toBe(1);
    expect(parsed.resolved_query).toBe("Saint-Martin-de-Sanzay");
    expect(parsed.matches[0]?.name).toBe("Saint-Martin-de-Sanzay");
    // Raw → comma-stripped → expanded (match, stop). Bare postcode never reached.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("geocode_place reports a directive hint when nothing matches", async () => {
    stubFetch(() => ({ json: { results: [] } }));
    const client = await connectClient();
    const { data } = await callJson(client, "geocode_place", { name: "Nowhereville" });
    const parsed = data as { match_count: number; next_step: string };
    expect(parsed.match_count).toBe(0);
    expect(parsed.next_step).toContain("postal code");
  });

  it("get_forecast (concise) zips daily rows and adds plain-text conditions", async () => {
    stubFetch((url) => {
      expect(url).toContain("api.open-meteo.com/v1/forecast");
      expect(url).not.toContain("hourly=");
      return {
        json: {
          timezone: "Europe/Oslo",
          daily: {
            time: ["2026-07-05", "2026-07-06"],
            weather_code: [0, 61],
            temperature_2m_max: [20, 18],
            temperature_2m_min: [10, 9],
            precipitation_sum: [0, 5],
            wind_speed_10m_max: [12, 15],
          },
          daily_units: { temperature_2m_max: "°C" },
        },
      };
    });
    const client = await connectClient();
    const { data } = await callJson(client, "get_forecast", {
      latitude: 59.91,
      longitude: 10.75,
      days: 2,
    });
    const parsed = data as {
      days: Array<{ conditions: string; temperature_2m_max: number }>;
      hourly?: unknown;
    };
    expect(parsed.days).toHaveLength(2);
    expect(parsed.days[0]?.conditions).toBe("Clear sky");
    expect(parsed.days[1]?.conditions).toBe("Slight rain");
    expect(parsed.hourly).toBeUndefined();
  });

  it("get_forecast (detailed) requests and returns the hourly series", async () => {
    stubFetch((url) => {
      expect(url).toContain("hourly=");
      return {
        json: {
          timezone: "Europe/Oslo",
          daily: { time: ["2026-07-05"], weather_code: [2] },
          hourly: {
            time: ["2026-07-05T00:00", "2026-07-05T01:00"],
            temperature_2m: [12, 11],
          },
        },
      };
    });
    const client = await connectClient();
    const { data } = await callJson(client, "get_forecast", {
      latitude: 1,
      longitude: 2,
      days: 1,
      response_format: "detailed",
    });
    const parsed = data as { hourly: Array<{ temperature_2m: number }> };
    expect(parsed.hourly).toHaveLength(2);
    expect(parsed.hourly[0]?.temperature_2m).toBe(12);
  });

  it("returns an error result when the upstream fails", async () => {
    stubFetch(() => ({ ok: false, status: 502, json: {} }));
    const client = await connectClient();
    const { data, isError } = await callJson(client, "get_current_weather", {
      latitude: 1,
      longitude: 2,
    });
    expect(isError).toBe(true);
    expect(JSON.stringify(data)).toContain("502");
  });
});
