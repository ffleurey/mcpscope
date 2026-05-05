# AI Client App Design

## Purpose

This document captures the current design of the AI Client App MVP.

It complements:

- `PROJECT.md` for project scope and product intent
- `USECASE-home-assistant-statistics.md` for the first concrete reference scenario

This document focuses on **how the application should work**.

## Design Goals

The MVP should be:

- simple to build and reason about
- highly observable
- optimized for MCP evaluation and context engineering
- local-first
- extensible without overengineering the first release

The application is **not** trying to be a fully generic assistant product in v1.

## Product Guardrails

The application should not drift into being just a generic chat UI with a context bar.

Its core value is as a **reproducible inspection and experimentation tool** for MCP-based local SLM workflows.

The following are non-negotiable requirements:

- capture enough raw runtime data to inspect what the client actually sent and received
- keep context accounting honest and explicit about exact, estimated, and unknown values
- preserve per-chat reproducibility through stable configuration and trace capture
- make failures, retries, and tool behavior visible rather than hiding them behind a smooth chat UI

If future features make the UI broader or more polished but weaken those properties, they are moving in the wrong direction.

## Application Shape

The application is a **single-page chat application** built with **Svelte + TypeScript + Vite**.

The MVP should feel like a traditional chat UI, but with much stronger inspection and experiment-management features.

Core characteristics:

- one visible chat at a time
- support for multiple active chats
- central reusable configuration
- local-only persistence
- real-time streaming and context updates

## Visual Design Principles

The visual design should be intentionally quiet and minimal.

The core philosophy is:

- dark mode by default
- dark grey background and light grey text
- minimal use of color in the core application UI
- no emojis
- no decorative icons in the MVP
- visual emphasis should come from structure and information, not ornament

The interface should feel closer to a subdued developer tool such as Zed or LM Studio than to a colorful consumer chat application.

### Use of color

Color should be used sparingly and mostly for semantic meaning, for example:

- context monitoring and context bar segments
- success, warning, and error states
- future rendered charts or other returned artifacts

The base UI for chat, configuration, navigation, and inspection should remain mostly neutral and monochrome.

### Visual hierarchy

Hierarchy should be created primarily through:

- spacing
- typography
- borders
- layout
- expansion and collapse behavior

The goal is for the application chrome to stay out of the way so the important runtime information stands out naturally.

### Styling approach

The implementation should minimize custom CSS and custom visual behavior on top of the chosen library/framework.

Prefer:

- off-the-shelf Svelte components where they fit
- default spacing and layout behavior from the component/library system where reasonable
- restrained theming over heavy custom styling

Avoid:

- decorative visual flourishes
- bespoke styling unless it is needed for clarity or function
- unnecessary divergence from the spacing and interaction model of the chosen component set

This should help keep the UI maintainable, predictable, and visually calm.

## Core Design Model

The app should be organized around three primary concepts:

1. **Model profiles**
2. **MCP server profiles**
3. **Chat sessions**

### Model profiles

Model profiles are centrally managed reusable configurations for LM Studio-backed models.

A model profile should contain at least:

- display name
- model identifier
- LM Studio base URL
- system prompt
- temperature

Possible future additions:

- max output tokens
- top-p or related sampling settings
- tags or notes for experiment grouping

### MCP server profiles

MCP server profiles are centrally managed reusable configurations for MCP endpoints.

An MCP server profile should contain at least:

- display name
- endpoint/base URL
- transport type
- optional auth or connection metadata for future use

For the MVP, the primary reference profile is the Home Assistant statistics MCP on `localhost:3001`.

### Chat sessions

Each chat session is a concrete experiment instance.

A chat session should reference:

- exactly one selected model profile
- exactly one selected MCP server profile
- conversation history
- tool trace history
- context accounting state
- chat metadata such as title, timestamps, and status

Each chat should be independently persisted and deletable.

## Proposed Snapshot Rule

For reproducibility, a chat session should likely store a **snapshot** of the selected model and MCP configuration at the time the chat starts or the first request is sent.

This avoids ambiguity when central profiles are edited later.

This is the preferred design direction, but should remain an explicit implementation decision until confirmed.

## UI Structure

The MVP UI should stay lightweight and conventional.

Suggested high-level layout:

1. **Sidebar**
   - chat list
   - create chat
   - delete chat
   - access to settings/configuration

2. **Main chat panel**
   - message timeline
   - streaming assistant output
   - user input box

3. **Inspection surfaces**
   - context bar
   - tool traces
   - collapsible tool input/output panels
   - request / response detail views where appropriate

The UI does not need to show multiple chats at once. A single visible chat is enough, even if other chats remain active.

## Real-Time Behavior

The application should update live as much as possible with the information available from the backend.

Real-time behaviors expected in the MVP:

- assistant output streams into the active chat view
- tool activity appears as it happens
- context visualization updates as known payloads change
- token and usage information is updated when returned

If some information is only known after a request completes, the UI should update as soon as that information becomes available.

## Chat Flow

The intended runtime flow for a normal chat turn is:

