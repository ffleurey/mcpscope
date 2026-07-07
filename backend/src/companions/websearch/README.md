# Web Search companion

Web search results via the [Brave Search API](https://brave.com/search/api/). Key-gated (like
`guardian`): listed but disabled until an API key is configured. Pairs naturally with `webfetch`
— search to find pages, then fetch one in full.

## Tool

- `web_search(query, count=5)` — ranked results as `[{ title, url, snippet, page_age }]`. Snippet
  highlight markup is stripped to plain text.

## API key (free tier, config file only)

Get a free key at <https://brave.com/search/api/> and set it in the mcpscope config file:

```jsonc
"companions": {
  "brave": { "api_key": "your-key-here" }
}
```

Sent as the `X-Subscription-Token` header. Until the key is set, the built-in `builtin-websearch`
profile is listed but **disabled**, with a tooltip naming the config key. The free tier allows
roughly 2,000 queries/month.

## Endpoint

- `https://api.search.brave.com/res/v1/web/search`

## Attribution & fair use

Results from Brave Search via its API, used under the free developer tier. Requests identify
mcpscope via the shared companion `User-Agent`.
