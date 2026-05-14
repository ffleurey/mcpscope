# Initial Use Case: Home Assistant Historical Statistics

## Purpose

This file defines the first concrete end-to-end use case for the mcpscope MVP.

It exists to give the project a focused build target: one realistic workflow that is specific enough to implement and test, while still representing the broader category of data-analysis MCP clients.

## Use Case Summary

We are testing an MCP server that extracts and computes statistics from a Home Assistant installation.

The MCP server:

- runs on `localhost:3001`
- performs the heavy statistical work
- exposes tools intended for local SLM use
- may later return compact reasoning outputs as well as richer user-facing artifacts

LM Studio is also running locally and is used as the model gateway, even when the underlying model is reached through LM Studio / LM Link.

The initial reference model is a variant of **Qwen3.6-35b-a3b**.

LM Studio documentation examples assume the OpenAI-compatible API is exposed at:

- `http://localhost:1234/v1`

That should be treated as the initial expected value, not a hardcoded guarantee. The application should let the user configure the LM Studio base URL.

General application behavior such as central profile management, persistence, and context monitoring is defined in `DESIGN.md`.

## Why This Use Case Matters

The goal is not just to get answers from a model.

The goal is to evaluate:

- how well the model chooses tools
- how effective the MCP tool descriptions and schemas are
- how much context the model actually needs to produce good answers
- how useful attached artifacts are for the user
- how observable and debuggable the whole interaction is

This is why a custom client is needed instead of a built-in generic chat UI.

The application must make it easier to inspect and understand:

- prompts and runtime settings
- tool calls and arguments
- tool outputs and structured payloads
- future charts, tables, images, or files returned alongside those outputs
- context growth and token usage
- what portions of the effective LLM context are consuming the available budget

## Target User Workflow

1. The user opens the client.
2. The user creates or edits central configuration as needed:
   - model profiles
   - MCP server profiles
3. The user opens a chat and selects:
   - one model profile
   - one MCP server profile for this chat
4. The user asks a question about historical Home Assistant data.
5. The model chooses one or more MCP tools.
6. The MCP server computes the result.
7. The client shows:
   - assistant output streaming in real time
   - a context budget bar with color-coded segments for known context elements
   - the tool call trace
   - collapsible boxes for tool inputs and outputs
   - the compact tool result that informs the model
8. The user evaluates whether the final answer, tool usage, and artifacts are useful and efficient.

## Representative Questions

Examples of the kind of questions this MVP should support:

- "How did indoor temperature change over the last 7 days?"
- "Compare this week's energy consumption to last week's."
- "When was humidity highest yesterday, and what else happened around that time?"
- "Show me whether motion events correlate with lighting activity in the evening."
- "What trend do you see in power usage over the last month?"

## Expected MCP Output Pattern

For this use case, the long-term preferred result pattern is:

1. **Compact reasoning payload**
   - enough structured information for the model to reason correctly
   - small enough to avoid unnecessary context growth

2. **Short textual summary**
   - suitable for chat history and user visibility

3. **User-facing artifact**
   - a chart
   - a table
   - an image
   - an HTML fragment/document
   - a CSV or other downloadable file

The client should keep the artifact out of the main model context when possible.

For the initial MVP, the UI does not need to render these richer artifacts yet. It is enough to show tool inputs and outputs clearly in the chat interface while preserving room for later artifact support.

## MVP Scope for This Use Case

The first version should focus on a traditional chat flow with visible traces.

It does **not** need to implement the eventual vision of a fully prompt-built interactive dashboard yet.

For this initial use case, the MVP should support:

- one working LM Studio integration
- one working local MCP server integration
- one selected model profile and one selected MCP server profile per chat
- real-time assistant streaming with real-time context updates
- context monitoring with a visual budget bar
- visible tool traces with collapsible tool input/output boxes
- local-only conversation persistence
- deletion of old chats and plain-text export
- support for multiple active chats, with one visible at a time
- retry-friendly error handling

## Evaluation Criteria

The MVP should help answer questions like:

- Did the model choose the correct tool?
- Did the tool schema help the model produce correct arguments?
- Was the returned reasoning payload compact but sufficient?
- Was the flow easy to debug when something failed?
- Could the user recover from LM Studio or MCP connection issues without losing too much context?
- Could we clearly see which parts of the context budget were being consumed?
- Could we distinguish exact measurements from estimates or unavailable information?
- When richer artifacts are added later, do they improve understanding without harming context efficiency?

## Generalization Beyond Home Assistant

Although this reference scenario is based on Home Assistant historical statistics, the application should be designed to generalize to similar domains, including:

- operational monitoring
- telemetry
- metrics dashboards
- sensor data analysis
- other time-series or event-stream analysis workflows

Home Assistant is the first example, not the permanent product boundary.
