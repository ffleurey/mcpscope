This folder is the lightweight product and implementation board for mcpscope.

Use this file for backlog process only.

Use [ROADMAP.md](ROADMAP.md) for the current product direction and whether any near-term queue is active.

When roadmap direction is still uncertain, or when planning is intentionally paused, keep work in `candidates/` until it is deliberately selected for active specification.

## States

- `candidates/` — ideas, future work, and deferred concepts that are worth keeping but are not yet selected for active specification.
- `specification/` — work selected for development and currently being refined into a coding-agent-ready task.
- `implementation/` — coding-agent-ready tasks or active branches for non-trivial feature work.
- `fixme/` — small, mostly ready bug fixes and hardening tasks that should not require the full heavier specification loop.
- `completed/` — merged historical task records kept for traceability and future reference.

One file per task or increment remains the rule.

## Task Shape

- One file should describe one task, increment, or coherent background spec.
- A task should live in exactly one state folder at a time.
- Non-trivial coding handoffs should come from `implementation/` or `fixme/`, not directly from `candidates/` or `specification/`.
- Large epics and background specs may stay in `specification/` or `candidates/` while their smaller implementation increments move forward independently.

## Folder Rules

### `candidates/`

Use `candidates/` for:

- ideas worth keeping on the radar
- deferred features
- background concepts that are not yet selected for active specification
- parked backlog during roadmap reset or planning pauses

Candidate files should focus on product value, major dependencies, and open questions rather than detailed implementation instructions.

### `specification/`

Use `specification/` for work that has been picked for development and is being clarified.

Specification files should make these items explicit before promotion:

- problem statement and goal
- scope and non-goals
- important constraints and dependencies
- concrete validation approach
- whether the task should be split further

### `implementation/`

Use `implementation/` for non-trivial tasks that are ready to hand to a coding agent.

Implementation tasks should already have:

- one scoped outcome suitable for one branch and one PR
- clear dependencies and linked canonical docs
- explicit acceptance criteria or expected result
- a named validation path

### `fixme/`

Use `fixme/` for small, already-understood fixes and hardening work.

This is the fast lane for items such as:

- localized bug fixes
- error-handling cleanup
- compact UX or CLI corrections
- small alignment tasks where the right behavior is already mostly known

If a fix grows broad, cross-cutting, or ambiguous, move it back to `specification/`.

### `completed/`

Use `completed/` for merged task records only.

Keep completed files as historical references for:

- why a change was made
- what validation landed with it
- how later related work should anchor itself

## Promotion Gates

### `candidates/` -> `specification/`

Move a task forward when:

- it has clear enough product value to spend planning time on it
- it fits the current product direction once one is explicitly chosen
- the major dependencies are understood well enough to specify it

### `specification/` -> `implementation/`

Move a task forward when:

- the scope is small enough for one coding handoff
- dependencies, constraints, and non-goals are explicit
- the expected result is concrete enough to validate
- the task does not still need major product decisions

### `specification/` -> `fixme/`

Move a task into `fixme/` instead of `implementation/` when:

- it is small and localized
- the behavior change is already well understood
- it does not need a large branch or heavy design pass

### `implementation/` or `fixme/` -> `completed/`

Move a task to `completed/` when:

- the work is merged to `main`
- the relevant roadmap and reference docs are updated
- any follow-up work is split into separate backlog items rather than hidden in the completed file

## Reverse Moves

Tasks can move backward when needed.

- Move from `implementation/` back to `specification/` if scope turns out to be unclear, too large, or blocked on unresolved decisions.
- Move from `fixme/` back to `specification/` if the fix is broader than expected.
- Move from `specification/` back to `candidates/` if the work is no longer near-term.
