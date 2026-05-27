# Session error reporting for CLI

This task improves how session and turn failures are surfaced through the CLI, especially for tool-loop-limit and other runtime failures that currently show up clearly in the UI but not in the CLI.

## Problem

Today, a failed run is easier to understand in the Web UI than in the CLI.

In particular:

- the backend can persist a `diagnostic-note` part with a clear human-readable explanation
- the UI can show that diagnostic information
- the CLI currently tends to show only that the session or turn ended in `error`
- the user may not get the actual cause in a compact, actionable form

This becomes especially painful when the default tool-call loop limit is reached.

Current behavior:

- `BACKEND_MAX_TOOL_ROUNDS` defaults to `10`
- tool-enabled runs that need more rounds can stop with a diagnostic note such as:
  - maximum tool-call rounds reached
  - increase `BACKEND_MAX_TOOL_ROUNDS`
- the CLI does not currently make that reason obvious enough

So the user can see **that** a run failed, but not clearly **why** it failed, unless they switch to the UI.

## Goal

Make the CLI surface session and turn failure reasons clearly enough that common runtime failures can be understood without requiring the Web UI.

This task should also revisit whether the current default tool-call limit is too low and whether users need a cleaner way to control it.

## Desired behavior

### 1. CLI-visible failure reason

When a session or turn finishes in an error state, the CLI should expose a concise, actionable reason.

Examples:

- tool-loop limit reached
- session initialization failed
- MCP server unreachable
- LM Studio unreachable
- model not loaded

The goal is not to dump every hidden diagnostic detail into normal text output.

The goal is:

> if the run failed, the CLI should tell the user the main reason in a clear and actionable way.

### 2. Better status / inspect behavior for failures

At least one CLI path should make the failure reason easy to retrieve.

Possible surfaces:

- `mcpscope status <session-id>`
- `mcpscope inspect <session-id>`
- `mcpscope inspect <turn-id>`
- structured error/failure field in the backend status response

The final design can choose the best surface, but the workflow should be simple for a coding agent:

1. run a session
2. poll status
3. if it fails, immediately see the main reason

### 3. Revisit diagnostic-note visibility policy

We previously avoided treating `diagnostic-note` parts as normal CLI trace content because they are not part of the user/model-visible conversation.

That is still a reasonable default.

But this task should explicitly decide between:

- keep diagnostic-note hidden from general CLI trace output, but expose the main failure reason elsewhere
- or selectively surface diagnostic-note content in failure-oriented CLI views

The important requirement is not the exact mechanism.

The important requirement is that the CLI no longer leaves the user guessing.

### 4. Tool-call loop limit

The feedback suggests the default limit of `10` is often too low.

This task should evaluate:

- increasing the default from `10` to `20`
- whether the configured limit should be surfaced more clearly
- whether users need a better configuration path than only `BACKEND_MAX_TOOL_ROUNDS`

This does **not** necessarily mean building a full per-session tuning UI immediately.

But the task should at least decide:

- what the default should be
- how the user learns what limit applied
- how the user changes it in a supported way

## Scope

### Backend

- review where failure reasons currently live:
  - session status
  - turn status/outcome
  - diagnostic-note parts
  - API error payloads
- add or expose a stable failure-reason surface suitable for CLI consumption
- review and likely update the default `maxToolRounds`
- add tests for common failure reasons being surfaced clearly

### CLI

- improve the user-visible failure message for failed sessions/turns
- make the main reason visible in at least one standard workflow, ideally `status`
- keep normal successful output compact
- support structured output for coding agents

### UI

- no major UI redesign is required
- if backend failure reporting becomes more structured, the UI should stay aligned with it

## Important design notes

- the backend should remain the source of truth for failure reason semantics
- the CLI should not have to infer failure cause from raw trace structure if the backend can expose it directly
- compact successful output is still the right default
- failure output should be concise, actionable, and scriptable
- this task is about runtime diagnostics, not about exposing every diagnostic part as ordinary transcript content

## Expected result

After this task:

- failed runs are understandable from the CLI
- hitting the tool-loop limit produces a clear explanation and next step
- the default tool-call limit is revisited and documented
- coding-agent workflows can detect and report failure reasons without having to fall back to the Web UI
