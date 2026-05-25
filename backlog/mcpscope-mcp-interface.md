# mcpscope MCP interface

This task explores adding an **MCP server interface for mcpscope itself**, alongside the existing Web UI and CLI.

## Problem

The current product exposes mcpscope through:

- the Web UI
- the backend HTTP API
- the packaged CLI

The CLI was the right first step because coding agents already have terminal access and are generally good at using shell tools.

That part is working.

But there is an important weakness:

- mcpscope is not a tool most coding agents were pretrained to use
- so the agent often falls back to writing larger shell scripts around it
- the agent may save session data into local files and re-analyze it externally
- that works around mcpscope instead of taking advantage of mcpscope's compact inspect/status surfaces

This weakens the product's main value:

- compact payloads
- targeted inspection by canonical ID
- interactive exploration of traces without flooding context with irrelevant content

## Goal

Add an MCP interface so coding agents can use mcpscope as a first-class tool surface, not only as a shell command.

The intended outcome is:

1. agents can discover mcpscope capabilities through MCP tools
2. agents are nudged toward the product's intended workflow
3. CLI and MCP stay aligned and complementary

## Core product idea

The MCP interface should **not** replace the CLI.

The likely long-term model is:

- Web UI for human inspection and configuration
- CLI for shell-native workflows and manual/scripted use
- MCP interface for agent-native interaction

The CLI and MCP tools should serve the **same purpose** and expose closely aligned concepts, structures, and payloads.

## Why this matters

For coding-agent use, an MCP interface would help in several ways:

- reduce the tendency to build ad-hoc shell scripts around mcpscope
- reduce the tendency to export too much data into local files
- encourage agents to inspect sessions and turns incrementally
- preserve mcpscope's compact payload strategy
- keep the exploration loop interactive and focused

This is especially relevant because mcpscope is itself an evaluation/debugging tool for MCP servers. Giving it an MCP interface could make agents use it in a more disciplined way.

## Desired behavior

### 1. MCP tools mirror the current CLI baseline

The first MCP surface should likely align with the shipped CLI baseline:

- list sessions
- create session
- get session status
- send prompt
- inspect by hierarchical ID
- rename session

The conceptual rule should be:

> every core CLI workflow should have an MCP equivalent, and both should feel like the same product surface.

### 2. Same compact semantics

The MCP interface should preserve the same information-shaping goals as the CLI:

- summary first
- detail on demand
- inspect by ID instead of dumping full traces
- avoid oversized payloads by default

### 3. Stable tool contracts

The MCP tool contracts should be stable enough that a coding agent can:

1. list or create a session
2. poll status
3. inspect the exact failed turn or part
4. continue investigating only where needed

This should make it easier for agents to stay within mcpscope's intended workflow instead of copying data out into separate local artifacts.

## Key design questions

### 1. Tool inventory

What is the smallest useful MCP tool set?

Likely first candidates:

- `list_sessions`
- `create_session`
- `rename_session`
- `get_session_status`
- `send_prompt`
- `inspect_object`

Equivalent naming is fine, but the mapping to CLI concepts should stay obvious.

### 2. Transport and hosting model

How should mcpscope expose the MCP server?

Likely options:

- embedded in the backend process
- separate MCP sidecar within the same distribution
- stdio adapter over the existing HTTP API

The important product constraint is that it should still be part of the same shipped mcpscope product.

### 3. Shared contract layer

To avoid drift, CLI and MCP should reuse the same backend-facing response shapes where possible.

This task should explicitly avoid creating:

- one payload shape for CLI
- a different conceptual shape for MCP
- and a third shape for the UI

The more the three surfaces share the same session/turn/inspect model, the better.

### 4. Error handling

The MCP interface should preserve machine-readable failure semantics already present in the backend and CLI work:

- `session_not_found`
- `session_not_initialized`
- `turn_in_progress`
- `another_session_active`
- later failure-reason improvements from the CLI error-reporting task

### 5. Scope boundary

This task is about an MCP interface for the existing workflow.

It is **not** automatically about:

- batch orchestration
- replay
- compare
- streaming terminal UX
- replacing the CLI

Those can be layered later.

## Scope

### Research / design

- define whether an MCP interface is the right complement to the CLI
- define the first tool inventory
- define how MCP tool payloads align with CLI and HTTP payloads
- define hosting/distribution strategy

### Backend

- likely expose an MCP server or adapter over the current backend-owned session model
- preserve current session/turn/inspect semantics

### CLI

- no removal or deprecation of the CLI
- CLI and MCP should remain aligned in command/tool purpose and output shape

### UI

- no major UI redesign is required
- the UI remains the human-first inspection surface

## Important design notes

- the MCP interface should help agents use mcpscope properly, not bypass it
- summary-first and detail-on-demand remain core design rules
- the MCP interface should be additive, not a replacement for the CLI
- if both CLI and MCP are kept, they should feel like parallel access modes over one backend-owned model

## Expected result

After this task is designed and implemented:

- coding agents can use mcpscope through an MCP tool surface
- CLI and MCP workflows stay aligned
- agents are less likely to script around mcpscope and dump unnecessary data into local files
- mcpscope's compact inspect-oriented workflow becomes easier to use correctly from agent environments
