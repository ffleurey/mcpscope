# mcpscope quick start

Get mcpscope running and start testing an MCP server in minutes. Pick one install method:

- **Desktop app** — the easiest way to play with mcpscope; everything bundled, GUI only.
- **npm** (recommended for MCP server developers) — adds the `mcpscope` CLI and `serve`;
  needs Node.js 24+. This guide's CLI sections assume it.
- **Docker** — a released container image, for servers and advanced setups; needs Docker.

Either way, you then configure mcpscope once in the Web UI (or in
[the config file](CONFIG.md)) and drive it from the UI, the CLI, or MCP — **one session at a
time**.

If you are developing **mcpscope itself**, see [DEVELOPMENT.md](docs/DEVELOPMENT.md) instead.

## What you need

- **Desktop app:** nothing — **or** — **npm:** Node.js 24+ — **or** — **Docker:** Docker (the image is public — no login)
- LM Studio (or Ollama) running on your machine, **with its local server started and a model
  loaded** — in LM Studio: Developer tab → *Start server*, then load a model and note its model id;
  the server URL is `http://localhost:1234/v1`
- an MCP server to test — **or none**: mcpscope ships built-in
  [companion servers](COMPANIONS.md) you can select with zero setup, and this guide uses one

## 1. Start mcpscope

### Option A — Desktop app (easiest)

