# Session tree navigation

This increment adds the UI/navigation layer on top of the typed session foundation.

The session-analysis MVP now absorbs the minimum tree behavior needed to create and navigate analysis child sessions beneath their parent. This task therefore remains the broader tree-navigation spec and the place for any remaining polish or generalization beyond that MVP slice.

## Dependency

- `backlog/done/session-metadata-foundation.md`

## Goal

Replace the flat left-pane session list with a tree-oriented navigation model that can reveal child sessions under their parent without making the default view noisy.

## Scope

- keep **primary sessions only** enabled by default
- add a toggle to reveal non-primary sessions
- when non-primary sessions are shown, place child sessions under their parent session
- sort siblings by creation time, newest first
- show compact date/time as `DD/MM HH:MM`
- begin labels with the 4-letter session ID
- use distinct visual treatment for primary vs non-primary sessions

## Non-goals

- no benchmark top-level tree design beyond leaving room for it later
- no analysis-session execution logic
- no new session-type semantics beyond what the foundation already provides

## Testability

This increment should be verifiable through:

1. deterministic frontend tests for tree shaping / sorting logic
2. component-level checks for primary-only vs expanded tree rendering
3. a short manual check of navigation behavior and delete visibility

## Expected result

After this increment:

- the default sidebar remains clean and primary-focused
- non-primary sessions become visible where they belong
- the UI is ready for analysis sessions without pretending they are ordinary top-level sessions
