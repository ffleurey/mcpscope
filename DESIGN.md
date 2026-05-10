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
- context window size in tokens

The context window value may be:

- auto-detected from model metadata when available
- manually entered or overridden when auto-detection is missing or unreliable

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

### Transport and browser integration

The MVP should target the **current MCP Streamable HTTP transport** for browser-based MCP communication.

Older SSE-based MCP transport should be treated as legacy compatibility, not the primary design target.

Implementation preference:

- prefer the official `@modelcontextprotocol/sdk` if it works cleanly in the browser for the targeted transport
- if browser support in the SDK is not sufficient, implement a minimal browser MCP client for the needed MVP operations rather than introducing a backend proxy

The MVP should remain aligned with the pure-frontend architecture.

### CORS responsibility

Because the application is a browser SPA, the selected MCP server must support browser access correctly.

That means the MCP server is responsible for:

- returning the required CORS headers
- handling browser preflight requests where needed
- allowing the app origin used in development and local deployment

If the MCP server cannot be called directly from the browser, the pure-frontend assumption is broken.

For the MVP, the design assumption is:

- **no local proxy**
- the MCP server must be browser-accessible directly

### Chat sessions

Each chat session is a concrete experiment instance.

A chat session should reference:

- exactly one selected model profile
- zero or one selected MCP server profile
- conversation history
- tool trace history
- context accounting state
- chat metadata such as title, timestamps, and status

Each chat should be independently persisted and deletable.

## Proposed Snapshot Rule

For reproducibility, a chat session should store a **snapshot** of the selected model and MCP configuration at the time the **first request is sent**.

This avoids ambiguity when central profiles are edited later.

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
2. The chat is associated with one model profile and optionally one MCP server profile.
3. The user sends a message.
4. The client builds the outbound model request.
5. The client updates context accounting from known request components.
6. The model streams output.
7. If the model invokes a tool, the client accumulates streamed tool-call data until the call is complete, then routes the completed tool call to the selected MCP server.
8. Tool inputs and outputs are shown in collapsible trace UI.
9. The resulting assistant output is rendered in the chat.
10. Usage and context information is updated as new exact or estimated values become available.

### Tool execution semantics

Model-only chats remain valid even after MCP support is added.

For MCP-enabled chats in the MVP:

- a chat may use zero or one MCP server profile
- a model response may contain multiple tool calls in one turn
- multiple tool calls from one turn should be executed **sequentially in the order received**
- true parallel tool execution is not required for the MVP

This keeps the execution model simple while still supporting batched tool usage.

## Context Accounting Design

Context accounting is a core feature of the app.

The app should track the **effective client-visible model context** as accurately as possible from the data it controls or receives.

### Architectural principle

The app sends every token to LM Studio — it is fully in control of what is in the context. There is no need to guess or re-derive context composition. The correct approach is to attach token counts directly to the data structures that represent context elements, and derive the context bar from those attached counts with no additional logic.

The single source of truth is `rebuildContextSegments()` in `chatStore.ts`. This function reads directly from the `messages[]` array in the store and produces the `activeContextSegments` list that `ContextBar.svelte` renders. The context bar is a pure renderer — it contains no token-counting logic.

`rebuildContextSegments()` is called whenever the store changes: at session load, after each API call that returns token data, and during live streaming.

### Context bar

The context bar visually represents the known context budget as color-coded segments.

Its total length is based on the selected chat model profile's configured context window size.

Segment categories:

- system prompt (`sys`)
- tool definitions (`tool-definitions`)
- user message (`user`)
- assistant response (`assistant`)
- reasoning / thinking (`thinking`)
- tool calls (`tool-call`)
- tool results (`tool-result`)

### Token provenance

Every token count has a clear provenance. The accounting uses API-derived data as far as possible, with estimates only as temporary values until the actual data arrives.

| Segment | How measured | When exact |
| --- | --- | --- |
| System prompt | API probe at session start (`probeSystemPromptTokens`) | Immediately |
| Tool definitions | API probe at session start (`probeToolDefinitionsTokens`) | Immediately |
| User messages (simple turns) | Back-calculated from `promptTokens` delta: `PT[current] - PT[previous] - systemPromptTokens - toolDefinitionsTokens - all prior message tokens` | When current PT is returned |
| User messages (after tool-calling turn) | `char/4` approximation (consistent with `historicalPayloadTokens` definition so bar total remains exact) | Approximate only |
| Assistant response (simple turn) | `completionTokens - reasoningTokens` from usage | When completion returns |
| Reasoning / thinking (simple turn) | `reasoningTokens` from usage | When completion returns |
| Tool calls + results + assistant content (tool-calling turn) | Covered by `historicalPayloadTokens`; split proportionally within for display | When next turn's PT arrives |
| `historicalPayloadTokens` (tool-calling turn total) | `nextTurnFirstPT - prevRound0PT - char4(nextUserContent)` | When next turn starts |
| Live streaming thinking | `char / 3.5` estimate | Replaced when completion returns |

### Reasoning stripping policy

The model requires reasoning to be available across tool-call rounds within a single turn (it uses its intermediate chain of thought when deciding the next tool call). After the final answer is produced, reasoning is no longer needed in the context and would waste tokens.

