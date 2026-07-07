import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CompanionError, fetchJson } from "../shared/http.js";
import { registerJsonTool } from "../shared/tool.js";

// Brave Search API. Requires a free-tier key, supplied via companions.brave.api_key
// in the mcpscope config file and sent as the X-Subscription-Token header.
// https://brave.com/search/api/
const WEB_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

const KEY_HINT =
  "The Web Search companion needs an API key. Set companions.brave.api_key in the mcpscope config file (free key: https://brave.com/search/api/).";

/** Strip the <strong> highlight markup Brave wraps around matched terms. */
function stripHighlight(s: string): string {
  return s.replace(/<\/?strong>/gi, "");
}

interface BraveWebSearchResult {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      page_age?: string;
    }>;
  };
}

export function createWebSearchServer(apiKey: string | null): McpServer {
  const server = new McpServer(
    { name: "mcpscope-websearch", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  registerJsonTool(
    server,
    "web_search",
    "Search the web and return ranked results (title, URL, and a short snippet) via " +
      "the Brave Search API. Use this to discover pages/sources for a query; then, if " +
      "you need a page's full content, pass a result `url` to the webfetch companion's " +
      "fetch_url (if available). Returns up to `count` results.",
    {
      query: z.string().min(1).describe("Search query, e.g. 'best practices MCP servers'."),
      count: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(5)
        .describe("Maximum number of results, 1–20 (default 5)."),
    },
    async ({ query, count }) => {
      if (!apiKey) throw new CompanionError(KEY_HINT);
      const data = await fetchJson<BraveWebSearchResult>(WEB_SEARCH_URL, {
        params: { q: query, count },
        headers: { "x-subscription-token": apiKey },
      });
      const results = (data.web?.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description ? stripHighlight(r.description) : undefined,
        page_age: r.page_age ?? undefined,
      }));
      return {
        query,
        count: results.length,
        results,
        next_step:
          "To read a result in full, pass its url to the webfetch companion's fetch_url.",
      };
    },
  );

  return server;
}
