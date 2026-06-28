# Inspect payload formats — text vs JSON, parity, and token efficiency

> Research note for the [inspect-payload tuning task](../../tuning-of-inspect-payload.md).
> The enduring result is the **token measurement** below; the format work it motivated has
> **shipped** — see [`serialization-architecture.md`](serialization-architecture.md) for the
> design and [`phase-2-pass.md`](phase-2-pass.md) for the content.

The question this answered: text or JSON — which should `inspect` return, on which surface,
and is one more token-efficient? Under the constraint that **text and JSON must carry the same
information** (format is a rendering choice, never a content choice).

## Token efficiency — measured on real payloads

Matched captures of the same objects, tokenized with `gpt-tokenizer` (o200k; the ratios are
structural and hold across tokenizers). Distilled table:
[`_measurements/token-efficiency.tsv`](_measurements/token-efficiency.tsv).

| Payload | text tok | JSON tok | JSON ÷ text | why |
|---|---:|---:|---:|---|
| `session` (full overview) | 678 | 1890 | **2.79×** | tree of parts — JSON nesting + repeated keys (`id`/`type`/`token_count`/`context_state` per part) |
| `turn` (full overview) | 334 | 1036 | **3.10×** | same |
| `tool_call` (leaf, +result) | 1376 | 1500 | 1.09× | result is already a text table; content dominates |
| `tool_definitions` (leaf) | 5140 | 5227 | 1.02× | schemas are inherently JSON |

**The win is concentrated in the high-frequency navigation payloads:**

- **Tree/overview payloads (session, turn, round, setup) → text saves ~64–68% of tokens.**
  These are exactly the fetches an agent repeats while exploring (map the tree, pick the next
  thing to read), and LLMs read indented log/outline text natively. This is the single biggest
  efficiency lever in the inspect surface — and the redesigned benchmark `R-`/`E-` reports
  (deep arrays of numeric stats) share the same structure, so their text rendering is a large
  win too.
- **Leaf content (tool results, tool schemas) → format is a wash (~1.0×).** The content is
  already a text blob or inherently structured. Here the choice is driven by **faithfulness**,
  not tokens: render tool-result tables as text, schemas as JSON. (JSON `\n`-escaping makes the
  table leaf ~9% *worse* as JSON.)

## What shipped (this note's recommendations, all done)

1. **`format: text | json` on every surface** (CLI, MCP, API), **text default** — MCP could not
   return text before. (F1)
2. **Text derives from the JSON payload** (text ⊆ json by construction) + a coverage test for
   the reverse — so format is a content-identical choice, not a lossy projection. (F4, F16)
3. **Benchmark family (`B-`/`R-`/`E-`) got text renderers** — they were JSON-only. (F2)
4. **MCP single channel** — no `structuredContent` double-encode by default. (F15)
5. **Graph-plumbing dropped** from the canonical view (`token_source`, `owner_step_id`, …) or
   kept JSON-only via a reviewed allow-list. (F4)

## The deeper framing (still the design principle)

`inspect` behaves like a **smart, use-case-aware file reader**: cheap navigation reads that are
themselves legible *and* tell you precisely what to read next, then targeted leaf reads for
evidence. Token efficiency of the navigation reads is what makes the gradual-exploration loop
affordable — see [`use-cases.md`](use-cases.md) for the fetch-path design.
