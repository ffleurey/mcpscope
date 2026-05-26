# Session analysis launch and report

This increment delivers the first end-to-end analysis workflow.

## Dependencies

- `backlog/session-metadata-foundation.md`
- `backlog/analysis-configurations.md`

## Goal

Allow a user or script to launch an analysis against one finished session and receive a compact structured report.

## Scope

### Analysis launch

- accept one target session plus explicit expectations
- create a child session of type `session_analysis`
- bind it to the selected analysis profile
- run the first analysis turn automatically

### Expectations input

Keep v1 expectations small and practical:

- `expected_result`
- `expected_tools` or `expected_tool_sequence`
- optional evaluation notes

This is guided evaluation, not deterministic exact matching.

### Restricted MCP tool subset

The analysis agent should use a restricted, session-focused tool surface, for example:

- inspect session
- inspect setup
- inspect turn
- inspect round
- inspect part
- fetch compact analysis-relevant metadata

It should **not** get broad operational tools such as:

- list all sessions
- create arbitrary sessions
- send arbitrary prompts outside the controlled analysis workflow

### Report contract

The output should be compact and stable, with sections such as:

- overall judgment
- expected vs observed outcome
- tool-use assessment
- main issues
- recommended next improvement

### Surfaces

- backend launch surface suitable for UI and CLI use
- CLI command to analyze one session explicitly
- JSON output for automation
- text output for normal use

## Prompt guidance

The initial analysis prompt should optimize for:

- trace-grounded reasoning
- concrete observations
- restrained claims
- low hallucination risk

The model should be pushed to:

- inspect setup before judging tool use
- cite observed evidence from the trace
- separate fact from interpretation
- evaluate the MCP tool surface, not just the model in isolation

## Non-goals

- no full interactive follow-up/viewing UX yet
- no dedicated split-pane or alternate analysis window yet
- no benchmark automation yet

## Testability

This increment should be covered by deterministic end-to-end tests for:

1. child analysis-session creation with correct parent link and type
2. default/non-default analysis profile selection
3. restricted tool-surface registration/exposure
4. compact report schema and CLI JSON shape
5. sequential locking behavior during analysis execution

## Expected result

After this increment:

- mcpscope can launch a real analysis session against one finished session
- that analysis session produces a compact report
- the result is scriptable and testable before the richer UI workflow lands
