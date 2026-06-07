# Criteria / Ambition to release a V1

We want to release mcpscope as an opensource project.

For that we have to package what we can call a V1 with a simple and useful set of features.

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

### Session Analysis

We need to ship V1 with a couple of different analysis strategies which can be used out of the box. Currently we have 3 different ones which have mostly been created to test the framework. None of them is really good and efficient, they need more work. Ideally I would like to propose 2 options. The first one targeted at small models like 'Gemma 4 e4b' which requires a deterministic step by step analysis along the lines of what we have implemented where we inject the exact content to be analysed automatically and provide full guidance. The second one targeting more "autonomous" models like "deepseek-v4-flash" and maybe some locally running version of Qwen 3.6. With those models we would like to provide less guidance and have them use more autonomously the mcp tools to decide and inspect the relevant parts without being forced to inspect everything. This should take advantage of their stronger abilities to still get good analysis but quicker and more efficiently.

### Acceptable UI and Design

The UI is very basic at this point, no effort has been put in it. It works but visually we should do some improvements and we should choose a color palette and make a basic icon. for the colors we will go with a dark mode, some shades of grey and amber and green as the main colors (colors of text CRT monitors of the 80s). We should try to make sure that we use a few colors consistently so that we do not run into advanced design issues. We need the readability to be good and the user experience to be efficient. We are not trying to be fancy and should use the underlying libs as much as possible to avoid too much custom CSS and alike. We need to do something about the dialogs and modals to make them consistent and decent looking. It is not the case for now but that should not be too hard to fix.

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

- Five CLI commands (`create`, `send`, `status`, `list`, `inspect`) with text and `--json` output, polling-based automation loop
- Five matching MCP tools (`mcpscope_create`, `mcpscope_send`, `mcpscope_status`, `mcpscope_list`, `mcpscope_inspect`) over Streamable HTTP — shared operation catalog enforces parity
- Restricted analysis MCP endpoint at `/mcp/analysis` exposing read-only `inspect` + `status` for agent-driven evaluation
- Sequential scheduler with init/session/step job types, admission control, pause/resume, and SSE event stream consumed by the frontend
- Three shipped analysis workflow types (`fullSession`, `fastSession`, `fastTool`) with plan-based execution, idempotent artifact steps, retry, and progress tracking
- Trace bundle export and import via the backend API
- Docker multi-stage build, docker-compose single-service deployment, and GitHub Actions release pipeline to GHCR
- Replay harness for deterministic comparison of exported traces across model and MCP server changes