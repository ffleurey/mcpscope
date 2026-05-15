# CLI for LLM-in-the-Loop Testing

mcpscope should expose a **CLI-first interface** for automated LLM-in-the-loop testing of MCP servers.

The primary user of this CLI is **a coding agent or a script**, not an end user. The CLI is the non-interactive companion to the mcpscope UI: the UI is optimized for visual inspection by a human, while the CLI is optimized for low-token, structured inspection by an agent.

## Goal

Allow a coding agent or test script to run MCP evaluation sessions against a selected model and MCP server, inspect only the relevant parts of the trace, and iterate quickly on prompts, tool descriptions, and schemas.

## Prerequisite

Before implementing the CLI itself, mcpscope should first complete **`hierachical-ids-system-and-api.md`**.

That task establishes:

- the canonical hierarchical ID format
- generic lookup by hierarchical ID
- summary-mode navigation across sessions, turns, rounds, and parts
- UI visibility and copyability of IDs

The CLI should build on top of those primitives rather than inventing them at the same time.

The CLI should make it easy to answer questions like:

- which tools were called in this turn?
- what happened in round 2?
- show me the reasoning block before this tool call
- how many tokens were used in this round?
- replay this session after changing the tool descriptions

## Direction

The CLI should be a standalone tool called **`mcpscope-cli`**.

It should use the **same backend, same database, and same session model as the UI**.

That means:

- a session created in the UI can be inspected from the CLI
- a session created from the CLI can be opened in the UI
- both human and agent refer to the same sessions, turns, rounds, and parts

This shared workspace is important. It avoids copy/paste, repeated explanations, and full transcript dumps. When the human says "look at session `test5`, round `2`", the agent should be able to inspect exactly that object in the CLI.

## General architecture

The preferred architecture is:

1. **one shared backend and persistence layer**
2. **one Web UI client**
3. **one standalone CLI client (`mcpscope-cli`)**

The CLI should talk to the mcpscope backend API rather than reading the database directly.

This keeps the UI and CLI aligned on:

- session lifecycle
- validation rules
- initialization behavior
- IDs and state transitions
- replay and inspection semantics

It also makes deployment simpler:

- mcpscope can run natively or in Docker
- the CLI can connect to the same running backend in either setup
- the shared workspace model remains the same

## API strategy

The CLI should be based on the **existing API used by the Web UI** wherever that fits.

That is the default direction because it pushes consistency between UI and CLI and avoids duplicate business logic.

At the same time, the CLI has different needs from the UI:

- it needs smaller, more targeted payloads
- it should avoid loading full sessions when only one turn, round, or part is needed
- it needs better support for polling, following, and machine-readable summaries

Because of that, it is acceptable and expected to add a **small number of CLI-friendly API endpoints** where the current API is too coarse.

Examples of likely useful additions:

- fetch one turn by ID
- fetch one round by ID
- fetch one part by ID
- fetch compact status/progress for a running turn
- stream progress events for a running turn

The important architectural rule is:

- **shared backend behavior**
- **shared persisted model**
- **mostly shared API**
- **plus a few targeted endpoints when needed for efficient CLI access**

The CLI may still load a larger object and present it in smaller chunks when that is acceptable, but we should not force the CLI to fetch full sessions if a better API shape is easy to provide.

## Authentication

Authentication is out of scope for the first version of this feature.

For now, the CLI assumes it can reach the mcpscope backend. Auth can be added later if needed and should be treated as a separate concern from the CLI interaction model itself.

## Why CLI

CLI is the best primary interface for this feature because it fits the inner development loop:

- low token overhead
- easy to script and automate
- natural for coding agents
- works well in CI and local testing workflows

The CLI should be inspired by tools such as `agent-browser`: small commands, stable IDs, concise output, and targeted follow-up inspection.

## Core model

The CLI should expose the same hierarchy as the UI:

- session
- turn
- round
- part

Default output should be **summary first**, with deeper inspection available on demand. The goal is not to dump the full session JSON, but to let the agent progressively inspect only what it needs.

