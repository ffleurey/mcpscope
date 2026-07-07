import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGuardianServer } from "./server.js";

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

async function connectClient(apiKey: string | null): Promise<Client> {
  const server = createGuardianServer(apiKey);
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

describe("guardian companion server", () => {
  it("exposes the expected tools", async () => {
    const client = await connectClient("test");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_article",
      "search_articles",
    ]);
  });

  it("search_articles maps results and passes filters + api key", async () => {
    let requested = "";
    stubFetch((url) => {
      requested = url;
      return {
        response: {
          status: "ok",
          total: 131202,
          results: [
            {
              id: "world/2026/jan/01/story",
              sectionName: "World news",
              webPublicationDate: "2026-01-01T10:00:00Z",
              webTitle: "A Headline",
              webUrl: "https://www.theguardian.com/world/2026/jan/01/story",
            },
          ],
        },
      };
    });
    const client = await connectClient("secret-key");
    const { data, isError } = await callJson(client, "search_articles", {
      query: "climate",
      section: "world",
      from_date: "2026-01-01",
    });
    expect(isError).toBe(false);
    expect(requested).toContain("api-key=secret-key");
    expect(requested).toContain("section=world");
    expect(requested).toContain("from-date=2026-01-01");
    const parsed = data as {
      total_available: number;
      results: Array<{ id: string; url: string }>;
      next_step: string;
    };
    expect(parsed.total_available).toBe(131202);
    expect(parsed.results[0]?.id).toBe("world/2026/jan/01/story");
    expect(parsed.next_step).toContain("get_article");
  });

  it("get_article concise omits the body; detailed includes it", async () => {
    stubFetch((url) => {
      expect(url).toContain("/world/2026/jan/01/story");
      return {
        response: {
          status: "ok",
          content: {
            id: "world/2026/jan/01/story",
            sectionName: "World news",
            webPublicationDate: "2026-01-01T10:00:00Z",
            webTitle: "A Headline",
            webUrl: "https://www.theguardian.com/world/2026/jan/01/story",
            fields: {
              headline: "A Headline",
              byline: "A Reporter",
              trailText: "The standfirst.",
              bodyText: "The full body text.",
            },
          },
        },
      };
    });
    const client = await connectClient("test");
    const concise = await callJson(client, "get_article", {
      id: "world/2026/jan/01/story",
    });
    expect((concise.data as { body?: string }).body).toBeUndefined();
    expect((concise.data as { standfirst: string }).standfirst).toBe(
      "The standfirst.",
    );

    const detailed = await callJson(client, "get_article", {
      id: "world/2026/jan/01/story",
      response_format: "detailed",
    });
    expect((detailed.data as { body: string }).body).toBe("The full body text.");
  });

  it("errors in-band with a directive hint when no api key is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = await connectClient(null);
    const { data, isError } = await callJson(client, "search_articles", {
      query: "anything",
    });
    expect(isError).toBe(true);
    expect(JSON.stringify(data)).toContain("companions.guardian.api_key");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
