# Web Fetch companion

Fetch an arbitrary public web page and return it as readable text. Inspired by the official
`fetch` reference server, trimmed to one tool with the safety guards a bundled server needs.
Illustrates open-ended retrieval and the raw-vs-extracted context trade-off.

## Tool

- `fetch_url(url, response_format=text|markdown|raw, max_chars=8000)` — download one page and
  return its content. `text` (default) strips HTML to plain text, `markdown` does a lightweight
  Markdown conversion, `raw` returns the original body untouched (largest). Output is capped at
  `max_chars`.

## Guards

- **Scheme** — only `http`/`https`.
- **SSRF** — the target host, and every DNS-resolved address, must be public; loopback,
  private, link-local (incl. cloud metadata `169.254.169.254`), CGNAT, and reserved ranges are
  refused. Redirects are followed manually and re-checked on every hop (`ssrf.ts`).
- **robots.txt** — the origin's robots.txt is honored for our user-agent (`robots.txt`
  evaluation in `robots.ts`); a missing/unreachable robots.txt is treated as allowed.
- **Timeout** and a bounded redirect count.

HTML→text/markdown is a deliberately lightweight regex strip (no headless browser / readability
dependency) — good enough for evaluation, and `raw` is always available for the exact bytes.

## Attribution & fair use

Fetches third-party pages on the user's behalf, identifying mcpscope via the shared companion
`User-Agent` and honoring each site's robots.txt.
