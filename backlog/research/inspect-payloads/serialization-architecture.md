# Inspect serialization architecture — making text and JSON equivalent by construction

> **Shipped** — this is the design record for the rendering architecture that Phase 1 built
> (`backend/src/inspect/renderInspect.ts` + the per-type builders + the coverage test). The
> "current architecture (what we have)" and "incremental migration" sections below describe the
> *pre-refactor* starting point and the rollout plan; they are kept as rationale. The **design
> rules (Rule 1–4)** are the live contract any new payload/field must follow.

Research note for the [inspect-payload tuning task](../../tuning-of-inspect-payload.md).
This is the *implementation* counterpart to [`formats.md`](formats.md): given that we want a
content-aligned `format: text | json` choice, what is the right code pattern so the formats
**cannot drift dangerously**. The guarantee is *directional*: **text ⊆ json by construction**
(a formatter's only input is the JSON payload, so text can never assert more than the JSON),
while the completeness direction (json ⊆ text) is kept honest by **specification + a coverage
test** — which is what buys us free, hand-tuned text layout instead of a mechanical dump.

## Current architecture (what we have)

Inspected objects are **plain records** reconstituted from SQLite rows (`SessionRecord`,
`TurnRecord`, `RoundRecord`, `StepRecord`, `PartRecord` in
[`domain/model.ts`](../../../backend/src/domain/model.ts); benchmark records in the same
area). They are data, not classes with methods.

Payload generation today is **two independent families of free functions**, and rendering
is a **third, separate traversal in a different package**:

```
 domain records ──► build*Node()            (runtime)   ─┐
                    hierarchicalLookup.ts                 ├─►  data: {id,type,mode, …}  ──► JSON.stringify  (MCP, CLI --json)
 benchmark records ─► *ToSnake()            (benchmark)  ─┘                               │
                    benchmarkOperations.ts                                                └─► renderSessionText()/renderPart()/…  (CLI text ONLY)
                                                                                              cli/src/commands/inspect.ts
```

Three problems follow directly from the shape of this diagram:

1. **Two builders, no shared contract.** `build*Node` (runtime) and `*ToSnake` (benchmark)
   return untyped `object` with different conventions. There is no `InspectNode` type
   that both satisfy ([`hierarchicalLookup.ts:139-221`](../../../backend/src/runtime/hierarchicalLookup.ts);
   [`benchmarkOperations.ts:57-281`](../../../backend/src/operations/benchmarkOperations.ts)).
2. **Text is a second, independent traversal** living in the **CLI package**
   ([`cli/src/commands/inspect.ts:143-217`](../../../cli/src/commands/inspect.ts)). It
   re-reads `data` and *hand-picks* fields — so it silently drops some (`token_source`,
   `latest_error`, …) and only knows the runtime shape. This is the **root cause** of F4
   (text ≠ JSON content), F2 (no benchmark text), and F8 (`latest_error` invisible).
3. **MCP renders nothing** — it `JSON.stringify`s the payload and also ships it again as
   `structuredContent` ([`server.ts:46-54`](../../../backend/src/mcp/server.ts)). It cannot
   emit text at all (F1), because the only text renderer lives downstream in the CLI.

The de-facto `toInspectJSON` already exists (the `build*Node` / `*ToSnake` functions). What
is missing is (a) a **single typed payload contract**, (b) a **single renderer that derives
text from that payload**, and (c) a **home for both that all three surfaces share**.

## The target pattern

The user's framing is the right one: payload generation should be a **first-class,
per-type serialization** — a `toString` with a format option — and **text must derive from
the JSON payload**, never from the source records. Concretely:

### Rule 1 — one **context-aware** builder per type (the `toInspectJSON`)

Make each type's payload builder a **registered serializer** with a uniform signature, so
"serialize an inspectable thing" is first-class and symmetric across all 10 types — but the
builder takes a **render context**, because a node's representation legitimately depends on
*where* it is being rendered (see "Context-aware build" below):

```ts
interface InspectSerializer<TId> {
  type: InspectType                                  // 'session' | … | 'benchmark_run'
  build(ctx, id: TId, rc: RenderContext): InspectNode  // the single source of truth
}
// registry keyed by type → kills the two-families split; the resolver just dispatches
```

`InspectNode` is a **typed node model** (not `object`): a node with a small, known set of
fields (`id`, `type`, scalar fields, `content`, and ordered children `parts | rounds |
steps | sections`). Both the runtime tree and the benchmark/report payloads express
themselves in this one shape.

### Context-aware build: target vs child (and why *not* a classic visitor)

There is **not one "render of a part."** The same part is rendered differently depending on
its role:

- **as the inspect target, full mode** → everything (full `tool_payload` with the result);
- **as the inspect target, summary mode** → a leaner self-view;
- **as a nested child inside a session/turn overview** → a compact line (id, type, tokens,
  capped args) — you do *not* want the full tool result inlined N times in an overview.

Today this is encoded as a tangle of booleans threaded through the builders
(`isDirectPartLookup`, `isPartLevelLookup`, `isDirectLookup`, plus `mode`) — see
[`hierarchicalLookup.ts:139-145,182-208`](../../../backend/src/runtime/hierarchicalLookup.ts).
The fix is to make that context **explicit and monotonic**:

```ts
type RenderContext = {
  role: 'target' | 'descendant'   // am I the thing being inspected, or nested under it?
  mode: 'summary' | 'full'
  depth: number                   // distance from the target; detail decays as it grows
}
```

The composition rule: **a parent builds each child with a *lowered* detail context**
(`rc.descend()` → `role:'descendant'`, `depth+1`). Each type decides *what compact means
for itself* — the part owns both its full self-view and its one-line child-view. This is
exactly "each object responsible for its own rendering," and it generalizes the gradual-
exploration principle into the data model: **detail decays with distance from the target**,
so an overview stays cheap and you drill to recover detail.

**Why this is a Composite-with-context, not a Visitor.** A classic visitor centralizes an
operation (`RenderVisitor`) and double-dispatches on node type — which *pulls per-type
representation logic out of the objects*, the opposite of what we want, and forces the
render context to be threaded as visitor state. The need here is the inverse: each type
keeps its own `build(rc)`, and the recursion follows the object graph, lowering `rc` as it
descends. That is the **Composite** pattern (a tree whose nodes render themselves) plus a
**passed-down render context** — not Visitor. (Where a visitor *does* fit is the *format*
phase below — but there the node type is uniform, so a plain recursive walk beats double
dispatch.)

**The crucial orthogonality.** Context-aware build decides *which* node `P` is produced;
equivalence-by-construction (Rule 2) guarantees `text(P) ≡ json(P)` for *whatever* `P` is.
These are independent axes. Inspecting a part directly yields a rich `P`; the same part as
a child yields a compact `P'`; both are internally consistent across formats. So "compact
children" and "text/JSON parity" never fight — parity is *per produced payload*, and
different fetches legitimately produce different payloads.

### Rule 2 — text takes the **payload** as its only input; the guarantee is *directional*

The payload returned by `build` is the **root `InspectNode`** (call it `p`). It is the
single source of truth. Define:

```ts
function toJson(p: InspectNode): string   // structural serialization of the node
function toText(p: InspectNode): string   // FREE per-type layout — but input is ONLY p
```

The load-bearing constraint is the **input type**: `toText` consumes **only** the
`InspectNode` (equivalently, the JSON) — *never* a domain record. From that one rule the
safe direction follows by construction:

- **text ⊆ json, by construction.** A formatter literally cannot reference a field the
  payload lacks, so the text can never assert *more* than the JSON. The model is never
  shown a "fact" that isn't backed by the payload, and text can't contradict JSON. This is
  the property that actually matters — it kills fabrication and drift.

What this does **not** give you for free is the other direction:

- **json ⊆ text is *not* automatic.** A custom formatter is free to omit fields (that is
  the whole point of formatting freedom — e.g. `token_source` is useful in the structured
  JSON but noise in human text). So text may be a *subset* of JSON.

This is the right trade. We **keep formatting freedom** (Rule 2b) and make the completeness
direction a thing we **specify and review**, not something we pay for with mechanical text
(Rule 2c).

### Rule 2b — formatting is free, and per-type

Unlike the JSON serializer (generic/structural), `toText` is allowed to be **hand-tuned per
type** — a run report renders as a table, a session as an indented tree, a tool result as
its raw text block. Register text formatters by type, exactly like the builders:

```ts
interface InspectTextFormatter { type: InspectType; format(node: InspectNode): string }
// a generic walker is the DEFAULT formatter; a type overrides it for polish.
```

A **generic walker** is the fallback formatter, so every type (and every newly added field)
renders *something* safe immediately; types override it where readability pays — without
ever widening the input beyond the node.

### Rule 2c — completeness by specification + a coverage test

Because `json ⊆ text` isn't free, make omissions **explicit and reviewed** rather than
accidental (the exact failure mode of today's F4):

- **Specify** per type which payload fields are *omittable from text* — a reviewed
  allow-list (e.g. `token_source`, `token_confidence`, `owner_step_id`). Everything else is
  expected to appear.
- **Test** it: a coverage test walks the JSON and asserts every scalar leaf appears in the
  rendered text **except** the allow-listed fields. Add a field to the payload and forget to
  render it → the test fails until you either render it or consciously allow-list it.

So the net contract is: **text content = json content − a reviewed omission set**, with
fabrication impossible by construction and omission caught by CI. This answers F4's open
question without forcing the text to be a dumb dump: the graph-plumbing can stay in JSON for
programmatic consumers and be *deliberately* dropped from human text, on the record.

**Decision (2026-06-27):** the F4 graph-plumbing fields (`token_source`, `token_confidence`,
`owner_step_id`, `parent_ref`, …) are the seed allow-list — **JSON-only for now**, omitted
from text. F4 is the clean illustration of "useful to put a bit less in the text than in the
JSON." *Open, deferred to the content pass:* whether these are even needed **in the JSON** —
a separate question from text rendering, answered per type when we critique payload content.

### Rule 3 — rendering is a core domain feature, shared by all surfaces

`build`, the JSON serializer, and the text formatters all live in the **backend domain
model** — producing these payloads is a first-class mcpscope capability, not a CLI concern.
All surfaces **fetch** the rendered payloads via the API: **frontend, CLI, and MCP** alike;
none renders locally. The CLI stops owning rendering (its per-type renderers are deleted);
MCP gains a text option for free (F1); benchmark types get text for free (F2); `latest_error`
shows because it is in the payload and not allow-listed out (F8).

### Rule 4 — the two enforcement layers

The directional model is enforced by two cheap mechanisms, matching the two directions:

- **Safety (text ⊆ json) — by construction.** Enforced by the *type system*: `format`'s
  only parameter is `InspectNode`. There is no record/db handle in scope, so a formatter
  cannot source content from anywhere but the payload. Nothing to test; it can't compile
  otherwise.
- **Completeness (json ⊆ text, minus the allow-list) — by a coverage test.** For every
  fixture payload, assert every scalar leaf of the JSON appears in the rendered text except
  fields on that type's reviewed omission allow-list. This is the one test that guards all
  10 types against the F4 failure mode (silently dropping a field) as payloads evolve.

## How free should the text formatter be? (the layout question)

Rule 2b says formatting is per-type and free; the remaining choice is *how* a type expresses
its custom layout:

- **Per-type formatter functions** — each type ships a `format(node)` that lays itself out
  (tree, table, raw block). Simplest; the polish lives in code next to the type. The
  generic walker is the default a type inherits until it overrides.
- **Presentation hints in the payload** — `build` tags nodes (`render: 'table'`, columns,
  `unit: 'kWh'`) and a single hint-aware renderer lays them out. Keeps layout declarative
  and shared, at the cost of a richer node model.

Both honour Rule 2 (input is the payload only) and Rule 2c (coverage-tested). **Recommend
starting with per-type formatter functions** — they are the least machinery, map directly
onto the existing per-type builders, and the navigation payloads already look right as
indented trees. Reach for payload-level hints only if several types want the *same* table
treatment (the benchmark run/eval reports are the likely first customers — UC-4/UC-7).

## Incremental migration (no big-bang)

1. **Extract `InspectNode` as a real type** and make `build*Node` / `*ToSnake` return it
   (mechanical; no behaviour change). Now there is one contract.
2. **Lift the CLI text renderers into the backend** as per-type `format(node)` formatters
   over the payload (a generic walker as the default), keyed by type; have the CLI call
   them. Delete the per-type CLI renderers. The formatter signature takes only `InspectNode`
   — which is what fixes F4/F8 by construction.
3. **Expose rendering through the API** (`format` param, returns text or JSON) so frontend,
   CLI, and MCP all consume it; route MCP through it. **Default = text**, JSON on opt-in; do
   not lean on `structuredContent` as a hidden channel. (Fixes F1; resolves F15.)
4. **Add benchmark serializers to the registry** so `B-/R-/E-` produce `InspectNode`
   and render as text. (Fixes F2.)
5. **Add the coverage test + per-type omission allow-lists** over fixtures. (Locks in the
   completeness direction; safety is already compile-enforced.)
6. **Then** hand-tune the high-value formatters (run/eval report tables), or introduce
   payload-level presentation hints if several types converge on the same layout.

Steps 1–3 are pure refactors that already retire the worst findings; 4–6 extend coverage.

## Refactor phasing

Two phases, deliberately separated so the structure is verifiable before the content debate:

- **Phase 1 — stand up the structure.** Build the node model, per-type builder modules,
  formatters, the `format` param, and the coverage test, and prove that **every type emits
  both text and JSON**. *Reference, not replica:* **session/parts and the case (`B-.N`) are
  kept** as the JSON reference (we put effort into them before) — reproduce them, accepting
  small deviations for a good reason (e.g. cross-payload consistency). The **benchmark suite,
  run and evaluation (`B-` / `R-` / `E-`) are redesigned, not reproduced** — there is no
  evidence today's are good and they have no text at all, so we don't copy what we don't like.
  Content targets below. **The GUI views are the starting-point reference** for what's
  relevant (`frontend/.../RunReportView.svelte`).
- **Phase 2 — content critique.** Then go back to the use-cases
  ([`use-cases-by-type.md`](use-cases-by-type.md)) with critical eyes on every payload: the
  remaining GRAN findings (F5/F12), error content (F9–F11), reachability (F6/F7), per-type
  allow-list contents, and "is each JSON field even needed."

## Decisions (resolved 2026-06-27)

The six scaffolding questions are settled:

1. **Per-type builder modules own the whole payload; parents delegate to child helpers.**
   The domain is record-based (no classes — [`domain/model.ts`](../../../backend/src/domain/model.ts)),
   so each type gets a **dedicated builder module** (the functional equivalent of "a method
   on the Benchmark class"): the benchmark builder produces the *whole* benchmark payload in
   one place, with dedicated sub-methods per element, **delegating to the case/run helpers**
   so child rendering isn't duplicated. This is the Composite-with-context model: the parent
   asks each child for its *compact* (descendant-context) view; full child detail comes from
   inspecting the child directly. The `InspectNode` model is therefore **uniform across all
   types** (no benchmark "blob" escape hatch) — runtime and benchmark both build real nodes.
2. **`RenderContext`** stays minimal — `{role, mode, partLevel}` re-expressing today's
   two-level behavior; no graded depth-decay yet.
3. **Rendering is a core domain feature in the backend.** Both the JSON build and the text
   serialization live in the backend domain model, exposed via the API so **frontend, CLI,
   and MCP all fetch the payloads** — none of them renders locally. (The CLI's per-type
   renderers are deleted; the frontend consumes the same payloads.)
4. **JSON-first, then a text serializer over it.** Always build the JSON node first; a
   separate method serializes it to formatted text — designed to be **easy to read in a
   terminal *and* easy for an LLM to tokenize and exploit**.
5. **Text by default; JSON opt-in via a param; do not rely on `structuredContent`.**
   `structuredContent` is the MCP-standard channel for schema-validated machine output, but
   **it does not guarantee exclusion from the model's context** (client-dependent) — so it is
   *not* a reliable hidden sidecar. Therefore: return **text only by default** (expected
   better/more compact in ~95% of cases — an assumption to validate), with a **parameter to
   request the full JSON object**. This also resolves F15 (no default double-encode).
6. **Test strategy = reference + redesign.** Snapshot the session/parts text+JSON against the
   captured examples as a *reference* (deviations allowed with reason); for benchmark types,
   write fresh golden fixtures for the redesigned payloads. Plus the coverage test + per-type
   omission allow-list (seeded with the F4 fields).

### Benchmark-family content targets (decided)

The common principle: **each level shows compact children + IDs + the signal you need to pick
what to drill; depth is recovered by inspecting the child.** The GUI's run report is the
relevance reference. Kept as-is: **`B-.N` (case)** — it *is* the rubric/full-spec drill
target — and **sessions + children**.

**`B-` (benchmark suite)** — for understanding/monitoring the suite, **not** results:
- **Cases:** suite shape only (ids, names/prompts) — **not** the full rubric; inspect `B-.N`.
- **Runs:** **minimal** — status, completion, whether evaluations exist — plus the **IDs** of
  runs and evaluations to inspect.
- **No results in `B-`.** For results inspect the **run** (`R-`); for scores the **eval** (`E-`).

**`R-` (run)** — focus on **status + evaluation results + a drillable session list**:
- **Summary:** run status + completion; the evaluation passes present (id, status, overall) to
  monitor progress; and **every session with {id, status}** for drill-down.
- **Full:** adds the **per-session metrics that help choose what to drill** — total context
  used (`tokens.total`, with prompt/completion/reasoning available), `tool_call_count`,
  `tool_error_count`, `terminal_status`, `final_answer`/`error` — plus per-case pass rates and
  the per-tool rollup (the GUI headline). These metrics already exist in `SessionMetrics`
  ([`benchmarkMetrics.ts:23`](../../../backend/src/operations/benchmarkMetrics.ts)); the
  redesign is mostly **restructuring toward a flat, session-centric list** rather than today's
  deep per-case→per-session nesting.

**`E-` (evaluation)** — focus on **status + scores + a drillable session list**:
- **Summary:** status + completeness (`judged/expected`, with an explicit incomplete flag —
  F11), `overall_pct`, and **every judged session with {analysis_session_id, status, pct}** for
  drill-down to the judge's reasoning.
- **Full:** adds the per-case distribution and the per-criterion grid (or leave the grid to the
  judge `analysis_session_id` drill — to be settled when we build `E-`). Fixes F5 (summary is
  genuinely lean) and F11 (incompleteness visible).

**Parked (Phase 2):** depth-graded decay beyond two levels; the per-surface default-format
question for any non-default cases; every remaining GRAN/content/error-content finding;
allow-list *contents* beyond the F4 seed; whether F4 fields stay in the JSON at all.

## Findings this resolves

Directly: **F1** (MCP text), **F2** (benchmark text), **F4** (text ⊆ json by construction +
omissions coverage-tested), **F8** (`latest_error` shown). Enables the format work in
[`formats.md`](formats.md) §4 and is tracked as **F16** in [`FINDINGS.md`](FINDINGS.md).
