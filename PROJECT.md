# Project direction

## Purpose

Build a trustworthy local tool for:

- developing and debugging MCP server workflows
- studying multi-turn LLM behavior
- inspecting reasoning, tool choice, and context growth
- exporting runs that can be replayed as deterministic regressions

## Product position

This is no longer best understood as a frontend experiment. It is a **backend-centered runtime and diagnostics tool** with a frontend UI on top.

That matters because the value of the project depends on correctness and inspectability:

- token accounting must be attached to canonical runtime state
- reasoning history must be preserved for study
- context trimming rules must be explicit and testable
- raw LM/MCP exchanges must be retained for replay and debugging

## Architecture

### Backend

The backend is the source of truth. It owns orchestration, persistence, token accounting, reasoning retention, trace export, and replay fidelity.

### Frontend

The frontend should present backend state, initiate actions, and support export/import workflows. It should not remain the place where core runtime correctness is decided.

The frontend vocabulary and data flow should stay aligned with the backend:

- **turn** -> full user request lifecycle
- **round** -> one model iteration inside a turn
- **part** -> canonical reasoning/content/tool-call/tool-result unit
- **delta** -> transient streamed update before a part is committed

The intended live UX is: stream deltas, then replace them with committed backend parts.

## Current assessment

The backend refactor was worth doing and has materially improved the project:

- the runtime model is much clearer
- the token/reasoning pipeline is far more testable
- the project now has a realistic path to trustworthy regression testing
- exported traces can become reusable replay fixtures

The project is now worth continuing. The frontend has been moved onto the backend-driven architecture closely enough that the main risk is no longer structural confusion, but **whether token/context reporting is fully trustworthy**.

## Immediate next phase

1. verify token accounting against captured traces and real sessions
2. confirm the context bar reflects the same canonical context/token state as the backend trace
3. fix any remaining token/context mismatches on top of the now-simplified backend-driven UI
4. continue building MCP-focused analysis features on top of that trusted runtime foundation
