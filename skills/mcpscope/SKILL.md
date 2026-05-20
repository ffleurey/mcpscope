---
name: mcpscope
description: >
  Use mcpscope to evaluate an MCP server through real session traces, not just tool
  schemas. Start the released Docker image, configure defaults once, run one session
  at a time, inspect the resulting trace, and turn what happened into concrete MCP
  improvements to tool descriptions, schemas, and payloads.
triggers:
  - "mcpscope"
  - "evaluate mcp server"
  - "inspect mcp traces"
  - "test mcp tool descriptions"
  - "improve mcp tool schema"
prerequisites:
  commands: [docker]
---

# mcpscope

Use this skill when the task is to evaluate how well an MCP server works **for an LLM in practice**.

The quality bar is not "the server exposes tools." The quality bar is:

- the model picks the right tool
- the model supplies good arguments
- the returned payload is easy for the model to use
- the final result is correct and explainable from the trace

## When to use

Use this skill when you need to:

- evaluate an MCP server end to end
- test whether tool descriptions are clear enough
- test whether input schemas help or confuse the model
- inspect a bad run and explain what failed
- compare "before vs after" MCP improvements using fresh sessions

Do not use this skill if the task is only:

- to implement mcpscope itself
- to browse the repository without running mcpscope
- to do raw protocol probing of an MCP server without running an LLM workflow

## Prerequisites

Before the AI workflow starts, make sure:

1. mcpscope is already running from the released Docker image
2. the Web UI is reachable at `http://localhost:3030`
3. LM Studio is reachable from the container
4. the MCP server is reachable from the container
5. the default model config is set in the UI
6. the default MCP profile is set in the UI if the evaluation needs one

Because mcpscope runs in Docker, host-side services should normally be configured in the UI with `host.docker.internal`, not `localhost`.

Typical values:

- LM Studio: `http://host.docker.internal:1234/v1`
- MCP server: `http://host.docker.internal:3001/mcp`

## Recommended CLI wrapper

Use the packaged CLI inside the container:

```bash
mcpscope() {
  docker exec -i mcpscope-app mcpscope "$@"
}
```

Then use:

```bash
mcpscope list
mcpscope create "temperature-eval"
mcpscope status ABCD
mcpscope send ABCD "How did indoor temperature change over the last 7 days?"
mcpscope inspect ABCD.1
```

## AI workflow

### 1. Start with a fresh session

Create a new session for the evaluation you want to run:

```bash
mcpscope create "short descriptive title"
```

Record the session ID from the output.

Do not reuse an old session when evaluating a changed MCP configuration, changed tool description, changed schema, or changed server behavior.

### 2. Wait until the session is ready

Poll until initialization completes:

```bash
mcpscope status ABCD
```

Only continue when the state is `ready`.

### 3. Send one representative prompt

Run a prompt that exercises the MCP behavior you want to judge:

```bash
mcpscope send ABCD "Your evaluation prompt here"
```

Use realistic prompts. Avoid synthetic prompts that do not resemble real usage.

### 4. Poll until the turn finishes

```bash
mcpscope status ABCD
```

When the session returns to `ready`, inspect the trace.

### 5. Inspect the right objects

Start here:

- session: `mcpscope inspect ABCD`
- setup: `mcpscope inspect ABCD.S`
- first turn: `mcpscope inspect ABCD.1`

Then go deeper when needed:

- first round: `mcpscope inspect ABCD.1.1`
- specific tool call part: `mcpscope inspect ABCD.1.1.3-T`

Use the setup object when you need to confirm:

- which model config snapshot was used
- which MCP profile snapshot was used
- what tool definitions and instructions were visible at run time

### 6. Diagnose the run

When reading the trace, answer these questions in order:

1. **Did the model choose the right tool?**
2. **If not, was the tool description too vague, too broad, or misleading?**
3. **Were the arguments correct, or did the model guess badly?**
4. **Did the tool return a payload that was easy to use, or too raw/noisy/large?**
5. **Did the final answer match what the trace supports?**
6. **Was context bloat or irrelevant detail making the run worse?**

### 7. Turn the trace into MCP improvements

Use mcpscope to recommend concrete changes such as:

- rename a tool
- rewrite a tool description
- clarify when to use or not use a tool
- tighten or simplify an input schema
- reshape tool output to be more decision-ready
- split one confusing tool into two clearer tools
- merge multiple shallow tools into one better tool

Prefer recommendations that improve **model usability**, not just API neatness.

### 8. Re-run with a fresh session

After MCP changes, run a new session and repeat the same prompt or prompt set.

Do not treat an old session as evidence for the new version of the MCP server.

## What good evidence looks like

Good mcpscope evidence is trace-based.

Prefer findings like:

- "The model picked `search_entities` instead of `get_temperature_history` because the latter description never says it accepts time windows."
- "The tool call arguments were malformed because the schema accepted multiple overlapping date fields with unclear precedence."
- "The tool returned a large raw payload, and the assistant had to infer the answer from noisy JSON instead of a pre-shaped result."

Avoid shallow findings like:

- "The answer looked wrong."
- "The schema seems okay."
- "The tool probably needs improvement."

## Hard rules

- Never run multiple sessions in parallel.
- Never start a new session while another one is still active.
- Never judge a tool by schema alone; inspect a real trace.
- Never judge a run by the final answer alone; inspect the tool calls and payloads.
- Never reuse a session after changing defaults or MCP configuration when you need a clean comparison.
- Prefer text output over JSON unless structured parsing is required.
- Inspect `ABCD.S` whenever configuration or tool-definition visibility may explain the behavior.

## Suggested report format

When reporting back after an evaluation, include:

- `Session`: session ID
- `Turn`: turn ID
- `Prompt`: short summary of what was tested
- `Outcome`: success / partial / failure
- `Tools used`: list of tools actually called
- `Main issue`: the most important failure or quality gap
- `Evidence`: what in the trace supports that conclusion
- `Recommended MCP change`: the concrete next improvement

## Quick command reference

```bash
mcpscope list
mcpscope create "my eval"
mcpscope status ABCD
mcpscope send ABCD "Evaluate this server behavior"
mcpscope inspect ABCD
mcpscope inspect ABCD.S
mcpscope inspect ABCD.1
mcpscope inspect ABCD.1.1
mcpscope inspect ABCD.1.1.3-T
```

## Reference map

- `TUTORIAL.md` - quick start for the released Docker image
- `CLI.md` - command syntax and output details
- `ARCHITECTURE.md` - backend model and API behavior
- `DATA-MODEL.md` - canonical IDs and runtime structure
