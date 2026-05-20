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
mcpscope inspect ABCD.1
```

Useful IDs:

- `ABCD` - session
- `ABCD.S` - setup used for the session
- `ABCD.1` - first turn
- `ABCD.1.1` - first round
- `ABCD.1.1.3-T` - specific tool call

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
mcpscope inspect ABCD.1
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

## 7. Copy-paste quick reference

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
mcpscope inspect ABCD.1
```
