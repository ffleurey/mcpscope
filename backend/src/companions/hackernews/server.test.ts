import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHackerNewsServer } from "./server.js";

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
  const server = createHackerNewsServer();
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

describe("hackernews companion server", () => {
  it("exposes the expected tools", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_item",
      "get_stories",
      "search_stories",
    ]);
  });

  it("get_stories reads a feed, resolves items, and derives hn_url + ISO time", async () => {
    stubFetch((url) => {
      if (url.includes("/topstories.json")) return [8863, 999];
      if (url.includes("/item/8863.json"))
        return {
          id: 8863,
          type: "story",
          by: "dhouston",
          title: "My YC app: Dropbox",
          score: 104,
          descendants: 71,
          url: "http://getdropbox.com",
          time: 1175714200,
          text: "self post body",
        };
      if (url.includes("/item/999.json")) return null; // dropped item
      throw new Error(`unexpected url ${url}`);
    });
    const client = await connectClient();
    const { data, isError } = await callJson(client, "get_stories", {
      feed: "top",
      limit: 2,
    });
    expect(isError).toBe(false);
    const parsed = data as {
      count: number;
      stories: Array<{
        rank: number;
        hn_url: string;
        time_iso: string;
        num_comments: number;
        text?: string;
      }>;
    };
    expect(parsed.count).toBe(1); // the null item is filtered out
    expect(parsed.stories[0]?.rank).toBe(1);
    expect(parsed.stories[0]?.num_comments).toBe(71);
    expect(parsed.stories[0]?.hn_url).toBe(
      "https://news.ycombinator.com/item?id=8863",
    );
    expect(parsed.stories[0]?.time_iso).toBe("2007-04-04T19:16:40.000Z");
    // concise omits the self-post body
    expect(parsed.stories[0]?.text).toBeUndefined();
  });

  it("get_stories detailed includes the self-post body", async () => {
    stubFetch((url) => {
      if (url.includes("/askstories.json")) return [1];
      return {
        id: 1,
        type: "story",
        title: "Ask HN",
        time: 1175714200,
        text: "the question body",
      };
    });
    const client = await connectClient();
    const { data } = await callJson(client, "get_stories", {
      feed: "ask",
      response_format: "detailed",
    });
    const parsed = data as { stories: Array<{ text?: string }> };
    expect(parsed.stories[0]?.text).toBe("the question body");
  });

  it("search_stories maps Algolia hits and picks the date endpoint + min_points filter", async () => {
    let requested = "";
    stubFetch((url) => {
      requested = url;
      return {
        nbHits: 42,
        hits: [
          {
            objectID: "22238335",
            title: "Why Discord is switching to Rust",
            url: "https://blog.discord.com/rust",
            author: "Sikul",
            points: 900,
            num_comments: 500,
            created_at: "2020-02-04T00:00:00Z",
            created_at_i: 1580774400,
          },
        ],
      };
    });
    const client = await connectClient();
    const { data } = await callJson(client, "search_stories", {
      query: "rust",
      sort: "date",
      min_points: 100,
    });
    expect(requested).toContain("/search_by_date");
    expect(requested).toContain("points%3E%3D100"); // points>=100 url-encoded
    const parsed = data as {
      total_available: number;
      results: Array<{ id: number; hn_url: string }>;
      next_step: string;
    };
    expect(parsed.total_available).toBe(42);
    expect(parsed.results[0]?.id).toBe(22238335);
    expect(parsed.results[0]?.hn_url).toBe(
      "https://news.ycombinator.com/item?id=22238335",
    );
    expect(parsed.next_step).toContain("get_item");
  });

  it("get_item walks a bounded comment tree and caps at comment_limit", async () => {
    // Story 100 has three top-level kids; comment 10 has a nested reply.
    stubFetch((url) => {
      if (url.includes("/item/100.json"))
        return { id: 100, type: "story", title: "Root", time: 1, kids: [10, 11, 12] };
      if (url.includes("/item/10.json"))
        return { id: 10, type: "comment", by: "a", text: "first", time: 2, kids: [20] };
      if (url.includes("/item/20.json"))
        return { id: 20, type: "comment", by: "b", text: "nested", time: 3 };
      if (url.includes("/item/11.json"))
        return { id: 11, type: "comment", by: "c", text: "second", time: 4 };
      if (url.includes("/item/12.json"))
        return { id: 12, type: "comment", by: "d", text: "third", time: 5 };
      throw new Error(`unexpected url ${url}`);
    });
    const client = await connectClient();
    const { data } = await callJson(client, "get_item", {
      id: 100,
      include_comments: true,
      max_depth: 2,
      comment_limit: 2,
    });
    const parsed = data as {
      comments: Array<{ id: number; replies?: Array<{ id: number }> }>;
      comments_returned: number;
      comment_note?: string;
    };
    // Budget of 2: comment 10 (+ its nested reply 20) is collected, then the cap hits.
    expect(parsed.comments_returned).toBe(2);
    expect(parsed.comments[0]?.id).toBe(10);
    expect(parsed.comments[0]?.replies?.[0]?.id).toBe(20);
    expect(parsed.comments).toHaveLength(1); // sibling 11 never fetched (cap reached)
    expect(parsed.comment_note).toContain("Truncated");
  });

  it("get_item without comments returns a story and a comments_hint", async () => {
    stubFetch(() => ({
      id: 100,
      type: "story",
      title: "Root",
      descendants: 5,
      time: 1,
    }));
    const client = await connectClient();
    const { data } = await callJson(client, "get_item", { id: 100 });
    const parsed = data as { comments_hint?: string; comments?: unknown };
    expect(parsed.comments).toBeUndefined();
    expect(parsed.comments_hint).toContain("include_comments=true");
  });
});
