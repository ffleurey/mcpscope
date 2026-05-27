# Backlog Roadmap

Use [README.md](README.md) for backlog process, folder meanings, and promotion gates.

This file is intentionally short. It should explain the direction of the project and why the backlog exists in its current shape, not restate every task file.

## Product Story

mcpscope is becoming a local-first inspection and evaluation tool for MCP-backed LLM workflows.

The core of the product is now in place:

- a backend-owned runtime model with persisted sessions, turns, rounds, and parts
- preserved raw LM and MCP exchanges for diagnostics and replay
- a thin UI, packaged CLI, and MCP surface aligned around the same backend contracts
- deterministic replay as part of both product value and regression strategy

That foundation means the project is no longer about proving that trace capture works. The roadmap is now about making that runtime genuinely useful for debugging, evaluation, and repeatable development workflows.

## What Has Been Established

Recent completed work has established three important pillars:

- backend-owned operation and interface discipline across UI, CLI, and MCP
- session metadata groundwork for parent/child relationships
- a first end-to-end analysis-session MVP that proves mcpscope can inspect its own sessions through a restricted internal MCP workflow

Those completed increments matter because they define the shape of the next decisions. New work should build on the canonical runtime and operation layers rather than introducing parallel frontend-owned or adapter-owned flows.

## Current Direction

The current direction is to turn mcpscope from a single-session inspector into a stronger evaluation loop for MCP developers.

### 1. Make analysis a first-class backend-owned workflow

The immediate direction is to finish the shift from an MVP analysis flow to a backend-owned one. The key idea is that analysis should be reusable and consistent across UI, CLI, and MCP, rather than partly orchestrated in the frontend.

That is why the current implementation focus is on the analysis-launch follow-up work in [implementation/](implementation/).

### 2. Strengthen inspectability and trust in operational workflows

The next layer of value is not more features for their own sake. It is making failures, streaming behavior, and CLI-driven workflows easier to understand and trust. The fast-lane fixes in [fixme/](fixme/) exist to improve day-to-day usability for both humans and coding agents without needing large design cycles.

### 3. Build toward repeatable evaluation, not just isolated chats

The longer arc of the roadmap is repeatable session evaluation:

- child sessions that clearly belong to a parent workflow
- richer analysis follow-up and viewing
- eventually grouped runs, benchmark-style workflows, and higher-level synthesis

That is why parent-linked session metadata and analysis-specific workflows remain the main architectural spine of the backlog.

## Use Cases We Are Optimizing For

The backlog should be prioritized against these use cases:

- a developer debugging one MCP-backed run and needing precise trace and tool insight
- a developer rerunning and inspecting sessions through stable backend-owned CLI and MCP surfaces
- a developer evaluating whether a session met expectations through a dedicated analysis workflow
- later, a developer comparing repeated runs or benchmark cases without losing inspectable evidence

If a task does not clearly support one of those use cases, it should be questioned, deferred, or rewritten.

## Near-Term Planning Guidance

Near-term planning should keep favoring:

- backend-owned execution paths over frontend orchestration
- thin adapters over shared backend semantics
- inspectable and replayable workflows over opaque automation
- small, testable increments that move candidate ideas toward real evaluation workflows

The roadmap should stay selective. Detailed task inventory belongs in the state folders, not here.