# Hacker News companion

Keyless [Hacker News](https://news.ycombinator.com) access over its two public backends: the
official Firebase API (items + ranked feeds) and the Algolia search index. Illustrates the
"browse/search to find, get one item in depth" pattern and an opt-in, token-heavy comment tree.

## Tools

- `get_stories(feed, limit=10, response_format=concise|detailed)` — one ranked feed
  (`top`/`new`/`best`/`ask`/`show`/`job`) as a compact list; `detailed` adds each self-post body.
- `search_stories(query, sort=relevance|date, min_points?, limit=20)` — full-text story search
  via Algolia.
- `get_item(id, include_comments=false, max_depth=2, comment_limit=50)` — one story (with body)
  or comment; `include_comments` walks a **bounded** comment tree (the token-heavy path).

Every timestamp is returned both raw (`time_unix` / `created_at_i`) and ISO-8601 UTC, and every
item carries a derived `hn_url` so the next call (or a human click-through) is obvious.

## Endpoints (no API key)

- Firebase items/feeds: `https://hacker-news.firebaseio.com/v0/`
- Algolia search: `https://hn.algolia.com/api/v1/search` and `/search_by_date`

## Attribution & fair use

Data from Hacker News, made available by Y Combinator via the Firebase API and by Algolia via the
HN Search API — both keyless and intended for public use. Requests are low-volume and identify
mcpscope via the shared companion `User-Agent`.
