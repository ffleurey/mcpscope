# AI Client App Project Brief

## Summary

This project is an experimental, local-first AI client for developing, testing, and evaluating MCP servers used with locally accessible SLMs. It is currently a personal project, so the initial implementation should optimize for simplicity, visibility, and iteration speed rather than production-grade hardening.

The application is **not intended to be a fully generic chat client for arbitrary MCP use cases**. Its purpose is more specific:

- evaluate how local models use MCP tools
- inspect and improve tool schemas and tool structure
- test how compact reasoning payloads and richer user-facing artifacts work together
- study how to use limited context windows effectively for data analysis tasks

The first reference domain is **historical statistics from Home Assistant**, but the application should be designed to generalize to other **data analysis, monitoring, telemetry, and time-series/event** use cases.

The application will use a **pure frontend architecture**: a Single Page Application (SPA) built with **Svelte + TypeScript + Vite** that communicates directly with:

- **LM Studio** for model inference and tool-calling
- **One or more MCP servers** for tool execution and artifact generation

There will be **no Node.js/Express middleman backend** in the initial architecture. If loading the app directly in the browser becomes inconvenient, it can be served by a simple local static server without changing that architectural principle.

## Product Identity

The first version should be treated as an **MCP evaluation client for data-analysis workflows**, not as a general assistant product.

This means the MVP should prioritize:

- visibility into model and tool behavior
- observability of prompts, tool calls, tool results, and context growth
- visual understanding of what occupies the LLM context window
- a plain chat workflow with strong inspection and debugging affordances
- fast experimentation with prompts, models, and MCP server behavior

The longer-term vision may evolve toward a more interactive, prompt-built dashboard experience, but the first version should stay focused on a **traditional chat workflow with collapsible tool traces**. Richer artifact rendering can be added incrementally as the MCP server begins returning images, HTML, CSV, or other attachments.

## Application Design

The application should behave like a traditional single-page chat application, but with stronger experiment management and observability than a consumer chat UI.

The core design model should be:

- **central configuration** for reusable model profiles and MCP server profiles
- **chat sessions** that select one model profile and optionally one MCP server profile
- **local-only persistence** for chats and configuration
- support for **multiple active chats**, even if only one chat is shown on screen at a time

Detailed runtime behavior, UI principles, and product guardrails are documented in `DESIGN.md`.

## Primary Goals

- Provide a lightweight environment for experimenting with MCP tool-calling
- Make tool calls and raw request/response payloads highly visible
- Establish the foundation for artifact-driven workflows without bloating the model context window
- Make context composition legible enough to spot oversized prompts, tool descriptions, or tool results quickly
- Allow quick configuration of models, prompts, and MCP endpoints
- Remain resilient during experimentation when services are misconfigured, offline, or unstable
- Help evaluate what makes an MCP server effective for local SLM-based statistical analysis

## Architecture

### 1. Frontend Client

**Stack:** Svelte + TypeScript + Vite

**Responsibilities:**

- Chat interface and conversation state
- Streaming communication with LM Studio
- MCP server connection management
- Tool-call logging and inspection
- Collapsible display of tool inputs and outputs
- Context monitoring and visualization
- Central configuration management for models and MCP servers
- Multi-chat session management
- Local persistence for conversations and settings
- Error reporting and retry flows
- Display of context size and token statistics when available

**Why Svelte:**

Svelte keeps the client lightweight and avoids unnecessary framework overhead. It is well suited to a highly interactive SPA with dynamic rendering requirements and a relatively small codebase.

The implementation should favor off-the-shelf Svelte components and lightweight libraries where they fit the requirements, while keeping the overall stack simple and easy to reason about.

### 2. AI Engine

**Primary engine:** LM Studio

**Initial runtime assumptions:**

- LM Studio is running locally
- It may provide access to remote-hosted models via LM Studio / LM Link while still exposing a local API surface
- The initial reference model is a variant of **Qwen3.6-35b-a3b**
- The frontend should treat the LM Studio base URL as **user-configurable**

**Integration model:**

- Use LM Studio's OpenAI-compatible API for the MVP
- LM Studio documentation examples assume a local base URL of `http://localhost:1234/v1`
- The actual port in a given environment may differ, so the app must not hardcode it
- Browser access requires appropriate local server and CORS configuration

