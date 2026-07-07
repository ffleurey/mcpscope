import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { COMPANION_USER_AGENT, CompanionError, DEFAULT_TIMEOUT_MS } from "../shared/http.js";
import { registerJsonTool } from "../shared/tool.js";
import { assertUrlAllowed } from "./ssrf.js";
import { isPathAllowed, WEBFETCH_UA_TOKEN } from "./robots.js";

const MAX_REDIRECTS = 5;
// Hard caps on how much of a response body is ever buffered, independent of
// `max_chars` (which truncates the *extracted* content only after the full
// body used to be read into memory).
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_ROBOTS_BYTES = 512 * 1024;

/**
 * Read at most `maxBytes` of a response body as text, cancelling the rest of
 * the stream. Returns the decoded text and whether the body was cut short.
 */
async function readBodyBounded(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bodyTruncated: boolean }> {
  if (!response.body) return { text: "", bodyTruncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let received = 0;
  let bodyTruncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      received += value.byteLength;
      if (received > maxBytes) {
        const keep = value.byteLength - (received - maxBytes);
        text += decoder.decode(value.subarray(0, keep), { stream: true });
        bodyTruncated = true;
        void reader.cancel().catch(() => {});
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return { text: text + decoder.decode(), bodyTruncated };
}

/** get_url output shaping. `raw` keeps the original HTML; the others extract readable text. */
const fetchFormatSchema = z
  .enum(["text", "markdown", "raw"])
  .default("text")
  .describe(
    "text = readable plain text (default); markdown = lightweight Markdown; raw = the original HTML/body untouched.",
  );

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function stripTags(s: string): string {
  // Remove remaining tags without inserting whitespace — block-level separation is
  // already applied via newline conversions, so this keeps inline runs like
  // "Hello <b>world</b>." reading as "Hello world.".
  return s.replace(/<[^>]+>/g, "");
}

/** Drop non-content elements (script/style/comments) before any extraction. */
function stripNonContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function htmlToText(html: string): string {
  let s = stripNonContent(html);
  s = s
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|section|article|header|footer|li|ul|ol|tr|table|h[1-6]|blockquote)\s*>/gi,
      "\n",
    );
  s = decodeEntities(stripTags(s));
  return s
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlToMarkdown(html: string): string {
  let s = stripNonContent(html);
  s = s.replace(
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_, level: string, inner: string) =>
      `\n\n${"#".repeat(Number(level))} ${stripTags(inner).trim()}\n\n`,
  );
  s = s.replace(
    /<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href: string, inner: string) => `[${stripTags(inner).trim()}](${href})`,
  );
  s = s.replace(
    /<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi,
    (_, __: string, inner: string) => `**${stripTags(inner).trim()}**`,
  );
  s = s.replace(
    /<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi,
    (_, __: string, inner: string) => `*${stripTags(inner).trim()}*`,
  );
  s = s.replace(
    /<li[^>]*>([\s\S]*?)<\/li>/gi,
    (_, inner: string) => `\n- ${stripTags(inner).trim()}`,
  );
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|table|blockquote)\s*>/gi, "\n\n");
  s = decodeEntities(stripTags(s));
  return s
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Fetch `url`, following redirects manually and re-running the SSRF guard on every hop. */
async function guardedFetch(
  url: string,
  signal: AbortSignal,
): Promise<{ response: Response; finalUrl: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertUrlAllowed(current);
    const response = await fetch(current, {
      headers: {
        "user-agent": COMPANION_USER_AGENT,
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      redirect: "manual",
      signal,
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new CompanionError(`Too many redirects (>${MAX_REDIRECTS}) fetching ${url}`);
}

/**
 * Refuse the fetch if the site's robots.txt disallows our user-agent for this path.
 *
 * Precondition: the caller must have already run `assertUrlAllowed(url)` — this
 * function fetches robots.txt from `url`'s host without its own SSRF check, relying
 * on that prior validation (same host).
 */
async function assertRobotsAllowed(url: string, signal: AbortSignal): Promise<void> {
  const u = new URL(url);
  const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
  let body: string;
  try {
    const res = await fetch(robotsUrl, {
      headers: { "user-agent": COMPANION_USER_AGENT },
      redirect: "manual",
      signal,
    });
    if (!res.ok) return; // no usable robots.txt ⇒ allowed
    body = (await readBodyBounded(res, MAX_ROBOTS_BYTES)).text;
  } catch {
    return; // robots unreachable ⇒ allowed
  }
  if (!isPathAllowed(body, u.pathname, WEBFETCH_UA_TOKEN)) {
    throw new CompanionError(
      `Fetch of ${url} is disallowed by the site's robots.txt for this crawler.`,
    );
  }
}

export function createWebFetchServer(): McpServer {
  const server = new McpServer(
    { name: "mcpscope-webfetch", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  registerJsonTool(
    server,
    "fetch_url",
    "Fetch a single public web page over HTTP(S) and return its readable content. " +
      "response_format='text' (default) strips HTML to plain text, 'markdown' returns " +
      "lightweight Markdown, and 'raw' returns the original HTML untouched (largest). " +
      "Output is capped at `max_chars`; raise it for more. Guards: only public http(s) " +
      "URLs (private/loopback/link-local addresses are refused), the requested URL is " +
      "checked against the site's robots.txt, every redirect hop is re-checked against " +
      "the address guard, and there is a request timeout. Use this " +
      "for arbitrary pages; prefer a dedicated companion (wikipedia, hackernews, …) when " +
      "one fits.",
    {
      url: z
        .string()
        .min(1)
        .describe("Absolute http(s) URL to fetch, e.g. 'https://example.com/page'."),
      response_format: fetchFormatSchema,
      max_chars: z
        .number()
        .int()
        .min(200)
        .max(50_000)
        .default(8_000)
        .describe("Maximum characters of content to return (default 8000)."),
    },
    async ({ url, response_format, max_chars }) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      try {
        // Validate the host BEFORE assertRobotsAllowed, which fetches robots.txt
        // from that same host — this check (not just guardedFetch's per-hop check)
        // is what keeps that robots fetch from hitting a private/loopback address.
        await assertUrlAllowed(url);
        await assertRobotsAllowed(url, controller.signal);
        const { response, finalUrl } = await guardedFetch(url, controller.signal);
        if (!response.ok) {
          throw new CompanionError(
            `Upstream returned HTTP ${response.status} ${response.statusText}`.trim(),
          );
        }
        const contentType = response.headers.get("content-type") ?? "";
        const { text: body, bodyTruncated } = await readBodyBounded(
          response,
          MAX_BODY_BYTES,
        );
        const isHtml =
          /html/i.test(contentType) || /^\s*(<!doctype html|<html)/i.test(body);

        let content: string;
        if (response_format === "raw" || !isHtml) content = body;
        else if (response_format === "markdown") content = htmlToMarkdown(body);
        else content = htmlToText(body);

        const truncated = content.length > max_chars || bodyTruncated;
        return {
          url: finalUrl,
          content_type: contentType || undefined,
          response_format,
          truncated,
          ...(content.length > max_chars ? { total_chars: content.length } : {}),
          ...(bodyTruncated ? { body_truncated: true } : {}),
          content: content.length > max_chars ? content.slice(0, max_chars) : content,
        };
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new CompanionError(`Request to ${url} timed out`);
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    },
  );

  return server;
}
