# mcpscope Agent Guide

mcpscope is a backend-centered runtime analysis tool for MCP and multi-turn LLM workflows. Optimize for correctness, inspectability, and parity across backend API, CLI, MCP, and the thin Svelte frontend.

## Start Here

- Read [README.md](README.md) for the repo map and dev commands.
- Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing runtime flow, persistence, streaming, or adapters.
- Read [DATA-MODEL.md](DATA-MODEL.md) before changing session, turn, round, or part structures.
- Read [TESTING.md](TESTING.md) before choosing regression coverage.
- Read [CLI.md](CLI.md) and [MCP.md](MCP.md) before changing command or tool behavior.

## Agent Workflow

- Treat [backlog/](backlog/) as the source of truth for product and implementation tracking.
- Use the backlog state folders consistently: [backlog/candidates/](backlog/candidates/), [backlog/specification/](backlog/specification/), [backlog/implementation/](backlog/implementation/), [backlog/fixme/](backlog/fixme/), and [backlog/completed/](backlog/completed/).
- One task file should correspond to one scoped coding handoff once it reaches [backlog/implementation/](backlog/implementation/) or [backlog/fixme/](backlog/fixme/).
- The planning agent owns backlog shaping, roadmap alignment, documentation consistency, coding-agent prompts, and PR review.
- The coding agent owns implementation of one approved backlog task at a time, plus the focused tests and narrow documentation changes needed to land it cleanly.
- For coding work, start from the assigned task in [backlog/implementation/](backlog/implementation/) or [backlog/fixme/](backlog/fixme/) and the canonical docs it links to. Escalate roadmap or scope changes back to the planning agent instead of silently broadening the task.
- When a backlog task is handed to a coding agent, create or switch to a git branch named from the task slug, usually the backlog filename without `.md`.
- When implementation is done, open a PR from that branch to `main`. If branch push or PR creation is blocked by missing tooling, auth, or network access, leave the branch ready locally and provide the exact commands, PR title, and PR body.
- The planning agent reviews the PR for correctness, architecture, regression coverage, and documentation alignment. Minor follow-up fixes may be done directly on the branch; larger concerns should be handed back to a coding agent with an explicit follow-up prompt.
- When a task is fully complete, the planning agent should update the relevant roadmap or status docs and move the backlog item to [backlog/completed/](backlog/completed/) when appropriate.

## Working Rules

- Add shared command or tool semantics in [backend/src/operations/](backend/src/operations/) first. The backend operation catalog is the single source of truth for HTTP routes, CLI behavior, and MCP tools.
- Keep machine-readable result shapes in `snake_case`. Internal TypeScript can stay `camelCase`, but adapter outputs should match the backend operation contracts.
- Keep the frontend thin. Canonical runtime state, persistence, and operation semantics belong in the backend, not in Svelte components.
- Do not add loopback HTTP for MCP-backed operations. MCP executes backend operations directly.
- Preserve the canonical runtime tree. Session metadata may evolve, but setup, turns, rounds, and parts remain the core model.
- Treat `backend-data/` as local runtime and test-artifact state. Do not add tracked files there beyond documented exceptions.

## Validation

- Run `npm test` for deterministic regressions when backend behavior changes.
- Run `npm run check:backend` for backend TypeScript changes.
- Run `npm run check:cli` for CLI changes.
- Run `npm run check` for frontend changes.
- Use `npm run test:integration` only when the change requires live LM Studio or MCP validation.
- Prefer trace replay or focused backend tests over UI-heavy tests when validating runtime behavior.

## High-Value Patterns

- Minimal operation example: [backend/src/operations/list.ts](backend/src/operations/list.ts)
- MCP adapter over the catalog: [backend/src/mcp/server.ts](backend/src/mcp/server.ts)
- CLI adapter pattern: [cli/src/commands/create.ts](cli/src/commands/create.ts)
- Representative Svelte 5 state usage: [frontend/src/lib/components/NewSessionPanel.svelte](frontend/src/lib/components/NewSessionPanel.svelte)
- Backend API and orchestration tests: [backend/src/app.test.ts](backend/src/app.test.ts)
- Replay harness for multi-step regressions: [backend/src/testing/replayHarness.ts](backend/src/testing/replayHarness.ts)

## Common Pitfalls

- Forgetting that operation IDs should stay literal (`as const`) in the catalog.
- Introducing adapter-only semantics into backend operations.
- Returning `camelCase` fields from machine-readable results.
- Reconstructing backend flow in tests when an exported trace and replay test would be more robust.
- Moving backend-owned defaults or validation logic into the frontend.

## Custom Agents

- Use [.github/agents/planning.agent.md](.github/agents/planning.agent.md) for backlog shaping, roadmap and doc consistency, coding-agent handoff prompts, and PR review.
- Use [.github/agents/coding.agent.md](.github/agents/coding.agent.md) for implementation work on one approved backlog task, including branch preparation, focused validation, and PR handoff.