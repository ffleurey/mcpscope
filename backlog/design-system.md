# Design System — mcpscope

## Brand identity

- **Product:** mcpscope — a test/evaluation tool for MCP servers (chat inspection, trace analysis, benchmarking)
- **Metaphor:** "scope" refers to **oscilloscope** (signal inspection, debugging), not weapon scope
- **Audience:** Developers and engineers
- **Aesthetic:** Dark background, phosphor-inspired accent colors (amber, green), restrained use of color — most UI is monochrome grey. Inspiration comes from CRT test equipment, not retro computing.

---

## Color palette

### Neutral greys — UI chrome (~90% of the surface)

These are the workhorse colors. Forms, dialogs, navigation, sidebar, labels — almost everything
uses greys by default. Color is added only where it provides signal.

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#141414` | Main application background |
| `--bg-surface` | `#1e1e1e` | Elevated surfaces: panels, dialogs, sidebar, inputs, cards |
| `--bg-hover` | `#282828` | Hover state for interactive elements |
| `--border` | `#333333` | Borders, dividers, separators |
| `--text-dim` | `#a8a8a8` | Labels, metadata, muted/secondary text |
| `--text-bright` | `#e8e8e8` | Primary body text — near-white |

**Rules:**
- `--bg-base` is the outermost background; everything sits on it
- `--bg-surface` is one step lighter — used for any container that needs distinction from the base
- `--text-bright` is the default UI text color; `--text-dim` for supporting information
- No color-on-color: accent colors are placed on `--bg-base` or `--bg-surface` backgrounds only (never on another color)
- **Green is for data, grey is for chrome** — see the green section below

### Amber — Primary accent (minimal use)

Reserved for the logo, the single primary action in any view/dialog, and **selection/activity state markers** (below). Most of the time the UI has no amber at all.

| Token | Value | Usage |
|---|---|---|
| `--amber-dim` | `oklch(55% 0.15 75)` | Logo, secondary amber text |
| `--amber-bright` | `oklch(72% 0.18 75)` | Primary action buttons, active tab underline, key highlights |
| `--amber-glow` | `oklch(78% 0.20 75)` | Hover/enhanced state; selection/loaded glow on icon toggles |

**Amber state markers (sanctioned exception to "flat, no-glow").** Icon toggles use amber to signal state:
`.icon-glow` = selected / loaded (steady amber glow via `drop-shadow`), `.icon-blink` = in-progress (pulsing amber).
Used for the default-config **radio** (single-select) and default-MCP **checkbox** (multi-select) in column 1 of the tables,
and the model load/eject state. This is the one place glow/animation is allowed — status *dots* stay flat.

### Green — Session content

Green is the **data color**. All text that is part of a session — user prompts, assistant answers,
reasoning blocks, tool calls, tool results — uses green text. This creates an immediate visual
boundary between the tool UI (monochrome grey, amber accents) and the session data being inspected.

Think of it like an oscilloscope: the UI chrome and controls are neutral, the signal trace is green.

| Token | Value | Usage |
|---|---|---|
| `--green-dim` | `oklch(50% 0.14 145)` | Dim status indicators, offline/dormant states |
| `--green-bright` | `oklch(65% 0.18 145)` | Session content text: prompts, answers, reasoning, tool calls, results |
| `--green-glow` | `oklch(72% 0.22 145)` | Bright status, pulsed indicators |

### Red — Destructive actions, errors

| Token | Value | Usage |
|---|---|---|
| `--red-dim` | `oklch(45% 0.12 25)` | Error text, danger button borders |
| `--red-bright` | `oklch(60% 0.16 25)` | Error states, deletion buttons, failure indicators |

Red has only 2 shades — error states don't need a glow variant.

### Context bar colors (unchanged, kept separate)

The context-window visualization bar in the session view uses a broader palette for part-type distinction (red, pink, purple, slate, orange, blue). These are defined in `frontend/src/lib/design/partColors.ts` and `frontend/src/app.css` CSS variables. They are specific to the context visualization and do not follow the main UI palette.

---

## Typography

The CRT feel comes from the colors, not the fonts. Choose compact, highly readable faces.

