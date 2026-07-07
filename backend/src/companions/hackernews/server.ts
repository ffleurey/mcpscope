import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CompanionError, fetchJson } from "../shared/http.js";
import {
  registerJsonTool,
  responseFormatSchema,
  type ResponseFormat,
} from "../shared/tool.js";

// Hacker News exposes two keyless backends:
//   Firebase — canonical items and the ranked feed lists (top/new/best/ask/show/job)
//   Algolia  — full-text search over stories and comments
const FIREBASE_BASE = "https://hacker-news.firebaseio.com/v0";
const ALGOLIA_BASE = "https://hn.algolia.com/api/v1";

// The six ranked feeds Firebase publishes, keyed by the `feed` enum value.
const FEED_ENDPOINTS: Record<string, string> = {
  top: "topstories",
  new: "newstories",
  best: "beststories",
  ask: "askstories",
  show: "showstories",
  job: "jobstories",
};

/** Canonical HN discussion URL for any item id (the paved path to the thread). */
function hnUrl(id: number | string): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

/** Unix seconds → ISO-8601 UTC, alongside the raw value (both are returned). */
function toIso(timeSec: unknown): string | undefined {
  return typeof timeSec === "number"
    ? new Date(timeSec * 1000).toISOString()
    : undefined;
}

interface HnItem {
  id: number;
  type?: string;
  by?: string;
  time?: number;
  text?: string;
  url?: string;
  score?: number;
  title?: string;
  descendants?: number;
  kids?: number[];
  parent?: number;
  deleted?: boolean;
  dead?: boolean;
}

async function fetchItem(id: number): Promise<HnItem | null> {
  return fetchJson<HnItem | null>(`${FIREBASE_BASE}/item/${id}.json`);
}

/** Compact, paved-path view of a story/job item. `detailed` adds the self-post body. */
function formatStory(item: HnItem, detailed: boolean): Record<string, unknown> {
  const view: Record<string, unknown> = {
    id: item.id,
    type: item.type,
    title: item.title,
    by: item.by,
    score: item.score,
    num_comments: item.descendants,
    url: item.url,
    hn_url: hnUrl(item.id),
    time_unix: item.time,
    time_iso: toIso(item.time),
  };
  if (detailed && item.text) view.text = item.text;
  return view;
}

interface CommentBudget {
  count: number;
  limit: number;
}

/**
 * Recursively fetch a bounded comment tree. Traversal stops at `maxDepth` levels
 * and once `budget.limit` comments have been collected — the opt-in, token-heavy
 * path, so it is always capped (progressive disclosure).
 */
async function buildCommentTree(
  ids: number[],
  depth: number,
  maxDepth: number,
  budget: CommentBudget,
): Promise<Array<Record<string, unknown>>> {
  const nodes: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    if (budget.count >= budget.limit) break;
    const item = await fetchItem(id);
    if (!item || item.deleted || item.dead) continue;
    budget.count += 1;
    const node: Record<string, unknown> = {
      id: item.id,
      by: item.by,
      time_iso: toIso(item.time),
      text: item.text,
    };
    if (depth < maxDepth && Array.isArray(item.kids) && item.kids.length > 0) {
      const replies = await buildCommentTree(item.kids, depth + 1, maxDepth, budget);
      if (replies.length > 0) node.replies = replies;
    }
    nodes.push(node);
  }
  return nodes;
}

interface AlgoliaSearchResult {
  hits?: Array<{
    objectID?: string;
    title?: string;
    story_title?: string;
    url?: string;
    story_url?: string;
    author?: string;
    points?: number;
    num_comments?: number;
    created_at?: string;
    created_at_i?: number;
  }>;
  nbHits?: number;
}

