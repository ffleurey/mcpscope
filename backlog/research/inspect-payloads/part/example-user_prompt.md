# inspect example — part: user_prompt

- **Source object:** `9LJM.1T.1.1-U`
- **Captured from:** live test instance (`localhost:3030`), benchmark run `R-RZNP` — Gemma 4 12B QAT on the HA Replay MCP profile.
- **Date:** 2026-06-27
- **Rendering:** CLI text renderer (`mcpscope inspect`). Note the MCP tool returns this same data as raw JSON, not this text.

> **Note:** summary and full modes return *identical* payloads for this object type — the `short` flag has no effect here.

## Summary mode

`mcpscope inspect --short 9LJM.1T.1.1-U`  ·  MCP `{ id: "9LJM.1T.1.1-U", short: true }`

```text
9LJM.1T.1.1-U  user_prompt  (81 tokens)
  I'd like to understand how cold it got outside last winter — December 2025 through February 2026. Two things: (1) which day was the coldest, and how cold did it get? (2) on how many days that winter did the temperature drop below freezing at some point? Resolve the outdoor sensor yourself and keep it concise.

```

## Full mode

`mcpscope inspect 9LJM.1T.1.1-U`  ·  MCP `{ id: "9LJM.1T.1.1-U" }`

```text
9LJM.1T.1.1-U  user_prompt  (81 tokens)
  I'd like to understand how cold it got outside last winter — December 2025 through February 2026. Two things: (1) which day was the coldest, and how cold did it get? (2) on how many days that winter did the temperature drop below freezing at some point? Resolve the outdoor sensor yourself and keep it concise.

```
