import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CompanionError, fetchJson } from "../shared/http.js";
import {
  registerJsonTool,
  responseFormatSchema,
  type ResponseFormat,
} from "../shared/tool.js";

// The Guardian Open Platform. Requires a free developer key, supplied via
// companions.guardian.api_key in the mcpscope config file. The `test` key works
// for light experimentation. https://open-platform.theguardian.com/access/
const CONTENT_BASE = "https://content.guardianapis.com";

const KEY_HINT =
  "The Guardian companion needs an API key. Set companions.guardian.api_key in the mcpscope config file (free key: https://open-platform.theguardian.com/access/).";

interface GuardianSearchResult {
  response?: {
    status?: string;
    total?: number;
    results?: Array<{
      id?: string;
      sectionName?: string;
      webPublicationDate?: string;
      webTitle?: string;
      webUrl?: string;
    }>;
  };
}

interface GuardianItemResult {
  response?: {
    status?: string;
    content?: {
      id?: string;
      sectionName?: string;
      webPublicationDate?: string;
      webTitle?: string;
      webUrl?: string;
      fields?: {
        headline?: string;
        byline?: string;
        trailText?: string;
        bodyText?: string;
      };
    };
  };
}

export function createGuardianServer(apiKey: string | null): McpServer {
  const server = new McpServer(
    { name: "mcpscope-guardian", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  // Every tool needs the key; fail in-band with a directive message when it is unset.
  function requireKey(): string {
    if (!apiKey) throw new CompanionError(KEY_HINT);
    return apiKey;
  }

  registerJsonTool(
    server,
    "search_articles",
    "Search The Guardian for news articles matching a query. Returns ranked " +
      "articles with their `id`, section, publication date, title, and web URL — pass " +
      "an `id` to get_article to read the body. Optionally filter by `section` (e.g. " +
      "'world', 'technology', 'sport') or `from_date` (YYYY-MM-DD, articles on/after " +
      "that day). Use this to FIND articles; use get_article to READ one.",
    {
      query: z.string().min(1).describe("Search text, e.g. 'climate summit'."),
      section: z
        .string()
        .optional()
        .describe("Filter by Guardian section id, e.g. 'world' or 'technology'."),
      from_date: z
        .string()
        .optional()
        .describe("Only articles published on/after this date, YYYY-MM-DD."),
      page_size: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Maximum number of articles, 1–50 (default 10)."),
    },
    async ({ query, section, from_date, page_size }) => {
      const data = await fetchJson<GuardianSearchResult>(`${CONTENT_BASE}/search`, {
        params: {
          q: query,
          section,
          "from-date": from_date,
          "page-size": page_size,
          "order-by": "relevance",
          "api-key": requireKey(),
        },
      });
      const results = (data.response?.results ?? []).map((r) => ({
        id: r.id,
        section: r.sectionName,
        published: r.webPublicationDate,
        title: r.webTitle,
        url: r.webUrl,
      }));
      return {
        query,
        total_available: data.response?.total,
        count: results.length,
        results,
        next_step:
          "Pass a result's id to get_article to read it (response_format='detailed' for the full body).",
      };
    },
  );

  registerJsonTool(
    server,
    "get_article",
    "Get one Guardian article by its `id` (from search_articles). " +
      "response_format='concise' (default) returns the headline, standfirst, byline, " +
      "and metadata; 'detailed' additionally returns the full article body, which is " +
      "token-heavy. Use search_articles first to find an id.",
    {
      id: z
        .string()
        .min(1)
        .describe("Guardian article id, e.g. 'world/2026/jan/01/some-slug'."),
      response_format: responseFormatSchema,
    },
    async ({ id, response_format }) => {
      const detailed = (response_format as ResponseFormat) === "detailed";
      const data = await fetchJson<GuardianItemResult>(
        `${CONTENT_BASE}/${id}`,
        {
          params: {
            "show-fields": "headline,byline,trailText,bodyText",
            "api-key": requireKey(),
          },
        },
      );
      const content = data.response?.content;
      if (!content) {
        throw new CompanionError(
          `No Guardian article with id '${id}'. Use search_articles to find a valid id.`,
        );
      }
      const fields = content.fields ?? {};
      const result: Record<string, unknown> = {
        id: content.id,
        title: fields.headline ?? content.webTitle,
        section: content.sectionName,
        published: content.webPublicationDate,
        byline: fields.byline,
        standfirst: fields.trailText,
        url: content.webUrl,
        response_format,
      };
      if (detailed) result.body = fields.bodyText;
      return result;
    },
  );

  return server;
}
