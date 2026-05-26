This folder contains backlog tasks and feature specs for mcpscope.

One file per task or increment.

Not every idea here is committed to be built, but active items should reflect the current agreed direction.

## Current agreed decisions

These decisions now shape the active parent-link and analysis work:

1. `turn` parents are deferred from v1
2. v1 parent kinds are limited to `session` and `benchmark`
3. follow-up questions stay in the same analysis conversation as the initial evaluation
4. execution stays fully sequential across all session types in v1
5. parent deletion cascades to attached child sessions
6. analysis configuration starts simple: named analysis profiles plus one default
7. the tree view should sort siblings newest-first and show compact date/time

## Recently completed increments

- `backlog/done/session-metadata-foundation.md`
- `backlog/done/analysis-configurations.md`
- `backlog/done/session-analysis-launch-and-report.md`

## Active split for the next implementation steps

The larger specs are now split into smaller, testable increments:

- `backlog/session-types-and-parent-links.md` — epic/background spec
  - `backlog/session-tree-navigation.md`

- `backlog/session-analysis-agent.md` — epic/background spec
  - `backlog/session-analysis-backend-owned-launch.md`
  - `backlog/analysis-follow-up-and-viewing.md`

## Next implementation step

The next recommended increment is:

- `backlog/session-analysis-backend-owned-launch.md`

Reasoning:

- the tree-integrated analysis MVP is now implemented and can be moved to done
- the remaining gap is architectural: the frontend still orchestrates initialization and first-turn launch
- the next increment should make analysis launch fully backend-owned and reusable for future CLI and MCP triggers
- richer analysis viewing can stay separate once that shared launch path exists

## Still deferred

The benchmark object model is still intentionally deferred.

For now the only benchmark requirement is that it will eventually act as a parent object that can contain sessions.
