# The Guardian companion

General & world news from [The Guardian Open Platform](https://open-platform.theguardian.com).
The first **key-gated** companion: it is listed but disabled until an API key is configured.
Illustrates search → read chaining and a token-heavy article body.

## Tools

- `search_articles(query, section?, from_date?, page_size=10)` — ranked articles with id,
  section, date, title, and URL.
- `get_article(id, response_format=concise|detailed)` — one article; `concise` returns
  headline/standfirst/byline/metadata, `detailed` adds the full body text (token-heavy).

## API key (free tier, config file only)

Get a free developer key at <https://open-platform.theguardian.com/access/> and set it in the
mcpscope config file:

```jsonc
"companions": {
  "guardian": { "api_key": "your-key-here" }
}
```

Until a key is set, the built-in `builtin-guardian` profile is listed but **disabled**, with a
tooltip naming the config key. The `test` key works for light experimentation. The key is a
companion→Guardian credential (config-file only, no GUI) — separate from any mcpscope→server auth.

## Endpoint

- `https://content.guardianapis.com/` — `/search` and `/{article-id}`.

## Attribution & fair use

Content from The Guardian via the Open Platform, used under its free developer tier. Requests
identify mcpscope via the shared companion `User-Agent`.
