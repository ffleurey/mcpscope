<p align="center">
  <img src="design-assets/logo.png" alt="mcpscope" width="320" />
</p>

An LLM is only as good as the tools it is given and the way you can work with it.

Most MCP servers today are thin wrappers around an existing API: generic, token-hungry, and
reliant on a large model with a large context window just to produce something useful. That wastes
the model and leaves most of its capability unused. A good MCP server is not an API wrapper. It is
a user interface built for an LLM, designed to solve a specific job efficiently even on a small
local model. It is also an application like any other, so it starts from clear use cases and
quality criteria, and most of ordinary software engineering applies when you design and build it.

The part that does not carry over is testing. You cannot pin end-to-end behavior down with
deterministic assertions, because the model is non-deterministic and both its inputs and outputs
are mostly natural language. So mcpscope measures quality with repeatable benchmarks rather than a
classical test suite: run a set of prompts many times against a chosen model and MCP server, then
read back per-tool reliability and token cost, with optional scoring of answer quality by a
separate judge model. Evaluation becomes statistical and observable instead of pass or fail.

Work like this is empirical, and you rarely do it alone anymore. A coding agent does much of the
heavy lifting, but it does not replace the developer: the best results come from a tight loop where
the developer steers and the agent executes. mcpscope is built for that partnership, not as a
benchmark an agent runs on its own, and not as a GUI a developer drives by hand. It offers the same
capabilities through three interfaces: a web UI shaped for a person, and a CLI and an MCP interface
shaped for an agent. All three run over one shared model, so the human can see exactly what the
agent did and the agent can inspect exactly what the human did, and a shared inspect path with a
type-tagged ID system lets both point at the same session, turn, or tool call.

You run a prompt, or a repeatable benchmark, against a local (LM Studio, Ollama) or remote
(OpenRouter) model, watch every reasoning step, tool call, and token of context, then change one
thing (a tool description, a parameter, an output payload) and run it again. Everything stays on
your machine.

## Install and run

Requires **Node.js 20+** and a running LLM backend, either local ([LM Studio](https://lmstudio.ai),
[Ollama](https://ollama.com)) or remote ([OpenRouter](https://openrouter.ai)).

```bash
npm install -g mcpscope
mcpscope serve
```

`mcpscope serve` starts mcpscope at **http://localhost:3030** and opens it in your browser. Data
is stored in `~/.mcpscope`; stop with `Ctrl-C`. Flags: `--port <n>`, `--host <host>`,
`--data-dir <path>`, `--no-open`.

## Other ways to run

- **Docker**: a released image is published to GHCR. See [TUTORIAL.md](TUTORIAL.md) for the step-by-step path and [RELEASING.md](RELEASING.md) for image tags.
- **From source**: for working on mcpscope itself, see [DEVELOPMENT.md](DEVELOPMENT.md).

## First steps

1. In the Web UI, open **Configuration** and add an **LM connection**, a **model config**, and an **MCP server profile**, then set a default model.
2. Create a session, send a prompt, and inspect the full trace: setup, tool definitions, reasoning, tool calls and results, and a color-coded context breakdown per turn.
3. Or define a **benchmark** and run it to test an MCP server repeatably across models.

The full walkthrough, including the CLI and a repeatable MCP-server testing loop, is in
[TUTORIAL.md](TUTORIAL.md).

## What you can do

- **Inspect sessions**: watch how a model reads tool definitions, reasons, calls tools, and consumes the context window, with auditable token attribution per part.
- **Benchmark MCP servers**: a reusable suite of prompts run N× against a chosen model and MCP server, producing a per-tool error/usage scorecard and per-case reliability (pass@k / pass^k).
- **LLM-evaluate answer quality**: a separate judge model scores each run against a per-case rubric (see [BENCHMARK.md](BENCHMARK.md)).
- **Drive it from the shell or as MCP tools**: every operation is both a `mcpscope <cmd>` CLI command and a `mcpscope_<cmd>` MCP tool, so coding agents can run the whole loop.

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
- [design-assets/](design-assets/) - master brand SVGs (logo, mark, wordmark, favicon); see its README
- [TESTING.md](TESTING.md) - test strategy, replay, and how to add regressions
- [RELEASING.md](RELEASING.md) - tag-driven release workflow and GHCR publishing
- [HISTORY.md](HISTORY.md) - chronological log of releases and major decisions
- [backlog/completed/SESSION-ANALYSIS.md](backlog/completed/SESSION-ANALYSIS.md) - the `session_analysis` workflow (also the engine behind benchmark evaluation)
