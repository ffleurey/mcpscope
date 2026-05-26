# Session types and parent links

This is the **epic/background spec** for adding typed sessions plus parent links.

The implementation should be delivered in smaller increments rather than as one broad cross-cutting change.

## Goal

Add a general session metadata model with:

1. a persisted **session type**
2. a persisted **parent reference**
3. type-specific rules for what parent kinds are allowed or required

The important design rule is:

> A session keeps the normal mcpscope runtime/session machinery, but its `session_type` and `parent_ref` determine what it is for and where it belongs.

## Fixed v1 decisions

- do **not** support `turn` parents yet
- v1 parent kinds are limited to:
  - `session`
  - `benchmark`
- runtime execution stays fully sequential across all session types
- parent deletion cascades to attached child sessions
- the ordinary list surfaces stay **primary-only** by default

## Architectural boundary

This work is **not** a new runtime-tree task.

The canonical runtime tree stays:

- Session
  - Setup
  - Turn[]
    - Round[]
      - Part[]

The new work is metadata around the session, not a replacement for the session/turn/round/part model.

## Implementation increments

### 1. `backlog/session-metadata-foundation.md`

Backend-first, testable foundation:

- persisted `session_type`
- persisted parent reference fields
- validation rules by session type
- parent/child queries
- primary-only list behavior
- cascade deletion
- inspectable metadata in API/CLI/MCP surfaces

This is the first increment because it gives a useful, testable result without requiring the new tree UI yet.

### 2. `backlog/session-tree-navigation.md`

UI/navigation increment:

- tree view in the left pane
- default-on **primary sessions only** toggle
- non-primary child sessions shown under their parent
- newest-first sibling ordering
- compact date/time display
- distinct visual treatment for primary vs non-primary sessions

## Relationship to other tasks

This foundation is required by:

- `backlog/session-analysis-agent.md`
- `backlog/session-compaction-agent.md`
- `backlog/benchmark-automation.md`
- `backlog/session-batch-runs.md`

Those tasks should build on this model rather than each inventing their own session-linking semantics.

## Expected result for the full epic

After the increments above:

- mcpscope can represent multiple kinds of sessions explicitly
- some session types can require a parent object
- primary sessions can optionally belong to benchmark/experiment parents
- internal analysis/compaction/synthesis sessions can be attached where they belong
- the UI and lifecycle rules can reflect those relationships cleanly