Examples of the kind of operations the CLI should support:

- create a session
- run a turn in an existing session
- list turns for a session
- list rounds for a turn
- list parts for a round
- inspect one specific part
- summarize tools called in a turn or round
- show token usage at session / turn / round / part level
- replay or compare an existing session

## Canonical IDs

The CLI and UI should share a **single canonical ID scheme** for sessions, turns, rounds, and parts.

The main requirement is that an ID should be:

- easy to read and type
- unambiguous
- stable across UI and CLI
- enough on its own to identify both the object and its parent chain

A hierarchical format is a good fit. For example:

- `SSS` for a session
- `SSS.T` for a turn
- `SSS.T.R` for a round
- `SSS.T.R.P` for a part

This kind of segmented ID has two advantages:

1. the number of segments tells us the object type immediately
2. the ancestry is always visible, so there is never ambiguity about what a round or part belongs to

The exact textual format can still be refined, but the important direction is:

- **hierarchical**
- **shared between UI and CLI**
- **used everywhere in commands and outputs**

This is especially valuable for human-agent collaboration. A human can say "look at `test5.2.1.3`" and the coding agent can inspect exactly that part without needing any extra context.

## Long-running execution and progress

Running a turn or round can take an unpredictable amount of time. Coding agents are often poor at waiting patiently, so the CLI should not assume blocking, synchronous workflows for long-running operations.

The design should support:

- **non-blocking start** for long-running work
- **stable run/session IDs** that can be checked later
- **agent-friendly progress inspection**
- **incremental visibility** into what has already happened

In practice, long-running commands should behave more like job submission plus inspection than like a single blocking request/response.

The CLI should support operations such as:

- start a turn and return immediately with its ID
- check status for a session / turn / round
- follow progress in a compact way
- inspect partial results while execution is still in progress

The progress output should be concise and useful for agents, for example:

- current status (`pending`, `running`, `done`, `failed`)
- current turn / round
- tools already called
- tokens consumed so far
- latest part produced

This matters for both automation and collaboration:

- a coding agent can launch a run and poll or follow progress without timing out mentally
- a human can open the same session in the UI while the run is still in progress
- both can inspect partial results before the full session completes

## Error handling and initialization behavior

Error handling should be explicit and agent-friendly. There is nothing more wasteful than a coding agent retrying a command that cannot succeed because a dependency is not ready.

The CLI should clearly distinguish between:

- **initialization failures**: something required to start the session is not available or not valid
- **runtime failures**: the session started correctly, but something failed later during execution

For the first version of the CLI, configuration of MCP connections, LM Studio integration, and model setup will continue to happen outside the CLI, using the same inputs and behavior as the UI.

Because of that, **session creation should be synchronous and blocking**.

`create session` should:

1. validate the requested inputs
2. attempt to initialize the session with the configured MCP and LLM dependencies
3. fail immediately if initialization cannot complete

If initialization fails:

- the CLI should return a clear, specific error message
- the command should exit with failure
- the session should **not** remain in the database in a dead or half-created state

This is important because a failure such as "LM Studio not reachable", "MCP server unavailable", or "model not configured" is not something an agent should blindly retry. The error should tell the agent what is wrong so it can stop and report the real issue.

Once a session is successfully created, later long-running operations such as running turns or rounds can use the non-blocking execution model described above.

Good error reporting should aim to tell the agent:

- what failed
- at which stage it failed
- whether retrying makes sense
- what dependency or configuration appears to be missing

In machine-readable mode, errors should be structured and include at least:

- `code`
- `stage`
- `retryable`
- `suggestion`

The UI should follow the same rule. A failed initialization should not leave behind a dead session that must be manually cleaned up.

## Output contract

The CLI should have a stable machine-readable output contract. The structured output is effectively an API for coding agents and scripts.

All commands should support a common format flag:

- `--format text`
- `--format json`
- `--format stream-json`

