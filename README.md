<p align="center">
  <img src="docs/design-assets/logo.png" alt="mcpscope" width="320" />
</p>

**A local-first workbench for developing, inspecting, and benchmarking MCP servers against local
(LM Studio, Ollama) or remote (OpenRouter) models — one shared workspace with a Web UI for you and
a CLI + MCP interface for your coding agent.**

Building a good MCP server is empirical work, and you rarely do it alone anymore: a coding agent
can run every benchmark and read every trace, but the numbers only get *good* when the developer
stays in the loop — looking at the one run that failed, tightening a tool description or a rubric,
deciding what to try next, and re-running. mcpscope is built for that partnership. It is not a
benchmark harness an agent runs unattended, and not a GUI a developer drives by hand: every
capability is exposed through a web UI shaped for a person and through a CLI and an MCP interface
shaped for an agent, all over one shared data model. The human can see exactly what the agent did,
the agent can inspect exactly what the human did, and a type-tagged ID system lets both point at
the same session, turn, or tool call.

Why that loop matters: an LLM is only as good as the tools it is given — a lesson I learned
building my own MCP servers for data analytics and statistics. My first versions did the obvious
thing: wrap the existing API and hand the raw data back to the model. That turned out to be the
worst possible design — token-hungry, imprecise, and dependent on a large model with a large
context window just to produce something useful. Results only became good when the server did the
work itself — the calculations, aggregation, and filtering — and returned answers rather than
data. That experience is the premise mcpscope is built on: a good MCP server is not an API
wrapper. It is a user interface built for an LLM, designed to solve a specific job efficiently
even on a small local model. And it is an application like any other, so it starts from clear use
cases and quality criteria, and most of ordinary software engineering applies when you design and
build it.

The part that does not carry over is testing. You cannot pin end-to-end behavior down with
deterministic assertions, because the model is non-deterministic and both its inputs and outputs
are mostly natural language. So, like the wider evaluation ecosystem, mcpscope measures quality
statistically — run a set of prompts many times against a chosen model and MCP server, then read
back per-tool reliability and token cost, with optional scoring of answer quality by a separate
judge model. What mcpscope adds is keeping that measurement *inside* the iteration loop rather
than at the end of it: every run stays inspectable down to each reasoning step, tool call, and
token of context, so "the score dropped" immediately becomes "look at what the model did here."

You run a prompt, or a repeatable benchmark, against a local (LM Studio, Ollama) or remote
(OpenRouter) model, watch every reasoning step, tool call, and token of context, then change one
thing (a tool description, a parameter, an output payload) and run it again. Everything stays on
your machine.

## Get started

