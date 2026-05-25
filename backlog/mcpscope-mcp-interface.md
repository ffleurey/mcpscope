# mcpscope MCP interface

This task adds an **MCP server interface for mcpscope itself** as a refactoring-first increment over the shipped CLI surface.

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

The first increment is **not** a new tool-design exercise.

It is a refactoring and adapter task:

1. extract one shared canonical operation layer from the current CLI
2. keep the same shipped operations, parameters, validation, semantics, and machine-readable payloads
3. expose that same surface through both:
   - the existing CLI
   - a new MCP interface

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

## Implementation rule

The first MCP increment must wrap the **currently shipped CLI surface exactly**.

Shared operations for this increment:

- `list`
- `create`
- `send`
- `status`
- `inspect`

Explicitly **out of scope** for this increment:

- `rename`
- batch / experiment tools
- replay / compare
- analysis-agent tools
- any new MCP-only workflow

The implementation should therefore start by refactoring the current CLI into a shared operation layer rather than by bolting an MCP adapter onto the current hand-written command files.

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

The rule is stronger than "equivalent":

> every shared operation exists once in the product model and is exposed unchanged through both CLI and MCP.

If a field is named `session_id` in one surface, it should not become `id` or `sessionId` in the other. If an option is optional in one surface, it should be optional in the other. If validation rejects a value in one surface, it should reject it in the other.

Important nuance:

- the 1:1 rule applies to **operation inputs and results**
- adapter-only flags and transport/bootstrap settings are **not** part of the shared operation schema

Shared operation inputs for the first increment should look like:

- `create`: `title`, `id`, `compaction`
- `send`: `session_id`, `prompt`
- `status`: `session_id`
- `inspect`: `id`, `short`
- `list`: no operation arguments

Adapter-only concerns:

- CLI: `--json`, `--help`
- client/bootstrap config: `--url`, `MCPSCOPE_URL`
- MCP transport hosting/configuration

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

## Settled implementation decisions

### 1. Canonical operation IDs + automatic MCP naming

Keep one canonical internal operation ID per shared operation.

The MCP tool names should be generated mechanically from that catalog rather than invented separately. A prefixed MCP naming style such as `mcpscope_list`, `mcpscope_create`, ... is acceptable as long as:

- the mapping is automatic
- the shared descriptions and schemas remain identical
- the operation identity still exists only once in the codebase

### 2. Canonical field naming

The shared operation layer should prefer stable machine-readable field names such as:

- `session_id`
- `prompt`
- `compaction`

CLI positionals should map into those names. MCP tool inputs should expose those same names.

### 3. Transport and hosting model

This task should ship **Streamable HTTP only** for the first increment.

Important implications:

- no stdio transport in this increment
- no separate sidecar process by default
- the MCP surface should be hosted by the existing Fastify-based mcpscope product
- the server factory should still be cleanly separated from transport wiring, but only Streamable HTTP needs to be implemented now

### 4. Framework and stack

Use:

- Node.js + TypeScript
- `@modelcontextprotocol/sdk`
- Fastify

Do **not** add Express for this task.

### 5. Shared execution path

The shared operation layer should continue using the existing backend HTTP API.

That means:

- CLI and MCP both call the same shared operation implementation
- the shared operation implementation talks to the backend over HTTP
- this increment should avoid a direct backend-internal MCP execution path

This keeps the first implementation truly identical across CLI and MCP.

### 6. Neutral shared module

The shared operation layer must live in a neutral module, not under a CLI-only or MCP-only directory.

It should contain:

- operation metadata
- shared schemas
- execution functions
- structured result helpers
- shared error typing / normalization

## Scope

### Shared operation layer

- define the shared operation catalog for `list`, `create`, `send`, `status`, `inspect`
- centralize descriptions, argument schemas, validation rules, execution functions, and structured result shaping
- centralize backend error normalization

### CLI refactor

- refactor the CLI to consume the shared operation catalog instead of owning command contracts directly
- keep the current CLI command names and behavior stable
- keep `sessions list` as a CLI alias only
- keep text rendering as a CLI-only presentation concern

### MCP adapter

- add an MCP server factory using `@modelcontextprotocol/sdk`
- register one MCP tool per shared operation
- derive tool descriptions and schemas from the shared catalog
- expose the same machine-readable results as the CLI JSON mode
- host the MCP interface through Streamable HTTP on the existing Fastify-based product

### Testing

- add contract tests showing CLI and MCP use the same shared schemas
- add tests showing descriptions/tool metadata come from the same shared source
- add tests showing machine-readable results and error codes match across adapters
- add tests showing adapter-only flags do not leak into the shared operation schema

### UI

- no major UI redesign is required for this increment

## Implementation plan

1. **Extract the shared operation catalog**
   - inventory the current CLI surface
   - move descriptions into shared metadata
   - move argument definitions into shared schemas
   - move machine-readable result shaping into shared helpers
   - centralize backend error normalization

2. **Refactor the CLI onto the shared layer**
   - replace per-command contract ownership with shared operation definitions
   - keep current command names and behavior unchanged
   - keep current text rendering stable unless a change is needed for correctness

3. **Introduce the MCP server factory**
   - create one server factory from the shared operation catalog
   - register the tools from shared metadata
   - expose shared schemas and handlers
   - return the shared structured payloads directly

4. **Add Streamable HTTP transport**
   - host the MCP interface through Fastify
   - keep transport wiring separate from server factory logic
   - keep transport configuration separate from tool parameters

5. **Add validation coverage**
   - contract tests for schema parity
   - tests for shared descriptions
   - tests for structured result parity
   - tests for shared error-code parity

6. **Update active docs**
   - document only the implemented MCP transport and tool surface
   - keep the shared-surface rule explicit

## Acceptance criteria

- the first MCP increment exposes only `list`, `create`, `send`, `status`, and `inspect`
- each MCP tool is derived from the same shared operation definition used by the CLI
- CLI and MCP share the same validation rules, defaults, descriptions, machine-readable success shapes, and machine-readable error codes
- CLI-specific presentation flags and MCP transport settings are not part of the shared operation schema
- the MCP interface is hosted through Streamable HTTP on Fastify
- no Express dependency is introduced
- no separate hand-written MCP-only execution path exists for the shared operations

## Important design notes

- the MCP interface should help agents use mcpscope properly, not bypass it
- summary-first and detail-on-demand remain core design rules
- the MCP interface should be additive, not a replacement for the CLI
- CLI and MCP should be parallel access modes over one shared operation layer
- the project should optimize for **zero semantic drift** between CLI and MCP
- any new shared workflow should be added once to the canonical operation catalog, then exposed automatically through both adapters
- this first increment is intentionally refactoring-first: the goal is a clean shared foundation, not a broad new feature surface

## Expected result

After this task is designed and implemented:

- coding agents can use mcpscope through an MCP tool surface
- CLI and MCP are backed by the same canonical operation definitions and execution paths
- each MCP tool corresponds exactly to one CLI command with the same parameters, defaults, validation, descriptions, and machine-readable results
- the MCP interface is delivered through Streamable HTTP on the existing Fastify-based product
- agents are less likely to script around mcpscope and dump unnecessary data into local files
- mcpscope's compact inspect-oriented workflow becomes easier to use correctly from agent environments
