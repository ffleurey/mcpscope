import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createOpenMeteoServer } from "./openMeteo/server.js";
import { createHackerNewsServer } from "./hackernews/server.js";
import { createWikipediaServer } from "./wikipedia/server.js";
import { createWorldBankServer } from "./worldbank/server.js";
import { createWebFetchServer } from "./webfetch/server.js";
import { createGuardianServer } from "./guardian/server.js";
import { createWebSearchServer } from "./websearch/server.js";

/**
 * A bundled companion MCP server. Each definition mounts at
 * `/companions/<name>/mcp` and is surfaced as a read-only built-in profile
 * (`builtin-<name>`) that users can select without any configuration.
 */
export interface CompanionDefinition {
  /** URL-safe id used in the route path and the `builtin-<name>` profile id. */
  name: string;
  /** Human-facing profile name shown in the MCP-server selection list. */
  title: string;
  /** One-line description of what the server offers. */
  description: string;
  /**
   * Name of the config key (`companions.<requiresKey>.api_key`) this companion
   * needs, or null when it is keyless. Key-gated companions are still listed but
   * rendered disabled until the key is configured.
   */
  requiresKey: string | null;
  /** Factory returning a fresh MCP server instance (called once per request). */
  createServer: (ctx: CompanionContext) => McpServer;
}

/** Per-request context passed to a companion factory. */
export interface CompanionContext {
  /** Resolved upstream API key for a key-gated companion, or null when unset/keyless. */
  apiKey: string | null;
}

export const COMPANIONS: CompanionDefinition[] = [
  {
    name: "open-meteo",
    title: "Open-Meteo Weather (built-in)",
    description:
      "Keyless weather: geocode a place, then get current conditions, a daily forecast, or historical archive data.",
    requiresKey: null,
    createServer: createOpenMeteoServer,
  },
  {
    name: "hackernews",
    title: "Hacker News (built-in)",
    description:
      "Keyless Hacker News: browse ranked feeds, full-text search stories, and read one story with a bounded comment tree.",
    requiresKey: null,
    createServer: createHackerNewsServer,
  },
  {
    name: "wikipedia",
    title: "Wikipedia (built-in)",
    description:
      "Keyless English Wikipedia: search titles, get a compact summary, or fetch a full article (summary vs. full).",
    requiresKey: null,
    createServer: createWikipediaServer,
  },
  {
    name: "worldbank",
    title: "World Bank Data (built-in)",
    description:
      "Keyless economics & development stats: find indicator codes, fetch a country's yearly series, and list countries.",
    requiresKey: null,
    createServer: createWorldBankServer,
  },
  {
    name: "webfetch",
    title: "Web Fetch (built-in)",
    description:
      "Fetch any public web page as readable text/markdown/raw, with robots.txt and SSRF guards.",
    requiresKey: null,
    createServer: createWebFetchServer,
  },
  {
    name: "guardian",
    title: "The Guardian News (built-in)",
    description:
      "General & world news from The Guardian: search articles and read one in full. Requires a free API key.",
    requiresKey: "guardian",
    createServer: (ctx) => createGuardianServer(ctx.apiKey),
  },
  {
    name: "websearch",
    title: "Web Search (built-in)",
    description:
      "Web search results (title, URL, snippet) via the Brave Search API. Requires a free API key.",
    requiresKey: "brave",
    createServer: (ctx) => createWebSearchServer(ctx.apiKey),
  },
];
