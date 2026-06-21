# Design System — mcpscope

The rules, rationale, and tokens for the mcpscope frontend. Read this before changing
anything visual, and keep it in sync (see **Working in this design system** below).

## Three sources of truth

1. **This document** — the *why* and the *rules* (brand, palette, principles, patterns).
2. **`frontend/src/app.css`** — the *implementation*: design tokens in `:root` and the shared
   primitive classes (`.btn`, `.field-*`, `.data-table`, `.status-dot`, `.token-pill`, …).
3. **The Design System Reference** — the *living visual guide*: the in-app **Design** page,
   rendered by `frontend/src/lib/components/DesignReference.svelte`. It renders **live tokens and
   the real components/classes** (not copies), so it cannot silently drift from `app.css`.

Master brand assets (logo, mark, wordmark, favicon) live in [`design-assets/`](design-assets/) —
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

## Brand identity

- **Product:** mcpscope — a test/evaluation tool for MCP servers (chat inspection, trace analysis, benchmarking).
- **Metaphor:** "scope" = **oscilloscope** (signal inspection, debugging), not weapon scope.
- **Audience:** developers and engineers.
- **Aesthetic:** dark background, phosphor-inspired accents (amber, green), restrained color — most UI
  is monochrome grey; color is added only where it carries signal. Inspiration is CRT test equipment,
  not retro computing. The core metaphor: **UI chrome is neutral grey; the session data is a green
  phosphor trace; amber is the single controlled accent.**

---

## Color palette

### Neutral greys — UI chrome (~90% of the surface)

The workhorse colors. Forms, dialogs, navigation, sidebar, labels — almost everything is grey by default.

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#141414` | Main application background; form inputs |
| `--bg-surface` | `#1e1e1e` | Elevated surfaces: panels, dialogs, sidebar, cards |
| `--bg-hover` | `#282828` | Hover state for interactive elements |
| `--border` | `#333333` | Borders, dividers, separators |
| `--text-dim` | `#a8a8a8` | Labels, metadata, muted/secondary text |
| `--text-bright` | `#e8e8e8` | Primary body text — near-white |

- `--bg-base` is the outermost background; `--bg-surface` is one step lighter for any container that
  needs distinction. Inputs sit on `--bg-base` (one step *darker* than the panel they live in).
- `--text-bright` is the default UI text; `--text-dim` for supporting information.
- No color-on-color: accents sit on `--bg-base`/`--bg-surface` only, never on another color.
- **Green is for data, grey is for chrome.**

### Amber — primary accent (minimal use)

Reserved for the logo, the **single primary action** per view/dialog, and **selection/activity state
markers**. Most of the UI has no amber at all.

| Token | Value | Usage |
|---|---|---|
| `--amber-dim` | `oklch(55% 0.15 75)` | Logo, secondary amber text |
| `--amber-bright` | `oklch(72% 0.18 75)` | Primary action buttons, active-tab underline, links, input focus |
| `--amber-glow` | `oklch(78% 0.20 75)` | Hover/enhanced state; selection/loaded glow on icon toggles |

**Amber state markers — the one sanctioned glow/animation exception.** Icon toggles use amber to signal
state: `.icon-glow` = selected/loaded (steady amber glow via `drop-shadow`), `.icon-blink` = in-progress
(pulsing amber). Used for the default-config **radio** (single-select), default-MCP **checkbox**
(multi-select), and model load/eject. Everywhere else stays flat — status *dots* never glow.

### Green — session content (the data color)

All text that is part of a session — user prompts, assistant answers, reasoning, tool calls, tool
results — uses green. This draws an immediate boundary between the tool (grey chrome, amber accents) and
the session data being inspected, like a green trace on an oscilloscope.

| Token | Value | Usage |
|---|---|---|
| `--green-dim` | `oklch(50% 0.14 145)` | Dim/offline status |
| `--green-bright` | `oklch(65% 0.18 145)` | Session content text (prompts, answers, reasoning, tool calls/results) |
| `--green-glow` | `oklch(72% 0.22 145)` | Bright/pulsed status |

**Green:** transcript prompts & answers, reasoning, tool call names/params/results, round & turn labels.
**Stays grey (it's chrome, not data):** sidebar, nav, buttons, dialogs, form labels, config views, the
session list, dialog titles, and **token counts / ID badges / timestamps** (tool metadata).

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
does not follow the main palette.

---

## Typography

The CRT feel comes from color, not fonts — use compact, highly readable system faces.

| Token | Value | Usage |
|---|---|---|
| `--sans` | `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif` | UI text |
| `--mono` | `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace` | Data: token counts, IDs, code, table cells |

Standard GitHub system-font stacks — no web-font download. Base **14px**; line-height **1.4** UI / **1.5**
body; small UI text **12px**; monospace data **13px**.

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

### Dialogs

Use the shared **`DialogShell.svelte`** — never hand-roll `<dialog>`. Backdrop `rgba(0,0,0,0.62)`,
`--bg-surface` surface, 8px radius, header & body `0.75rem 1rem`, `min(720px,95vw)` / 85vh,
draggable header. **Separation from the dark background:** a `--amber-dim` border (marks the active/
focused surface — a sanctioned use of the amber accent) plus an elevation shadow
(`0 10px 40px rgba(0,0,0,0.55)`); dark-on-dark needs both color and depth. Error content: the
**`InlineAppError.svelte`** component.

### Tabs / navigation

Active tab: 2px `--amber-bright` underline + `--text-bright`. Inactive: `--text-dim`. Hover: `--text-bright`.

### Status indicators

`.status-dot` (8px flat circle) + modifier: `.running` (green-bright), `.idle` (green-dim),
`.warn` (amber), `.error` (red). Flat — no glow. `.status-pill` (+ `.dim/.soft/.error/.success`) for a
rounded status label.

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

### Token pill, disclosure, other primitives

`.token-pill` (grey metadata count, 999px). `.disclosure-summary`/`.disclosure-boxed`/`.disclosure-arrow`
for `<details>` and button-toggle expand/collapse. See the Reference for the full set.

### Icons

- **Material Design Icons** via `@mdi/js` (tree-shakeable path data — no icon font), exposed under
  semantic names in `src/lib/design/icons.ts` (`iconEdit`, `iconTest`, …). To change the set, only that
  file changes.
- Render with the **`<Icon path={iconX} />`** component (`Icon.svelte`) — plain `<svg><path>` markup, never
  `{@html}`. Size via `font-size` (1em), color via `currentColor`.

---

## Logo

Master brand SVGs live in [`design-assets/`](design-assets/); the app serves working copies from
`frontend/public/` and references them by path (`/logo.svg`, `/favicon.svg`, …). The live demo is the
**Brand & logo** section of the Design System Reference. Variants:

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
