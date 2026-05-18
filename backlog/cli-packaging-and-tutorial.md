# CLI packaging and tutorial

This task packages the shipped CLI lifecycle MVP so it can be used without cloning the repository or installing Node.js on the host.

## Problem

The CLI currently exists in-repo and works well for development, but that is not a good packaged MVP story.

If a user already runs mcpscope in Docker, asking them to also:

- clone the repository
- install Node.js
- build the CLI locally
- `npm link` it on the host

undercuts the value of the Docker-based setup.

## Goal

Make the Docker image itself sufficient for the basic developer + coding-agent workflow:

1. run mcpscope with `docker run`
2. configure the model and MCP server in the Web UI
3. execute the CLI from inside the same container with `docker exec`

## Key decisions

- package the CLI in the **same application container** as the backend and Web UI
- expose a `mcpscope` executable inside the container
- make **plain `docker run`** the primary quick-start path
- treat data persistence as **optional** for a first testing round
- keep `docker compose` as a convenience, not the main packaging story

## Scope

### Container packaging

- build the CLI as part of the Docker image
- copy the compiled CLI into the production image
- expose a usable `mcpscope` command in the container

### Documentation

- rewrite the tutorial so the default path is:
  - `docker build` or `docker pull`
  - `docker run`
  - `docker exec ... mcpscope`
- document both:
  - quick evaluation without a volume
  - persistent local use with a Docker volume
- update README and CLI docs to reflect the packaged Docker CLI workflow
- update release docs so the released image story includes CLI usage from the container

## Out of scope

- separate dedicated CLI container
- host-level package manager distribution
- standalone binary packaging
- richer CLI follow/cancel/discovery features

## Implementation notes

- the CLI talks to the backend over HTTP only, so running it in the app container is sufficient
- defaulting the in-container CLI to `http://127.0.0.1:3030` is appropriate for `docker exec`
- the current MVP should optimize for a simple "one running container" mental model

## Expected result

After this task, the main tutorial path should let a developer and coding agent evaluate an MCP server with:

```bash
docker run -d --name mcpscope-app -p 3030:3030 mcpscope
docker exec -i mcpscope-app mcpscope list
docker exec -i mcpscope-app mcpscope create "test"
```

without any repo checkout or host CLI install.
