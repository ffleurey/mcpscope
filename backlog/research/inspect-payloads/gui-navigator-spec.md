# GUI inspect-payload navigator — specification (draft for discussion)

> Builds on the consolidated [Inspect dialog](../../tuning-of-inspect-payload.md) shipped in
> Phase 1.

> **Decisions (2026-06-28):** (1) JSON detection = **grammar-only**. (2) Text linkify = **T2**
> — the frontend prefetches the JSON for any payload, extracts the real id-set, and matches
> those exact ids in the rendered text (reliable, no content false positives). (3) Detail/Format
> are **sticky** across navigation. (4) Failed lookups **stay in history** (back recovers).
> (5) **Autocomplete + any backend change are deferred** — the id input is free-text for now.
> Implementing **Phase A + T2** (frontend-only): back/forward history, JSON+text id links,
> free-text id input.

## Goal

Turn the single-element `InspectDialog` into a **browser-like navigator** so a human can
explore the payload graph the way the CLI/MCP user (and the analysis/judge agents) do:
open an element, follow links to related elements (children, parent, referenced
sessions/runs/evaluations), go **back/forward**, and **jump to any id**. The navigator is
the GUI equivalent of "inspect → read child ids → inspect a child → …".

## UX (extends the existing toolbar)

```
[←] [→]   [ id input ⌄ ]            Detail [Summary|Full]   Format [Text|JSON]   [Copy payload]
─────────────────────────────────────────────────────────────────────────────────────────────
 <payload, with inspectable IDs rendered as clickable links>
```

- **`[←] [→]`** — back / forward, browser semantics (disabled at the ends).
- **ID input** — shows the current id; editable to navigate; `Enter` goes. Optional
  autocomplete (see below). Paste-friendly.
- **Detail / Format / Copy** — unchanged from today.
- **Body** — the payload with **inspectable ids hyperlinked**; clicking an id navigates the
  dialog to inspect it.

## Navigation model

- An in-dialog **history stack** of ids with browser semantics: navigating to a new id
  truncates any forward entries; `←`/`→` move a pointer over the stack.
- **Detail/Format are sticky view settings** (persist across navigation), not stored
  per-history-entry. (Decision 3.)
- A failed lookup (stale/deleted id) renders in the existing error state and **still counts
  as a navigation**, so `←` returns you to the last good view. (Decision 4.)

## The crux: which ids are navigable, and how we detect them

Payloads contain **two** kinds of id, and only one is inspectable:

| Navigable (inspect grammar) | NOT navigable (config) |
|---|---|
| `9LJM`, `9LJM.1T`, `9LJM.1T.3.2-T`, `9LJM.S.2-TD` | `model_config_id` = `ce0c471c-…` (uuid) |
| `B-GUDP`, `B-GUDP.1`, `R-RZNP`, `E-FE7K` | `mcp_profile_ids` = `["ha-replay"]` (slug) |
| fields: `id`, `*_id`, `*_ids[]`, `parent_ref.id`, `stripped_part_ids[]`, `analysis_session_id`, `source_case_id`, … | `judge_model_config_id`, `model.key`, `model.id` |

**Discriminator = the inspect-ID grammar** (source of truth:
`backend/src/domain/hierarchicalIds.ts`):
- session id = `[A-HJ-NP-Z2-9]{4}` (uppercase Crockford base32 — no I/O/0/1),
- hierarchical suffixes `.S`, `.<n>T`, `.<n>W`/`.<n>C`, `.<w>.<n>T.<n>`, `…-<SP|MI|TD|U|R|A|T|TR|DN>`,
- benchmark family `B-XXXX`, `B-XXXX.N`, `R-XXXX`, `E-XXXX`.

Config ids are **lowercase / contain dashes / are uuids or slugs**, so they never match the
grammar — they are excluded for free. This is why grammar-based detection (not "looks like
an id") is the right approach.

### JSON view — linkify
Linkify string values matching the inspect-ID grammar. Very safe because (a) the grammar
excludes config ids and (b) ID-shaped strings in our structured JSON are real ids. Optional
extra safety: only linkify at id-bearing keys (`id`, `*_id`, `*_ids`, `parent_ref.id`,
`stripped_part_ids`). (Decision 1.)

### Text view — linkify
The text is backend-rendered plain text (shared with CLI/MCP). Three options:
- **T1 — frontend regex** (grammar + word boundaries) over the text. Simplest; small
  false-positive risk if a 4-char uppercase token appears inside content (a prompt, a tool
  result). The restrictive charset keeps this rare.
- **T2 — intersect with the payload's real id-set** (extract ids from the JSON, then linkify
  only those exact strings in the text). No content false positives. Needs the JSON
  available in text mode (an extra fetch, or render text from JSON client-side).
- **T3 — backend id-occurrence sidecar**: the text renderer already knows where the real ids
  are; return their offsets alongside the text. Exact and content-safe; small backend change.

Recommendation: **MVP = JSON links + text via T1**; upgrade to T2/T3 only if false positives
bite. (Decision 2.)

## ID input autocomplete

- Suggestions come from **listable top-level entities**: sessions (`/api/sessions`),
  benchmarks / runs / evaluations. **Fine-grained part/turn/round/step ids are derived, not
  globally listable**, so they are *not* in autocomplete — you reach them by following
  in-payload links once you've navigated into a session/run.
- Enrich suggestions with the **current payload's child ids** and **recently visited ids**.
- Free-text entry is always allowed; the inspect call validates and errors gracefully.

## Gaps, risks & decisions to discuss

1. **JSON detection: grammar-only vs id-bearing-key allowlist.** Grammar-only is simpler and
   already excludes config ids; key-allowlist adds belt-and-suspenders at the cost of
   coupling to payload shape. *Proposed: grammar-only, revisit if needed.*
2. **Text linkify approach (T1/T2/T3).** Trade simplicity vs exactness vs a backend change.
   *Proposed: T1 for MVP.*
3. **Sticky vs per-entry Detail/Format.** *Proposed: sticky.*
4. **Error navigations in history.** *Proposed: keep them (back recovers).*
5. **Autocomplete scope = top-level only.** Manage expectations; deep ids via links. Is that
   acceptable, or do we want a richer "search ids" backend endpoint later?
6. **No global flat id list** for parts/turns — confirmed by the data model. The design works
   *around* this (links + per-session children) rather than fighting it.
7. **Grammar duplicated frontend↔backend.** Replicate the regex with a pointer to
   `hierarchicalIds.ts`, or expose it as a generated/shared constant. *Proposed: replicate
   with a comment; it's tiny and stable.*
8. **Non-inspectable but interesting ids** (model config, mcp profile): leave as plain text
   now. Could later link to their config views — out of scope.
9. **Performance.** Per-navigation fetch is cheap (small payloads). The autocomplete session
   list can be large (hundreds) — fetch once, filter client-side, cap the dropdown.
10. **Scope boundary.** The navigator lives in the dialog only; we do *not* (yet) linkify ids
    in the main trace/report views. The pill remains the entry point.
11. **Keyboard niceties** (Alt+←/→, Enter-to-go, Esc to close) — nice-to-have, not MVP.

## Suggested phasing

- **Phase A (MVP, frontend-only):** back/forward history + JSON id links + editable id input
  (free text, no autocomplete). No backend change.
- **Phase B:** autocomplete from listable entities (+ in-payload children + history); text-view
  links via T1.
- **Phase C (optional):** backend id-occurrence sidecar (T3) for exact text links; keyboard
  shortcuts; visited-id highlighting.

Almost entirely a frontend feature; the only possible backend touch is the optional Phase-C
text id-sidecar.
