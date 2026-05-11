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

## Current assessment

The backend refactor was worth doing and has materially improved the project:

- the runtime model is much clearer
- the token/reasoning pipeline is far more testable
- the project now has a realistic path to trustworthy regression testing
- exported traces can become reusable replay fixtures

The project is now worth continuing, but the frontend must be aligned with this architecture before more feature growth.

## Immediate next phase

1. rewire the frontend to consume backend APIs
2. remove duplicated frontend runtime/accounting logic
3. expose trace export/import and replay-oriented diagnostics cleanly in the UI
4. continue building MCP-focused analysis features on top of the backend foundation
