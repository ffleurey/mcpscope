# Design System Alignment — mcpscope

Gap analysis comparing `backlog/design-system.md` against the current Svelte frontend implementation. Generated 2026-06-15, last updated 2026-06-15.

## Legend

- ✅ Aligned — matches the spec
- ⚠️ Minor gap — small deviation, low risk
- ❌ Gap — meaningful divergence, needs attention
- 🟦 Done — resolved in this pass

---

## Completed Work

### Phase 1: Low-hanging fixes

| # | Item | Files | What changed |
|---|---|---|---|
| 1 | `color-scheme: dark` | `app.css` | Added to `:root` for native dark form controls |
| 2 | Status dots use tokens | `ExecutionBar.svelte` | Hardcoded hex → `var(--green-bright)` etc., removed pulse animation |
| 3 | Amber nav underline | `Sidebar.svelte` | `.nav-item.active` now uses 2px `--amber-bright` bottom border |
| 4 | Amber view-mode toggle | `ChatView.svelte` | `.view-mode-btn.active` uses `--amber-bright` border + `--text-bright` |
| 5 | NewSessionPanel button | `NewSessionPanel.svelte` | Custom `.start-btn` → `.btn.btn-primary` |

### Phase 2: Forms & Dialogs canonicalization

| # | Item | Files | What changed |
|---|---|---|---|
| 6 | Form styles canonical | `LmConnectionForm.svelte` | Uppercase labels, `--bg-base` inputs, monochrome focus, gap-based layout |
| 7 | Form styles canonical | `McpProfileForm.svelte` | Same as above |
| 8 | Form styles canonical | `ModelConfigForm.svelte` | Same + `#4ade80` → `var(--green-bright)` |
| 9 | Fix button classes | `PrimarySessionLaunchModal.svelte` | `class="btn-primary"` → `class="btn btn-primary"` |
| 10 | Replace custom buttons | `AnalysisLaunchModal.svelte` | Removed custom `.btn-primary/.btn-secondary`, use global classes |
| 11 | Fix hardcoded colors | `ModelConfigs.svelte` | `#4ade80` → `var(--green-bright)` in card badges |
| 12 | Inline forms → dialogs | `LmConnections.svelte` | Forms render inside `DialogShell` |
| 13 | Inline forms → dialogs | `McpProfiles.svelte` | Forms render inside `DialogShell` |
| 14 | Inline forms → dialogs | `ModelConfigs.svelte` | Forms render inside `DialogShell` |

### Phase 3: Global CSS extraction & deduplication

| # | Item | Files | What changed |
|---|---|---|---|
| 15 | Global form classes | `app.css` | Added `.field`, `.field-label`, `.field-input`, `.field-errortext`, `.field-hinttext`, `.check-option`, `.radio-opt`, `.check-label`, `.radio-opt-label`, `.radio-opt-hint`, `select { accent-color }` — canonical patterns live in one place |
| 16 | DesignReference cleanup | `DesignReference.svelte` | Removed ~70 lines of scoped form duplicates; now uses global classes |
| 17 | Dialog body padding | `DialogShell.svelte` | Added `padding: 0.75rem 1rem` to `.dialog-body` — consistent margins from dialog borders |
| 18 | Draggable dialogs | `DialogShell.svelte` | Header bar is drag handle; `transform: translate()` offsets from center; `grab`/`grabbing` cursor |
| 19 | Double-title removal | Three form components | Removed `<h3>` titles; dialog header provides the only title |
| 20 | Test form dialog | `DesignReference.svelte` | Added second dialog with complete form (inputs, select, textarea, checkboxes) |

### Phase 4: Monochrome alignment sweep

