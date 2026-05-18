# mcpscope tutorial

mcpscope is a **local-first runtime analysis tool for MCP server development**.

It is built for a specific loop:

1. a developer configures the model and MCP server in the Web UI
2. a coding agent drives repeatable evaluation runs from the CLI
3. both inspect the same persisted sessions, turns, tool calls, and context usage
4. the developer tunes the MCP server and repeats

This makes mcpscope useful when you do not just want an answer from an LLM. You want to know:

- did the model choose the right tool?
- were the tool descriptions and schemas clear enough?
- did the MCP server return payloads the model could actually use?
- where did the run fail?
- how much context did the run consume?

## Why mcpscope exists

mcpscope closes the loop between **MCP server development** and **LLM behavior evaluation**.

It is not mainly a generic chat UI. It is a backend-centered inspection tool with:

- persisted sessions
- traceable tool calls and tool results
- canonical hierarchical IDs for lookup
- context and token visibility
- replayable traces for regression work

The key design idea is that the **backend owns the canonical runtime state**. The Web UI and CLI both look at the same sessions.

That makes it a good fit for a collaboration model where:

- the **developer** uses the Web UI to configure and inspect
- the **coding agent** uses the CLI to run scripted evaluations

## What the MVP already supports

The current CLI workflow is intentionally small and scriptable:

- `mcpscope list`
- `mcpscope create`
- `mcpscope send`
- `mcpscope status`
- `mcpscope inspect`

That is enough to:

1. create a session from backend-owned defaults
2. wait until it is ready
3. send a domain prompt
4. poll until the run finishes
5. inspect the resulting turn and tool activity

## Recommended setup model

Use mcpscope like this:

- run mcpscope in Docker
- keep LM Studio and your MCP server running locally
- use the Web UI once to configure:
  - LM connection
  - model config
  - MCP profile
  - default model for session creation
  - optional default MCP profile for session creation
- let the coding agent use the CLI for evaluation runs

The defaults matter because `mcpscope create` does **not** ask the CLI user to build session snapshots manually.

## 1. Run mcpscope with Docker

The packaged MVP path is:

1. run the mcpscope container
2. open the Web UI in the browser
3. run the CLI inside that same container with `docker exec`

### Quick evaluation mode

For a short testing round, you do **not** need a Docker volume:

```bash
docker build -t mcpscope .
docker run -d --name mcpscope-app -p 3030:3030 mcpscope
```

This is enough if you only need a temporary environment.

### Persistent local mode

If you want data to survive container replacement, add a volume:

```bash
docker build -t mcpscope .
docker run -d --name mcpscope-app -p 3030:3030 -v mcpscope-data:/data mcpscope
```

mcpscope will be available at:

```text
http://localhost:3030
```

To stop the container:

```bash
docker stop mcpscope-app
```

To start it again later:

```bash
docker start mcpscope-app
```

To remove it entirely:

```bash
docker rm -f mcpscope-app
```

If you want to use a released image instead of building locally, see [RELEASING.md](RELEASING.md).

## 2. Prepare the surrounding tools

mcpscope expects the model gateway and MCP server to be reachable from the machine where mcpscope runs.

Typical local setup:

- **LM Studio** exposing an OpenAI-compatible API, often at `http://localhost:1234/v1`
- your **MCP server** running locally on its own port

mcpscope itself does not replace those services. It sits around them and records what happens during a run.

## 3. Configure mcpscope in the Web UI

Open the Web UI at `http://localhost:3030`.

Create:

1. an **LM connection**
2. a **model config** that points to that LM connection
3. an **MCP profile** for the MCP server under development

Then set:

- one **default model config** for session creation
- optionally one **default MCP profile** for session creation

This is the minimum setup the CLI needs for `mcpscope create`.

### Important behavior

- the default model is **required**
- the default MCP profile is **optional**
- defaults affect only **new sessions**
- created sessions keep frozen snapshots of the resolved model/MCP configuration

That snapshot behavior is important for evaluation work: a session keeps the exact setup it was created with even if the reusable config changes later.

## 4. Use the packaged CLI

The Docker image now includes the CLI.

That means you do **not** need:

- a repo checkout just to run the CLI
- a host Node.js install
- `npm link`

Run the CLI inside the container:

```bash
docker exec -i mcpscope-app mcpscope list
```

Create a shell helper if you want the shorter `mcpscope ...` form on the host:

```bash
mcpscope() {
  docker exec -i mcpscope-app mcpscope "$@"
}
```

Then you can use:

```bash
mcpscope list
```

Inside the container, the CLI defaults to `http://127.0.0.1:3030`, so no explicit `--url` is needed for the common packaged workflow.

## 5. First end-to-end evaluation run

Create a session:

```bash
mcpscope create "ha-temperature-eval"
```

Example output:

```text
ABCD  ha-temperature-eval
```

Wait for initialization:

```bash
mcpscope status ABCD
```

Repeat until the state becomes `ready`.

Send a prompt:

```bash
mcpscope send ABCD "How did indoor temperature change over the last 7 days?"
```

Poll until the run completes:

```bash
mcpscope status ABCD
```

When the session returns to `ready`, inspect the turn:

```bash
mcpscope inspect ABCD.1
```

Useful inspection targets:

- `ABCD` — full session
- `ABCD.S` — setup
- `ABCD.1` — first turn
- `ABCD.1.1` — first round of the first turn
- `ABCD.1.1.3-T` — a specific tool call part

For automation, prefer JSON:

```bash
mcpscope create "ha-temperature-eval" --json
mcpscope status ABCD --json
mcpscope send ABCD "..." --json
mcpscope inspect ABCD.1 --json
```

If you prefer not to define a shell helper, the exact Docker form is:

```bash
docker exec -i mcpscope-app mcpscope create "ha-temperature-eval"
docker exec -i mcpscope-app mcpscope status ABCD
docker exec -i mcpscope-app mcpscope send ABCD "..."
docker exec -i mcpscope-app mcpscope inspect ABCD.1
```

## 6. How the developer and coding agent should work together

### Developer responsibilities

Use the Web UI to:

- configure LM connections, model configs, and MCP profiles
- set the defaults used by CLI session creation
- inspect finished sessions visually
- review tool calls, arguments, outputs, and context growth
- change the MCP server implementation, tool descriptions, or schemas

### Coding agent responsibilities

Use the CLI to:

- create fresh sessions for each evaluation run
- send a fixed prompt set
- collect session IDs and turn IDs
- inspect results by canonical ID
- report where the model failed to choose tools correctly or use outputs effectively

This split works well because both are using the same backend-owned runtime state.

## 7. A practical evaluation loop

For each MCP server change:

1. update the MCP server implementation, tool descriptions, or schemas
2. restart the MCP server if needed
3. create a fresh mcpscope session
4. run one or more representative prompts
5. inspect the resulting turn and tool calls
6. decide whether the failure was caused by:
   - bad tool description
   - bad schema shape
   - weak tool result payload
   - model limitation
   - context pressure
   - MCP server bug
7. repeat

The important practice is to use **fresh sessions** when evaluating changes to setup or defaults, so the run reflects the new configuration snapshot.

## 8. Choosing good evaluation prompts

A good evaluation prompt should:

- be realistic for the target domain
- require the model to decide whether and how to use MCP tools
- have a result that a developer can judge
- be stable enough to compare across iterations

Examples for the Home Assistant statistics domain:

- "How did indoor temperature change over the last 7 days?"
- "Compare this week's energy consumption to last week's."
- "When was humidity highest yesterday?"
- "Show whether evening motion events correlate with lighting activity."

## 9. What to look at during inspection

When a run is weak, inspect in this order:

1. **session setup**
   - system prompt
   - MCP instructions
   - tool definitions
2. **turn structure**
   - user prompt
   - reasoning blocks
   - tool calls
   - assistant answer
3. **tool call details**
   - selected tool name
   - arguments
   - returned payload
4. **context behavior**
   - whether tool outputs are too large
   - whether reasoning was stripped from later context as expected
   - whether token use is becoming excessive

mcpscope is especially useful when the answer is wrong but the reason is not obvious from the final assistant text alone.

## 10. Suggested prompt for a coding agent

You can give a coding agent instructions like this:

> Use mcpscope at `http://localhost:3030`. Create a new session for each prompt. Wait for initialization before sending. Run the evaluation prompts, inspect the resulting turn and tool calls, and report whether the MCP server helped the model solve the task correctly. Focus on tool choice, argument quality, returned payload usefulness, and any obvious context bloat.

If you want structured output, add:

> Use `--json` where possible and summarize each run with session ID, turn ID, tools used, failure mode, and recommended MCP/tool-description changes.

## 11. Known limits of the current MVP

The current CLI intentionally does **not** yet provide:

- streaming terminal output
- follow mode
- cancellation
- replay commands
- compare commands
- CLI-side model/MCP discovery
- CLI-side explicit model/MCP selection

The current best workflow is:

- configure in the Web UI
- execute with the CLI
- inspect in both the CLI and Web UI

## 12. Where to go next

- [CLI.md](CLI.md) — exact CLI command reference
- [ARCHITECTURE.md](ARCHITECTURE.md) — product and backend design
- [DATA-MODEL.md](DATA-MODEL.md) — canonical session/turn/round/part model
- [TESTING.md](TESTING.md) — replay and regression strategy
- [USECASE-home-assistant-statistics.md](USECASE-home-assistant-statistics.md) — first concrete evaluation scenario