export function createHackerNewsServer(): McpServer {
  const server = new McpServer(
    { name: "mcpscope-hackernews", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  registerJsonTool(
    server,
    "get_stories",
    "List the current Hacker News stories from one ranked feed. Use the `feed` " +
      "enum to pick which: 'top' (front page), 'new' (newest), 'best' (highest-rated " +
      "recent), 'ask' (Ask HN), 'show' (Show HN), or 'job' (jobs). This is the tool " +
      "for browsing/what's-trending questions — use search_stories to find a specific " +
      "topic, and get_item to read one story's comments. response_format='detailed' " +
      "adds each self-post's body text. Each result carries the numeric `id` (pass it " +
      "to get_item) and a derived `hn_url`.",
    {
      feed: z
        .enum(["top", "new", "best", "ask", "show", "job"])
        .describe("Which ranked feed to read."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(30)
        .default(10)
        .describe("How many stories to return, 1–30 (default 10)."),
      response_format: responseFormatSchema,
    },
    async ({ feed, limit, response_format }) => {
      const detailed = (response_format as ResponseFormat) === "detailed";
      const endpoint = FEED_ENDPOINTS[feed];
      const ids = await fetchJson<number[]>(`${FIREBASE_BASE}/${endpoint}.json`);
      const items = await Promise.all(
        (ids ?? []).slice(0, limit).map((id) => fetchItem(id)),
      );
      const stories = items
        .filter((it): it is HnItem => it !== null)
        .map((it, i) => ({ rank: i + 1, ...formatStory(it, detailed) }));
      return { feed, count: stories.length, stories };
    },
  );

  registerJsonTool(
    server,
    "search_stories",
    "Full-text search Hacker News for stories matching a query (via the Algolia " +
      "index). Use this to FIND a specific topic; use get_stories to browse a feed " +
      "and get_item to read one result's discussion. `sort`='relevance' (default) " +
      "ranks by match quality, 'date' returns newest first. `min_points` filters out " +
      "low-scoring stories. Each result carries the numeric `id` and a derived " +
      "`hn_url` — pass the id to get_item to read the thread.",
    {
      query: z.string().min(1).describe("Search text, e.g. 'rust async runtime'."),
      sort: z
        .enum(["relevance", "date"])
        .default("relevance")
        .describe("'relevance' = best match (default); 'date' = newest first."),
      min_points: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Only return stories with at least this many points."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe("Maximum number of results, 1–50 (default 20)."),
    },
    async ({ query, sort, min_points, limit }) => {
      const endpoint = sort === "date" ? "search_by_date" : "search";
      const data = await fetchJson<AlgoliaSearchResult>(
        `${ALGOLIA_BASE}/${endpoint}`,
        {
          params: {
            query,
            tags: "story",
            hitsPerPage: limit,
            numericFilters:
              min_points !== undefined ? `points>=${min_points}` : undefined,
          },
        },
      );
      const results = (data.hits ?? []).map((h) => ({
        id: h.objectID !== undefined ? Number(h.objectID) : undefined,
        title: h.title ?? h.story_title,
        url: h.url ?? h.story_url,
        author: h.author,
        points: h.points,
        num_comments: h.num_comments,
        hn_url: h.objectID !== undefined ? hnUrl(h.objectID) : undefined,
        created_at: h.created_at,
        created_at_i: h.created_at_i,
      }));
      return {
        query,
        sort,
        count: results.length,
        total_available: data.nbHits,
        results,
        next_step:
          "Call get_item with a result's id (set include_comments=true to read the discussion).",
      };
    },
  );

  registerJsonTool(
    server,
    "get_item",
    "Fetch one Hacker News item by numeric id — a story (with its self-post body) " +
      "or a single comment. Set include_comments=true to also walk the discussion: a " +
      "bounded comment tree capped by `max_depth` (reply nesting levels) and " +
      "`comment_limit` (total comments). The comment tree is the token-heavy path, so " +
      "it is opt-in and always bounded. Get ids from get_stories or search_stories.",
    {
      id: z.number().int().describe("Numeric HN item id."),
      include_comments: z
        .boolean()
        .default(false)
        .describe("When true, also return a bounded tree of comments."),
      max_depth: z
        .number()
        .int()
        .min(1)
        .max(5)
        .default(2)
        .describe("Reply-nesting levels to walk when include_comments (default 2)."),
      comment_limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(50)
        .describe("Max total comments to return when include_comments (default 50)."),
    },
    async ({ id, include_comments, max_depth, comment_limit }) => {
      const item = await fetchItem(id);
      if (!item) throw new CompanionError(`No Hacker News item with id ${id}`);

      if (item.type === "comment") {
        return {
          id: item.id,
          type: "comment",
          by: item.by,
          parent: item.parent,
          hn_url: hnUrl(item.id),
          time_unix: item.time,
          time_iso: toIso(item.time),
          text: item.text,
        };
      }

      const result = formatStory(item, true);
      const kids = Array.isArray(item.kids) ? item.kids : [];
      if (include_comments && kids.length > 0) {
        const budget: CommentBudget = { count: 0, limit: comment_limit };
        result.comments = await buildCommentTree(kids, 1, max_depth, budget);
        result.comments_returned = budget.count;
        if (budget.count >= comment_limit) {
          result.comment_note = `Truncated at comment_limit=${comment_limit}; raise it or narrow max_depth to see more.`;
        }
      } else if (!include_comments && item.descendants) {
        result.comments_hint = `${item.descendants} comments available — call get_item again with include_comments=true to read them.`;
      }
      return result;
    },
  );

  return server;
}