Policy:

- **Within a live turn** (tool rounds in progress): reasoning is kept and sent as `reasoning_content` to the next tool-call sub-turn
- **Historical turns** (all turns except the current live one): all reasoning is stripped when building `buildBaseApiMessages()`. This applies to both intermediate reasoning between tool rounds and the reasoning attached to the final answer

The context bar reflects this: reasoning appears for the most recent completed turn (it was in context when that turn was produced), then disappears when the next message is sent.

### Tool-calling turns and `historicalPayloadTokens`

For turns that involve tool calls, the live per-round PT deltas give a slightly higher cost than the historical reconstruction, because:

- The live prompt includes thinking-block delimiter tokens that are NOT present in the historical reconstruction (which strips all `reasoning_content`)
- `completionTokens - reasoningTokens` from LM Studio includes format/delimiter overhead tokens not stored in `content`

Rather than trying to correct these individual values, we derive the total historical cost of the entire tool-calling turn from the next turn's `promptTokens`:

```
historicalPayloadTokens = nextTurnFirstPT - prevRound0PT - char4(nextUserContent)
```

This makes the bar total match LM Studio's `promptTokens` exactly for the next turn. The tc+tr segments are then split proportionally for display, but their total is exact.

### Intentional approximations (not errors)

These are by-construction approximations that cannot be made exact without additional API calls:

1. **tc+tr visual split within a round** — the total is exact, but dividing it between tool-call and tool-result tokens uses length ratios (display only, total is accurate)
2. **User messages after a tool-calling turn** — `char/4`, because the `historicalPayloadTokens` definition absorbs the full cost of the prior turn; the next turn's bar total is still exact by construction
3. **Legacy messages without `toolRounds`** — historical messages loaded from DB before this accounting was implemented; irrecoverable, char/4 used

### No permanent estimates

The original design allowed for permanent char-based estimates at several points. These have been eliminated. The only char-based values that remain are:

- The `char/3.5` estimate used during live thinking streaming — replaced by actual `reasoningTokens` when the completion returns
- The `char/4` for user messages after tool-calling turns — a structural approximation, not an accumulating error, because the bar total is corrected by `historicalPayloadTokens`

### Source of truth

The primary source of truth for the context view is:

- the exact payload the client sends to LM Studio (we build it, we know its contents)
- API usage data returned by LM Studio (`promptTokens`, `completionTokens`, `reasoningTokens`)
- session-level probes for system prompt and tool definition token counts
- `historicalPayloadTokens` derived from consecutive PT values

The app does not claim visibility into context elements it does not observe. Where approximations are necessary they are clearly bounded and do not accumulate over a session.

## Tool Trace Design

Tool usage must be highly visible.

For each tool interaction, the UI should show:

- tool name
- request timing/state
- tool call arguments
- tool result payload
- error state if relevant

The MVP should present tool inputs and outputs in **collapsible boxes** to keep the chat readable while still making the data easy to inspect.

Connection testing and tool discovery should use the real MCP protocol path for the targeted transport:

- initialize
- tools/list

That means Increment 1 includes a minimal but real MCP client layer rather than a simple HTTP ping.

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

The primary storage technology for chats, traces, and context data should be **IndexedDB**.

`localStorage` may still be used for very small UI preferences if useful, but it should not be the primary storage layer for chat data.

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

Deleting a chat should remove its associated local traces, snapshots, and context accounting data as part of the same operation.

For the MVP, plain-text export should include:

- timestamps
- user and assistant messages
- selected model and MCP profile names
- a concise tool trace summary

It does not need to include full raw JSON payloads by default.

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

### Retry semantics

For the MVP, retry should mean rerunning the last failed turn from the last committed chat state before that turn began.

This implies:

- the failed attempt remains visible in traces as a failed attempt
- retry does not silently mutate prior successful turns
- retries should use the same per-chat snapshot configuration captured for that run

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

The specific component foundation should be chosen in Increment 1.

If no lightweight library is clearly better than native Svelte plus semantic HTML, prefer the simpler option rather than forcing a component library decision.

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

The following questions were raised during design and have been answered:

1. **Background chat execution** *(answered)*
   Non-visible active chats do not continue streaming in the background. When the user switches away, the active request is aborted and that chat's state is frozen. This keeps the implementation simple and avoids concurrent write issues.

2. **Token estimation implementation** *(answered)*
   No Wasm tokenizer. Token counts are back-calculated from LM Studio's `promptTokens` deltas wherever possible. Character-based approximations (`char/4`) are used only where API data is structurally unavailable, and are never permanent accumulating errors. See the Context Accounting Design section for the full approach.

3. **Component foundation** *(answered)*
   Bare Svelte with semantic HTML and CSS custom properties. No component library introduced.

## Current Recommendation

The cleanest MVP implementation path is:

- central profile management
- per-chat selection of one model and optional one MCP server
- local snapshot-oriented chat records
- streaming chat UI
- collapsible tool traces
- real-time context bar with exact/estimated/unknown accounting

This keeps the first version focused on the main product value: **understanding how MCP-based local SLM workflows actually use context and tools in practice**.