| Token | Value | Usage |
|---|---|---|
| `--sans` | `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif` | UI text: labels, buttons, dialogs, prose |
| `--mono` | `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace` | Data: token counts, IDs, code blocks, table cells |

These are the standard GitHub system-font stacks — no web-font download, native on every platform.

- Base size: **14px**
- Compact line-height: **1.4** for UI elements, **1.5** for body text
- Small UI text (labels, badges, metadata): **12px** (0.75rem)
- Monospace data text: **13px** (0.8125rem) for readability at small sizes

---

## Spacing & density

No spacing scale. The only rule is: **use the minimum spacing that makes the information legible.**

- Default padding for containers and dialogs: **0.75rem** (buttons and inputs are tighter — see their sections)
- Default gap between related elements: **0.35rem** — tight but readable
- Use Svelte's `style` directives and native HTML element spacing (`gap`, `padding`) directly — no CSS utility classes or abstraction layers
- No unnecessary wrapper divs: prefer flat DOM with direct spacing over nested containers
- Dialogs and forms should fit without scrolling — compact layout is the goal, not a token system

See `SessionTurnBlock.svelte` and `SessionPreludeBlock.svelte` for the existing density reference.

---

## Component patterns

### Buttons

| Variant | Style |
|---|---|
| Default `.btn` | Transparent background, dim border + text. Hover lifts to `--bg-hover`, brighter text. |
| Primary `.btn-primary` | Transparent background, `--amber-bright` border and text. Hover adds subtle amber-tinted background. Use **only one** per view/dialog. |
| Danger `.btn-danger` | No background; `--red-bright` border and text, subtle red tint on hover |
| Icon `.icon-btn` | No border, `--text-bright`, hover adds `--bg-hover` background |

- Border-radius: **4px** (see the radius ladder under Implementation principles)
- Focus-visible outline: 2px solid `--amber-bright`, 2px offset
- Button padding: **0.4rem** vertical, **0.85rem** horizontal (`.btn-sm`: `0.28rem 0.65rem`)

### Form elements (inputs, selects, textareas)

- Background: `--bg-base` (inputs sit one step *darker* than the `--bg-surface` dialog/panel they live in)
- Border: `--border`
- Text: `--text-bright`
- Focus: `--amber-bright` **border** on `:focus-visible` — always shown, never suppressed (keyboard accessibility, WCAG 2.4.7)
- Padding: **0.4rem** vertical, **0.6rem** horizontal
- Labels: `.field-label` — `--text-dim`, 0.78rem, uppercase, above the input
- Checkboxes/radios: the `Checkbox.svelte` / `Radio.svelte` components — a visually-hidden native input (keeps accessibility + form semantics) with an MDI glyph visual that glows amber when checked, the **same toggle look as the data tables** (`.opt-check` / `.opt-radio`)
- Selects: native, tinted with `accent-color: var(--amber-bright)`; dark rendering from `color-scheme: dark`

### Dialogs

- Backdrop: `rgba(0, 0, 0, 0.55)`
- Surface: `--bg-surface` with `--border` outline, 8px radius
- Header: `0.75rem 1rem` padding, bottom border, title in 0.9rem 600, draggable
- Body: `0.75rem 1rem` padding, compact form layout
- Max width: `min(720px, 95vw)`, max height: 85vh
- Use the shared `DialogShell.svelte` — don't hand-roll `<dialog>` markup

### Tabs / Navigation

- Active tab: `--amber-bright` underline (2px), `--text-bright` label
- Inactive tab: `--text-dim`, no underline
- Hover tab: `--text-bright`

### Status indicators

Shared primitive `.status-dot` (8px flat circle) with a state modifier:

- **Running / active:** `.status-dot.running` — `--green-bright`
- **Idle / ready:** `.status-dot.idle` — `--green-dim`
- **Warning / attention:** `.status-dot.warn` — `--amber-bright`
- **Error / failed:** `.status-dot.error` — `--red-bright`
- No glow effects — flat dots keep it clean

### Session content (green phosphor)

All text that is part of a session trace — user prompts, assistant answers, reasoning blocks,
tool calls, tool results, and their metadata — uses `--green-bright` as the text color.

This is the core visual metaphor: the UI chrome is neutral grey with amber accents, while the
session data reads like a green phosphor trace on an oscilloscope. The boundary between
the tool and the data is immediately visible.

