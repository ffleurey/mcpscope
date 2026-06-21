# mcpscope

**See exactly how a local LLM uses an MCP server** — every reasoning step, tool call, token, and
context-window byte. mcpscope is a local-first tool for developing and evaluating MCP servers with
local models (LM Studio, Ollama) or remote ones (OpenRouter), where context management matters most.

## Install and run

Requires **Node.js 20+** and a running LLM backend — local ([LM Studio](https://lmstudio.ai),
[Ollama](https://ollama.com)) or remote ([OpenRouter](https://openrouter.ai)).

```bash
npm install -g mcpscope
mcpscope serve
```

`mcpscope serve` starts mcpscope at **http://localhost:3030** and opens it in your browser. Data
is stored in `~/.mcpscope`; stop with `Ctrl-C`. Flags: `--port <n>`, `--host <host>`,
`--data-dir <path>`, `--no-open`.

## Other ways to run

- **Docker** — a released image is published to GHCR; see [TUTORIAL.md](TUTORIAL.md) for the step-by-step path and [RELEASING.md](RELEASING.md) for image tags.
- **From source** — for working on mcpscope itself, see [DEVELOPMENT.md](DEVELOPMENT.md).

## First steps

1. In the Web UI, open **Configuration** and add an **LM connection**, a **model config**, and an **MCP server profile**, then set a default model.
2. Create a session, send a prompt, and inspect the full trace — setup, tool definitions, reasoning, tool calls/results, and a color-coded context breakdown per turn.
3. Or define a **benchmark** and run it to test an MCP server repeatably across models.

The full walkthrough — including the CLI and a repeatable MCP-server testing loop — is in
[TUTORIAL.md](TUTORIAL.md).

## What you can do

- **Inspect sessions** — watch how a model reads tool definitions, reasons, calls tools, and consumes the context window, with auditable token attribution per part.
- **Benchmark MCP servers** — a reusable suite of prompts run N× against a chosen model + MCP server, producing a per-tool error/usage scorecard and per-case reliability (pass@k / pass^k).
- **LLM-evaluate answer quality** — a separate judge model scores each run against a per-case rubric (see [BENCHMARK.md](BENCHMARK.md)).
- **Drive it from the shell or as MCP tools** — every operation is both a `mcpscope <cmd>` CLI command and a `mcpscope_<cmd>` MCP tool, so coding agents can run the whole loop.

## Documentation

### Getting started

- [TUTORIAL.md](TUTORIAL.md) - install, configure, run a session, and benchmark an MCP server
- [case-study/USECASE-home-assistant-statistics.md](case-study/USECASE-home-assistant-statistics.md) - a concrete reference scenario and evaluation target
- [BENCHMARK.md](BENCHMARK.md) - benchmark suite/case/run model, deterministic metrics, and LLM rubric evaluation

### Interfaces

- [MCP.md](MCP.md) - MCP interface: transport, tool surface, and structured results
- [CLI.md](CLI.md) - CLI commands, flags, output format, and exit codes
- [PROVIDERS.md](PROVIDERS.md) - provider behavior (LM Studio, Ollama, OpenRouter): reasoning tokens, token counting, context windows

### Internals & contributing

- [DEVELOPMENT.md](DEVELOPMENT.md) - run from source, build, dev helpers, and repository notes
- [AGENTS.md](AGENTS.md) - guide for AI coding agents: project shape, parity principle, working style, validation
- [ARCHITECTURE.md](ARCHITECTURE.md) - system design, persistence, streaming, replay, and API surface
- [DATA-MODEL.md](DATA-MODEL.md) - canonical runtime tree, part taxonomy, and IDs
- [DATABASE-SCHEMA.md](DATABASE-SCHEMA.md) - SQLite tables, foreign keys, and ER diagram
- [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) - frontend design system: brand, tokens, primitives, patterns
- [TESTING.md](TESTING.md) - test strategy, replay, and how to add regressions
- [RELEASING.md](RELEASING.md) - tag-driven release workflow and GHCR publishing
- [HISTORY.md](HISTORY.md) - chronological log of releases and major decisions
- [backlog/completed/SESSION-ANALYSIS.md](backlog/completed/SESSION-ANALYSIS.md) - the `session_analysis` workflow (also the engine behind benchmark evaluation)
