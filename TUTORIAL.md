# mcpscope quick start

Use this guide if you want to **run the released mcpscope Docker image and start testing an MCP server in minutes**.

This is the recommended user path:

- no repo checkout
- no local build
- one Docker container
- one persistent Docker volume
- one session at a time

If you are developing **mcpscope itself**, use [README.md](README.md) instead.

## What you need

- Docker
- a GitHub PAT with `read:packages` for `ghcr.io`
- LM Studio running on your machine
- your MCP server running on your machine

## 1. Start mcpscope

Log in to GHCR:

```bash
export GITHUB_USER=YOUR_GITHUB_USERNAME
export GITHUB_PAT=YOUR_GITHUB_PAT
echo "$GITHUB_PAT" | docker login ghcr.io -u "$GITHUB_USER" --password-stdin
```

Pull the image:

```bash
docker pull ghcr.io/ffleurey/mcpscope:latest
```

Run the one recommended container command:

```bash
docker run -d \
  --name mcpscope-app \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 3030:3030 \
  -v mcpscope-data:/data \
  ghcr.io/ffleurey/mcpscope:latest
```

Open:

```text
http://localhost:3030
```

### Why this command

- `-v mcpscope-data:/data` keeps sessions and config persistent
- `-p 3030:3030` exposes both the UI and API
- `--add-host=host.docker.internal:host-gateway` lets the container reach LM Studio and your MCP server on the host machine

For pinning a specific version instead of `:latest`, running the CLI inside the container, or the docker-compose variant, see [RELEASING.md → Pulling a released image](RELEASING.md#pulling-a-released-image).

If you stop the container later, start it again with:

```bash
docker start mcpscope-app
```

## 2. Make the CLI easy to use

Run the CLI inside the container:

```bash
docker exec -i mcpscope-app mcpscope list
```

For easier daily use, add this shell helper:

```bash
mcpscope() {
  docker exec -i mcpscope-app mcpscope "$@"
}
```

Then you can use:

```bash
mcpscope list
```

## 3. Configure mcpscope once in the Web UI

In `http://localhost:3030`, create:

1. an **LM connection**
2. a **model config**
3. an **MCP profile**

Then set:

1. the **default model config**
2. optionally the **default MCP profile**

### Important

Because mcpscope is running in Docker, use **`host.docker.internal`**, not `localhost`, for services running on your machine.

Typical values:

- LM Studio: `http://host.docker.internal:1234/v1`
- MCP server: `http://host.docker.internal:3001/mcp`

The CLI `create` command depends on these defaults. Once they are configured, the CLI can create sessions without asking for model or MCP snapshots.

## 4. Run one session

Create a session:

```bash
mcpscope create "temperature-eval"
```

The command prints the new session ID, for example:

```text
ABCD  temperature-eval
```

Wait for initialization to finish:

```bash
mcpscope status ABCD
```

Repeat `mcpscope status ABCD` until the state is `ready`.

Send a prompt:

```bash
mcpscope send ABCD "How did indoor temperature change over the last 7 days?"
```

Poll until the turn finishes:

```bash
mcpscope status ABCD
```

When the session returns to `ready`, inspect the result:

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

1. create one session
2. wait until it is ready
3. send one prompt
4. wait until it finishes
5. inspect the run
6. only then create the next session

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
# Create a suite and add a case (optionally assert which tools must / must not be called)
mcpscope benchmark_create "weather server"          # → B-7K3M
mcpscope benchmark_add_case B-7K3M "What's the forecast for Paris tomorrow?" --expect-tool get_forecast   # → B-7K3M.1

# Run it 5× and block until done (defaults: configured model + MCP, all cases)
mcpscope benchmark_run B-7K3M --repetitions 5 --wait    # → R-9QX4

# Read the scorecard (per-tool errors/usage + per-case pass rates and token stats)
mcpscope benchmark_run_report R-9QX4
```

Iterate on your MCP server and re-run: each run is an **immutable snapshot**, so past results stay valid as you edit the suite. Benchmark IDs (`B-` suite, `B-.N` case, `R-` run, `E-` evaluation) inspect just like a session — `mcpscope inspect R-9QX4`.

To also score **answer quality**, give a case a rubric and launch a judging pass with a *separate* model (`mcpscope benchmark_evaluate R-9QX4 --judge-model <id>`). The full workflow — rubric authoring, LLM evaluation, every report field, and the same steps over MCP for coding agents — lives in **[BENCHMARK.md](BENCHMARK.md)**.

## 8. Copy-paste quick reference

```bash
export GITHUB_USER=YOUR_GITHUB_USERNAME
export GITHUB_PAT=YOUR_GITHUB_PAT
echo "$GITHUB_PAT" | docker login ghcr.io -u "$GITHUB_USER" --password-stdin
docker pull ghcr.io/ffleurey/mcpscope:latest
docker run -d \
  --name mcpscope-app \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 3030:3030 \
  -v mcpscope-data:/data \
  ghcr.io/ffleurey/mcpscope:latest

mcpscope() { docker exec -i mcpscope-app mcpscope "$@"; }

mcpscope create "temperature-eval"
mcpscope status ABCD
mcpscope send ABCD "How did indoor temperature change over the last 7 days?"
mcpscope status ABCD
mcpscope inspect ABCD.1T
```
