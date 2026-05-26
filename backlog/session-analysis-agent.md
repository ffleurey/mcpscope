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

This task should depend on:

- the completed `backlog/done/mcpscope-mcp-interface.md` work
- `backlog/session-types-and-parent-links.md`

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

Analysis runs must be represented as a **dedicated internal session type** in the generalized parent-linked session model.

They must be clearly distinct from:

- normal user / evaluation sessions
- later benchmark-synthesis sessions

This distinction must exist in backend/runtime behavior, not only in the UI.

Analysis sessions should:

- have `session_type = session_analysis` or equivalent
- have a mandatory parent reference to the subject session they analyze
- be inspectable during development
- be hidden from the normal session list by default

This task should **reuse** the typed parent-linked session model from `session-types-and-parent-links.md`, not redefine that model locally.

They also need **dedicated analysis configuration**, separate from ordinary session defaults, including:

- model to use
- system prompt
- temperature / reasoning settings if needed
- any special evaluation instructions

This configuration should be treated as a first-class configuration surface, not as an ad-hoc special case.

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

### 5. Analysis sessions are interactive and inspectable

An analysis run should behave like a real session, not a hidden one-shot background job.

That means:

- the analysis session should be visible live while it runs
- it should be inspectable just like a normal session
- it should be possible to ask follow-up questions in the analysis session after the initial run

Follow-up questions should remain in the same analysis conversation:

- first turn = initial analysis
- later turns = follow-up questions and refinement

### 6. Multiple analyses per base session

It should be possible to run more than one analysis session on the same primary session.

Examples:

- compare different analysis prompts
- compare different analysis models
- rerun an analysis after changing expectations

It should also be possible to delete selected analysis sessions without deleting the base session.

### 7. Launch and viewing UX

The user should be able to trigger analysis:

- from the session being analyzed
- and/or by selecting the target session in the session tree view

Because the base session often needs to remain visible during evaluation, the analysis UX should support a separate viewing surface.

Acceptable directions include:

- a fresh analysis window/view
- a split pane
- a dialog

The important requirement is:

> running and inspecting the analysis should not force the user to lose sight of the base session they are evaluating

### 8. Analysis configuration UI

The product should have a dedicated configuration screen for analysis sessions.

That screen should allow the user to:

- choose which model to use for analysis
- inspect and edit the system prompt used by the analysis agent
- define multiple analysis model/prompt alternatives
- choose which analysis alternative is the default

This should be done consistently with the existing configuration model used elsewhere in the product.

If the current configuration area is not clean or reusable enough, the task should refactor and solidify that area instead of layering new shortcuts on top of old ones.

The launch UX should support:

- one-click start with the default analysis alternative
- a small selector/dropdown to start with a non-default alternative when needed

Because session snapshots already persist model/system-prompt state, this should reuse existing session snapshot mechanics rather than introducing parallel storage concepts.

## Scope

### Backend

- define the analysis input shape for one session
- define the output/report shape
- run the analysis agent using the configured LM runtime
- expose the analysis through a backend surface suitable for UI and CLI use
- support more than one analysis session attached to the same base session
- support deleting individual analysis sessions
- define how analysis-session configuration is stored separately from ordinary session defaults
- define or reuse a restricted mcpscope MCP tool subset for analysis-only session inspection
- keep execution fully sequential across all session types (same global lock model as normal sessions)
- enforce cascade deletion from parent session to attached analysis sessions

### CLI

- add a command to analyze one session explicitly
- show the short report in text mode
- support JSON output for scripting and later automation
- keep session-listing behavior focused on primary sessions only unless a later task explicitly expands CLI visibility of non-primary sessions

### UI

- allow analysis to be triggered from the base session and/or session tree selection
- show analysis sessions live while they run
- allow follow-up questions inside the analysis session
- keep analysis sessions out of the ordinary top-level session list by default
- when non-primary sessions are revealed, show analysis sessions under their parent session in the tree view
- support viewing analysis in a separate surface so the base session can remain visible
- allow deleting selected analysis sessions
- add a dedicated analysis-configuration screen for models, prompts, alternatives, and default selection
- use a default title pattern for analysis sessions based on the selected analysis model/profile name so multiple analyses are easy to distinguish

## Important design notes

- this is not a deterministic oracle system yet
- expectations should guide evaluation, not pretend the run has only one valid path
- the analysis prompt should emphasize factual, trace-based observations
- the output should be small enough to be useful in repeated workflows
- the reusable typed parent-linked session primitive should come from `session-types-and-parent-links.md`
- the implementation should stay product-specific and avoid growing into a full generic agent framework
- analysis sessions must be clearly separated from normal user sessions
- the analysis agent should get only the mcpscope MCP tools it actually needs for session analysis
- configuration for analysis sessions should reuse and strengthen the existing configuration architecture rather than bypass it
- this task should not require benchmark details; benchmark object design remains part of benchmark tasks as long as session-parent semantics are respected

## Expected result

After this task:

- a user can define expectations for one session
- mcpscope can run an analysis agent against that session
- mcpscope can produce a compact report about whether the run matched the expectations and what the main issues were
- analysis runs are clearly represented as dedicated internal analysis sessions rather than ordinary sessions
- users can run multiple analyses against one primary session and inspect/delete them independently
- the GUI can reveal those analysis sessions under the base session when non-primary sessions are shown
- analysis model/prompt configuration is first-class and consistent with the rest of product configuration
- the project has a concrete per-session analysis layer that later benchmark automation can build on