Download the installer for your OS from the
[Releases page](https://github.com/ffleurey/mcpscope/releases) — macOS `.dmg`, Windows `.exe`
(NSIS), Linux `AppImage` / `.deb` / `.rpm`. Launch it: the full workbench opens as a desktop
window, with the backend bundled and data stored in `~/.mcpscope`. The builds are unsigned for
now, so macOS Gatekeeper / Windows SmartScreen warn on first run.

The desktop app is the GUI experience only — it does not put the `mcpscope` CLI on your PATH.
For the CLI/agent workflows in §4 and later, install via npm (Option B; both can share the same
`~/.mcpscope` data as long as only one runs at a time).

### Option B — npm (recommended for MCP server developers)

```bash
npm install -g mcpscope
mcpscope serve
```

`mcpscope serve` starts mcpscope at `http://localhost:3030`, opens your browser, and stores data
in `~/.mcpscope`. Stop with `Ctrl-C`; run `mcpscope serve` again to resume. Flags: `--port <n>`,
`--host <host>`, `--data-dir <path>`, `--no-open`.

mcpscope runs natively, so use `localhost` for services on your machine (e.g. LM Studio at
`http://localhost:1234/v1`).

### Option C — Docker (advanced)

The image is public on GHCR — pull and run, no login needed:

```bash
docker pull ghcr.io/ffleurey/mcpscope:latest
docker run -d \
  --name mcpscope-app \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 3030:3030 \
  -v mcpscope-data:/data \
  ghcr.io/ffleurey/mcpscope:latest
```

Then open `http://localhost:3030`.

- `-v mcpscope-data:/data` keeps sessions and config persistent
- `--add-host=host.docker.internal:host-gateway` lets the container reach LM Studio and your MCP server on the host — with Docker, use `host.docker.internal` (not `localhost`) for those services
- restart later with `docker start mcpscope-app`

For version pinning, the in-container CLI, or the docker-compose variant, see
[RELEASING.md → Pulling a released image](docs/RELEASING.md#pulling-a-released-image).

## 2. Make the CLI easy to use

**npm install:** the `mcpscope` CLI is already on your PATH — use it directly:

```bash
mcpscope list
```

**Docker install:** run the bundled CLI inside the container, and add a shell helper so the rest
of this guide's `mcpscope …` commands work as-is:

```bash
mcpscope() { docker exec -i mcpscope-app mcpscope "$@"; }
mcpscope list
```

## 3. Configure mcpscope once in the Web UI

In `http://localhost:3030`, create:

1. an **LM connection** — the base URL of your LLM backend (LM Studio: `http://localhost:1234/v1`)
2. a **model config** — pick the connection and the model id of the model you loaded
3. an **MCP profile** — the URL of your own MCP server

(Everything in this step can also be done by editing the config file directly — see
[CONFIG.md](CONFIG.md), including a fully headless setup.)

> **Shortcut — skip the MCP profile:** mcpscope ships built-in **companion MCP servers** you can
> select without creating a profile. The keyless **Open-Meteo Weather** server is a good first
> target — it exposes `geocode_place`, `get_current_weather`, `get_forecast`, and
> `get_historical_weather` out of the box. Just tick it in the launch dialog, or pass
> `--mcp-profile builtin-open-meteo` to the CLI — **built-ins are selected per session; they
> cannot be session defaults**. See [COMPANIONS.md](COMPANIONS.md) for the full set. The rest of
> this guide uses it, so you can follow along with no MCP server of your own.

Then set the **default model config**. (You can also mark your *own* MCP profiles as
*enabled by default* so `create` picks them up without flags — built-in companions always need
the explicit `--mcp-profile` selection.)

### Important — host addresses

Which host to use for services on your machine depends on how you installed mcpscope:

- **npm:** use `localhost` — e.g. LM Studio at `http://localhost:1234/v1`, and likewise for your
  own MCP server's URL.
- **Docker:** use `host.docker.internal` (the container can't see `localhost`) — e.g.
  `http://host.docker.internal:1234/v1`, and likewise for your own MCP server's URL.

The CLI `create` command depends on these defaults. Once they are configured, the CLI can create sessions without asking for model or MCP snapshots.

## 4. Run one session

Create a session against the built-in Open-Meteo companion (built-ins must be selected
explicitly — they are never part of the defaults):

```bash
mcpscope create "weather-eval" --mcp-profile builtin-open-meteo --wait
```

`--wait` blocks until initialization finishes, so the session is ready immediately. The command
prints the new session ID, for example:

```text
ABCD  weather-eval
```

`ABCD` is illustrative — use the ID your `create` actually printed in the commands below.

Send a prompt (this one makes the model chain two tools — `geocode_place` to resolve the city,
then `get_historical_weather` for the data). Again `--wait` blocks until the turn completes —
no polling loop:

```bash
mcpscope send ABCD "How did the temperature in Paris change over the last 7 days?" --wait
```

Inspect the result:

```bash
mcpscope inspect ABCD.1T
```

Useful IDs:

- `ABCD` - session
- `ABCD.S` - setup used for the session
- `ABCD.1T` - first turn
- `ABCD.1T.1` - first round
- `ABCD.1T.1.3-T` - specific tool call

## 5. Use mcpscope the simple way

### One session at a time

mcpscope now enforces a **single active session**.

That is the intended workflow:

1. create one session (`--wait`)
2. send one prompt (`--wait`)
3. inspect the run
4. only then create the next session

(Without `--wait`, `create` and `send` return immediately and you poll `mcpscope status` —
useful when you want to watch progress live in the Web UI while the turn runs.)

If you get `another_session_active`, finish or inspect the blocking session first.

### Prefer text output

For normal use, prefer the default text output:

```bash
mcpscope list
mcpscope status ABCD
mcpscope inspect ABCD.1T
```

It is:

- smaller
- easier to read
- usually good enough for both humans and coding agents

Use `--json` only when you truly need structured parsing.

## 6. Practical loop for MCP testing

For each MCP change:

1. update the MCP server
2. create a fresh session
3. wait for `ready`
4. send one representative prompt
5. wait for `ready` again
6. inspect the turn, tool calls, and setup
7. repeat

Fresh sessions matter because each session keeps a snapshot of the model and MCP configuration used at creation time.

For a **repeatable** version of this loop — a saved suite you re-run with one command — use benchmarks (next).

## 7. Repeatable testing with benchmarks

The loop above is manual and one-off. A **benchmark** turns it into a reusable suite: a set of prompts (**cases**) you re-run against a model + MCP server with a single command. You get a per-tool "which tools cause issues" scorecard plus pass/fail reliability across repetitions, and — optionally — a separate **judge model** that scores answer quality against a per-case **rubric**.

Minimal CLI flow (same `mcpscope` helper, defaults from the config you set in step 3):

```bash
# Create a suite and add a case (optionally assert which tools must / must not be called).
# This example runs against the built-in Open-Meteo Weather companion — no server of your own.
mcpscope benchmark_create "open-meteo-weather"          # → B-7K3M
mcpscope benchmark_add_case B-7K3M "What's the forecast for Paris tomorrow?" --expect-tool get_forecast   # → B-7K3M.1

# Run it 5× and block until done (model: configured default; MCP: the companion —
# built-ins are never defaults, so pass the profile explicitly)
mcpscope benchmark_run B-7K3M --repetitions 5 --mcp-profile builtin-open-meteo --wait    # → R-9QX4

# Read the scorecard (per-tool errors/usage + per-case pass rates and token stats)
mcpscope benchmark_run_report R-9QX4
```

Iterate on your MCP server and re-run: each run is an **immutable snapshot**, so past results stay valid as you edit the suite. Benchmark IDs (`B-` suite, `B-.N` case, `R-` run, `E-` evaluation) inspect just like a session — `mcpscope inspect R-9QX4`.

To also score **answer quality**, give a case a rubric and launch a judging pass with a *separate* model (`mcpscope benchmark_evaluate R-9QX4 --judge-model <id>`). The full workflow — rubric authoring, LLM evaluation, every report field, and the same steps over MCP for coding agents — lives in **[BENCHMARK.md](BENCHMARK.md)**.

For the complete loop run end-to-end on a real model — inspect a session, benchmark it, change
one thing, and watch the token metric move — see **[EXAMPLE.md](EXAMPLE.md)**.

## 8. Connect your coding agent

mcpscope is built as a collaboration tool between you and your coding agent: connected over MCP,
the agent can do the heavy lifting of §7 — author benchmark cases, run the sweeps, read every
trace — on the same sessions and IDs you watch in the Web UI. mcpscope's MCP interface is served
at **`http://localhost:3030/mcp`** (Streamable HTTP, same port as the UI — nothing extra to run).

```bash
# Claude Code
claude mcp add --transport http mcpscope http://localhost:3030/mcp
```

Most other agents and IDEs take a JSON entry along these lines in their MCP settings:

```json
{ "mcpServers": { "mcpscope": { "type": "http", "url": "http://localhost:3030/mcp" } } }
```

The exact steps (and key names) vary by tool and change often, so follow your tool's own MCP
documentation: [Claude Code](https://code.claude.com/docs/en/mcp),
[VS Code / Copilot](https://code.visualstudio.com/docs/copilot/chat/mcp-servers),
[Cursor](https://cursor.com/docs/context/mcp), [Zed](https://zed.dev/docs/ai/mcp),
[OpenCode](https://opencode.ai/docs/mcp-servers/) — and if MCP itself is new to you,
[modelcontextprotocol.io](https://modelcontextprotocol.io) is the standard's home.

Once connected, paste the onboarding prompt from [MCP.md](MCP.md#connecting-a-client) and the
agent takes it from there. The tool surface and result shapes are documented in
[MCP.md](MCP.md); the agent-driven version of this tutorial's loop is the last section of
[EXAMPLE.md](EXAMPLE.md).

## 9. Copy-paste quick reference

```bash
# Install + start (npm)
npm install -g mcpscope
mcpscope serve            # http://localhost:3030 — configure connections in the UI first

# One session against the built-in Open-Meteo companion (after configuring a default model;
# ABCD = the session ID your create prints). --wait: no polling needed.
mcpscope create "weather-eval" --mcp-profile builtin-open-meteo --wait
mcpscope send ABCD "How did the temperature in Paris change over the last 7 days?" --wait
mcpscope inspect ABCD.1T
```

Docker instead of npm? Replace the first two lines with the GHCR `docker run` from
[Option C](#option-c--docker-advanced) and define `mcpscope() { docker exec -i mcpscope-app mcpscope "$@"; }`.
