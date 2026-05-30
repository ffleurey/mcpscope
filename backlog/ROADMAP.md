# Backlog Roadmap

Use [README.md](README.md) for backlog process, folder meanings, and promotion gates.

This file is intentionally short. It should describe the current product posture and planning state, not restate the task inventory.

## Product Story

mcpscope is a local-first inspection and evaluation tool for MCP-backed LLM workflows.

The core product foundation is now in place:

- a backend-owned runtime model with persisted sessions, turns, rounds, and parts
- preserved raw LM and MCP exchanges for diagnostics and replay
- a thin UI, packaged CLI, and MCP surface aligned around the same backend contracts
- deterministic replay as part of both product value and regression strategy

That foundation is enough to keep the project worth evolving, but it does not yet force one immediate product direction.

## What Has Been Established

Completed work has already established the main architectural constraints for future planning:

- backend-owned operation and interface discipline across UI, CLI, and MCP
- the canonical runtime vocabulary of `SessionContainer`, `Session`, `Step`, and `Turn`
- an explicit backend execution loop through `Session.execute()` / `advance()` / `canContinue()`
- generic persistence for containers, sessions, and steps, with `Turn` retaining infrastructure-specific subtype persistence
- a first end-to-end analysis-session MVP proving mcpscope can inspect its own sessions through a restricted internal MCP workflow

Future work should build on those constraints rather than reopening them casually.

## Current Planning Posture

There is intentionally no active near-term roadmap at the moment.

The current backlog state is a parked inventory of candidate ideas accumulated over time. Those ideas may still be valuable, but they should not be treated as selected priorities, active specifications, or implied commitments.

Until a new direction is chosen explicitly:

- `candidates/` is the only active planning queue
- `specification/`, `implementation/`, and `fixme/` should stay empty unless work is deliberately reactivated
- no candidate file should be read as the current roadmap by itself

## Longer-Term Themes

The parked backlog still clusters around a few recurring themes that remain plausible future directions:

- stronger inspectability and operational trust for debugging MCP-backed runs
- evidence-grounded evaluation of session outcomes and tool use
- repeatable workflows across UI, CLI, MCP, and replay surfaces
- session grouping, parent/child workflow structure, and other higher-level evaluation patterns

These are themes, not commitments.

## Planning Rule

When planning restarts, choose the next direction explicitly before promoting any task out of `candidates/`.

If a task does not clearly support an explicitly chosen direction and concrete developer use case, it should remain parked.