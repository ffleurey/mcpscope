# AI Client App Implementation Plan

## Purpose

This plan defines the implementation increments for the AI Client App MVP.

It is intended to be used as an **acceptance plan**:

- each increment should leave the application in a usable state
- each increment has a clear testable outcome
- we should not move to the next increment until the current one is stable enough

This plan complements:

- `PROJECT.md` for product scope and goals
- `DESIGN.md` for application structure and runtime behavior
- `USECASE-home-assistant-statistics.md` for the initial reference scenario

## Quality expectations for every increment

At every step, we should aim for:

- robust error handling
- maintainable, well-structured code
- clear separation of concerns
- strong type safety
- visible and debuggable runtime behavior
- no avoidable regressions in previously accepted functionality

If a feature works but is too fragile, too opaque, or too messy to extend safely, the increment is not really complete.

## Increment status values

Use these statuses when updating this file:

- **Planned**
- **In progress**
- **Accepted**
- **Blocked**

## Overview

| Increment | Status | Goal |
| --- | --- | --- |
| 1. App shell, configuration, connection testing | Planned | Build the SPA shell and central model/MCP configuration with connectivity checks |
| 2. Basic model-only chat | Planned | Build a single-chat flow with LM Studio and real-time streaming |
| 3. MCP-enabled chat, plain text | Planned | Add one-MCP-per-chat tool support and minimal raw tool traces |
| 4. Context monitoring and visualization | Planned | Add context accounting, token tracking, and the context bar |
| 5. Chat formatting and tool inspection UI | Planned | Improve readability and add collapsible inspection surfaces |
| 6. Multi-chat, local persistence, export | Planned | Add multiple chats, local persistence, delete, and plain-text export |

## Increment 1: App shell, configuration, connection testing

**Status:** Planned

### Goal

Build the application shell and central configuration model that everything else depends on.

### Scope

- initialize the Svelte + TypeScript + Vite application
- create the main SPA layout
- create central configuration screens for:
  - model profiles
  - MCP server profiles
- support create, edit, and delete for profiles
- add connection test actions for:
  - LM Studio connectivity
  - model reachability where possible
  - MCP server connectivity
  - MCP tool discovery

### After this step we should be able to test

- the app starts and renders the main shell
- a user can create and edit model profiles
- a user can create and edit MCP server profiles
- LM Studio connection success and failure are clearly reported
- MCP server connection success and failure are clearly reported
- invalid ports, unreachable hosts, and misconfiguration produce understandable errors

### Acceptance gate

Do not move on until:

- profile management is stable
- connection tests are useful for debugging
- failure states are clear enough that setup issues are easy to diagnose

## Increment 2: Basic model-only chat

**Status:** Planned

### Goal

Build the first working chat loop using LM Studio only, without MCP tool support yet.

### Scope

- create a single chat session view
- allow a chat to select one model profile
- send prompts to LM Studio
- stream assistant output into the UI in real time
- show message history in the chat view
- introduce internal request/response trace capture, even if the full inspection UI comes later

### After this step we should be able to test

- create a chat and associate it with a model profile
- send a prompt and receive a streamed assistant response
- see partial output appear progressively in the UI
- recover gracefully from LM Studio connection failures during chat
- confirm that the app is already capturing the core request/response data needed for later trace and context features

### Acceptance gate

Do not move on until:

- streaming feels reliable
- chat state updates are predictable
- model failures do not break the whole UI
- the internal data model is clean enough to extend with MCP and traces

## Increment 3: MCP-enabled chat with plain text output

**Status:** Planned

### Goal

Add the first full model-plus-MCP workflow using one MCP server per chat.

### Scope

- allow a chat to select one MCP server profile
- fetch and attach MCP tools for the selected chat runtime
- support model tool calls
- route tool calls to the selected MCP server
- feed plain text and structured tool results back into the chat loop
- expose minimal raw tool trace visibility

### After this step we should be able to test

- a chat can use one model profile and one MCP server profile together
- the model can discover and call MCP tools
- the app correctly forwards tool calls and receives results
- the assistant can continue after tool execution
- the UI shows at least minimal raw trace information for:
  - available tools
  - tool call arguments
  - tool results
  - tool errors

### Acceptance gate

Do not move on until:

- the full model/tool/result loop works end to end
- tool failures are visible and understandable
- trace data is captured in a way that later UI improvements can build on

## Increment 4: Context monitoring and visualization

**Status:** Planned

### Goal

Add the main context-engineering feature: context accounting and the visual context bar.

### Scope

- compute client-visible context composition from known request data
- classify measurements as:
  - exact
  - estimated
  - unknown
- build the color-coded context bar
- update context information in real time as data becomes available
- surface token and usage statistics when returned by the backend

### After this step we should be able to test

- the UI shows a context budget bar for a running chat
- the bar reflects major context segments such as:
  - system prompt
  - conversation history
  - tool descriptions / tool schemas
  - tool calls
  - tool results
  - assistant answers
- the UI clearly distinguishes exact, estimated, and unknown values
- large prompts or oversized tool outputs are easy to spot visually
- context information updates during or immediately after a turn as more information becomes known

### Acceptance gate

Do not move on until:

- the context bar is trustworthy enough to support real evaluation work
- the UI does not imply visibility into hidden reasoning when that visibility does not exist
- context accounting remains understandable under both success and error paths

## Increment 5: Chat formatting and tool inspection UI

**Status:** Planned

### Goal

Improve readability and inspection quality without changing the core runtime model.

### Scope

- add better text formatting in the chat
- add collapsible boxes for tool calls
- expose tool inputs and outputs cleanly
- improve request/response inspection views
- make the chat easier to read while preserving detail

### After this step we should be able to test

- assistant text is easier to read
- tool traces do not overwhelm the message timeline
- a user can expand and collapse tool details on demand
- tool arguments and results are inspectable without cluttering the main chat
- inspection surfaces feel good enough for real MCP evaluation work

### Acceptance gate

Do not move on until:

- the inspection UI improves readability instead of adding confusion
- detailed runtime information remains easy to access
- the chat stays usable during longer tool-heavy sessions

## Increment 6: Multi-chat, local persistence, export

**Status:** Planned

### Goal

Add experiment management features once the single-chat runtime is stable.

### Scope

- support multiple active chats
- show one chat at a time in the main UI
- persist chats locally
- persist model and MCP profiles locally
- support deleting chats
- support plain-text export

### After this step we should be able to test

- create several chats and switch between them
- preserve each chat's state independently
- keep chats available after reloading the application
- delete old chats safely
- export a chat as plain text
- run experiments in parallel at a practical level, even though only one chat is shown at a time

### Acceptance gate

Do not move on until:

- persistence does not corrupt chat state
- switching between chats is reliable
- deletion and export are predictable and safe
- accepted behavior from earlier increments still works after reload

## Notes on sequencing

This sequence is intentionally incremental, but with one important design rule:

- **trace capture and context-accounting plumbing should begin before the full context UI**

That means increments 2 and 3 should already capture the data that increment 4 will visualize.

It is also intentional that:

- connection testing happens first
- the first MCP workflow is plain text only
- richer artifact rendering is left for later
- local persistence comes after the core chat/runtime behavior is stable

## Current recommendation

Build in this order:

1. app shell + central configuration + connection testing
2. model-only chat with streaming
3. MCP-enabled chat with minimal raw traces
4. context accounting + context bar
5. formatting + collapsible inspection UI
6. multi-chat + local persistence + export/delete

This gives us a fast path to a usable evaluator while still protecting code quality and maintainability at each step.
