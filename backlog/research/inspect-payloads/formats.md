# Inspect payload formats — text vs JSON, parity, and token efficiency

> Research note for the [inspect-payload tuning task](../../tuning-of-inspect-payload.md).
> Raw measurement artifacts (matched text+json captures + token table) are in
> [`_measurements/`](_measurements/).

The question: text or JSON — which should `inspect` return, on which surface, and is one
more token-efficient? And the constraint the user set: **text and JSON must carry exactly
the same information** — format should be a pure rendering choice, never a content choice.

## 1. What each surface returns today

| Surface | Default | Other option | Notes |
|---|---|---|---|
| **CLI** | curated **text** (per-type renderer) | `--json` (the raw `InspectResult`) | text only exists for runtime types; benchmark types fall through to JSON ([`cli/src/commands/inspect.ts:235-256`](../../../cli/src/commands/inspect.ts)) |
| **MCP** | **JSON only** | — | `content[0].text = JSON.stringify(result, null, 2)` **and** `structuredContent = result` ([`backend/src/mcp/server.ts:46-54`](../../../backend/src/mcp/server.ts)) |
| **UI** | renders from the structured payload | — | same `data` object |

Two immediate facts that contradict the mental model "we have text and JSON over MCP":

- **MCP has no text rendering at all.** The model-facing agents that dog-food inspect
  (the analysis workflow and the benchmark judge) receive pretty-printed **JSON**, never
  the readable CLI text. The text view we are tuning is CLI-only.
- **MCP encodes the payload twice** — once as a JSON string in `content`, once as an
  object in `structuredContent`. A client that ingests both pays for the payload twice.
  This is a concrete, format-independent efficiency issue worth fixing regardless of the
  text/JSON decision.

## 2. Content parity — today text ≠ JSON

The CLI text is **not** a faithful reformat of the JSON; it is a lossy, curated
projection. Comparing the `session` payload, the JSON carries fields the text drops:

- per part: `token_source`, `token_confidence` (text keeps `token_count` + `context_state`);
- structural / graph metadata: `owner_step_id`, `owned_turn_ids`, `parent_ref`,
  `postamble_step_ids`, `source_turn_id`, `kind`, timestamps.

So "switch to text" today silently *loses* information. To make format a pure choice we
must first define the **canonical information set** for each payload, then render that same
set as either text or JSON. The graph-metadata above is plausibly noise for every analysis
use-case (it exists for tree navigation, which IDs already encode) — the cleanest move is
to **drop it from the canonical view in both formats**, not to keep one format richer.

## 3. Token efficiency — measured on real payloads

Matched captures of the same objects, tokenized with `gpt-tokenizer` (o200k, a reasonable
proxy; the ratios are structural and hold across tokenizers). Full table:
[`_measurements/token-efficiency.tsv`](_measurements/token-efficiency.tsv).

| Payload | text tok | JSON tok | JSON ÷ text | why |
|---|---:|---:|---:|---|
| `session` (full overview) | 678 | 1890 | **2.79×** | tree of parts — JSON nesting + repeated keys (`id`/`type`/`token_count`/`context_state` per part) |
| `turn` (full overview) | 334 | 1036 | **3.10×** | same |
| `tool_call` (leaf, +result) | 1376 | 1500 | 1.09× | result is already a text table; content dominates |
| `tool_definitions` (leaf) | 5140 | 5227 | 1.02× | schemas are inherently JSON; the "text" path just dumps JSON |
| `run` summary | 3296 | 3296 | 1.00× | **no text renderer** — text == JSON fallback |
| `run` full (+report) | 14534 | 14534 | 1.00× | **no text renderer** — text == JSON fallback |

### Reading of the result

The user's intuition is correct, with nuance — **the win is concentrated in the
high-frequency navigation payloads**:

- **Tree / overview payloads (session, turn, round, setup) → text saves ~64–68% of
  tokens.** These are exactly the fetches an agent repeats while exploring (map the tree,
  pick the next thing to read). LLMs read indented log/outline text natively. This is the
  single biggest efficiency lever in the whole inspect surface.
- **Leaf content (tool results, tool schemas) → format is a wash (~1.0×).** The content is
  already either a text blob (HA returns a rendered table) or inherently structured (JSON
  schema). Here the choice should be driven by **faithfulness**, not tokens: render tool
  result text tables as text (no `\n`-escaping, no wrapper), render schemas as JSON.
- **Benchmark run / evaluation reports → unmeasured but likely a large win.** They are
  deep arrays-of-objects of numeric stats (per-tool, per-case, per-session) — the same
  structure that made `session` 2.8× — but they have **no text renderer**, so today they
  pay full JSON cost. A tabular/log text rendering of the run report is a high-value,
  unbuilt opportunity. (These are precisely the "write a run report / compare runs"
  payloads — see [`use-cases.md`](use-cases.md).)

JSON escaping makes the leaf case slightly *worse* than a wash where the content contains
newlines/quotes (the tool-result table costs +9% as JSON purely from `\n` escaping).

## 4. Recommendation (for discussion — no code changed)

1. **Make format an explicit, content-identical choice.** Add a `format: "text" | "json"`
   parameter to the inspect operation so it is available on **both** CLI and MCP (today
   MCP can't ask for text at all). Define one canonical information set per payload;
   both formats render it 1:1. This satisfies the user's hard constraint.
2. **Default the model-facing surface to text for navigation payloads.** Session / turn /
   round / setup / run overviews should default to the log-style text rendering — that is
   where the 2.8–3.1× lives and where agents fetch most often.
3. **For leaf payloads, pick the format that matches the content, not a global default.**
   Tool-result tables → text; tool-definition schemas → JSON; the part wrapper line stays
   text either way.
4. **Build text renderers for the benchmark family** (`B-`/`R-`/`E-`), which have none
   today, and **measure** — expected to mirror the session win and directly serve the
   report/compare use-cases.
5. **Fix the MCP double-encoding.** Decide whether to keep `structuredContent` alongside
   the text `content`; sending both duplicates the payload for clients that read both.
6. **Drop graph-metadata** (`owner_step_id`, `parent_ref`, `token_source`, etc.) from the
   canonical view in *both* formats — it is navigation plumbing, not analysis content.

### The deeper framing

`inspect` should behave like a **smart, use-case-aware file reader**: cheap navigation
reads that are themselves legible *and* that tell you precisely what to read next, then
targeted leaf reads for evidence. Token efficiency of the navigation reads is what makes
the gradual-exploration loop affordable — see [`use-cases.md`](use-cases.md) for the
fetch-path design that this format work is in service of.