| # | Item | Files | What changed |
|---|---|---|---|
| 21 | Composer focus border | `ChatView.svelte` | Amber `color-mix` → `var(--border)` |
| 22 | Title edit focus border | `ChatView.svelte` | `var(--color-accent)` → `var(--border)` |
| 23 | Field-select background | `PrimarySessionLaunchModal.svelte` | `var(--bg-input)` → `var(--bg-base)` |
| 24 | Checked checkbox/radio wraps | `PrimarySessionLaunchModal.svelte` | Amber border + tint → `var(--border)` monochrome |
| 25 | accent-color tokens | `PrimarySessionLaunchModal.svelte` | `var(--color-accent)` → `var(--amber-bright)` |
| 26 | Field/hint spacing & tokens | `PrimarySessionLaunchModal.svelte` | `gap:0.45rem`→`0.3rem`, `--text-muted`→`--text-dim` |
| 27 | Custom `.btn-accent` | `ModelConfigs.svelte` | Removed custom CSS, replaced with `.btn.btn-primary.btn-sm` |
| 28 | `--text-muted` sweep | `PrimarySessionLaunchModal.svelte` | Hint/error text → `var(--text-dim)` |

---

## Remaining Gaps

### 1. Green Phosphor Session Content — ❌ Major gap

**Spec**: All session content text (user prompts, assistant answers, reasoning blocks, tool calls, tool results) must use `--green-bright`. This is the core oscilloscope metaphor: grey UI chrome with green signal trace.

**Current**: `--green-bright` is only used in `DesignReference.svelte` (demo) and `ExecutionBar.svelte` (status dot). Zero session content components apply it. All session text uses `var(--text)` / `var(--text-muted)`.

Affected files:
- `TracePartBlock.svelte` — part titles, preview text, part body content
- `CompactRoundContent.svelte` — assistant answers, reasoning blocks, tool call results
- `SessionTurnBlock.svelte` — `.chat-answer-text`, round labels
- `SessionPreludeBlock.svelte` — setup part display

**What should be green** (per spec):
- User prompts and assistant answers in the transcript
- Reasoning blocks and chain-of-thought
- Tool call names, parameters, and results
- Round headers and turn labels within the session view

**What must stay grey**:
- Token counts, ID badges, timestamps (tool metadata)
- Round status labels, finish reasons
- All UI chrome elements

**Approach**: Change the text `color` on session content blocks from `var(--text)` to `var(--green-bright)`. Token pills, ID badges, and meta labels stay `var(--text-dim)`. Test on one component first (`TracePartBlock` is the leaf component — changes there cascade up).

### 2. Button Primary — ✅ Resolved

**Spec originally said**: filled amber background with near-black text.

**Resolved**: Outlined pattern confirmed as canonical. `backlog/design-system.md` updated to match the living DesignReference. No code changes needed — all buttons already follow the outlined pattern consistently.

### 3. Logo / Wordmark — ❌ Not implemented

**Spec**: Wordmark "mcpscope" in 2-tone amber, optional oscilloscope waveform icon.

**Current**: No branding. Sidebar header just shows "Sessions".

**Approach**: Add a wordmark to the sidebar header area. Simple text-based approach using `--amber-bright` and `--amber-dim`. Optional waveform SVG icon can be added later.

### 4. Tables — ⚠️ Pattern defined, unused

Pattern exists in DesignReference but no production component uses it yet. Deferred until first table component is needed.

### 5. Spacing Tokens — ⚠️ Contradiction in spec

Spec references `--space-md`, `--space-sm`, `--space-xs`, `--space-lg` but also says "No spacing scale." These tokens are not defined. Components use ad-hoc values. Need to either define the tokens or remove the references from the spec.

---

## Next Steps (proposed order)

| Priority | Item | Effort | Dependencies |
|---|---|---|---|
| **Next** | Logo / wordmark | Small — sidebar header change | None |
| **After** | Green phosphor session content | Medium — 4 components, needs visual validation | Good to prototype on one component first |
| **Deferred** | Tables | Implement with first table component | None |
| **Deferred** | Spacing tokens | Clarify then act | Spec discussion |
