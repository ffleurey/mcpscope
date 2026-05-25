# Session analysis agent

This task adds a first-class **analysis agent** that evaluates **one finished session** against explicit expectations and returns a compact, trace-grounded report.

## Problem

mcpscope already captures the right evidence:

- setup
- turns and rounds
- tool calls and tool results
- final answer
- diagnostics

But turning that evidence into an evaluation still takes a lot of manual work. A developer must decide:

- whether the intended task was achieved
- whether the right tools were used
- whether the failure was caused by prompt wording, tool descriptions, schema shape, payload shape, or runtime issues
- how to summarize the run into a reusable judgment

## Goal

Add a reusable session-level analysis step that:

1. accepts explicit expectations for one finished session
2. runs a dedicated internal analysis workflow
3. produces a short, structured report

This is **not** a deterministic oracle and **not** a generic agent framework. It is a product-specific analysis workflow for one session.

## Dependency note

This task should depend on `backlog/mcpscope-mcp-interface.md`.

The analysis agent should use a **restricted analysis-oriented mcpscope MCP tool subset**, not the full operational tool surface.

Analysis-facing tools should stay narrow and session-focused, for example:

- inspect session
- inspect setup
- inspect turn
- inspect round
- inspect part
- fetch compact analysis-relevant metadata

It should **not** need broad operational tools such as:

- list all sessions
- create arbitrary sessions
- send arbitrary prompts outside the controlled analysis workflow

## Implementation direction

The intended implementation is to **bootstrap mcpscope on itself**:

- create a dedicated internal analysis session
- configure it with a dedicated system prompt and analysis criteria
- let it inspect the subject session through mcpscope-owned surfaces
- use the mcpscope MCP interface as the analysis tool surface

This reuses what mcpscope already has:

- persisted sessions
- compact inspect surfaces
- hierarchical IDs
- LM Studio integration

without turning mcpscope into a general-purpose agent platform.

## Session model requirements

Analysis runs must be represented as a **dedicated internal session type** or equivalent persisted classification.

They must be clearly distinct from:

- normal user / evaluation sessions
- later benchmark-synthesis sessions

This distinction must exist in backend/runtime behavior, not only in the UI.

Analysis sessions should:

- link back to the subject session they analyze
- be inspectable during development
- be hidden from the normal session list by default

They also need **dedicated analysis configuration**, separate from ordinary session defaults, including:

- model to use
- system prompt
- temperature / reasoning settings if needed
- any special evaluation instructions

## Desired behavior

### 1. Expectations are explicit

The analysis step should accept structured expectations for one session.

First-version fields should stay small and practical, for example:

- `expected_result`
- `expected_tools` or `expected_tool_sequence`
- optional evaluation notes

This should be treated as **guided evaluation**, not exact deterministic matching.

### 2. The analysis is trace-grounded

The analysis agent should evaluate the real stored session, including:

- setup
- turns
- rounds
- tool calls
- tool results
- final answer
- relevant diagnostics

It should work from mcpscope's own compact inspect surfaces rather than from oversized exported payloads.

### 3. The report is compact and stable

The output should be a short report, not a long essay.

Likely sections:

- overall judgment
- expected vs observed outcome
- tool-use assessment
- main issues
- recommended next improvement

### 4. The analysis is factual

The analysis prompt should explicitly optimize for:

- trace-grounded reasoning
- concrete observations
- restrained claims
- low hallucination risk

The model should be pushed to:

- cite observed evidence from the trace
- separate fact from interpretation
- avoid inventing expectations or hidden intent

## Scope

### Backend

- define the analysis input shape for one session
- define the output/report shape
- run the analysis agent using the configured LM runtime
- expose the analysis through a backend surface suitable for UI and CLI use
- define a dedicated session type / classification for analysis runs
- define how analysis-session configuration is stored separately from ordinary session defaults
- define how analysis sessions link back to the subject session
- define or reuse a restricted mcpscope MCP tool subset for analysis-only session inspection

### CLI

- add a command to analyze one session explicitly
- show the short report in text mode
- support JSON output for scripting and later automation

### UI

- show the analysis result in a compact form
- make analysis sessions inspectable in a dedicated development-oriented view or filter
- keep analysis sessions out of the ordinary session list by default

## Important design notes

- this is not a deterministic oracle system yet
- expectations should guide evaluation, not pretend the run has only one valid path
- the analysis prompt should emphasize factual, trace-based observations
- the output should be small enough to be useful in repeated workflows
- this task should create the reusable primitive that later benchmark automation builds on
- the implementation should stay product-specific and avoid growing into a full generic agent framework
- analysis sessions must be clearly separated from normal user sessions
- the analysis agent should get only the mcpscope MCP tools it actually needs for session analysis

## Expected result

After this task:

- a user can define expectations for one session
- mcpscope can run an analysis agent against that session
- mcpscope can produce a compact report about whether the run matched the expectations and what the main issues were
- analysis runs are clearly represented as dedicated internal analysis sessions rather than ordinary sessions
- the project has a concrete foundation for later benchmark automation
