# Session analysis backend-owned launch

This increment closes the main architecture gap left intentionally after the shipped tree-integrated analysis MVP.

## Dependencies

- `backlog/completed/session-analysis-launch-and-report.md`
- `backlog/completed/mcpscope-mcp-interface.md`

## Problem

The current MVP proves the product flow, but the launch orchestration still lives partly in the frontend:

- the backend route creates the child analysis session and returns the prompt
- the frontend then initializes that session and sends the first analysis turn
- there is not yet a shared CLI/MCP trigger for the same workflow

That is acceptable for the MVP that is about to merge, but it is the next architecture task to clean up.

## Goal

Make analysis launch a fully backend-owned reusable workflow that can be triggered consistently from:

- the UI
- the CLI
- MCP

## Scope

- move analysis launch orchestration into a backend-owned execution path
- keep the backend as the owner of:
  - child-session creation
  - internal MCP binding
  - prelude initialization
  - first-turn launch for the analysis prompt
  - launch-time validation and error handling
- expose a CLI command to analyze one session explicitly
- expose a matching MCP trigger through the backend-owned operation/catalog surface when appropriate
- keep the UI as a thin caller of that same shared launch behavior

## Required behavior

- launching analysis should still create a `session_analysis` child session under the target session
- the child session should still bind to mcpscope's own restricted analysis MCP endpoint
- the workflow should avoid leaving a partially launched child session because the frontend failed between create, initialize, and first-turn send
- if analysis execution fails after the child session exists, the failure should remain inspectable in that analysis session rather than disappearing silently
- CLI/MCP trigger semantics should match the backend-owned launch rules rather than reimplementing them separately

## Non-goals

- no new analysis viewer UI
- no split-pane workflow
- no benchmark automation
- no redesign of the analysis prompt UX

## Testability

This increment should be covered by:

1. backend tests showing the launch path creates, initializes, and starts the first turn through one backend-owned workflow
2. tests for failure behavior when launch breaks after child-session creation
3. CLI coverage for explicit analysis launch
4. MCP coverage if the trigger ships in the same increment
5. frontend checks that the UI still launches analysis through the shared backend path without owning the orchestration

## Expected result

After this increment:

- the shipped analysis MVP keeps the same user-visible behavior
- the backend owns the full launch workflow rather than just part of it
- CLI and MCP can trigger the same analysis flow without frontend-specific logic
- the analysis launch architecture matches the rest of mcpscope's backend-owned execution model more closely