import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWorldBankServer } from "./server.js";

function stubFetch(handler: (url: string) => unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      return {
        ok: true,
        status: 200,
        statusText: "",
        json: async () => handler(String(input)),
      } as Response;
    }),
  );
}

async function connectClient(): Promise<Client> {
  const server = createWorldBankServer();
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

describe("worldbank companion server", () => {
  it("exposes the expected tools", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_indicator",
      "list_countries",
      "search_indicators",
    ]);
  });

  it("search_indicators filters the WDI set by keyword", async () => {
    stubFetch((url) => {
      expect(url).toContain("/indicator");
      expect(url).toContain("source=2");
      return [
        { page: 1, pages: 1, per_page: 2000, total: 2 },
        [
          { id: "NY.GDP.PCAP.CD", name: "GDP per capita (current US$)" },
          { id: "SP.POP.TOTL", name: "Population, total" },
        ],
      ];
    });
    const client = await connectClient();
    const { data, isError } = await callJson(client, "search_indicators", {
      query: "per capita",
    });
    expect(isError).toBe(false);
    const parsed = data as {
      count: number;
      indicators: Array<{ code: string; name: string }>;
      next_step: string;
    };
    expect(parsed.count).toBe(1);
    expect(parsed.indicators[0]?.code).toBe("NY.GDP.PCAP.CD");
    expect(parsed.next_step).toContain("get_indicator");
  });

  it("get_indicator sorts the series oldest-first and drops null values", async () => {
    stubFetch(() => [
      { page: 1, pages: 1, per_page: 500, total: 3 },
      [
        {
          date: "2022",
          value: 120,
          indicator: { value: "GDP (current US$)" },
          country: { value: "United States" },
        },
        { date: "2021", value: null, indicator: { value: "GDP (current US$)" } },
        { date: "2020", value: 100, indicator: { value: "GDP (current US$)" } },
      ],
    ]);
    const client = await connectClient();
    const { data } = await callJson(client, "get_indicator", {
      country_code: "US",
      indicator_code: "NY.GDP.MKTP.CD",
    });
    const parsed = data as {
      country: string;
      indicator: string;
      observations: number;
      series: Array<{ year: string; value: number }>;
    };
    expect(parsed.country).toBe("United States");
    expect(parsed.observations).toBe(2); // the null year is dropped
    expect(parsed.series.map((s) => s.year)).toEqual(["2020", "2022"]);
  });

  it("get_indicator errors when the country/indicator has no data", async () => {
    stubFetch(() => [{ page: 0, pages: 0, per_page: 500, total: 0 }, null]);
    const client = await connectClient();
    const { data, isError } = await callJson(client, "get_indicator", {
      country_code: "ZZ",
      indicator_code: "BOGUS",
    });
    expect(isError).toBe(true);
    expect(JSON.stringify(data)).toContain("No data");
  });

  it("list_countries excludes aggregates and filters by region substring", async () => {
    stubFetch(() => [
      { page: 1, pages: 1, per_page: 400, total: 2 },
      [
        {
          id: "USA",
          iso2Code: "US",
          name: "United States",
          region: { value: "North America" },
          incomeLevel: { value: "High income" },
          capitalCity: "Washington D.C.",
        },
        { id: "WLD", iso2Code: "1W", name: "World", region: { value: "Aggregates" } },
      ],
    ]);
    const client = await connectClient();
    const all = await callJson(client, "list_countries", {});
    expect((all.data as { count: number }).count).toBe(1); // aggregate dropped

    const europe = await callJson(client, "list_countries", { region: "europe" });
    expect((europe.data as { count: number }).count).toBe(0);

    const northAmerica = await callJson(client, "list_countries", {
      region: "north",
    });
    const parsed = northAmerica.data as {
      countries: Array<{ code: string; capital: string }>;
    };
    expect(parsed.countries[0]?.code).toBe("USA");
    expect(parsed.countries[0]?.capital).toBe("Washington D.C.");
  });
});
