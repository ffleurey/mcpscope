# Criteria / Ambition to release a V1

We want to release mcpscope as an opensource project.

For that we have to package what we can call a V1 with a simple and useful set of features.

> **Status (updated 2026-06-18).** Major progress since this was first drafted: the foundation
> was cleaned up (v1→v2 migration cruft removed, schema/IDs simplified — merged to `main`); a
> **design system** shipped ([DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md)); and the **benchmark**
> feature (suite/case/run) shipped for V1 across UI, CLI and MCP (PR #35 — see
> [BENCHMARK.md](../BENCHMARK.md) and [completed/benchmark-v1.md](completed/benchmark-v1.md)).
> The analysis direction was reframed to **benchmark-first**, with two analysis *modes* (guided +
> "skill") layered on later — see
> [candidates/v1-analysis-and-benchmark-plan.md](candidates/v1-analysis-and-benchmark-plan.md).
> The readiness summary at the bottom is current; the prose sections below are partly historical.
>
> **Update (2026-06-21).** LLM rubric **evaluation** shipped (a separate judge model layered on
> the benchmark — see [BENCHMARK.md](../BENCHMARK.md)) and the project was **released as v0.14.0**.
> **npm distribution** shipped: `npm i -g mcpscope && mcpscope serve` boots the bundled
> backend + UI ([improve-distribution.md](improve-distribution.md)). **Production-ready analysis
> modes (guided + "skill") are settled as post-V1** — they will be designed after we gain real
> experience from the shipped benchmark + LLM evaluation, which is the better way to get them
> right. With distribution done, the V1 *build* scope is complete; focus shifts to QA.

We target developers and ai enthusiasts who want to experiment with mcp servers and mcp server development. The core use-case is to allow experimenting with local AI models (LMStudio, Ollama) to help people understand how the context work and how the llm actually picks tools and call them. The reason I built mcpscope in the first place was that I felt that the built-in chat in LMStudio or other tools like OpenWebUI did not give me enough observability on the state of the context at all time. Working with local model with small context windows from 8k to 64k means that context management is very important.

## The MCP:Scope usecases

### Use Case 1: Education and manual evaluation of models and mcp servers

Target: Anyone that knows what an LLM and MCP server is and wants to experiment and see what is going on in terms of context below the chat interface.

Uses the Web UI exclusively: create sessions, send prompts, and inspect every part, tool description, tool call, and context bar through the GUI. Token counts, context window usage, and reasoning blocks are visible at a glance — no CLI or MCP involvement needed.

### Use Case 2: Development, testing and evaluation of mcp servers

Target: A developer developing or evaluating MCP servers and wanting to understand what the MCP server provides and evaluate how models are able to exploit it.

Builds on Use Case 1 by adding the CLI and MCP interface for ad-hoc inspection and analysis driven by coding agents, with or without the built-in analysis workflows. Combine agent-driven testing with manual GUI inspection in one loop.

### Use Case 3: Framework to build custom benchmarks and evaluation

Target: A developer who wants to implement specific evaluation strategies to benchmark models, mcp servers or combinations of both.

Builds on Use Case 1 + 2: developers extend the shipped analysis classes and workflow registry to create their own analysis strategies, then orchestrate them at scale with the benchmark container model and sequential scheduler for repeatable evaluation suites.

## V1 scope

UC1 and UC2 are in scope for V1. UC3 is out of scope: we should design and structure the code with UC3 in mind (extensible analysis classes, workflow registry, benchmark containers as building blocks), but V1 ships only the UI-, CLI-, and MCP-driven workflows covered by UC1 and UC2.

## Features and Gaps

### LLM Provider support

Support for Ollama with full streaming and reasoning like we have with LMStudio. Since Ollama and LMStudio are the most popular tools to run LLM locally it is good to have both in the V1. We have support for OpenRouter as well for remote LLM to complement but that is secondary and from tests it is not as easy to get the thinking and reasoning blocks. Being able to use bigger models for the analysis make sense and this is mostly where OpenRouter integration is useful. For the analysis, it is the result which is interesting, not the details of the session so the limitation in terms of observability does not matter. We could consider having also a standard OpenAI Connection option for other tools but we have to make sure that the standard part is enough for the basics.

### Session Analysis — reframed to benchmark-first

This was reframed after experience with the three test-framework strategies (`fullSession` /
`fastSession` / `fastTool`, none production-ready). The V1 direction is **benchmark-first**: the
benchmark suite/case/run feature (shipped — repeatable runs + per-tool/per-case deterministic
metrics) is the primary UC2 value. Session *analysis* would become two **modes** layered on the
existing workflow framework:

