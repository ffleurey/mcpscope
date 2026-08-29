# Design System — mcpscope

The rules, rationale, and tokens for the mcpscope frontend. Read this before changing
anything visual, and keep it in sync (see **Working in this design system** below).

The goal is not visual polish for its own sake — it is consistency, reuse, and a clean
implementation. One small set of tokens and shared primitives keeps every screen looking like
the same application, and the explicit rules plus live reference components exist because much
of this GUI is built with coding agents — which do not keep a UI consistent without concrete
instructions and templates to copy.

## Three sources of truth

1. **This document** — the *why* and the *rules* (identity, palette, principles, patterns).
2. **`frontend/src/app.css`** — the *implementation*: design tokens in `:root` and the shared
   primitive classes (`.btn`, `.field-*`, `.data-table`, `.status-dot`, `.pill`, …).
3. **The Design System Reference** — the *living visual guide*: the in-app **Design** page,
   rendered by `frontend/src/lib/components/DesignReference.svelte`. It renders **live tokens and
   the real components/classes** (not copies), so it cannot silently drift from `app.css`.

The master logo assets (logo, mark, wordmark, favicon) live in [`design-assets/`](design-assets/) —
see its [README](design-assets/README.md) for the manifest and the [Logo](#logo) section below for
the rules.

### Working in this design system

- Reuse the shared primitives. Don't re-implement a button/field/pill/dialog/table that already exists.
- Tokens and shared primitive classes live in `app.css`; component-*specific* styling stays co-located
  in the `.svelte` `<style>` block.
- When you change a design element, update **all three** so they stay in agreement: this doc, the
  `app.css` token/primitive, and the Design System Reference (add/adjust the live demo).
- New primitive → render it live in the Reference so the next person can see and reuse it.
- Bans: no ad-hoc hex for chrome (use tokens), no `box-shadow`/gradient on chrome, never suppress
  `:focus-visible`, no `var(--x, #hex)` fallbacks, don't shadow a global primitive's class in a component.

---

## Identity

- **Product:** mcpscope — a test/evaluation tool for MCP servers (chat inspection, trace analysis, benchmarking).
- **Metaphor:** "scope" = **oscilloscope** (signal inspection, debugging), not weapon scope.
- **Audience:** developers and engineers.
- **Aesthetic:** dark background, a phosphor-inspired amber accent, restrained color — most UI
  is monochrome grey; color is added only where it carries signal. Inspiration is CRT test equipment,
  not retro computing. The core rule: **chrome is dim grey; session content is bright grey;
  amber highlights metadata values and the primary action; green and red are status colors.**

---

## Color palette

### Neutral greys — UI chrome (~90% of the surface)

The workhorse colors. Forms, dialogs, navigation, sidebar, labels — almost everything is grey by default.

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#141414` | Main application background; form inputs |
| `--bg-surface` | `#1e1e1e` | Elevated surfaces: panels, dialogs, sidebar, cards |
| `--bg-raised` | `#292929` | Boxes nested on a surface: open disclosure rows, message bubbles, the composer |
| `--bg-hover` | `#343434` | Hover state for interactive elements — must read on `--bg-raised` too |
| `--border` | `#414141` | Borders, dividers, separators |
| `--text-dim` | `#a8a8a8` | Labels, metadata, muted/secondary text |
| `--text-bright` | `#e8e8e8` | Primary body text and session content — near-white |
| `--text-emphasis` | `#ffffff` | Markdown emphasis (bold/headers/inline code) inside session text |

- The background ramp is base → surface → raised → hover; every adjacent step is ≥ 10/255 so each
  layer reads against the one below it. Never fake an elevation with a `color-mix()` toward
  transparent — over a same-colored parent that composites to a no-op; use the next ramp token.
- `--bg-base` is the outermost background; `--bg-surface` is one step lighter for any container that
  needs distinction. Inputs sit on `--bg-base` (one step *darker* than the panel they live in).
  `--bg-raised` is for a box *inside* a surface (a tool-call disclosure inside a card).
- `--text-bright` is the default text for UI **and** session content; `--text-dim` for supporting
  information and labels.
- No color-on-color: accents sit on the grey ramp only, never on another color.

### Amber — the accent (metadata + primary action)

Amber does two jobs: it fills the **single primary action** per view/dialog (plus the logo,
active-tab underline, links, focus and selection/activity markers), and it **highlights metadata
values** — token counts (`.pill.amber`, `TokenPill.svelte`), ID badges on hover, round/context
token totals. **Amber never colors prose**: message text, reasoning, tool output, labels, and
descriptions stay grey. If a metadata number isn't worth drawing the eye to, use `--text-dim`.

| Token | Value | Usage |
|---|---|---|
| `--amber-dim` | `oklch(55% 0.15 75)` | Logo, secondary amber text, active-surface borders (dialogs, focused composer) |
| `--amber-bright` | `oklch(72% 0.18 75)` | Primary action buttons, metadata pills/counts, active-tab underline, links, input focus |
| `--amber-glow` | `oklch(78% 0.20 75)` | Hover/enhanced state; selection/loaded glow on icon toggles |

**Amber state markers — the one sanctioned glow/animation exception.** Icon toggles use amber to signal
state: `.icon-glow` = selected/loaded (steady amber glow via `drop-shadow`), `.icon-blink` = in-progress
(pulsing amber). Used for the default-config **radio** (single-select), default-MCP **checkbox**
(multi-select), and model load/eject. Everywhere else stays flat — status *dots* never glow.

### Green — status semantics only

Green means "running / success / loaded" — nothing else. Session content is **no longer green**
(it was, in the original phosphor-trace metaphor): prompts, answers, reasoning, tool names,
arguments, results, previews, and tool schemas are all grey (`.session-text` → `--text-bright`,
their metadata → `--text-dim`).

| Token | Value | Usage |
|---|---|---|
| `--green-dim` | `oklch(50% 0.14 145)` | Idle/offline status dot |
| `--green-bright` | `oklch(65% 0.18 145)` | Running status dot, `.pill.green` statuses, success metrics, loaded/complete markers |
| `--green-glow` | `oklch(72% 0.22 145)` | Bright/pulsed status |

**Still green:** `.status-dot.running/.idle`, `.pill.green` statuses, "Analysis complete" and other
completion markers, connection-test success, benchmark expected-tool tags, and `--syntax-string` in
the JSON viewer (part of the documented syntax-palette exception).

### Red — destructive actions, errors

| Token | Value | Usage |
|---|---|---|
| `--red-dim` | `oklch(45% 0.12 25)` | Error text, danger button borders |
| `--red-bright` | `oklch(60% 0.16 25)` | Error states, deletion buttons, failures |

Two shades only — errors don't need a glow.

### Syntax highlighting (JSON / code)

A small dedicated palette (`--syntax-key/-string/-number/-literal/-punctuation`), reusing the main
accents where they fit. Like the context bar, it's a documented exception to the restrained palette.

### Context bar colors (separate, documented exception)

The context-window visualization bar uses a broader part-type palette (red/pink/purple/slate/orange/blue),
defined in `frontend/src/lib/design/partColors.ts` + `app.css`. It is specific to that visualization and
does not follow the main palette. The exception also covers the bar's track/separator shades
(`color-mix` with `#000` in `ContextSnapshotBar.svelte`) — the component needs steps *darker* than
`--bg-base`, which no chrome token provides.

---

## Typography

The CRT feel comes from color, not fonts — use compact, highly readable system faces.

| Token | Value | Usage |
|---|---|---|
| `--sans` | `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif` | UI text |
| `--mono` | `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace` | Data: token counts, IDs, code, table cells |

Standard GitHub system-font stacks — no web-font download. Base **14px** on `html`/`body` (so
`1rem = 14px`); line-height **1.4** UI / **1.5** body.

All font sizes go through the five-token scale below — never write a raw `font-size` value for text
(icon glyph sizes are the exception). Pick by role, not by eye:

| Token | Value | ≈px | Role |
|---|---|---|---|
| `--font-title` | `1.4rem` | 19.6 | View/section headers (`.config-view-header h2`, report titles) |
| `--font-body` | `1.25rem` | 17.5 | Session content (`.session-text`), composer, markdown prose |
| `--font-ui` | `1.1rem` | 15.4 | Buttons, inputs, dialog/chat titles, menus, general UI text |
| `--font-meta` | `0.95rem` | 13.3 | Hints, previews, secondary text, table cells, `.btn-sm` |
| `--font-label` | `0.85rem` | 11.9 | Pills, uppercase labels (`.meta-label`, `.field-label`, table headers), `.btn-xs` |

---

## Spacing & density

No spacing scale — **use the minimum spacing that keeps information legible** (a deliberate choice for a
dense inspection tool; the shared primitives already carry consistent internal spacing).

- Default container/dialog padding **0.75rem**; default gap between related elements **0.35rem**
  (buttons/inputs are tighter — see their sections).
- Use native CSS `gap`/`padding` directly — no utility classes or abstraction layers.
- Flat DOM: avoid unnecessary wrapper divs. Dialogs and forms should fit without scrolling.

---

## Component patterns

All of these are shared primitives in `app.css` (or shared components) with a live demo in the Reference.

### Buttons

| Variant | Style |
|---|---|
| `.btn` | Transparent bg, dim border + text; hover lifts to `--bg-hover`, brighter text |
| `.btn-primary` | Filled `--amber-bright` bg, matching border, dark (`--bg-base`) text; **only one per view/dialog** |
| `.btn-danger` | `--red-bright` border + text, subtle red tint on hover |
| `.icon-btn` | Borderless icon button; `.icon-btn-danger` (red), `.icon-btn-dim` (muted chrome) |

Sizes: default `0.4rem 0.85rem`; `.btn-sm` (`0.28rem 0.65rem`); `.btn-xs` (dense inline). Focus-visible:
2px `--amber-bright` outline, 2px offset.

### Form elements

- Inputs/selects/textareas (`.field-input`): `--bg-base` bg, `--border`, `--text-bright`. Focus shows a
  **`--amber-bright` border on `:focus-visible`** — always, never suppressed (WCAG 2.4.7).
- Labels: `.field-label` — `--text-dim`, 0.78rem, uppercase, above the input. Hints `.field-hinttext`,
  errors `.field-errortext`, read-only values `.field-static`. Layout: `.form-stack` + `.form-actions`.
- Checkboxes/radios: the **`Checkbox.svelte` / `Radio.svelte`** components — a visually-hidden native
  input (keeps accessibility + form semantics) with an MDI glyph that glows amber when checked, the same
  toggle look as the tables (`.opt-check`/`.opt-radio`). Selects stay native (`accent-color`).
- Segmented control: the **`SegmentedControl.svelte`** component — a compact group of
  mutually-exclusive options (a labelled toggle group). Inactive options are `--text-dim`; the
  **selected** option uses the sanctioned active signal — `--amber-bright` text on a faint amber
  wash (`color-mix(--amber-bright 16%, transparent)`) — never dark-on-grey. Use for small,
  binary/few-option switches (e.g. the inspect dialog's detail and format axes); for more or
  longer options prefer a native select.

### Dialogs

Use the shared **`DialogShell.svelte`** — never hand-roll `<dialog>`. Backdrop `rgba(0,0,0,0.62)`,
`--bg-surface` surface, 8px radius, header & body `0.75rem 1rem`, `min(720px,95vw)` / 85vh,
draggable header. **Separation from the dark background:** a `--amber-dim` border (marks the active/
focused surface — a sanctioned use of the amber accent) plus an elevation shadow
(`0 10px 40px rgba(0,0,0,0.55)`); dark-on-dark needs both color and depth. **Dismissal:** a dialog
closes only via an explicit action — a footer button, the close ✕, or Escape (the keyboard equivalent
of the ✕). Clicking the backdrop does **not** close it, so an accidental outside-click never discards
in-progress content. Error content: the **`InlineAppError.svelte`** component. For a large
content viewer, two opt-in props: **`fixedHeight`** locks the dialog at 85vh so it doesn't
resize as content/options change, and **`flush`** removes body padding so the child owns its
layout (e.g. a fixed toolbar above a single scrolling region) — used by the inspect dialog.

### Tabs / navigation

Active tab: 2px `--amber-bright` underline + `--text-bright`. Inactive: `--text-dim`. Hover: `--text-bright`.

### Status indicators

`.status-dot` (8px flat circle) + modifier: `.running` (green-bright), `.idle` (green-dim),
`.warn` (amber), `.error` (red). Flat — no glow. Rounded status labels are `.pill` variants (see the
Pill section) — **render a status word only when it is noteworthy** (error, aborted, streaming,
waiting); a `complete` label on every row is noise.

For **run status** (benchmark/analysis runs) the dot and pill modifier come from the shared
`runStatusDotClass` / `runStatusPillClass` helpers in `src/lib/format.ts` (`runStatusPillClass`
returns a `.pill` color variant: `green`, `red`, or `''` for the dim default) — one source of truth
so every run row renders identically (in particular, `paused` reads as an active dot, not idle).
Don't re-derive these per component.

### Tables

The shared **`.data-table`** primitive (config admin pages, run reports; live demo in the Reference):

- Wrap in `.table-scroll` (`overflow-x:auto`); `table-layout: fixed` with a `<colgroup>`. The table is
  `width: 100%` so it **fills (justifies to) its container**. Give each column a fixed `<col style="width:…">`
  **except exactly one**, which is the elastic column — `<col class="col-flex">` with no width. That one
  column absorbs the leftover space (so the table fills) and yields first when space is tight; when the
  fixed widths exceed the container the wrapper scrolls instead of crushing the columns. Pick the column
  that benefits most from width (a name, URL, model, or path) as `col-flex`.
- **Every `.data-table` is resizable** — always add `use:columnResize`. Dragging a fixed column's header
  border changes only that column; the **`col-flex` column absorbs the difference**, so the table stays
  justified and the other fixed columns don't move. The `col-flex` column has no handle (resizing it would
  defeat the fill). A persistent thin divider marks each resizable border and turns amber on hover, so the
  grab point is always visible. Widths are session-only.
- Header: `--text-dim` 0.68rem uppercase. **A column's header and cells share the same alignment** — text
  columns left, `.col-num` right (header *and* cells, so the label sits above its numbers), `.col-actions`
  right, `.col-toggle` centered. Dense rows, `--border` horizontal separators only, `--bg-hover` hover.
  Cells truncate with ellipsis (add `title=`).
- Column roles: `.col-num` (right-aligned mono header + cells), `.col-mono` (IDs/URLs), `.col-toggle`
  (first-column control), `.col-actions` (trailing), `.col-flex` (the one elastic column). Layout reads
  **static data → state indicator → actions**; state is a `.status-dot` or amber icon toggle, actions are
  always-visible `.icon-btn`s in `.row-actions`.
- **Columns holding a single number use `.col-num` and are narrow by default** — give them tight
  `<col>` widths so numeric data doesn't waste horizontal space; let the `col-flex` text column be wide.

### Pill

**One pill for every rounded chip in the app** — same size, shape, and layout everywhere; variants
recolor the text only. `.pill`: `--font-label`, 999px radius, `0.1rem 0.45rem` padding, **no
border**, a subtle `--bg-raised` fill, dim text by default. Modifiers:

- `.mono` — monospace + tabular numerals, for values (counts, IDs).
- `.amber` — metadata values: token counts, context totals.
- `.red` / `.green` — status semantics (error/aborted; success/complete runs).
- `.on-raised` — bumps the fill to `--bg-hover` when the pill sits on a `--bg-raised` parent
  (user bubble, streaming row); pills inside an open `.disclosure-boxed` summary get this
  automatically via a global rule.
- `.pill-end` — layout companion, pushes the pill to the end of a flex row.

Token counts always render through the **`TokenPill.svelte`** component (`count`, `estimated`,
`end`, `onRaised`, `short` props; formats via `fmtTokens` in `src/lib/format.ts`, hides itself for
null counts; `short` abbreviates to `tk` for dense rows). Don't hand-roll `~N tokens` strings.
**`IdBadge.svelte`** is the interactive pill (`.pill.mono.id-pill`): copy/inspect menu, amber on
hover. `.disclosure-summary`/`.disclosure-boxed`/`.disclosure-arrow` for `<details>` and
button-toggle expand/collapse (`.disclosure-boxed[open]` sits on `--bg-raised`). See the Reference
for the full set.

### Session view — chat first, inspect on demand

There is **one session view** (no Chat/Inspect mode split). At first glance it reads as a chat;
every deeper layer is one gesture away:

1. **Chat layer** (`--font-body`): the user message in a `--bg-raised` bubble; the assistant answer
   as rendered markdown in a global **`.prose`** block (`renderMarkdown` — `html:false`, so model
   HTML renders as text; links open in a new tab). JSON answers keep the syntax-highlighted source
   form. A hover control on the answer toggles the raw markdown source. While a turn is streaming,
   text renders plain (`.session-text`) — markdown parses only once the part commits.
2. **Metadata layer** (`--font-label`): one quiet meta row per turn — disclosure arrow, dim
   `N rounds · M tool calls · <amber>X tokens</amber>` stats (outcome folded in as dim text), a
   `.pill.red` only for error/aborted. Expanding shows per-round headers
   (`Round 2 · stop` + a `tk` pill) and the boxed reasoning/tool rows.
3. **Inspect layer**: every row is `.has-reveal`; its `IdBadge` is a **`.reveal-item`** — visible on
   hover, on focus-within, and while focused (opacity-based, never `display:none`, so keyboard users
   reach it by tabbing). The badge's copy/inspect menu is the entry point to the inspect dialog.

Component grammar and rules:

- **`.session-text`** — the one content-text block for transcript data: pre-wrap, `--font-body`,
  `--text-bright`. Modifiers: `.mono` (tool calls/results, tool/param names), `.italic` (reasoning),
  **`.detail`** (`--font-meta` — tool args/results and reasoning bodies inside expanded rows are one
  step smaller than chat prose). Never re-declare this block in a component.
- **`.session-markdown`** — hljs emphasis styling for raw-source views (`--text-emphasis` + bold).
- **`.meta-label`** — uppercase dim label, reserved for **static** section labels (REASONING, TOOL,
  CALL, RESULT, SESSION SETUP). Dynamic values (tool names, statuses, round labels) render in
  normal case — mono for names (`.summary-value`), dim text for the rest.
- **`.summary-row`** / **`.summary-meta`** — the transcript row grammar: label + preview left,
  right-aligned metadata cluster (reveal IdBadge + pill).
- **`.card`** (+ `.card-meta` header row, `.card-line` label run) — bordered `--bg-surface` container
  for grouped session steps (compaction steps, analysis workflow blocks).
- Session layout metrics are `:root` tokens: `--chat-indent/-pad/-gap/-stack` (transcript rail) and
  the `--compact-*` set (compact row padding/gaps). Use them — no hard-coded copies, and (as with all
  tokens) no `var(--x, fallback)` defaults.

### Icons

- **Material Design Icons** via `@mdi/js` (tree-shakeable path data — no icon font), exposed under
  semantic names in `src/lib/design/icons.ts` (`iconEdit`, `iconTest`, …). To change the set, only that
  file changes.
- Render with the **`<Icon path={iconX} />`** component (`Icon.svelte`) — plain `<svg><path>` markup, never
  `{@html}`. Size via `font-size` (1em), color via `currentColor`.
- **The rule:** every icon in the app is an `<Icon path={iconX} />` fed from the canonical
  `design/icons.ts` set. **Never** hand-inline a raw Unicode glyph (`✕`, `▶`, `↑`, `∑`, `⚠️`, `✓`, …) or a
  hand-written `<svg>` in a component as an icon — add a token to `icons.ts` and render it through `<Icon>`.
- **Disclosure arrows** use `<span class="disclosure-arrow" class:open={…}><Icon path={iconChevronRight} /></span>`.
  The `.disclosure-arrow` span is what rotates (`.open` → `transform: rotate(90deg)`); the chevron itself is a
  normal `<Icon>`. Don't rotate a triangle glyph.
- **The one allowed exception** is a CSS pseudo-element triangle: `::before { content: '▶' }`. A `::before`
  can't hold a Svelte component, so those (and only those) may keep the literal glyph in CSS.

---

## Logo

The master logo SVGs live in [`design-assets/`](design-assets/); the app serves working copies from
`frontend/public/` and references them by path (`/logo.svg`, `/favicon.svg`, …). The live demo is the
**Logo** section of the Design System Reference. Variants:

- **Mark** — `logo-mark.svg` / `favicon.svg`: an amber `>` prompt chevron beside three stacked bars
  (a tool list) on a dark rounded square. Used as the favicon and app icon.
- **Wordmark** — `logo-wordmark.svg`: "mcpscope" in 2-tone amber (`mcp` bright `#E49000`, `scope`
  dim `#A36000`) — the "text icon".
- **Lockup** — `logo.svg` / `logo-lockup.svg`: mark + wordmark, the primary horizontal logo (e.g. the
  Home hero).

Amber only, on the dark square — never a crosshair or weapon/scope imagery. If a logo changes, update
the master in `design-assets/` **and** the served copy in `frontend/public/`.

---

## Implementation principles

- CSS custom properties in `:root` (`app.css`) — no ad-hoc hex for chrome. Keep the token set small
  enough to hold in your head.
- Design tokens + shared primitive classes live globally in `app.css`; component-specific styling is
  co-located in `.svelte` `<style>` blocks.
- Leverage Svelte primitives directly — no CSS-in-JS or external styling libraries.
- `color-scheme: dark` on `:root` forces neutral native controls (scrollbars, form elements).

### Border-radius ladder

- **4px** — controls: buttons, inputs, selects, small chips.
- **6–8px** — containers: dialogs (8px), cards, callouts, banners (6px).
- **999px** — pills: token counts, ID badges, status labels.

### Edges

- **Links:** `--amber-bright`, no underline by default, underline on hover.
- **Text selection:** `--amber-bright` at 30% opacity.
