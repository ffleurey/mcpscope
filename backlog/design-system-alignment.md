# Design System Alignment — mcpscope

Plan to bring the Svelte frontend in line with `backlog/design-system.md` and the
living `DesignReference.svelte`. **Rewritten 2026-06-16** from a full component audit
(29 components + `app.css`). Supersedes the 2026-06-15 gap analysis (condensed history
at the bottom — note that some items it marked "done" had regressed or were incomplete,
which the audit caught).

## Status

- **Pass 1 (done, 2026-06-16):** reconciled the three sources of truth — `design-system.md`,
  `app.css`, and `DesignReference.svelte`. Fixed font-stack drift, the phantom `--space-*`
  tokens, the radius-ladder claim, input background, and the input focus a11y bug. Added
  `.status-dot` and `.token-pill` as canonical global primitives. Made the reference render
  **live tokens** + the **real** `IdBadge` / `InlineAppError` / `DialogShell` instead of copies.
- **Pass 2 (this plan):** apply the same discipline to the 29 feature components.
  - **Phase A done (2026-06-16):** fixed the real rendering bugs and swept every
    `var(--x, #hex)` fallback. No foreign-palette hex or undefined tokens remain
    (the `JsonDialog` hljs number/literal colors are deliberately left for D7). Type-check + build green.
  - **Phase B done (2026-06-16):** migrated all 5 forms/modals to the global field primitives
    (~250 net lines of duplicated CSS removed). Type-check + build green, **visually verified** by the user.
  - **Phase C done (2026-06-16):** **rebuilt** the 3 config pages from scratch as dense tables
    (not the old cards) — see the rewritten Phase C below. Connections verified by the user before
    replicating to MCP Servers + Model Configs. Type-check + build green.
  - **Phase C refinements + reference sync done (2026-06-16):** `table-layout: fixed` + `<colgroup>` +
    horizontal-scroll (no jump/collapse); **resizable columns** (`use:columnResize`, drag header border);
    default = single first-column amber toggle (radio = single-select, checkbox = multi-select);
    load/eject = one amber icon (`.icon-glow` loaded / `.icon-blink` busy); bigger table icons (1.3rem);
    fixed the disabled-radio dimming bug. **Updated `DesignReference.svelte`** (live table demo, new
    icons, state markers, `.field-static`) and **`design-system.md`** (real Tables spec, Icons section,
    sanctioned amber glow/blink) so all three sources of truth match again. Build green, user-verified.
  - **Checkbox/Radio unification done (2026-06-16):** new shared `Checkbox.svelte` / `Radio.svelte`
    (hidden native input + MDI glyph + amber glow = the table toggle look). Migrated both launch modals
    and the reference; retired `.check-option` / `.radio-opt`. Forms and tables now share one
    radio/checkbox visual. Build green.
  - **Phases D/E/F — safe items done (2026-06-16); session-trace refactors deferred.** Build green. Done:
    - **E (all):** E4/E6 `ErrorDialog` → `DialogShell` + `InlineAppError` (red title & banned box-shadow gone);
      E7 `IdBadge` reuses `.token-pill`, drops box-shadow, completes menu ARIA. (E1/E2/E3 landed in Phase C; E5 in Phase B.)
    - **D1** `ExecutionBar` status-dot → global (`paused`→`warn`); **D2** Sidebar `.icon-btn` shadow removed,
      new `.icon-btn-dim` modifier; **D3** `.token-pill` redefinitions deleted (CompactRoundContent, TracePartBlock, IdBadge);
      **D5 (chrome)** ExecutionBar's `.exec-btn`/`.queue-remove-btn` → `.btn-sm`/`.icon-btn-danger`;
      **D7** added `--syntax-*` tokens, JSON dialog off raw hex.
    - **F:** F1 off-ladder radii → ladder (5→4/6, 10–14→8); **F2 legacy-alias sweep** — all 213 usages → canonical,
      alias block deleted from `app.css`; F4 scrollbar hex → tokens.
    - **Deferred (need a focused session-trace visual pass — they change the green-phosphor UI we haven't been reviewing):**
      D4 (consolidate ~7 bespoke status pills → a `.status-pill` primitive), D5 (session-trace buttons `.raw-btn`/`.meta-btn`/`.preview-btn`/`.csb-mode-btn` → `.btn-sm`),
      D6 (extract one shared disclosure primitive from the 5 `<details>`+▶ copies).
    - **F3 deferred:** no formatter is configured (no Prettier/EditorConfig); a blanket reformat is a project decision, not a cleanup.

## Root cause (what the audit found)

Multiple authors/agents built components by **copying shared primitives instead of importing
them**, and by writing **`var(--token, #fallback)` everywhere**. The fallbacks reference at
least three foreign palettes (GitHub greys, Material colors, Tailwind reds). Net effect: much
of the UI is silently styled by dead fallback values from a palette that isn't ours, and a few
**undefined tokens render the wrong colors outright**. Almost every finding below is a symptom
of those two habits.

---

## Phase A — Real bugs + fallback sweep ✅ DONE (2026-06-16)

These rendered *wrong* or hid future breakage. No new primitives needed. All items below applied.

| # | Item | Files / refs |
|---|---|---|
| A1 | Progress bar uses undefined `--bg-subtle` / `--color-primary` → light-grey track + blue fill in the dark UI. Use `--border` / `--amber-bright`. | `ChatView.svelte:837,844` |
| A2 | `color-mix()` with undefined `--accent` → whole declaration invalid → background silently missing. Use a defined token. | `SessionCompactionStepBlock.svelte:62`, `AnalysisWorkflowBlock.svelte:245,355`, `CompactRoundContent.svelte`, `StreamingRoundDeltaBlock.svelte`, `SessionTurnBlock.svelte:624` |
| A3 | `var(--font-mono)` (undefined, no fallback) → monospace data renders in default font. Use `var(--mono)`. | `ErrorDialog.svelte:89`, `ConnectionTestDialog.svelte:124,169`, `PrimarySessionLaunchModal.svelte:191`, (+ masked: `JsonDialog`, `MarkdownPreviewDialog`) |
| A4 | Undefined button variants `.btn-ghost` / `.btn-secondary` silently degrade to base `.btn`. Use `.btn .btn-sm`. | `ChatView.svelte:375,512,522` |
| A5 | Raw off-palette hex with no token home. Map to `--red-*` / syntax tokens (see D7). | `AnalysisWorkflowBlock.svelte:294` (`#b43b25`), `ChatView.svelte:817`, `JsonDialog.svelte:43-44` (`#f9a825`,`#e879f9`) |
| A6 | **Fallback sweep**: delete every `var(--x, #hex)` fallback across the codebase; where the token is undefined, point at the real one. This removes the foreign GitHub/Material/Tailwind palette (`#30363d #8b949e #e6edf3 #f85149 #4caf50 #5b9bd5 #7c3aed #e0e0e0 #dc2626 #b45309`). | ExecutionBar, ChatList, ChatView, SessionTurnBlock, AnalysisWorkflowBlock, JsonDialog, MarkdownPreviewDialog |

---

## Phase B — form/modal migration ✅ DONE (2026-06-16)

Migrated all three forms + both launch modals onto the global `.field*` / `.check-option` /
`.radio-opt` primitives; deleted the duplicated local CSS (~250 net lines gone). Decided
**against** a `<Field>` wrapper component — the design system favors flat DOM + direct classes
over abstraction, and the global classes already are the primitive. Promoted `.form-stack`,
`.form-actions`, and `.field-static` to `app.css`. Read-only values (transport, locked IDs)
now render as `.field-static` text, not disabled inputs (B5). Collapsed the redundant
`ModelConfigForm` validate branch. Type-check + build green. Items as completed:

The single biggest source of accidental complexity *was*: the **three forms each re-declared the
entire `.field*` stack** (and the copies had drifted), and **both launch modals did it again**.

- B1 — Build a `Field.svelte` wrapper (label + input/select/textarea + hint + error in one), or at
  minimum migrate to the existing global `.field` / `.field-label` / `.field-input` /
  `.field-errortext` / `.field-hinttext` classes.
- B2 — Fix the wrong class names everywhere: `.field-error` (used as the message) → `.field-errortext`;
  `.field-hint` → `.field-hinttext`. They currently only work via local redefinition.
- B3 — Delete the local form `<style>` blocks in `LmConnectionForm`, `McpProfileForm`, `ModelConfigForm`.
- B4 — `AnalysisLaunchModal` / `PrimarySessionLaunchModal`: replace `.field-select`/`.field-textarea`
  (verbatim copies of `.field-input`) and the bespoke card-style checkboxes/radios with
  `.field-input` / `.check-option` / `.radio-opt`.
- B5 — Render read-only values (e.g. transport) as static text, not disabled `<input>`s
  (`McpProfileForm.svelte:116`, `ModelConfigForm`).

---

## Phase C — rebuild the 3 config pages as tables ✅ DONE (2026-06-16)

Decided **not** to extract the old card layout — it was the wrong model. Rebuilt Connections,
MCP Servers, and Model Configs from scratch as **dense data tables**: static columns, a dynamic
state column (green `.status-dot`), and always-visible icon-button row actions at the end. This
realizes the dormant Tables spec and **also resolves the Phase E color issues for these files**
(no more amber "Set as default" buttons / amber default badges / green-on-chrome text; default &
loaded are now green status-dots, set-default is a plain star icon action).

What landed:
- **Icon set swap (app-wide):** added `@mdi/js` (Material Design Icons, tree-shakeable path data —
  no font). Re-sourced `icons.ts` from it, keeping the `{@html iconX}` API, so the *whole app*
  flipped to Material with zero consumer churn. Custom hand-drawn SVGs retired.
- **New shared `app.css` primitives:** `.config-view` / `.config-view-header` / `.header-actions`,
  `.data-table` (+`.col-num` / `.col-mono` / `.col-actions`), `.row-actions`, `.icon-btn-danger`,
  `.status-cell` / `.status-muted`, `.state-on`.
- **Connections:** Name · Provider · Base URL · Auth · Test · actions. Test is **inline + ephemeral**
  (status-dot + message; click for detail dialog; resets on navigation). Form reordered: Provider
  before Base URL.
- **MCP Servers:** Name · ID · URL · Default(green dot) · Test · actions (test, star-toggle, edit, delete).
  Dropped the constant Transport column and the redundant default checkbox/badge.
- **Model Configs:** Name · Connection · Model · Temp · Reasoning · Context · Default · Loaded · actions
  (load/eject, details, set-default star, edit, delete). Per-row load/eject errors fold into the
  Loaded cell (red dot + tooltip). Form reordered: **Connection → Model → Name → ID → tuning**.

Per-page deltas left intentionally: green "Loaded" status text is now a proper `.status-dot` (allowed
for active state). Remaining color-rule work in Phase E is now only `ErrorDialog` + `IdBadge`.

---

## Phase D — Consolidate the copied primitives

| # | Item | Files / refs |
|---|---|---|
| D1 | `ExecutionBar` defines its own `.status-dot` (+ off-vocabulary `paused`). Delete it; use global `.status-dot`, rename `paused` → `warn`. | `ExecutionBar.svelte:137-151` |
| D2 | `Sidebar` defines a local `.icon-btn` that **shadows** the global primitive. Remove; add a dim modifier in `app.css` if needed. | `Sidebar.svelte:175-195` |
| D3 | `.token-pill` re-declared verbatim; `IdBadge`'s `.id-pill` re-derives it. Use the global class. | `CompactRoundContent.svelte:545`, `TracePartBlock.svelte:319`, `IdBadge.svelte:66-79` |
| D4 | ~7 bespoke 999px pills + `●/○` glyph status indicators. Replace with `.token-pill` and a new **status-pill / badge primitive** (D7). | `SessionTurnBlock`, `CompactRoundContent`, `StreamingRoundDeltaBlock`, `AnalysisWorkflowBlock`, `ModelConfigs`, `McpProfiles` |
| D5 | ~6 bespoke small buttons (`.exec-btn`, `.raw-btn`, `.meta-btn`, `.action-btn`, `.queue-remove-btn`, `.csb-mode-btn`). Consolidate onto `.btn-sm` / `.icon-btn` (+ a danger modifier). | session blocks, ExecutionBar, ChatList, ContextSnapshotBar |
| D6 | Disclosure/expand toggle re-implemented 5+ times (two mechanisms). Extract one shared disclosure primitive. | SessionTurnBlock ×2, SessionPreludeBlock, CompactRoundContent, TracePartBlock ×2 |
| D7 | Add **status-pill/badge** and **syntax-highlight** tokens (JSON + markdown currently diverge and use raw hex); document both. | `JsonDialog`, `MarkdownPreviewDialog`, app.css |

---

## Phase E — Color-rule + a11y fixes

| # | Item | Files / refs |
|---|---|---|
| E1 | Amber overuse: only one primary action per view. "Set as default" on every card → plain `.btn`; keep only the header "New" as `.btn-primary`. | `ModelConfigs.svelte:235,179` |
| E2 | Amber on passive state: "Default" badges / `is-default` card borders → grey `.token-pill` or `.status-dot`. | `McpProfiles.svelte:198-201`, `ModelConfigs.svelte:302-336` |
| E3 | Green on chrome: model "loaded" status uses green *text* → grey label + `.status-dot`. | `ModelConfigForm`, `ModelConfigs` |
| E4 | Dialog title is red (titles stay grey chrome). | `ErrorDialog.svelte:62` |
| E5 | Focus suppressed: `.field-select { outline:none }` with no `:focus-visible`. Restore the amber focus border (resolved by Phase B migration). | `AnalysisLaunchModal`, `PrimarySessionLaunchModal` |
| E6 | **`ErrorDialog` is hand-rolled** (`<div>` overlay, banned `box-shadow`, no close button, no backdrop-click close). Migrate to `DialogShell`. | `ErrorDialog.svelte` |
| E7 | `IdBadge` dropdown uses a `box-shadow` + raw rgba; incomplete `role="menu"`. Use `--border`/`--bg-surface` for elevation; fix or drop the menu role. | `IdBadge.svelte:43,94` |

---

## Phase F — Ladder, drift, and alias debt (mechanical, do last)

- F1 — Off-ladder radii → 4 / 6–8 / 999: 12px & 14px cards, 10px bubbles, 7px radio cards, 3px/5px assorted.
- F2 — Legacy-alias sweep: `--bg-panel`→`--bg-surface`, `--text`→`--text-bright`, `--text-muted`→`--text-dim`,
  `--border-subtle`→`--border`, `--color-*`→canonical. Then delete the alias block from `app.css`.
- F3 — Formatting drift: Prettier pass (2-space vs 4-space files), and one stacking convention
  (`flex-column`, not `grid`) for identical part stacks.
- F4 — `app.css` scrollbar uses raw `#444`/`#555` → `--border`/`--bg-hover`.

---

## Guardrails to encode (stop the regression)

This is a multi-author repo; conventions need teeth, ideally a cheap lint rule:

- **Ban `var(--x, #hex)` fallbacks** — this is how the foreign palette and undefined tokens hid.
- **Never redefine a global primitive's class name** (`.btn`, `.icon-btn`, `.field-*`, `.status-dot`,
  `.token-pill`) in component scope.