**Prerequisite (2 minutes):** a running LLM backend — local
([LM Studio](https://lmstudio.ai), [Ollama](https://ollama.com)) or remote
([OpenRouter](https://openrouter.ai)). For LM Studio: open the **Developer** tab → **Start
server**, load a model, and note its model id — the server URL is `http://localhost:1234/v1`.

### Desktop app — the easiest way to try mcpscope

Download the installer for your OS from the
[**Releases page**](https://github.com/ffleurey/mcpscope/releases) (macOS `.dmg` — Apple
Silicon only, Windows `.exe`, Linux `AppImage`/`.deb`/`.rpm`). Everything is bundled — launch it and the workbench
opens; data lives in `~/.mcpscope`. While it runs it serves the same backend as `mcpscope serve`
at **`http://localhost:3066`** (MCP interface at `/mcp`), so coding agents and other MCP clients
can connect to it directly — set the `BACKEND_HOST` / `BACKEND_PORT` environment variables before
launching to change the address (shown in the app under **Configuration → Server**). The builds
are unsigned for now, so macOS Gatekeeper / Windows SmartScreen warn on first run.

### npm — for developing an MCP server (adds the CLI)

If you're building an MCP server you'll want the CLI (and the MCP interface for your coding
agent). Requires **Node.js 24+**:

```bash
npm install -g mcpscope
mcpscope serve
```

Or run it without installing: `npx mcpscope serve`.

`mcpscope serve` starts mcpscope at **`http://localhost:3066`** and opens it in your browser. Data
is stored in `~/.mcpscope`; stop with `Ctrl-C`. Flags: `--port <n>`, `--host <host>`,
`--data-dir <path>`, `--no-open`.

### First steps (either install)

1. In the Web UI, open **Configuration** and add an **LM connection** (the base URL above) and a **model config** (the model id you loaded), then set it as the default model. No MCP profile is needed to start — mcpscope ships zero-setup [companion MCP servers](COMPANIONS.md). Prefer editing a file? The same setup as JSON: [CONFIG.md](CONFIG.md).
2. Create a session, select a companion server (e.g. **Open-Meteo Weather**), send a prompt, and inspect the full trace: setup, tool definitions, reasoning, tool calls and results, and a color-coded context breakdown per turn.
3. Add an **MCP server profile** when you are ready to point mcpscope at your own server.
4. Define a **benchmark** and run it to test an MCP server repeatably across models — then hand the same loop to your coding agent.

The full walkthrough is in [TUTORIAL.md](TUTORIAL.md); the worked example with real numbers is
[EXAMPLE.md](EXAMPLE.md).

## For coding agents

mcpscope speaks MCP itself — connect your agent and it can drive the whole loop on the same
sessions you see in the UI:

```bash
claude mcp add --transport http mcpscope http://localhost:3066/mcp
```

```json
{ "mcpServers": { "mcpscope": { "type": "http", "url": "http://localhost:3066/mcp" } } }
```

Then a prompt like this is enough to put the agent to work:

> mcpscope is running at localhost:3066 (MCP at /mcp; the `mcpscope` CLI is the identical
> surface). Use its `mcpscope_*` tools to benchmark my MCP server: start with
> `mcpscope_list_mcp_profiles` and `mcpscope_list_model_configs`, create sessions and send
> prompts with `wait: true` so you never poll, and follow the loop in EXAMPLE.md.

Every operation is both a CLI command and an MCP tool (test-enforced parity), results are
snake_case JSON, and `create`/`send` take `wait` so agents get terminal results in one call.
Details: [MCP.md](MCP.md).

## Other ways to run

- **Docker**: a released image is published to GHCR. See [TUTORIAL.md](TUTORIAL.md) for the step-by-step path and [RELEASING.md](docs/RELEASING.md) for image tags.
- **From source**: for working on mcpscope itself, see [DEVELOPMENT.md](docs/DEVELOPMENT.md).

## What you can do

- **Inspect sessions**: watch how a model reads tool definitions, reasons, calls tools, and consumes the context window, with auditable token attribution per part.
- **Benchmark MCP servers**: a reusable suite of prompts run N× against a chosen model and MCP server, producing a per-tool error/usage scorecard and per-case reliability (pass@k / pass^k).
- **LLM-evaluate answer quality**: a separate judge model scores each run against a per-case rubric (see [BENCHMARK.md](BENCHMARK.md)).
- **Drive it from the shell or as MCP tools**: every operation is both a `mcpscope <cmd>` CLI command and a `mcpscope_<cmd>` MCP tool, so a coding agent can run the whole loop — on the same sessions you see in the UI.

## How it compares

Plenty of good tools touch parts of this space; the difference is which part of the loop they
serve, and who they keep in it.

- [MCP Inspector](https://github.com/modelcontextprotocol/inspector) pokes an MCP server at the protocol level — list tools, call them by hand. There is no model in the loop; mcpscope tests what a model actually *does* with your server.
- [mcpsnoop](https://github.com/kerlenton/mcpsnoop) captures real client↔server MCP traffic on the wire. mcpscope runs the model itself and attributes every token of context.
- [MCPJam](https://github.com/MCPJam/inspector) is the closest neighbor: an LLM playground with evals and traces. mcpscope differs on per-part token attribution, pass@k / pass^k reliability statistics, and the human+agent parity over one shared store.
- [promptfoo](https://github.com/promptfoo/promptfoo), [mcp-eval](https://github.com/lastmile-ai/mcp-eval), and [DeepEval](https://github.com/confident-ai/deepeval) are config- or code-driven eval harnesses, at their best as unattended regression gates in CI. mcpscope is the interactive workbench for the iteration loop *before* that — and exposes the same operations over CLI/MCP so an agent can drive it too.
- [MCPBench](https://github.com/modelscope/MCPBench), [MCP-Bench](https://github.com/Accenture/mcp-bench), and [MCPMark](https://github.com/eval-sys/mcpmark) benchmark *models* against fixed sets of servers. mcpscope benchmarks *your server* against the models you choose.
- [LM Studio](https://lmstudio.ai) and [Open WebUI](https://docs.openwebui.com) are chat interfaces with tool support — for the human only, with aggregate token counts at best. LM Studio is one of mcpscope's supported backends, not a competitor.

If one of these fits your workflow better, use it — several are excellent. mcpscope is for the
loop where you and your coding agent iterate on your own MCP server together.

## Documentation

### Getting started

- [TUTORIAL.md](TUTORIAL.md) - install, configure, run a session, and benchmark an MCP server
- [EXAMPLE.md](EXAMPLE.md) - the worked example: inspect → benchmark → change one thing → watch the metric move
- [CONFIG.md](CONFIG.md) - the `mcpscope.config.json` reference, including fully headless setup
- [COMPANIONS.md](COMPANIONS.md) - bundled zero-config companion MCP servers you can select without any setup
- [BENCHMARK.md](BENCHMARK.md) - benchmark suite/case/run model, deterministic metrics, and LLM rubric evaluation

### Interfaces

- [MCP.md](MCP.md) - MCP interface: transport, tool surface, and structured results
- [CLI.md](CLI.md) - CLI commands, flags, output format, and exit codes

### Internals & contributing

- [DEVELOPMENT.md](docs/DEVELOPMENT.md) - run from source, build, dev helpers, and repository notes
- [AGENTS.md](AGENTS.md) - guide for AI coding agents working on mcpscope itself: project shape, parity principle, working style, validation
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - system design, persistence, streaming, replay, and API surface
- [PROVIDERS.md](docs/PROVIDERS.md) - provider internals (LM Studio, Ollama, OpenRouter): reasoning tokens, token counting, context windows, model loading/unloading (incl. auto-swap)
- [DATA-MODEL.md](docs/DATA-MODEL.md) - canonical runtime tree, part taxonomy, and IDs
- [DATABASE-SCHEMA.md](docs/DATABASE-SCHEMA.md) - SQLite tables, foreign keys, and ER diagram
- [DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) - frontend design system: the tokens, primitives, and patterns that keep the GUI consistent
- [design-assets/](docs/design-assets/) - master logo SVGs (logo, mark, wordmark, favicon); see its README
- [TESTING.md](docs/TESTING.md) - test strategy, replay, and how to add regressions
- [RELEASING.md](docs/RELEASING.md) - tag-driven release workflow: npm publish, GHCR image, and desktop installers

Internal/contributor docs live under [`docs/`](docs/); user-facing guides stay at the repository root.