**Model profiles:**

Model-related settings should be defined centrally as reusable profiles rather than configured separately in each chat.

A model profile should include at least:

- model selection
- system prompt
- temperature
- LM Studio base URL
- context window size

### 3. MCP Tool Servers

The app should support **multiple configured MCP servers**, even if the first concrete target is a custom **Home Assistant historical statistics MCP server**.

**Initial assumptions:**

- The first MCP server runs on `localhost:3001`
- Chats may run model-only or use **one active MCP server per chat**
- The browser client communicates with MCP servers over a browser-friendly transport
- **Streamable HTTP** is the current expected transport for the initial implementation
- The MCP server must be directly browser-accessible, including correct CORS behavior

**Future direction:**

- MCP servers may later run remotely
- Remote access can be handled behind **TLS**
- Access control can be added with **basic auth** or a **token**
- If a frontend-entered token is needed later, it may be stored locally (for example in `localStorage`) as an acceptable tradeoff for this project phase

**MCP server profiles:**

MCP server endpoints should also be configured centrally as reusable profiles.

For the MVP, each chat selects:

- exactly one model profile
- zero or one MCP server profile

## Domain Scope

The application should be optimized for **data analysis and statistical reasoning** rather than general-purpose assistant use.

The first implementation should work especially well for:

- historical time-series analysis
- aggregation and comparison over periods
- trend detection and anomaly inspection
- event/value correlation
- visual explanation of computed results

It should not be Home Assistant-specific in its architecture. The same client patterns should be reusable for:

- operational monitoring data
- telemetry
- sensor streams
- other event-based or time-series datasets

## Credentials and Security Posture

This is an experimental personal application, so security should be sensible but pragmatic.

**Current stance:**

- The **Home Assistant token will not be entered in the frontend**
- The Home Assistant token will live in the MCP server
- The frontend may store local configuration such as endpoints, preferences, saved chats, and possibly future remote MCP access tokens
- The project is **not** currently optimized for hardened secret storage on the client

## Artifact-Driven Workflow

The application should support an **artifact-driven MCP pattern** so large tool outputs do not unnecessarily inflate model context.

This is a core architectural direction, but **not all of it needs to ship in the first UI iteration**. The MVP can start with plain chat plus visible tool traces, then add richer artifact rendering as the MCP server begins returning those attachments.

The key design principle is to separate:

- **assistant-facing reasoning payloads** used by the model for analysis and response generation
- **user-facing renderable artifacts** used by the client for visualization, inspection, or download

The MCP server should do the heavy lifting, return a compact result for the model, and expose richer artifacts for the UI without forcing those artifacts into the LLM context window.

## Context Monitoring

Context monitoring is a **core MVP feature** because the main purpose of the application is to understand and improve context engineering for local SLM tool use.

The UI should make it easy to inspect not just the latest answer, but the **shape of the effective model context** over time.

### Context bar

The MVP should include a visual context bar that fills progressively and uses color-coded segments to show how the known context budget is being consumed.

Typical segments may include:

- system prompt
- conversation history
- tool descriptions / tool schemas
- tool call arguments
- tool results
- assistant answers
- other known model-visible payloads

This should help the user quickly see when, for example:

- tool descriptions are too large
- a tool result consumes too much of the budget
- conversation history is crowding out useful analysis context

### Measurement model

The UI should clearly distinguish between:

- **exact** measurements derived from known request payloads or returned usage data
- **estimated** measurements derived from local token counting or approximations
- **unknown / unavailable** portions that cannot be inspected precisely

This is especially important for model "thinking" or hidden reasoning, which may not be exposed by the API even if the model uses it internally.

The application should avoid pretending that hidden reasoning is fully observable if it is not.

### Intended flow

1. The user asks for analysis or data exploration.
2. The model decides to call a tool exposed by an MCP server.
3. The frontend sends that tool call to the selected MCP server.
4. The MCP server performs the heavy work and returns:
   - a compact reasoning payload for the model
   - a short textual summary for the chat history
   - one or more renderable artifacts for the user interface
