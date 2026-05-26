# Session metadata foundation

This increment delivers the first **testable** step of the parent-linked session work.

## Goal

Add backend-owned session metadata so mcpscope can represent typed sessions and parent links without changing the canonical runtime tree.

## Scope

### Persistence

- add persisted `session_type`
- add persisted parent-reference fields suitable for:
  - fetch parent for one session
  - fetch all child sessions for one parent
- add indexes needed for those lookups

### Validation rules

Support these v1 rules:

- `primary`
  - parent optional
  - if present, parent kind must be `benchmark`
- `session_analysis`
  - parent required
  - parent kind must be `session`
- `session_compaction`
  - parent required
  - parent kind must be `session`
- `benchmark_analysis`
  - parent required
  - parent kind must be `benchmark`

Do **not** support `turn` parents in this increment.

### Lifecycle and visibility

- existing sessions become `primary`
- child sessions are hidden from ordinary list surfaces by default
- CLI/MCP/session list behavior stays focused on primary sessions
- parent deletion cascades to attached child sessions

### Inspection

- expose session metadata through inspect/trace/status surfaces where relevant
- make parent and child relationships fetchable through backend-owned operations

## Non-goals

- no tree view yet
- no benchmark object design yet
- no analysis execution yet

## Testability

This increment should be covered by deterministic tests for:

1. schema migration and repository persistence
2. validation of allowed parent kinds by session type
3. parent lookup and child-session lookup
4. primary-only listing behavior
5. cascade delete behavior
6. API serialization of the new metadata

## Expected result

After this increment:

- the backend can represent typed sessions and parent links safely
- the product still behaves normally for primary sessions
- child-session semantics are real and testable even before the tree UI exists
