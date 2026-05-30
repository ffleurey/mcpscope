# Session analysis backend-owned launch

This increment closes the main architecture gap left intentionally after the shipped tree-integrated analysis MVP.

## Dependencies

- `backlog/completed/session-analysis-launch-and-report.md`
- `backlog/completed/mcpscope-mcp-interface.md`
- `backlog/candidates/session-analysis-evidence-protocol.md`

## Problem

The current MVP proves the product flow, but the launch orchestration still lives partly in the frontend:

- the backend route creates the child analysis session and returns the prompt
- the frontend then initializes that session and sends the first analysis turn
- there is not yet a shared CLI/MCP trigger for the same workflow

At the same time, the project has not yet finished determining what the trustworthy analysis workflow should be. The exact stages, gates, and intermediate artifacts of session analysis are still being clarified experimentally.

That means this task should not freeze detailed analysis inputs or outputs prematurely. It should follow the evidence-protocol work rather than guess at the final analysis contract.

## Goal

Make analysis launch a fully backend-owned reusable workflow that can be triggered consistently from:

- the UI
- the CLI
- MCP

But only after the analysis protocol is clarified enough to know what workflow the backend should actually own.

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

The exact analysis input contract, intermediate stages, and final report shape should be derived from the evidence-protocol task rather than fixed independently here.

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
- no independent redesign of the analysis protocol before the evidence-protocol task settles it

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
- the backend-owned launch path reflects the experimentally clarified analysis protocol rather than a guessed one-shot prompt contract