5. The frontend:
   - preserves the compact reasoning payload in model-visible context
   - keeps the artifact outside the main LLM context when possible
   - initially exposes tool inputs and outputs in inspectable UI panels
   - later renders richer artifacts in the UI as support is added

### MCP framing

This should be implemented as a general MCP client pattern rather than a one-off tool convention.

The project should explicitly support the idea that tools may return:

- **structured content** for model reasoning
- **resource links** or **embedded resources** for user-facing artifacts
- MIME-typed outputs such as HTML, images, CSV, JSON, or other renderable/downloadable assets

The client should treat this as a generic artifact workflow, not as special handling for a single tool like historical analysis.

### Artifact contract

The client should be designed around a simple, explicit artifact contract so different MCP servers can participate consistently.

At a minimum, an artifact should carry enough information for the client to understand:

- what it is
- how it should be rendered or offered to the user
- whether it should be shown to the model, the user, or both

Typical artifact metadata may include:

- kind
- URI or embedded payload
- MIME type
- title or label
- optional summary or description

The first implementation should favor a small number of broadly useful artifact types such as:

- chart
- table
- image
- HTML fragment or document
- CSV or downloadable file

### Trust model

Generated HTML is considered **mostly trusted** because it is expected to come from the project's own experimental MCP server. The rendering path should still be designed carefully so this can evolve later if trust boundaries become stricter.

## Functional Requirements

### Chat and Session Management

- Run chat sessions against LM Studio
- Support multiple active chats
- Show one chat at a time in the main UI
- Preserve conversation context across retries when possible
- Persist conversations locally only
- Support plain-text export of conversations
- Allow old chats to be deleted
- Keep the first version focused on a straightforward chat flow
- Stream assistant output into the UI in real time

### MCP and Tooling

- Configure and manage multiple MCP server endpoints
- Allow zero or one MCP server per chat in the MVP (MCP is optional; model-only chats are fully supported)
- Make all tool calls visible in the UI
- Expose request/response details clearly for testing and debugging
- Show tool execution progress and failures in a user-friendly way
- Show tool inputs and outputs in collapsible boxes
- Prepare for generic artifact rendering based on resource metadata and MIME type rather than tool-specific hardcoding
- Distinguish clearly between model-facing outputs and user-facing artifacts as richer attachments are added

### Observability and Metrics

- Show context size and keep it updated as live as possible
- Show token and usage statistics whenever the model/backend provides them
- Make it easy to inspect what the model sent, what tool was called, and what came back
- Support evaluation of MCP quality through observable traces rather than opaque chat behavior
- Provide a color-coded context visualization showing which parts of the known context are consuming the budget
- Make clear which token measurements are exact, estimated, or unavailable
- Update visible assistant output and context monitoring in real time as data becomes available

### Error Handling

Robust error handling is a core requirement because experimentation will frequently involve:

- services not running
- wrong ports
- crashed servers
- CORS/configuration mistakes
- intermittent local setup issues

The UI should:

- clearly report connection and execution failures
- preserve as much conversation state as possible
- allow the user to retry without losing the whole session

## Evaluation Focus

The app exists to help evaluate MCP server design for local SLMs. The first version should make it easy to judge:

- whether the model selects the right tools
- whether tool descriptions and schemas guide the model effectively
- whether compact tool outputs are sufficient for good answers
- whether the overall workflow remains debuggable and reliable
- whether later-added artifacts improve user understanding without wasting context
- whether the context budget is being used efficiently across prompts, tool definitions, tool calls, and tool results

## Initial Reference Use Case

The first concrete use case is a **Home Assistant historical statistics MCP server** running locally and used to answer analysis questions over historical data.

This reference scenario should guide the MVP, but it should not lock the architecture to Home Assistant.

See **`USECASE-home-assistant-statistics.md`** for the first end-to-end use case definition.

## Initial Non-Goals

These items are intentionally out of scope for the first iteration:

- A dedicated backend orchestration service
- A fully generic MCP client for any domain
- Production-grade secret management
- Multi-user support
- Cloud sync
- Full product hardening for hostile or untrusted tool output
- A fully prompt-built dashboard UI

## Guiding Principle

This application should stay **simple, local, transparent, and easy to experiment with**. The first version should prioritize developer visibility and a strong MCP testing workflow over breadth, polish, or enterprise-grade architecture.
