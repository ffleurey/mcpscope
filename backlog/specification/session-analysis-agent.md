# Session analysis agent

This is the **epic/background spec** for a first-class analysis agent that evaluates one finished session against explicit expectations and returns a compact, trace-grounded report.

The implementation should be delivered in smaller increments rather than as one broad feature branch.

## Goal

Add a reusable session-level analysis workflow that:

1. accepts explicit expectations for one finished session
2. runs a dedicated internal analysis session
3. produces a short, structured report

This is **not** a deterministic oracle and **not** a generic agent framework. It is a product-specific analysis workflow for one session.

## Dependencies

This feature depends on:

- the completed `backlog/completed/mcpscope-mcp-interface.md` work
- the parent-link foundation from `backlog/specification/session-types-and-parent-links.md`

In practice, it should build on:

- `backlog/completed/session-metadata-foundation.md`
- the shipped tree-integrated MVP from `backlog/completed/session-analysis-launch-and-report.md`

## Fixed v1 decisions

- analysis runs are represented as child sessions, not special hidden jobs
- `session_type = session_analysis` (or equivalent) requires a parent session
- follow-up questions remain in the same analysis conversation
- execution stays fully sequential across all session types
- deleting a base session cascades to its attached analysis sessions
- analysis configuration starts simple: named profiles plus one default

## Core implementation direction

The intended implementation is to **bootstrap mcpscope on itself**:

- create a dedicated internal analysis session
- configure it with an analysis-specific profile
- let it inspect the subject session through mcpscope-owned surfaces
- use a restricted analysis-oriented mcpscope MCP tool subset, not the full operational surface

## Implementation increments

### 1. `backlog/completed/analysis-configurations.md`

Configuration increment:

- dedicated analysis profiles
- default analysis profile selection
- configuration UI/backend cleanup where needed

This should be testable before any analysis execution exists.

This increment is now complete.

### 2. `backlog/completed/session-analysis-launch-and-report.md`

Backend/CLI/tree-integrated MVP increment:

- explicit user-supplied analysis prompt for one base session
- creation of a child analysis session
- binding that child session to mcpscope's own MCP endpoint with a restricted analysis tool subset
- restricted analysis MCP tool subset
- compact structured report output
- CLI/API launch surface
- tree-based UI launch that shows the created child session beneath its parent, navigates into it, and reuses the standard session view for streaming and follow-up

This is the first increment that should produce a real end-to-end analysis result.

This increment is now complete, with the remaining backend-owned launch/CLI/MCP refactor tracked separately below.

### 3. `backlog/implementation/session-analysis-backend-owned-launch.md`

Backend ownership and automation increment:

- move analysis launch orchestration fully into a backend-owned reusable path
- expose that same launch path to future CLI and MCP triggers
- keep the UI on top of that shared launch surface instead of owning the orchestration itself

### 4. `backlog/specification/analysis-follow-up-and-viewing.md`

Interactive UI increment:

- separate viewing surface so the base session can stay visible
- selective delete of individual analysis sessions
- richer launch entry points from the base session and/or tree selection

## Important design notes

- expectations should guide evaluation, not pretend the run has only one valid path
- the output should stay compact and reusable
- analysis sessions must remain clearly separate from normal user sessions
- the implementation should stay product-specific and avoid growing into a generic agent framework
- benchmark details remain deferred as long as session-parent semantics stay compatible with later benchmark work

## Expected result for the full epic

After the increments above:

- a user can define expectations for one session
- mcpscope can run an analysis agent against that session
- mcpscope can produce a compact report about whether the run matched the expectations and what the main issues were
- analysis runs are clearly represented as dedicated internal analysis sessions rather than ordinary sessions
- users can run multiple analyses against one primary session and inspect/delete them independently
- the GUI can reveal those analysis sessions under the base session when non-primary sessions are shown
- analysis model/prompt configuration is first-class and consistent with the rest of the product configuration
- the project has a concrete per-session analysis layer that later benchmark automation can build on
