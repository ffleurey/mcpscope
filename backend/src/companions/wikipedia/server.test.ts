import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWikipediaServer } from "./server.js";

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
  const server = createWikipediaServer();
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

describe("wikipedia companion server", () => {
  it("exposes the expected tools", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_article",
      "get_summary",
      "search",
    ]);
  });

  it("search strips snippet HTML and returns a next-step hint", async () => {
    stubFetch((url) => {
      expect(url).toContain("list=search");
      return {
        query: {
          search: [
            {
              title: "Alan Turing",
              pageid: 1208,
              wordcount: 16150,
              snippet:
                'the <span class="searchmatch">Turing</span> machine &quot;model&quot;',
            },
          ],
        },
      };
    });
    const client = await connectClient();
    const { data, isError } = await callJson(client, "search", {
      query: "alan turing",
    });
    expect(isError).toBe(false);
    const parsed = data as {
      results: Array<{ title: string; snippet: string }>;
      next_step: string;
    };
    expect(parsed.results[0]?.title).toBe("Alan Turing");
    expect(parsed.results[0]?.snippet).toBe('the Turing machine "model"');
    expect(parsed.next_step).toContain("get_summary");
  });

  it("get_summary returns the compact extract + url", async () => {
    stubFetch((url) => {
      expect(url).toContain("/page/summary/Alan%20Turing");
      return {
        title: "Alan Turing",
        description: "English computer scientist (1912–1954)",
        extract: "Alan Mathison Turing was an English mathematician...",
        content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Alan_Turing" } },
      };
    });
    const client = await connectClient();
    const { data } = await callJson(client, "get_summary", {
      title: "Alan Turing",
    });
    const parsed = data as { description: string; url: string };
    expect(parsed.description).toContain("computer scientist");
    expect(parsed.url).toBe("https://en.wikipedia.org/wiki/Alan_Turing");
  });

  it("get_article summary requests exintro; full omits it", async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      return {
        query: {
          pages: {
            "1208": { pageid: 1208, title: "Alan Turing", extract: "Lead text." },
          },
        },
      };
    });
    const client = await connectClient();
    await callJson(client, "get_article", { title: "Alan Turing" }); // default summary
    const { data } = await callJson(client, "get_article", {
      title: "Alan Turing",
      response_format: "full",
    });
    expect(urls[0]).toContain("exintro=1");
    expect(urls[1]).not.toContain("exintro");
    const parsed = data as { response_format: string; extract: string; url: string };
    expect(parsed.response_format).toBe("full");
    expect(parsed.url).toBe("https://en.wikipedia.org/wiki/Alan_Turing");
  });

  it("get_article errors clearly for a missing title", async () => {
    stubFetch(() => ({
      query: { pages: { "-1": { title: "Nope", missing: "" } } },
    }));
    const client = await connectClient();
    const { data, isError } = await callJson(client, "get_article", {
      title: "Nope",
    });
    expect(isError).toBe(true);
    expect(JSON.stringify(data)).toContain("No Wikipedia article");
  });
});
