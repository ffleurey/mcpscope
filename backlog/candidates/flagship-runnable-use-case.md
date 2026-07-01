# Flagship runnable use-case (V1 doc example)

Status: **candidate** — deferred pending a decision on the featured MCP server (see Alternatives).
Tracked from [V1-RELEASE-PLAN.md → Milestone B (B4)](../V1-RELEASE-PLAN.md).

## Problem

mcpscope's documentation has the *ingredients* for a compelling story but they are disjoint:

- The **compelling domain example** (`case-study/USECASE-home-assistant-statistics.md`) is a
  design/spec document — no runnable commands, it references a private Home Assistant instance
  with real household data, and names a model that doesn't exist. It reads as internal direction,
  not a newcomer on-ramp.
- The **runnable command flows** (TUTORIAL.md §4–7, BENCHMARK.md's tutorial) are accurate but use
  a generic placeholder "weather server", so they never connect to a concrete, motivating scenario.

The result: a newcomer can't see the value in one runnable pass. There is no single example that a
reader can copy-paste, run end-to-end, and come away understanding *why* mcpscope exists.

## Motivation

This is the single highest-leverage documentation item for V1 (per the audit). The point of
mcpscope — observe context/token usage on small local models, watch how a model picks and calls
tools, then change one thing (a tool description, a parameter, an output payload) and re-run to see
the number move — only lands when a reader can *do it*. A flagship example is what turns "looks
interesting" into "I'll use this on my own MCP server."

## What the example must demonstrate (end to end)

One copy-pasteable walkthrough that:

1. Points at a **concrete MCP server a newcomer can actually run** (no private setup, no real
   personal data).
2. Walks: create session → send a prompt → **inspect** every part / tool definition / context bar
   and token accounting → build a **benchmark** (add cases, expected tools, checks) → run it N times
   → read the per-tool/per-case report → add a **rubric** and run an LLM **evaluation** pass.
3. Makes the core loop concrete: **change one tool description / parameter / output payload, re-run,
   and watch the metric move.** This is the "aha" the whole tool is built around.
4. Ideally works on a **small local model** (8k–64k context) so the context-observability angle is
   visible, not just remote-model plumbing.

## The featured MCP server — needs a decision (+ research)

The example is only as good as the server it drives. The server should be trivial to run yet have
**data characteristics that illustrate mcpscope's point** — i.e. tools whose descriptions,
parameters, and payload sizes actually matter for how a small model behaves (token-heavy results,
several similar tools that are easy to confuse, parameters that are easy to get wrong, results that
reward a good vs. a lazy summary). A pure "echo"/"add two numbers" toy is too trivial to show
anything interesting.

**TODO (research):** survey what the community uses as "toy"/reference MCP servers for demos and
testing, and judge which have enough data richness to make the mcpscope loop visible. Look at the
official reference servers (e.g. filesystem, fetch, git, memory/knowledge-graph, sqlite/database,
time), popular community demo servers, and any purpose-built "example" servers. Capture the
shortlist and trade-offs here before building.

### Alternatives

1. **Tiny bundled/example MCP server shipped in this repo** *(current recommendation).*
   A few purpose-built toy tools with deliberately interesting data characteristics (a small
   dataset behind a couple of query/stat tools, token-heavy vs. compact result variants, two
   easily-confused tools). Fully self-contained and reproducible — zero external setup — and we can
   design the tools specifically to showcase the "change one thing, re-run" loop.
   - Pros: zero dependencies, perfectly reproducible, tuned to make the point, no data-privacy risk.
   - Cons: we build and maintain it; must feel realistic, not contrived.

2. **A well-known public reference MCP server** (e.g. filesystem, fetch, sqlite).
   - Pros: realistic, already trusted, nothing for us to maintain.
   - Cons: adds a setup dependency; its tools weren't designed to illustrate mcpscope; behavior may
     drift with upstream versions.

3. **Sanitized version of the Home Assistant case study.**
   - Pros: keeps the real, motivating narrative already written.
   - Cons: needs a runnable HA (or a stand-in) plus fabricated data; heaviest setup; highest effort.

## Acceptance criteria

- A newcomer with Node + one LLM backend (local or OpenRouter) can run the example end-to-end from
  copy-paste, no private assets.
- No real personal/household data anywhere in the example.
- The walkthrough explicitly shows the change-one-thing-and-re-run loop with a before/after metric.
- The example is wired into the docs (TUTORIAL/BENCHMARK or a dedicated `examples/` doc) and the
  featured server, if bundled, lives in the repo with its own short README.
- Retire or fold in the current `case-study/` HA spec so there is one example story, not two
  disjoint ones (and no personal data ships — see Milestone D).

## Notes

- Related audit context: README/TUTORIAL install story and the case-study gaps are in the V1 plan
  (Milestones B and D). Data-privacy cleanup of the existing `case-study/` + `exports/` is a
  Milestone D (extraction) item; the *new* example must be clean from the start.
