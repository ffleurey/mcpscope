# inspect example — deterministic step — compaction (9LJM.2C)

- **Source:** `9LJM.2C` — a `strip-reasoning` compaction after turn 1. Compaction-only accounting fields; no empty turn-owning arrays.

- **Captured:** rebuilt backend (Phase 2), read-only against `backend-data/`, 2026-06-28.

## Summary mode

`mcpscope inspect --short 9LJM.2C`

```text
9LJM.2C  compaction  complete  strip-reasoning  after turn 1
  stripped 3 parts
    9LJM.1T.1.2-R
    9LJM.1T.2.1-R
    9LJM.1T.3.1-R
```

## Full mode

`mcpscope inspect 9LJM.2C`

```text
9LJM.2C  compaction  complete  strip-reasoning  after turn 1
  stripped 3 parts (932 tokens)
    9LJM.1T.1.2-R  reasoning  (314 tokens)
    9LJM.1T.2.1-R  reasoning  (236 tokens)
    9LJM.1T.3.1-R  reasoning  (382 tokens)
  reason  Removed from future context because strip-reasoning compaction excludes assistant reasoning parts.
```