1. The user selects or creates a chat.
2. The chat is associated with one model profile and one MCP server profile.
3. The user sends a message.
4. The client builds the outbound model request.
5. The client updates context accounting from known request components.
6. The model streams output.
7. If the model invokes a tool, the client routes the tool call to the selected MCP server.
8. Tool inputs and outputs are shown in collapsible trace UI.
9. The resulting assistant output is rendered in the chat.
10. Usage and context information is updated as new exact or estimated values become available.

## Context Accounting Design

Context accounting is a core feature of the app.

The app should track the **effective client-visible model context** as accurately as possible from the data it controls or receives.

### Context bar

The context bar should visually represent the known context budget as color-coded segments.

Likely segment categories:

- system prompt
- conversation history
- tool descriptions / tool schemas
- tool call arguments
- tool results
- assistant responses
- other model-visible payloads

The context bar should make it easy to spot oversized components quickly.

### Measurement classes

Every token or context metric should be classified as one of:

- **exact**
- **estimated**
- **unknown**

#### Exact

Derived from:

- known request payloads
- returned usage data
- deterministic client-side measurements where trusted

#### Estimated

Derived from:

- local token approximation
- heuristics based on known payload structure

#### Unknown

Used when the app cannot reliably inspect or infer the data.

This is especially relevant for:

- hidden reasoning
- backend-internal prompt construction
- model/provider behavior not exposed through the API

### Source of truth

The primary source of truth for the context view should be:

- the exact payload the client sends to LM Studio
- the exact tool definitions and tool results seen by the client
- returned usage metadata when available

The app should not claim visibility into context elements it does not actually observe.

## Tool Trace Design

Tool usage must be highly visible.

For each tool interaction, the UI should show:

- tool name
- request timing/state
- tool call arguments
- tool result payload
- error state if relevant

The MVP should present tool inputs and outputs in **collapsible boxes** to keep the chat readable while still making the data easy to inspect.

## Artifact Support

The broader architecture should support artifact-driven workflows, but the first UI iteration does not need full artifact rendering yet.

### MVP behavior

In v1, the app should focus on:

- showing plain chat output
- showing tool traces clearly
- preserving room in the design for future artifact rendering

### Future behavior

Later versions may support rendering:

- charts
- tables
- images
- HTML
- CSV and downloadable files

Those future features should fit the same core separation:

- compact model-facing payloads
- richer user-facing artifacts

## Persistence Model

Persistence is local only.

The app should persist:

- model profiles
- MCP server profiles
- chat sessions
- message history
- tool traces
- context accounting data needed for inspection

The app should support:

- deleting old chats
- exporting a chat as plain text

Cloud sync and shared multi-user state are out of scope.

## Future Direction

Once the MVP foundations are stable, the app may grow beyond single-run chat inspection into more explicit experiment workflows.

A particularly important future direction is support for **repeatable experiment runs** so the same chat scenario can be executed multiple times to study model non-determinism and compare outcomes more rigorously.

That future direction should build on the same core foundations:

- reproducible per-chat configuration
- strong trace capture
- honest context accounting
- clear result inspection

It is a valuable extension, but it is **not part of the initial MVP scope**.

## Error Handling

The app should assume unstable local experimentation conditions.

Common failures include:

- LM Studio not running
- wrong LM Studio port
- MCP server not running
- wrong MCP endpoint
- CORS/configuration problems
- tool execution errors

The UI should:

- surface failures clearly
- preserve as much local chat state as possible
- allow retry flows without losing the whole conversation

## Multiple Active Chats

The MVP should support more than one active chat session, even though only one is displayed at a time.

This supports parallel experimentation and comparison across chats.

Open implementation questions remain around:

- whether hidden chats continue streaming in the background
- how aggressively background chats update their context/accounting views

## Reusable Components and Libraries

The implementation should prefer off-the-shelf Svelte components and lightweight libraries when they reduce boilerplate without adding unnecessary complexity.

Selection criteria should favor:

- low dependency weight
- clear APIs
- compatibility with Svelte + TypeScript + Vite
- easy styling/customization

## Non-Goals for the MVP

The design does not currently target:

- a backend orchestration service
- a fully generic assistant for arbitrary domains
- full artifact rendering from day one
- multi-user collaboration
- cloud persistence
- hardened production security
- a prompt-built dashboard UI

## Open Questions

The following questions remain worth deciding before or during implementation planning:

1. **Profile snapshot behavior**
   - should chats freeze a snapshot of selected profiles on creation, on first send, or always reference the latest central profile?

2. **Background chat execution**
   - should non-visible active chats continue streaming and updating normally in the background?

3. **Delete semantics**
   - should deleting a chat remove all associated traces and context accounting data as well?

4. **Token estimation implementation**
   - which tokenizer or estimation strategy should be used when exact backend usage is unavailable?

5. **Context bar granularity**
   - how fine-grained should segment breakdowns be in the MVP versus later versions?

## Current Recommendation

The cleanest MVP implementation path is:

- central profile management
- per-chat selection of one model and one MCP server
- local snapshot-oriented chat records
- streaming chat UI
- collapsible tool traces
- real-time context bar with exact/estimated/unknown accounting

This keeps the first version focused on the main product value: **understanding how MCP-based local SLM workflows actually use context and tools in practice**.