- a **guided** strategy (deterministic injection) to compensate for small/lazy models (e.g. Gemma-class), and
- a **"skill"** mode (prompt-guided) that lets a more capable model decide what to inspect via the `mcpscope_inspect` tools.

**Decision (2026-06-21): both modes are post-V1.** The three existing workflows (`fullSession` /
`fastSession` / `fastTool`) stay as the framework proof but are not the V1 analysis story. We
will design the production-ready guided + "skill" modes *after* gaining real experience from the
shipped benchmark + LLM evaluation — that experience is the best input for getting them right,
and the benchmark + judge already cover the UC2 quality story on their own. V1 does not claim a
polished session-analysis surface.

LLM-judged evaluation — a *separate* judge model, never self-judging — **shipped** (PR #38,
v0.14.0) as the success layer on top of the benchmark; it reuses the analysis workflow framework
(one judge session per run-session). See [BENCHMARK.md → Evaluation](../BENCHMARK.md#evaluation-llm-rubric-judging).
Full plan: [candidates/v1-analysis-and-benchmark-plan.md](candidates/v1-analysis-and-benchmark-plan.md);
evaluation research: [research/benchmark-success-criteria.md](research/benchmark-success-criteria.md).
The original two-strategy text is preserved in git history.

### Acceptable UI and Design — ✅ design system shipped

A dark, restrained design system shipped (the original goal as described below was met): neutral
greys for chrome, **amber** as the single accent, **green** for session data (80s CRT-phosphor
inspiration), a small token set, shared primitives (buttons, fields, dialogs via `DialogShell`,
`.data-table`, status pills/dots), MDI icons, and an amber oscilloscope favicon. Dialogs/modals
are consistent (shared shell, standardized action order). Rules, tokens, and a live in-app
reference are documented in [DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md). Remaining work is
incremental polish, not a V1 blocker.

### Explicit model and MCP profile selection from CLI and MCP

**Status: ✅ Implemented (PR #32).** The `mcpscope create` command and `mcpscope_create` MCP tool now accept `model_config_id` and `mcp_profile_ids` to override defaults. Two new list commands/tools expose available configs and profiles. See `CLI.md` and `MCP.md` for the full reference.

The original specification (preserved below) was shipped as described:

The `mcpscope create` command and `mcpscope_create` MCP tool currently accept a title and optional session ID and compaction strategy, but resolve the model config and MCP server profiles entirely from UI-configured defaults:

- the model config is always the configured default
- the MCP profiles are always the profiles with `defaultEnabled = true`

This is too restrictive for the Use Case 2 development workflow. A coding agent driving mcpscope through the CLI or MCP interface needs to be able to select different model configs and MCP profiles without going through the GUI. Concrete scenarios:

- *Test the same MCP server with different models* — create sessions with model configs for DeepSeek V4 Flash, Qwen 3.6, Gemma 4 4b, etc. to compare tool selection and reasoning quality under different models.
- *Compare two versions of an MCP server* — create sessions with the same model but different MCP server profiles pointing to different server instances or configurations, then compare traces.
- *Automated regression loops* — a script or agent runs the same prompt against multiple model+MCP combinations, inspects the results, and reports differences.

**Required change:** Add optional `model_config_id` and `mcp_profile_ids` parameters to the shared `create` operation in the backend catalog. When provided, these override the defaults. When omitted, the current default-resolving behavior is preserved. The parameters select from the existing pool of model configs and MCP server profiles — configuration remains GUI-only, selection becomes available everywhere.

The CLI flags would be:

- `--model-config <id>` — explicit model config ID
- `--mcp-profile <id>` — repeatable MCP profile ID (one per flag, e.g. `--mcp-profile ha --mcp-profile weather`)

The MCP tool inputs would be:

- `model_config_id` — optional string
- `mcp_profile_ids` — optional string array

Model config IDs and MCP profile IDs are visible through the UI and documented in existing model/MCP configuration surfaces.

**Required backend changes:**
- Accept optional `model_config_id` and `mcp_profile_ids` in the `create` operation input schema
- When `model_config_id` is present, use that model config instead of the default (validating it exists and the connection is reachable)
- When `mcp_profile_ids` is present, use those profiles (with `defaultEnabled` ignored) instead of the default-enabled set
- Preserve full backward compatibility when both are omitted

### Distribution and developer onboarding — ✅ `mcpscope serve` shipped

**Status: ✅ Implemented.** A `mcpscope serve` command boots the bundled backend in-process,
serves the pre-built frontend, creates a per-user data dir (`~/.mcpscope` by default), and opens
the browser — so the npm path is `npm install -g mcpscope && mcpscope serve`. Flags: `--port`,
`--host`, `--data-dir`, `--no-open`. The package ships the built artifacts (`files`:
`cli/dist`, `backend/dist`, `frontend/dist`) and runtime deps were corrected (Fastify moved to
`dependencies`). The only remaining step to publish to the public npm registry is flipping
`"private": true` and running `npm publish` (deliberately left as a conscious release action).

See [improve-distribution.md](improve-distribution.md) for the packaging-options analysis (npm,
SEA, Electron) — the recommended near-term npm/`serve` path is now done; SEA/Electron remain
optional future paths only if a single binary or desktop shell becomes a priority.

## What is already in place

### UC1 — Web UI

- Session creation, prompt sending, and listing via the chat UI with composer textarea and sidebar
- Turn rendering with collapsible rounds, reasoning blocks, tool calls, tool results, and assistant answers
- Part-level inspection (system prompt, MCP instructions, tool definitions, user/assistant/reasoning/tool-call parts) with token pills and payload viewers
- Context snapshot bars with color-coded token breakdown per part type and context window usage
- Session prelude block showing setup parts with full tool definition expansion
- Compaction step visibility in the timeline
- Trace export (download as JSON) and import (file picker upload with ID remapping)
- Analysis launch modal with workflow kind, model, temperature, tool scope, and evaluation criteria configuration
- Analysis workflow progress display (step labels, status, owned turns, artifacts)
- Scheduler status bar with running/idle/paused state, active job, pause/resume, and queue management
- Configuration management UI for LM connections, model configs, and MCP profiles

### UC2 — CLI and MCP

- Nineteen shared catalog operations, each exposed identically as a `mcpscope <id>` CLI command and a `mcpscope_<id>` MCP tool (Streamable HTTP) — seven core (`create`, `send`, `status`, `list`, `inspect`, `list_model_configs`, `list_mcp_profiles`) plus twelve `benchmark_*` ops (suite/case CRUD, run, status/report, evaluate, run_evaluations). Parity (CLI ids == MCP ids) is test-enforced; CLI has text and `--json` output with a polling automation loop. (The local `mcpscope serve` launcher is CLI-only, not a catalog op.)
- Benchmark suite/case/run via UI, CLI and MCP: define a reusable prompt suite, run it (N repetitions, chosen model/MCP), poll progress, and read a per-tool/per-case report (see [BENCHMARK.md](../BENCHMARK.md))
- Restricted analysis MCP endpoint at `/mcp/analysis` exposing read-only `inspect` + `status` for agent-driven evaluation
- Sequential scheduler with init/session/step job types, admission control, pause/resume, and SSE event stream consumed by the frontend
- Three shipped analysis workflow types (`fullSession`, `fastSession`, `fastTool`) with plan-based execution, idempotent artifact steps, retry, and progress tracking
- Trace bundle export and import via the backend API
- Docker multi-stage build, docker-compose single-service deployment, and GitHub Actions release pipeline to GHCR
- Replay harness for deterministic comparison of exported traces across model and MCP server changes

## V1 readiness summary

| Area | State | v1 Gap |
|---|---|---|
| Architecture & data model | ✅ Solid | None (foundation cleanup merged to `main`) |
| Provider support (LM Studio, OpenRouter, Ollama) | ✅ Complete | Minor: generic OpenAI-compatible option |
| Execution model & scheduler | ✅ Solid | None (explicit public step enqueue still deferred) |
| Session management (CRUD, lifecycle) | ✅ Complete | None |
| CLI + MCP surface (19 catalog ops, mirrored) | ✅ Complete | None — parity is test-enforced |
| **Benchmark (suite/case/run) via UI/CLI/MCP** | ✅ Shipped | None |
| **Benchmark LLM evaluation (judge model + rubric)** | ✅ Shipped (v0.14.0) | None |
| Docker packaging & tutorial | ✅ Complete | None |
| **npm distribution + `serve` command** | ✅ Shipped | None (publish = flip `private` + `npm publish`) |
| Replay harness & test infrastructure | ✅ Strong | None |
| Session analysis (guided / "skill" modes) | ⏸ Post-V1 | Settled post-V1 — design after benchmark+eval experience |
| **UI design & polish** | ✅ Design system shipped | Incremental polish only |
| Model/MCP selection on CLI and MCP | ✅ Complete | None |
| Trace export/import | ✅ Complete | None |
| Configuration management | ✅ Complete | None |
