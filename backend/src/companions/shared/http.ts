// Shared HTTP helpers for the bundled companion MCP servers.
//
// Companions are well-behaved, low-volume clients of open public APIs. Every
// upstream request identifies mcpscope with a real User-Agent and enforces a
// timeout so a hung upstream can never wedge a tool call.

/** Identifies mcpscope on every companion upstream request (fair-use courtesy). */
export const COMPANION_USER_AGENT = `mcpscope-companion/${
  process.env.APP_VERSION ?? "dev"
} (+https://github.com/ffleurey/mcpscope)`;

export const DEFAULT_TIMEOUT_MS = 15_000;

/** A companion tool failure with a clean, model-facing message. */
export class CompanionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanionError";
  }
}

/** Query-param value types accepted by {@link fetchJson}. */
export type QueryValue = string | number | boolean | undefined | null;

function buildUrl(base: string, params?: Record<string, QueryValue>): string {
  if (!params) return base;
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * GET `base` (with optional query params) and parse the JSON body.
 * Throws {@link CompanionError} with a concise message on timeout, transport
 * failure, non-2xx status, or invalid JSON.
 */
export async function fetchJson<T = unknown>(
  base: string,
  options: {
    params?: Record<string, QueryValue>;
    timeoutMs?: number;
    /** Extra request headers (e.g. an upstream API token). */
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const url = buildUrl(base, options.params);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "user-agent": COMPANION_USER_AGENT,
        accept: "application/json",
        ...options.headers,
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new CompanionError(`Request to ${base} timed out`);
    }
    throw new CompanionError(
      `Request to ${base} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new CompanionError(
      `Upstream ${base} returned HTTP ${response.status} ${response.statusText}`.trim(),
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new CompanionError(`Upstream ${base} returned a non-JSON response`);
  }
}
