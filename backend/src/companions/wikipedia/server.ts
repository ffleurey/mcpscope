import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CompanionError, fetchJson } from "../shared/http.js";
import { registerJsonTool } from "../shared/tool.js";

// English Wikipedia over two keyless (User-Agent-required) endpoints:
//   action API — full-text search and plain-text article extracts
//   REST v1    — the compact page summary (lead extract + short description)
const API_BASE = "https://en.wikipedia.org/w/api.php";
const SUMMARY_BASE = "https://en.wikipedia.org/api/rest_v1/page/summary";

/** get_article size control. `summary` = lead section; `full` = the whole article. */
const articleFormatSchema = z
  .enum(["summary", "full"])
  .default("summary")
  .describe(
    "summary = lead section only (compact, default); full = the entire article as plain text (very token-heavy).",
  );

/** Canonical desktop article URL for a title (the paved path / click-through). */
function pageUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

/** Strip the search-snippet markup + common HTML entities to plain text. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

interface SearchResult {
  query?: {
    search?: Array<{
      title?: string;
      pageid?: number;
      snippet?: string;
      wordcount?: number;
    }>;
  };
}

interface ExtractResult {
  query?: {
    pages?: Record<
      string,
      { pageid?: number; title?: string; extract?: string; missing?: string }
    >;
  };
}

interface SummaryResult {
  title?: string;
  description?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
}

export function createWikipediaServer(): McpServer {
  const server = new McpServer(
    { name: "mcpscope-wikipedia", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  registerJsonTool(
    server,
    "search",
    "Search English Wikipedia for article titles matching a query. Returns ranked " +
      "titles with a short snippet and word count. Use this FIRST when you don't know " +
      "the exact article title — then pass a result's `title` to get_summary (quick " +
      "overview) or get_article (full text). Titles are case- and spelling-sensitive " +
      "downstream, so copy them exactly.",
    {
      query: z.string().min(1).describe("Search text, e.g. 'alan turing'."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(5)
        .describe("Maximum number of results, 1–20 (default 5)."),
    },
    async ({ query, limit }) => {
      const data = await fetchJson<SearchResult>(API_BASE, {
        params: {
          action: "query",
          list: "search",
          srsearch: query,
          srlimit: limit,
          format: "json",
        },
      });
      const results = (data.query?.search ?? []).map((r) => ({
        title: r.title,
        pageid: r.pageid,
        wordcount: r.wordcount,
        snippet: r.snippet ? stripHtml(r.snippet) : undefined,
      }));
      return {
        query,
        count: results.length,
        results,
        next_step:
          "Copy a result's title into get_summary(title) for a quick overview, or get_article(title, response_format='full') for the whole article.",
      };
    },
  );

  registerJsonTool(
    server,
    "get_summary",
    "Get the compact summary of one Wikipedia article by exact title: a one-line " +
      "description plus the lead-paragraph extract. This is the low-token overview — " +
      "use it before reaching for get_article's full text. If you don't know the exact " +
      "title, call search first.",
    {
      title: z
        .string()
        .min(1)
        .describe("Exact article title, e.g. 'Alan Turing' (from search)."),
    },
    async ({ title }) => {
      const data = await fetchJson<SummaryResult>(
        `${SUMMARY_BASE}/${encodeURIComponent(title)}`,
      );
      return {
        title: data.title ?? title,
        description: data.description,
        extract: data.extract,
        url: data.content_urls?.desktop?.page ?? pageUrl(title),
        next_step:
          "Need the whole article? Call get_article(title, response_format='full').",
      };
    },
  );

  registerJsonTool(
    server,
    "get_article",
    "Get the plain-text body of one Wikipedia article by exact title. " +
      "response_format='summary' (default) returns just the lead section; 'full' " +
      "returns the ENTIRE article, which is often very large — request it only when " +
      "the lead section is not enough. If you don't know the exact title, call search " +
      "first. For a one-line overview prefer get_summary.",
    {
      title: z
        .string()
        .min(1)
        .describe("Exact article title, e.g. 'Alan Turing' (from search)."),
      response_format: articleFormatSchema,
    },
    async ({ title, response_format }) => {
      const full = response_format === "full";
      const data = await fetchJson<ExtractResult>(API_BASE, {
        params: {
          action: "query",
          prop: "extracts",
          explaintext: 1,
          exintro: full ? undefined : 1,
          redirects: 1,
          titles: title,
          format: "json",
        },
      });
      const page = Object.values(data.query?.pages ?? {})[0];
      if (!page || page.missing !== undefined) {
        throw new CompanionError(
          `No Wikipedia article titled "${title}". Use search to find the exact title.`,
        );
      }
      return {
        title: page.title ?? title,
        pageid: page.pageid,
        response_format,
        extract: page.extract,
        url: pageUrl(page.title ?? title),
      };
    },
  );

  return server;
}
