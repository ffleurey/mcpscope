# Wikipedia companion

Keyless English [Wikipedia](https://en.wikipedia.org) access over the Wikimedia action API
(search + plain-text extracts) and the REST v1 summary endpoint. Illustrates the canonical
search → disambiguate → read chain and the summary-vs-full context lesson.

## Tools

- `search(query, limit=5)` — ranked article titles + snippets (call this first when unsure of
  the exact title).
- `get_summary(title)` — one-line description + lead-paragraph extract (compact overview).
- `get_article(title, response_format=summary|full)` — plain-text body; `summary` = lead
  section, `full` = the entire article (often very token-heavy).

Titles are exact — copy them from `search` output. Search snippets are stripped to plain text.

## Endpoints (no API key; User-Agent required)

- Action API: `https://en.wikipedia.org/w/api.php`
- REST summary: `https://en.wikipedia.org/api/rest_v1/page/summary/{title}`

## Attribution & fair use

Content from Wikipedia, licensed **CC BY-SA**. Access is keyless but Wikimedia requires a
descriptive `User-Agent` and applies anonymous rate limits — mcpscope identifies itself via the
shared companion `User-Agent` and keeps volume low.
