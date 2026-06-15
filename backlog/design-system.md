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
| `--text-dim` | `#888888` | Labels, metadata, muted/secondary text |
| `--text-bright` | `#e8e8e8` | Primary body text — near-white |

**Rules:**
- `--bg-base` is the outermost background; everything sits on it
- `--bg-surface` is one step lighter — used for any container that needs distinction from the base
- `--text-bright` is the default UI text color; `--text-dim` for supporting information
- No color-on-color: accent colors are placed on `--bg-base` or `--bg-surface` backgrounds only (never on another color)
- **Green is for data, grey is for chrome** — see the green section below

### Amber — Primary accent (minimal use)

Reserved for the logo and the single primary action in any view/dialog. Most of the time the UI has no amber at all.

| Token | Value | Usage |
|---|---|---|
| `--amber-dim` | `oklch(55% 0.15 75)` | Logo, secondary amber text |
| `--amber-bright` | `oklch(72% 0.18 75)` | Primary action buttons, active tab underline, key highlights |
| `--amber-glow` | `oklch(78% 0.20 75)` | Hover/enhanced state for primary elements |

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
| `--sans` | `system-ui, 'Segoe UI', Roboto, sans-serif` | UI text: labels, buttons, dialogs, prose |
| `--mono` | `ui-monospace, 'Cascadia Code', Consolas, monospace` | Data: token counts, IDs, code blocks, table cells |

- Base size: **14px**
- Compact line-height: **1.4** for UI elements, **1.5** for body text
- Small UI text (labels, badges, metadata): **12px** (0.75rem)
- Monospace data text: **13px** (0.8125rem) for readability at small sizes

---

## Spacing & density

No spacing scale. The only rule is: **use the minimum spacing that makes the information legible.**

- Default padding for containers, dialogs, buttons: **0.75rem** — one consistent value
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
| Default `.btn` | Grey on `--bg-surface`, `--border`, hover lifts to `--bg-hover` |
| Primary `.btn-primary` | `--amber-bright` background, near-black text (`#0a0a0a`). Use **only one** per view/dialog. |
| Danger `.btn-danger` | No background; `--red-bright` border and text, subtle red tint on hover |
| Icon `.icon-btn` | No border, `--text-dim`, hover becomes `--text-bright` with `--bg-hover` background |

- Border-radius: **4px** consistently
- Focus-visible outline: 2px solid `--amber-bright`, 2px offset
- Button padding: `--space-md` horizontal, `--space-sm` vertical (tight)

### Form elements (inputs, selects, textareas)

- Background: `--bg-surface`
- Border: `--border`
- Text: `--text-bright`
- Focus: `--amber-bright` outline (not border) — optional, can stay grey for fully monochrome forms
- Padding: `--space-md` horizontal, `--space-sm` vertical
- Labels: `--text-dim`, 12px, above the input

### Dialogs

- Backdrop: `rgba(0, 0, 0, 0.55)`
- Surface: `--bg-surface` with `--border` outline
- Header: 0.75rem padding, bottom border, title in 0.9rem bold
- Body: `--space-lg` padding, compact form layout
- Max width: 720px or 95vw, max height: 85vh

### Tabs / Navigation

- Active tab: `--amber-bright` underline (2px), `--text-bright` label
- Inactive tab: `--text-dim`, no underline
- Hover tab: `--text-bright`

### Status indicators

- **Running / active:** `--green-bright` filled dot
- **Idle / ready:** `--green-dim` dot
- **Warning / attention:** `--amber-bright` dot
- **Error / failed:** `--red-bright` dot
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

### Tables

- Dense rows with minimal padding (`--space-xs` vertical, `--space-sm` horizontal)
- Monospace for numeric columns, right-aligned
- `--border` row separators (horizontal only, no vertical lines)
- Header row: `--text-dim` 11px uppercase labels

---

## Logo

- Wordmark "mcpscope" in `--amber-bright` and `--amber-dim` (2-tone)
- Optional small icon: a simple oscilloscope waveform trace (sine/square wave line), not a crosshair
- No weapon/scope imagery

---

## Implementation principles

- Use CSS custom properties defined in `:root` (`app.css`) — no ad-hoc hex values for UI chrome
- Component styles stay co-located in `.svelte` `<style>` blocks
- Leverage Svelte primitives directly — no CSS-in-JS or external styling libraries
- Keep the number of CSS variables small enough to hold in your head
- `color-scheme: dark` on `:root` to force neutral system colors on native controls (scrollbars, form elements)

### Edges

- **Links:** `--amber-bright`, no underline by default, underline on hover
- **Text selection:** `--amber-bright` at 30% opacity — `oklch(72% 0.18 75 / 0.3)`