Rules:

- in `json` mode, stdout contains a single JSON object or array
- in `stream-json` mode, stdout contains NDJSON events, one JSON object per line
- in structured modes, stdout must never mix plain text with JSON
- logs, warnings, and progress messages go to stderr
- all structured outputs include an `api_version`

Human-readable text output can evolve. Structured output should be treated as stable.

## Standard non-interactive flags

The CLI should explicitly support non-interactive and automation-friendly flags:

- `--no-input`
- `--yes`
- `--quiet`
- `--fields`
- `--limit`
- `--timeout`
- `--async`
- `--follow`
- `--dry-run`

When stdout is not a TTY, or when running in CI, the CLI should behave as non-interactive by default and should not display prompts, pagers, or ANSI-dependent progress output.

## Exit codes

The CLI should document stable exit codes so agents can branch correctly on failures.

Recommended minimum set:

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | general error |
| 2 | usage error |
| 3 | initialization/dependency failure |
| 4 | runtime failure after successful start |
| 5 | timeout / partial / interrupted waiting |
| 130 | interrupted by SIGINT |

Initialization failures should use a distinct exit code because they are often non-retryable.

## Long-running command model

The CLI should distinguish clearly between:

- **start**: begin work and return immediately
- **status**: return the current snapshot immediately
- **follow**: block and stream progress until a terminal state
- **wait**: block silently until a terminal state
- **cancel**: explicitly stop a running turn or round

This should apply in particular to turns, and later to any other long-running operation.

The follow/stream path should be agent-friendly and compact, with events containing:

- object ID
- status
- current round
- latest part ID
- tools called so far
- tokens used so far
- elapsed time

## Determinism and script safety

The CLI should be safe to script against.

- structured outputs are the stable contract
- human-readable outputs are not for scripts
- commands should validate eagerly, even in async mode
- validation failures should be reported synchronously
- interrupted runs should not remain stuck forever in `running`
- default list output must stay compact

This matters both for CI and for coding agents operating in a tight context budget.

## Main use cases

### 1. Agent-first automated test

A script or coding agent runs a prompt or test case, checks the resulting tool calls and answer summary, and only drills deeper when something looks wrong.

This is the primary use case for CI, regression testing, prompt-suite execution, and iterative tuning.

### 2. Human starts in UI, agent continues in CLI

A human explores a session visually in the UI, notices a suspicious tool call or reasoning step, and asks the coding agent to inspect that exact session / round / part through the CLI.

### 3. Agent starts in CLI, human reviews in UI

A coding agent runs many experiments through the CLI, stores the sessions, and the human later opens the interesting ones in the UI for visual review.

### 4. Human-agent collaborative debugging

The human and the coding agent discuss the same canonical session objects. The UI gives the human clear visual navigation; the CLI gives the agent precise, low-token access to the same trace structure.

This is especially important because LLM-based evaluation is imperfect. mcpscope should support collaboration between human judgment and agent-driven automation rather than relying entirely on one or the other.

## Design principles

- **CLI-first for automation**
- **standalone `mcpscope-cli` client**
- **shared backend and persisted model with the UI**
- **shared DB and shared session model with the UI**
- **reuse the existing API by default**
- **add a few targeted API endpoints where CLI needs finer-grained access**
- **summary-first, detail-on-demand**
- **stable IDs for session / turn / round / part**
- **hierarchical IDs with visible parentage**
- **non-blocking execution for long-running work**
- **progress inspection that is compact and agent-friendly**
- **clear synchronous failure for session initialization**
- **no dead or half-created sessions after initialization failure**
- **errors that help an agent stop retrying when retry will not help**
- **stable structured output contract for scripts**
- **strict stdout/stderr separation in machine-readable modes**
- **explicit non-interactive behavior in agent and CI contexts**
- **documented exit codes for branching**
- **field-selectable and size-bounded list output**
- **eager validation before async submission**
- **machine-readable output for scripting**
- **no mandatory full transcript dumps**
