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

That baseline now also includes the execution-model refactor:

- the canonical runtime vocabulary is `SessionContainer`, `Session`, `Step`, and `Turn`
- the backend runtime loop is explicit through `Session.execute()` / `advance()` / `canContinue()`
- persistence is generic by default for containers, sessions, and steps, with `Turn` retaining infrastructure-specific subtype persistence

Those completed increments matter because they define the shape of the next decisions. New work should build on the canonical runtime and operation layers rather than introducing parallel frontend-owned or adapter-owned flows.

## Current Direction

The current direction is to turn mcpscope from a single-session inspector into a stronger evaluation loop for MCP developers.

### 1. Make analysis a first-class backend-owned workflow

The immediate direction is no longer to harden the launch flow first. The immediate direction is to use the current shipped analysis workflow as an experimental harness to learn what trustworthy analysis actually requires.

But backend ownership is only half of the problem. The next critical question is analysis quality: the product needs an analysis process that is evidence-grounded, systematic, and resistant to lazy or hallucinatory summaries from smaller models.

That means the roadmap should prioritize analysis discipline before scaling analysis to batches or benchmark suites. A technically working analysis session is not yet enough if it can produce plausible but unsupported stories.

That experimental clarification work is captured in [specification/session-analysis-evidence-protocol.md](specification/session-analysis-evidence-protocol.md). The backend-owned launch follow-up should come after that work is concrete enough to say what workflow the backend is actually expected to own.

### 2. Strengthen inspectability and trust in operational workflows

The next layer of value is not more features for their own sake. It is making failures, streaming behavior, and CLI-driven workflows easier to understand and trust. The fast-lane fixes in [fixme/](fixme/) exist to improve day-to-day usability for both humans and coding agents without needing large design cycles.

### 3. Build toward evidence-grounded evaluation, not just free-form judgment

The next planning step on the analysis line is to define a stricter evaluation protocol for one session before trying to synthesize many sessions.

The likely direction is a constrained multi-step workflow rather than a single free-form prompt:

- deterministic session digest and structural coverage
- required inspection of setup, relevant turns, rounds, and parts
- explicit evidence extraction before diagnosis
- final compact synthesis that is only allowed to rely on gathered evidence

This is more agentic than the current MVP, but it should be constrained and backend-owned rather than open-ended.

That work is now captured by [specification/session-analysis-evidence-protocol.md](specification/session-analysis-evidence-protocol.md), and it should be treated as the next planning priority on the analysis line.

### 4. Build toward repeatable evaluation, not just isolated chats

The longer arc of the roadmap is repeatable session evaluation:

- child sessions that clearly belong to a parent workflow
- richer analysis follow-up and viewing
- eventually grouped runs, benchmark-style workflows, and higher-level synthesis

That is why parent-linked session metadata and analysis-specific workflows remain the main architectural spine of the backlog.

## Use Cases We Are Optimizing For

The backlog should be prioritized against these use cases:

- a developer debugging one MCP-backed run and needing precise trace and tool insight
- a developer rerunning and inspecting sessions through stable backend-owned CLI and MCP surfaces
- a developer evaluating whether a session met expectations through a dedicated analysis workflow that cites real session evidence instead of inventing a plausible story
- later, a developer comparing repeated runs or benchmark cases without losing inspectable evidence

If a task does not clearly support one of those use cases, it should be questioned, deferred, or rewritten.

## Near-Term Planning Guidance

Near-term planning should keep favoring:

- backend-owned execution paths over frontend orchestration
- thin adapters over shared backend semantics
- inspectable and replayable workflows over opaque automation
- analysis workflows that force evidence coverage before synthesis
- small, testable increments that move candidate ideas toward real evaluation workflows

The roadmap should stay selective. Detailed task inventory belongs in the state folders, not here.