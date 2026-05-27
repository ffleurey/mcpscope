# Session compaction agent

This task adds a future **compaction session** workflow for more advanced context compaction strategies.

## Problem

mcpscope currently supports only simple compaction choices:

- `none`
- `strip-reasoning`

That is the right short-term behavior.

But future compaction may need to do more than remove one known part type.

Examples:

- analyze a long session and decide what context is still needed
- summarize earlier turns
- keep some tool results but compress others
- preserve key instructions while pruning low-value detail
- compact at the session level or around a specific turn boundary

That work is not just a flag choice. It may require a dedicated analysis workflow with its own trace and inspectability.

## Goal

Add a future **compaction session** workflow that:

1. runs as a dedicated typed session
2. attaches to the session it is compacting in v1 (turn-level parent later)
3. produces explicit compaction decisions/artifacts that remain inspectable

## Dependency note

This task should build on:

- `backlog/specification/session-types-and-parent-links.md`

It should reuse the same typed parent-linked session model as analysis and benchmark synthesis work.

## Core idea

The compaction workflow should not be a hidden black box.

If mcpscope eventually uses a richer compaction strategy, it should be possible to inspect:

- what source context it looked at
- what it decided to keep
- what it decided to remove
- what summaries or compressed artifacts it produced

That suggests representing the compaction workflow itself as a session.

Likely relationship:

- `session_compaction` session type
- mandatory parent: `session` in v1
- `turn` parent support is deferred to a later increment

## Scope for now

This task is intentionally only a **basic task definition** for future work.

It does not need a full implementation plan yet.

What matters now is:

- reserving the architectural concept
- making sure the generalized session model supports it
- documenting why advanced compaction likely needs a parent-linked session workflow

## Expected result

After this task is eventually implemented:

- mcpscope can support advanced compaction workflows beyond `none` and `strip-reasoning`
- those workflows are inspectable rather than opaque
- compaction sessions are attached to the target object they compact (`session` in v1, `turn` later)
- compaction fits the same generalized typed parent-linked session architecture as analysis and benchmark synthesis
