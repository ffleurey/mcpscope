# inspect example — compaction step (9LJM.2C)

- **Source object:** `9LJM.2C`
- **Captured from:** live test instance (`localhost:3030`), benchmark run `R-RZNP` — Gemma 4 12B QAT on the HA Replay MCP profile.
- **Date:** 2026-06-27
- **Rendering:** CLI text renderer (`mcpscope inspect`). Note the MCP tool returns this same data as raw JSON, not this text.

## Summary mode

`mcpscope inspect --short 9LJM.2C`  ·  MCP `{ id: "9LJM.2C", short: true }`

```text
9LJM.2C  compaction  complete  strip-reasoning  after turn 1
  stripped parts
    9LJM.1T.1.2-R
    9LJM.1T.2.1-R
    9LJM.1T.3.1-R

```

## Full mode

`mcpscope inspect 9LJM.2C`  ·  MCP `{ id: "9LJM.2C" }`

```text
9LJM.2C  compaction  complete  strip-reasoning  after turn 1
  stripped parts
    9LJM.1T.1.2-R
    9LJM.1T.2.1-R
    9LJM.1T.3.1-R
  stripped details
    9LJM.1T.1.2-R  reasoning  (314 tokens)
      Removed from future context because strip-reasoning compaction excludes assistant reasoning parts.
    9LJM.1T.2.1-R  reasoning  (236 tokens)
      Removed from future context because strip-reasoning compaction excludes assistant reasoning parts.
    9LJM.1T.3.1-R  reasoning  (382 tokens)
      Removed from future context because strip-reasoning compaction excludes assistant reasoning parts.

```
