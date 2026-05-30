# Analysis follow-up and viewing

This increment adds the interactive user workflow around analysis sessions.

## Dependencies

- `backlog/completed/session-analysis-launch-and-report.md`
- `backlog/candidates/session-analysis-evidence-protocol.md`

## Goal

Make analysis sessions feel like real, inspectable conversations rather than one-shot hidden jobs.

This task assumes the project has already clarified experimentally what trustworthy analysis looks like. It should build UI on top of that clarified workflow rather than treating the current MVP prompt behavior as final.

The launch-and-report increment already covers the MVP path of creating the child analysis session, showing it in the tree beneath its parent, navigating into it, live streaming its first turn, and allowing follow-up through the standard chat view.

## Scope

- support a separate viewing surface so the base session can remain visible
- allow deleting selected analysis sessions without deleting the base session
- use a default analysis-session title pattern based on the selected analysis profile name
- allow richer launch entry points from the base session and/or tree selection

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

- the base session can remain visible while analysis is inspected
- analysis sessions are easier to inspect alongside their base session
- users can manage individual analysis sessions without deleting the base session
