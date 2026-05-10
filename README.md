# AI Client App

A local-first AI chat SPA for evaluating MCP-based workflows with local language models.

## What it is

A developer tool for running and inspecting LLM + MCP tool sessions locally. The core value is **context transparency**: the app tracks exactly what is in the model's context window at every turn, segment by segment, with precise token counts derived directly from API data.

Built with: Svelte 5 · TypeScript · Vite · IndexedDB

## What it connects to

- **LM Studio** — local LLM runtime (OpenAI-compatible API, streaming, extended thinking support)
- **MCP servers** — tool servers over Streamable HTTP transport (e.g. Home Assistant statistics)

## Key features

- Real-time streaming chat with reasoning/thinking support
- Multi-round tool call execution with full trace visibility
- **Context bar** — color-coded segment-by-segment view of exactly what is in the model's context window, updated live during each turn
- Per-message token statistics (prompt, completion, reasoning tokens, generation speed)
- Configurable model profiles (system prompt, temperature, reasoning mode)
- Multiple MCP server profiles, optional per chat
- Full diagnostic export (JSON dump of chat with all token data for offline analysis)
- Local-only persistence via IndexedDB, no backend required

## Context accounting principles

The app tracks every token with a clear provenance:

- **System prompt and tool definitions** — probed via API at session start (exact)
- **User messages** — back-calculated from API `promptTokens` deltas (exact for simple turns; char/4 estimate for turns following tool-calling turns)
- **Tool calls and results (tc+tr)** — computed from per-round `promptTokens` deltas; when the next turn arrives, corrected to the exact historical cost using LM Studio's feedback
- **Assistant content** — from API `completionTokens - reasoningTokens` (exact for simple turns)
- **Reasoning/thinking** — shown while in context; stripped from historical turns
- No permanent character-count estimates remain once API data is available

## Setup

```
npm install
npm run dev
```

Configure LM Studio connections and model profiles in the sidebar settings. Optionally add MCP server profiles to enable tool use.

## Diagnostics

The chat export button (in the chat header) dumps the full session as JSON including all token breakdowns per message and tool round. The `exports/` folder contains scripts to analyse exported files:

```
node exports/analyze.js exports/your-export.json
node exports/plot.js exports/your-export.json  # generates an HTML chart
```

