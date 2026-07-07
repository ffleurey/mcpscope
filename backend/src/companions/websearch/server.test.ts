import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWebSearchServer } from "./server.js";

type Captured = { url: string; headers: Record<string, string> };

function stubFetch(handler: (c: Captured) => unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      return {
        ok: true,
        status: 200,
        statusText: "",
        json: async () => handler({ url: String(input), headers }),
      } as Response;
    }),
  );
}

async function connectClient(apiKey: string | null): Promise<Client> {
  const server = createWebSearchServer(apiKey);
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

describe("websearch companion server", () => {
  it("exposes the web_search tool", async () => {
    const client = await connectClient("k");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["web_search"]);
  });

  it("sends the token header, strips highlight markup, and maps results", async () => {
    let captured: Captured | null = null;
    stubFetch((c) => {
      captured = c;
      return {
        web: {
          results: [
            {
              title: "Model Context Protocol",
              url: "https://modelcontextprotocol.io",
              description: "MCP is <strong>an open standard</strong> for tools.",
              page_age: "2025-01-01",
            },
          ],
        },
      };
    });
    const client = await connectClient("secret-token");
    const { data, isError } = await callJson(client, "web_search", {
      query: "mcp",
      count: 3,
    });
    expect(isError).toBe(false);
    expect(captured!.url).toContain("count=3");
    expect(captured!.headers["x-subscription-token"]).toBe("secret-token");
    const parsed = data as {
      results: Array<{ title: string; url: string; snippet: string }>;
      next_step: string;
    };
    expect(parsed.results[0]?.snippet).toBe("MCP is an open standard for tools.");
    expect(parsed.results[0]?.url).toBe("https://modelcontextprotocol.io");
    expect(parsed.next_step).toContain("fetch_url");
  });

  it("errors in-band with a directive hint when no api key is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = await connectClient(null);
    const { data, isError } = await callJson(client, "web_search", {
      query: "anything",
    });
    expect(isError).toBe(true);
    expect(JSON.stringify(data)).toContain("companions.brave.api_key");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
