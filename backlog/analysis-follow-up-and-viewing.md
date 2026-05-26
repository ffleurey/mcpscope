# Analysis follow-up and viewing

This increment adds the interactive user workflow around analysis sessions.

## Dependencies

- `backlog/session-tree-navigation.md`
- `backlog/session-analysis-launch-and-report.md`

## Goal

Make analysis sessions feel like real, inspectable conversations rather than one-shot hidden jobs.

## Scope

- allow analysis launch from the base session and/or tree selection
- show analysis sessions live while they run
- allow follow-up questions in the same analysis session
- keep the first turn as the initial analysis and later turns as normal follow-up turns
- support a separate viewing surface so the base session can remain visible
- allow deleting selected analysis sessions without deleting the base session
- show analysis sessions under their parent when non-primary sessions are revealed
- use a default analysis-session title pattern based on the selected analysis profile name

## Non-goals

- no benchmark synthesis workflow yet
- no cross-session batch automation yet

## Testability

This increment should be verified through:

1. targeted frontend tests for launch/view state
2. component checks for child-session rendering and delete actions
3. a short manual workflow covering launch, live inspection, follow-up, and selective delete

## Expected result

After this increment:

- the analysis workflow is usable from the product UI
- the base session can remain visible while analysis is inspected
- follow-up questions become part of the same reusable analysis conversation
