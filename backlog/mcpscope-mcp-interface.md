# mcpscope MCP interface

This task adds an **MCP server interface for mcpscope itself** as a refactoring-first increment over the shipped CLI surface.

## Problem

mcpscope already exposes:

- the Web UI
- the backend HTTP API
- the packaged CLI

The current CLI was the right first step for coding-agent workflows, but it is not yet the right architectural base for MCP.

The important correction is this:

> mcpscope is a **backend-centered product**.

That means the canonical command/tool semantics should live in the backend, not in a separate execution layer outside the backend.

If we instead make a shared external module own execution and have the backend-hosted MCP surface call back into the backend over loopback HTTP, we create the wrong ownership boundary:

- the backend stops being the clear owner of operation semantics
- MCP becomes a thin wrapper over a second execution layer
- the backend can end up calling itself over HTTP
- cleanup later becomes harder as more operations accumulate

## Goal

Add an MCP interface so coding agents can use mcpscope as a first-class tool surface, not only as a shell command.

The first increment is **not** a new tool-design exercise.

It is a refactoring and adapter task:

1. move canonical operation ownership into the backend
2. keep the same shipped operations, parameters, validation, semantics, and machine-readable payloads
3. expose that same backend-owned surface through both:
   - the CLI
   - a new MCP interface

## Core product idea

The MCP interface should **not** replace the CLI.

The long-term model remains:

- Web UI for human inspection and configuration
- CLI for shell-native workflows and manual/scripted use
- MCP interface for agent-native interaction

The key implementation rule is:

> CLI and MCP must be a **1:1 surface by design**, but the backend must own the semantics and execution.

That means:

- each MCP tool corresponds to exactly one CLI command
- each CLI command corresponds to exactly one MCP tool
- parameter names, required/optional status, defaults, validation, and semantics are identical
- machine-readable result shapes and error codes are identical
- CLI help text and MCP tool descriptions come from the same source, not from duplicated wording

MCP vs CLI is a presentation difference, not a product-contract difference.

## Required architecture decision

The canonical operation layer must be **backend-owned**.

The project should not implement:

- one command parser and handler path for CLI
- a separate hand-written tool layer for MCP
- a separate shared execution layer outside the backend that becomes a second operational core
- a backend-hosted MCP adapter that calls back into the backend over loopback HTTP for shared operations

Instead, mcpscope should define a single backend-owned operation catalog. Each operation should define, in one place:

- canonical operation ID
- user-facing description
- canonical input schema
- defaults
- validation rules
- backend execution function
- machine-readable success shape
- machine-readable error shape

From that backend-owned definition, mcpscope should derive:

- CLI command registration and help text
- MCP tool registration and tool descriptions
- shared input validation
- shared result mapping

This is the most important design constraint of the task. It is how we prevent long-term drift between CLI and MCP without creating a second core layer outside the backend.

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

## Desired behavior

### 1. MCP tools and CLI commands are exact mirrors

The first MCP surface should mirror the shipped CLI baseline exactly:

- list sessions
- create session
- get session status
- send prompt
- inspect by hierarchical ID

The rule is stronger than "equivalent":

> every shared operation exists once in the backend-owned product model and is exposed unchanged through both CLI and MCP.

If a field is named `session_id` in one surface, it should not become `id` or `sessionId` in the other. If validation rejects a value in one surface, it should reject it in the other.

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

### 3. Same structured contract

The shared CLI/MCP contracts should be stable enough that a coding agent can:

1. list or create a session
2. poll status
3. inspect the exact failed turn or part
4. continue investigating only where needed

The MCP interface must expose **real structured results**, not just JSON serialized into text content. If the SDK supports structured output, mcpscope should use it.

### 4. Shared descriptions and documentation

The descriptive text for a command/tool should be defined once.

That includes:

- one canonical summary/description
- one canonical parameter description set
- one canonical list of defaults and constraints

The CLI help output and MCP tool descriptions should be rendered from that shared source.

## Settled implementation decisions

### 1. Canonical operation IDs + automatic MCP naming

Keep one canonical internal operation ID per shared operation.

The MCP tool names should be generated mechanically from that catalog rather than invented separately. A prefixed naming style such as `mcpscope_list`, `mcpscope_create`, ... is acceptable as long as:

- the mapping is automatic
- the shared descriptions and schemas remain identical
- the operation identity still exists only once in the backend-owned catalog

### 2. Canonical field naming

The backend-owned operation layer should prefer stable machine-readable field names such as:

- `session_id`
- `prompt`
- `compaction`

CLI positionals should map into those names. MCP tool inputs should expose those same names.

### 3. Transport and hosting model

This task should ship **Streamable HTTP only** for the first increment.

Important implications:

- no stdio transport in this increment
- no separate sidecar process by default
- the MCP surface should be hosted by the existing Fastify-based mcpscope backend
- the server factory should still be cleanly separated from transport wiring, but only Streamable HTTP needs to be implemented now

### 4. Framework and stack

Use:

- Node.js + TypeScript
- `@modelcontextprotocol/sdk`
- Fastify

Do **not** add Express for this task.

### 5. Backend ownership of execution

The backend must own operation execution.

That means:

- MCP should call backend-owned operations directly
- backend-hosted MCP should not call the backend HTTP API over loopback for shared operations
- CLI remains a remote adapter over HTTP

If a top-level shared module remains, it should be limited to **contract-only** concerns such as:

- operation IDs
- shared field names
- schemas/types if still useful
- descriptions

It should **not** become the place where shared operations execute.

## Scope

### Backend operation layer

- define the backend-owned operation catalog for `list`, `create`, `send`, `status`, `inspect`
- centralize descriptions, canonical input schemas, validation rules, execution functions, and structured result shaping
- centralize backend error normalization
- normalize result field naming so the shared contract is consistent across all five operations

### CLI refactor

- refactor the CLI to consume the backend-owned contract instead of owning command semantics directly
- keep the current CLI command names and behavior stable
- keep `sessions list` as a CLI alias only
- keep text rendering as a CLI-only presentation concern

### MCP adapter

- add an MCP server factory using `@modelcontextprotocol/sdk`
- register one MCP tool per backend-owned operation
- derive tool descriptions and schemas from the same backend-owned source
- expose the same machine-readable results as the CLI JSON mode
- use real structured MCP tool output
- host the MCP interface through Streamable HTTP on the existing Fastify backend

### Testing

- add contract tests showing CLI and MCP use the same schemas
- add tests showing descriptions/tool metadata come from the same shared source
- add tests showing machine-readable results and error codes match across adapters
- add tests showing adapter-only flags do not leak into the shared operation schema
- add tests showing MCP results are structured, not text-only JSON blobs

### UI

- no major UI redesign is required for this increment

## Implementation plan

1. **Move operation ownership into the backend**
   - define the canonical operation catalog under the backend
   - move execution functions there
   - move canonical result shaping there
   - move backend error normalization there

2. **Reduce any top-level shared layer to contract-only concerns**
   - keep only what is truly neutral and non-executing
   - remove backend-calling execution functions from any root-level shared package

3. **Refactor the CLI into a thin adapter**
   - keep argv parsing, stdin handling, text rendering, exit codes
   - stop owning command semantics directly
   - consume the backend-owned contract cleanly

4. **Introduce the backend-native MCP server**
   - create one server factory from the backend-owned catalog
   - register the tools from shared metadata
   - expose shared schemas and handlers
   - return structured MCP results directly

5. **Add Streamable HTTP transport**
   - host the MCP interface through Fastify
   - keep transport wiring separate from server factory logic
   - keep transport configuration separate from tool parameters

6. **Add validation coverage**
   - contract tests for schema parity
   - tests for shared descriptions
   - tests for structured result parity
   - tests for shared error-code parity

7. **Update active docs**
   - document only the implemented MCP transport and tool surface
   - keep the backend-owned architecture rule explicit

## Acceptance criteria

- the first MCP increment exposes only `list`, `create`, `send`, `status`, and `inspect`
- each MCP tool is derived from the same backend-owned operation definition used by the CLI
- CLI and MCP share the same validation rules, defaults, descriptions, machine-readable success shapes, and machine-readable error codes
- result field naming is consistent across all five operations
- CLI-specific presentation flags and MCP transport settings are not part of the shared operation schema
- the MCP interface is hosted through Streamable HTTP on Fastify
- no Express dependency is introduced
- no backend loopback HTTP path is used for backend-hosted MCP operation execution
- any remaining top-level shared package is contract-only, not an execution layer

## Important design notes

- the MCP interface should help agents use mcpscope properly, not bypass it
- summary-first and detail-on-demand remain core design rules
- the MCP interface should be additive, not a replacement for the CLI
- CLI and MCP should be parallel access modes over one backend-owned operation layer
- the project should optimize for **zero semantic drift** between CLI and MCP
- this first increment is intentionally refactoring-first: the goal is a clean foundation we can build on, not a broad feature surface

## Expected result

After this task is designed and implemented:

- coding agents can use mcpscope through an MCP tool surface
- the backend clearly owns the canonical operation semantics
- CLI and MCP are backed by the same backend-owned operation definitions and execution paths
- each MCP tool corresponds exactly to one CLI command with the same parameters, defaults, validation, descriptions, and machine-readable results
- the MCP interface is delivered through Streamable HTTP on the existing Fastify-based backend
- the architecture remains clean enough to extend later with rename, batches, analysis-agent tools, and future surfaces without introducing a second operational core outside the backend