**What gets green:**
- User prompts and assistant answers in the transcript
- Reasoning blocks and chain-of-thought
- Tool call names, parameters, and results
- Round headers and turn labels within the session view

**What stays grey:**
- All UI chrome: sidebar, navigation, buttons, dialogs, form labels
- Configuration views and settings
- Session list in the sidebar
- Dialog titles and action labels
- **Token counts, ID badges, timestamps** — these are tool metadata, not session content

### Context bar colors (unchanged, kept separate)

The context-window visualization bar uses its own palette for part-type distinction.
See `partColors.ts`. It is unrelated to the grey-chrome / green-data split.

### Icons

- **Material Design Icons** via `@mdi/js` (tree-shakeable path data — no icon font).
- Exposed under **semantic names** in `src/lib/design/icons.ts` (`iconEdit`, `iconTest`, `iconRadioMarked`, …) as ready-to-render SVG strings. To change the icon set, only that file changes.
- Render with `{@html iconX}` inside `.icon-btn` (standalone) or `.btn-icon` (icon + text); size via `font-size`, color via `currentColor`. `.icon-btn-danger` tints destructive actions red.

### Token pill (metadata)

Small monochrome count/label — `.token-pill`: `--text-dim` text, `--border` outline, fully rounded (999px), 0.68rem. Used for token counts and similar tool metadata; **stays grey** (it is chrome, not session data).

### Tables

The shared `.data-table` primitive (used by the config admin pages). Live demo in the Design System Reference.

- Wrap in `.table-scroll` (`overflow-x: auto`) so a narrow window scrolls instead of crushing columns
- `table-layout: fixed` with a `<colgroup>` of explicit widths; `width: max-content; min-width: 100%` (never collapse, fill when there's room)
- Header row: `--text-dim` 0.68rem uppercase labels, `--border` bottom rule
- Dense rows (`0.4rem 0.6rem`), `--border` horizontal separators only, `--bg-hover` row hover
- Cells truncate with ellipsis (add `title=` for the full value)
- Column modifiers: `.col-num` (right-aligned mono numerics), `.col-mono` (IDs/URLs), `.col-actions` (trailing right-aligned), `.col-toggle` (first-column single control)
- **Static data → state indicator → actions**, left to right. Dynamic state uses a `.status-dot` or amber icon toggle; actions are always-visible `.icon-btn`s in `.row-actions` (`.icon-btn-danger` for delete)
- Resizable columns via `use:columnResize` (drag a header's right border; session-only)

---

## Logo

- Wordmark "mcpscope" in `--amber-bright` and `--amber-dim` (2-tone)
- Optional small icon: a simple oscilloscope waveform trace (sine/square wave line), not a crosshair
- No weapon/scope imagery

---

## Implementation principles

- Use CSS custom properties defined in `:root` (`app.css`) — no ad-hoc hex values for UI chrome
- **Design tokens and shared primitive classes live globally in `app.css`** — `.btn`, `.field-*`, `.status-dot`, `.token-pill`. Component-*specific* styling stays co-located in `.svelte` `<style>` blocks
- Leverage Svelte primitives directly — no CSS-in-JS or external styling libraries
- Keep the number of CSS variables small enough to hold in your head
- `color-scheme: dark` on `:root` to force neutral system colors on native controls (scrollbars, form elements)

### Border-radius ladder

One small ladder, applied by element role:

- **4px** — controls: buttons, inputs, selects, small chips
- **6–8px** — containers: dialogs (8px), cards, callouts, banners (6px)
- **999px** — pills: token counts, ID badges, status labels

### Migration debt

`app.css` keeps a block of **legacy alias variables** (`--bg`, `--bg-sidebar`, `--bg-panel`, `--text-muted`, `--color-accent`, …) that point at the canonical tokens. They exist only so not-yet-migrated components keep working. Don't reach for them in new code — use the canonical tokens. Remove an alias once `grep` shows no remaining uses.

### Edges

- **Links:** `--amber-bright`, no underline by default, underline on hover
- **Text selection:** `--amber-bright` at 30% opacity — `oklch(72% 0.18 75 / 0.3)`
