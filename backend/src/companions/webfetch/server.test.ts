import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWebFetchServer } from "./server.js";

// A public IP literal keeps the SSRF guard from doing any DNS lookup in tests.
const PAGE_URL = "http://93.184.216.34/page";

function stubPages(opts: { robots?: string; html?: string; contentType?: string }): void {
  const robots = opts.robots ?? "";
  const html = opts.html ?? "<html><body><p>hi</p></body></html>";
  const contentType = opts.contentType ?? "text/html";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      const isRobots = url.endsWith("/robots.txt");
      // Real Response objects so the body is a genuine stream (the server
      // reads it via readBodyBounded, not response.text()).
      return new Response(isRobots ? robots : html, {
        status: 200,
        headers: isRobots ? {} : { "content-type": contentType },
      });
    }),
  );
}

async function connectClient(): Promise<Client> {
  const server = createWebFetchServer();
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

describe("webfetch companion server", () => {
  it("exposes the fetch_url tool", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["fetch_url"]);
  });

  it("extracts readable text from HTML by default", async () => {
    stubPages({
      html: "<html><body><h1>Title</h1><p>Hello <b>world</b>.</p><script>ignore()</script></body></html>",
    });
    const client = await connectClient();
    const { data, isError } = await callJson(client, "fetch_url", { url: PAGE_URL });
    expect(isError).toBe(false);
    const parsed = data as { content: string; response_format: string; truncated: boolean };
    expect(parsed.response_format).toBe("text");
    expect(parsed.content).toContain("Title");
    expect(parsed.content).toContain("Hello world.");
    expect(parsed.content).not.toContain("<");
    expect(parsed.content).not.toContain("ignore");
  });

  it("returns untouched HTML for response_format=raw", async () => {
    const html = "<html><body><p>raw &amp; real</p></body></html>";
    stubPages({ html });
    const client = await connectClient();
    const { data } = await callJson(client, "fetch_url", {
      url: PAGE_URL,
      response_format: "raw",
    });
    expect((data as { content: string }).content).toBe(html);
  });

  it("caps output at max_chars and flags truncation", async () => {
    stubPages({ html: `<html><body><p>${"x".repeat(5000)}</p></body></html>` });
    const client = await connectClient();
    const { data } = await callJson(client, "fetch_url", {
      url: PAGE_URL,
      response_format: "raw",
      max_chars: 200,
    });
    const parsed = data as { content: string; truncated: boolean; total_chars: number };
    expect(parsed.truncated).toBe(true);
    expect(parsed.content).toHaveLength(200);
    expect(parsed.total_chars).toBeGreaterThan(5000);
  });

  it("refuses a URL disallowed by robots.txt", async () => {
    stubPages({ robots: "User-agent: *\nDisallow: /page" });
    const client = await connectClient();
    const { data, isError } = await callJson(client, "fetch_url", { url: PAGE_URL });
    expect(isError).toBe(true);
    expect(JSON.stringify(data)).toContain("robots.txt");
  });

  it("caps how much of the body it buffers and flags body truncation", async () => {
    const big = "y".repeat(6 * 1024 * 1024); // over the 5 MB MAX_BODY_BYTES cap
    stubPages({ html: big, contentType: "text/plain" });
    const client = await connectClient();
    const { data, isError } = await callJson(client, "fetch_url", {
      url: PAGE_URL,
      response_format: "raw",
      max_chars: 200,
    });
    expect(isError).toBe(false);
    const parsed = data as { content: string; truncated: boolean; body_truncated?: boolean };
    expect(parsed.body_truncated).toBe(true);
    expect(parsed.truncated).toBe(true);
    expect(parsed.content).toHaveLength(200);
  });

  it("refuses a private/loopback target before any fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = await connectClient();
    const { data, isError } = await callJson(client, "fetch_url", {
      url: "http://127.0.0.1:9000/admin",
    });
    expect(isError).toBe(true);
    expect(JSON.stringify(data)).toContain("private/reserved");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
