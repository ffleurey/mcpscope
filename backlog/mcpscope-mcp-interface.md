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
3. CLI and MCP are the **same product surface exposed through two presentation modes**

## Core product idea

The MCP interface should **not** replace the CLI.

The likely long-term model is:

- Web UI for human inspection and configuration
- CLI for shell-native workflows and manual/scripted use
- MCP interface for agent-native interaction

The key implementation rule should be:

> CLI and MCP must be a **1:1 surface by design**.

That means:

- each MCP tool corresponds to exactly one CLI command
- each CLI command corresponds to exactly one MCP tool
- parameter names, required/optional status, defaults, validation, and semantics are identical
- machine-readable result shapes and error codes are identical
- CLI help text and MCP tool descriptions come from the same source, not from duplicated wording

MCP vs CLI should be treated as a **presentation difference**, not a product or contract difference.

## Required architecture decision

This task should explicitly require a **shared canonical operation layer**.

The project should not implement:

- one command parser and handler path for CLI
- a separate hand-written tool layer for MCP

Instead, mcpscope should define a single internal operation catalog for the shared surface. Each operation should define, in one place:

- canonical operation name
- user-facing description
- arguments and options
- required / optional fields
- defaults
- validation rules
- backend call / execution path
- machine-readable success shape
- machine-readable error shape

From that shared definition, mcpscope should derive:

- CLI command registration and help text
- MCP tool registration and tool descriptions
- shared input validation
- shared result mapping

This is the most important design constraint of the task. It is how we prevent long-term drift between CLI and MCP.

## Why this matters

For coding-agent use, an MCP interface would help in several ways:

- reduce the tendency to build ad-hoc shell scripts around mcpscope
- reduce the tendency to export too much data into local files
- encourage agents to inspect sessions and turns incrementally
- preserve mcpscope's compact payload strategy
- keep the exploration loop interactive and focused

This is especially relevant because mcpscope is itself an evaluation/debugging tool for MCP servers. Giving it an MCP interface could make agents use it in a more disciplined way.

## Desired behavior

### 1. MCP tools and CLI commands are exact mirrors

The first MCP surface should mirror the shipped CLI baseline exactly:

- list sessions
- create session
- get session status
- send prompt
- inspect by hierarchical ID
- rename session

The rule is stronger than "equivalent":

> every shared operation exists once in the product model and is exposed unchanged through both CLI and MCP.

If a field is named `session_id` in one surface, it should not become `id` or `sessionId` in the other. If an option is optional in one surface, it should be optional in the other. If validation rejects a value in one surface, it should reject it in the other.

### 2. Same compact semantics

The MCP interface should preserve the same information-shaping goals as the CLI:

- summary first
- detail on demand
- inspect by ID instead of dumping full traces
- avoid oversized payloads by default

### 3. Stable tool contracts

The shared CLI/MCP contracts should be stable enough that a coding agent can:

1. list or create a session
2. poll status
3. inspect the exact failed turn or part
4. continue investigating only where needed

This should make it easier for agents to stay within mcpscope's intended workflow instead of copying data out into separate local artifacts.

### 4. Shared descriptions and documentation

The descriptive text for a command/tool should be defined once.

That includes:

- one canonical summary/description
- one canonical parameter description set
- one canonical list of defaults and constraints

The CLI help output and MCP tool descriptions should be rendered from that shared source. The project should avoid separately maintained help text for the same operation.

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

The naming scheme should be chosen once and mapped mechanically across both surfaces, not invented separately per surface.

If the CLI and MCP naming syntaxes need different separators for ergonomic reasons, the mapping must still be lossless and automatic. The operation identity, parameters, and descriptions must remain shared.

### 2. Transport and hosting model

How should mcpscope expose the MCP server?

Likely options:

- embedded in the backend process
- separate MCP sidecar within the same distribution
- stdio adapter over the existing HTTP API

The important product constraint is that it should still be part of the same shipped mcpscope product.

### 3. Shared contract layer

To avoid drift, CLI and MCP should reuse the same backend-facing response shapes wherever possible and share the same operation definitions by construction.

This task should explicitly avoid creating:

- one hand-written command implementation for CLI
- a different hand-written tool implementation for MCP
- one payload shape for CLI
- a second payload shape for MCP
- duplicated descriptions for the same behavior

The target model is:

- one shared operation definition
- one execution path
- one validation path
- one machine-readable contract
- two adapters: CLI and MCP

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
- CLI and MCP should remain identical in command/tool purpose, parameters, validation, and machine-readable output shape
- CLI-specific text rendering may differ from MCP because text rendering is presentation, but the underlying structured result must be the same

### UI

- no major UI redesign is required
- the UI remains the human-first inspection surface

## Important design notes

- the MCP interface should help agents use mcpscope properly, not bypass it
- summary-first and detail-on-demand remain core design rules
- the MCP interface should be additive, not a replacement for the CLI
- CLI and MCP should be parallel access modes over one shared operation layer
- the project should optimize for **zero semantic drift** between CLI and MCP
- any new shared workflow should be added once to the canonical operation catalog, then exposed automatically through both adapters

## Concerns and tradeoffs

This 1:1 strategy is the right default for mcpscope, but the task should acknowledge a few tradeoffs:

- it reduces freedom to make MCP-only or CLI-only workflow variants for the same operation
- it requires discipline in naming and schema design up front
- presentation-only differences must stay clearly separated from contract differences

Those are acceptable constraints here because mcpscope benefits much more from consistency than from surface-specific customization.

## Expected result

After this task is designed and implemented:

- coding agents can use mcpscope through an MCP tool surface
- CLI and MCP are backed by the same canonical operation definitions and execution paths
- each MCP tool corresponds exactly to one CLI command with the same parameters, defaults, validation, descriptions, and machine-readable results
- agents are less likely to script around mcpscope and dump unnecessary data into local files
- mcpscope's compact inspect-oriented workflow becomes easier to use correctly from agent environments