- **Never `outline:none` without a `:focus-visible` replacement.**
- **No `box-shadow` / gradient on chrome.**
- Every new primitive must be **rendered live in `DesignReference.svelte`** so it can't drift.

---

## Open decisions / deferred

- **Spacing scale** — keep "no scale" vs. adopt a tiny xs/sm/md/lg scale. The doc contradiction is
  resolved (literal values); the strategic choice is still open. Needs a decision.
- **Logo / wordmark** — still unimplemented. Sidebar header shows "Sessions". Add a 2-tone amber
  wordmark (`--amber-bright` + `--amber-dim`), optional oscilloscope-waveform SVG. *(rescued from prior plan)*
- **Tables** — no production table exists; pattern is documented as a target only. Build with the
  first real table. *(rescued from prior plan)*
- **Sidebar background** — `--bg-sidebar` aliases to `--bg-base`, but `design-system.md` lists the
  sidebar under `--bg-surface`. Reconcile when Phase D2 touches the sidebar.
- **Green phosphor session content** — *largely landed* since the prior plan: the trace renderers
  (`TracePartBlock`, `CompactRoundContent`, `StreamingRoundDeltaBlock`, `SessionTurnBlock`) correctly
  use `--green-bright` for content with grey chrome. Verify coverage during Phase D rather than as a
  separate push.

---

## Suggested order

A (bugs + sweep) → B (Field + forms) → C (cards) → D (primitives) → E (color/a11y) → F (mechanical).
A and F are independent and can slot in anytime; B→C→D are where the real simplification is.

---

## History — prior pass (2026-06-15, pre-audit)

A first alignment pass landed `color-scheme: dark`, token-based status dots, the amber nav
underline, the global `.field*` / `.check-option` / `.radio-opt` classes, `DialogShell` body
padding + dragging, and moved the config forms into dialogs. **Caveat:** it recorded the three
config forms as "canonicalized," but the 2026-06-16 audit found they still re-declare the
`.field*` stack locally (Phase B). The button-primary question was settled (outlined pattern is
canonical). Treat that pass as history, not guidance.
