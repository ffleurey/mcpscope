# Session types and parent links

This task adds the general model for **different kinds of sessions** and for **sessions that belong to another parent object**.

## Problem

mcpscope currently treats sessions as one flat category of top-level runtime objects.

That is good enough for normal user and evaluation sessions, but it is not enough for future internal workflows such as:

- per-session analysis
- advanced context compaction
- benchmark-level synthesis

Those workflows should reuse normal session runtime, persistence, and inspectability, but they are not ordinary top-level sessions.

Examples:

- a session-analysis run only makes sense if the base session it analyzes exists
- a compaction session only makes sense if the target object it is compacting exists (session in v1, turn later)
- a benchmark-analysis session only makes sense if the benchmark it summarizes exists
- a normal benchmark run may also need to belong to a benchmark parent object

Without a general model, those sessions risk becoming:

- ad-hoc special cases
- hard to place in the UI
- hard to delete safely
- hard to reason about across features

## Goal

Add a general session metadata model with:

1. a persisted **session type**
2. a persisted **parent reference**
3. type-specific rules for what parent kinds are allowed or required

The important design rule is:

> A session keeps the normal mcpscope runtime/session machinery, but its `session_type` and `parent_ref` determine what it is for and where it belongs.

## Core idea

The canonical runtime tree should stay the same:

- Session
  - Setup
  - Turn[]
    - Round[]
      - Part[]

This task is **not** about creating a second runtime tree.

It is about adding metadata around sessions so mcpscope can represent:

- top-level primary sessions
- internal child sessions attached to another object
- primary sessions that optionally belong to a benchmark/experiment parent

## Parent model

Architecturally, the model should be:

- `session_type`
- `parent_ref`

`parent_ref` is one concept even if persistence uses multiple fields internally.

The parent is **not** limited to another session.
The allowed parent kind depends on the `session_type`.

### v1 simplification

To keep v1 simple:

- do **not** support `turn` parents yet
- support only:
  - `session` parent
  - `benchmark` parent

Turn-level parent references can be added later when compaction work needs them.

Examples:

- `primary` → optional parent: `benchmark`
- `session_analysis` → required parent: `session`
- `session_compaction` → required parent: `session` (v1), `turn` later
- `benchmark_analysis` → required parent: `benchmark`

Equivalent naming is fine, but the concept should remain:

- one session type
- one parent reference
- validation rules derived from the type

Persistence shape can vary, but v1 should make two operations straightforward:

1. fetch parent for one session
2. fetch all child sessions for one parent

The storage model should optimize for those reads because the GUI tree view depends on them.

## Desired behavior

### 1. Typed sessions

mcpscope should persist a clear session classification.

Likely examples:

- `primary`
- `session_analysis`
- `session_compaction`
- `benchmark_analysis`

This classification must exist in backend/runtime behavior, not only in the UI.

### 2. Parent-linked sessions

Some session types must have a parent.

In v1, that parent may be:

- a session
- a benchmark / experiment

Future extensions may add other parent kinds such as `turn` when needed.

The allowed parent kinds should be explicit per session type.

### 3. Lifecycle tied to the parent

Parent-linked sessions should not behave like free-floating top-level sessions.

The model should support rules such as:

- a session-analysis run should not exist without its base session
- a benchmark-analysis run should not exist without its benchmark
- deleting a parent should cascade-delete attached sessions consistently

### 4. Reuse normal session tooling

Even when typed and parent-linked, these objects should still reuse:

- normal session persistence
- normal trace/inspect flows
- normal session rendering
- normal debugging affordances

The goal is not to invent a second concept beside sessions.

### 5. Visibility by type

The product should support different default visibility behavior by session type.

Likely rule:

- `primary` sessions visible in the normal session list
- internal workflow sessions hidden from the normal session list by default
- internal sessions still inspectable from the parent object and from dedicated debug/development views

### 6. Tree view in the GUI

The left-pane session browser should evolve from a flat list to a tree view that reflects parent relationships.

Short-term desired behavior:

- by default, show **primary sessions only**
- provide a toggle such as `primary sessions only`
- that toggle should be enabled by default
- when disabled, non-primary sessions should become visible in the tree under the parent object they relate to
- sort siblings by creation time, newest first
- show a compact fixed-width date/time in the tree item row using `DD/MM HH:MM`
- use distinct visual treatment (icon/badge) for primary vs non-primary session types
- all session labels should begin with the 4-letter session ID

Examples:

- a `session_analysis` child should appear under the analyzed session
- a `session_compaction` child should appear under the session it belongs to in v1
- when benchmarks/experiments are introduced, benchmark parents should appear at the top level and hold their child sessions

The important UI rule is:

> parent-linked sessions should be visible where they belong, not mixed into the ordinary top-level session list as if they were unrelated sessions

## Scope

### Backend

- define persisted session type and parent-reference model
- define validation rules for allowed parent kinds per session type
- define lifecycle semantics for parent-linked sessions
- expose enough metadata for UI/CLI inspection and filtering
- keep existing normal sessions working as `primary` sessions

### UI

- keep the ordinary session list focused on ordinary top-level primary sessions by default
- add a tree view in the left pane that can reveal non-primary sessions under their parents
- add a default-on toggle such as `primary sessions only`
- support dedicated debug/development visibility for internal sessions without making the default session list noisy
- make the same tree model work later for benchmark/experiment parents at the top level

### CLI / API

- make the metadata inspectable
- avoid exposing misleading flat-session assumptions once typed parent-linked sessions exist
- for now, keep CLI and MCP list surfaces focused on primary sessions only unless a later task explicitly expands that scope
- keep runtime execution fully sequential across all session types in v1 (single LM Studio instance assumption)

## Relationship to other tasks

This is the foundation for:

- `backlog/session-analysis-agent.md`
- `backlog/session-compaction-agent.md`
- `backlog/benchmark-automation.md`
- `backlog/session-batch-runs.md`

Those tasks should build on this generalized model rather than each inventing their own session-linking semantics.

## Important design notes

- this is a session metadata / lifecycle task, not a new runtime-tree task
- the canonical setup/turn/round/part structure should stay unchanged
- the parent reference is one architectural concept even if persistence stores it in more than one field
- do not force all parents to be sessions; the parent kind depends on the session type
- the model should be explicit enough that future internal workflows do not need one-off hacks
- the GUI should reflect parent relationships directly in its navigation model rather than hiding them behind unrelated flat filters
- benchmarks can be specified later in detail; for this task, it is enough to treat them as parent objects that can contain sessions

## Expected result

After this task:

- mcpscope can represent multiple kinds of sessions explicitly
- some session types can require a parent object
- primary sessions can optionally belong to benchmark/experiment parents
- internal analysis/compaction/synthesis sessions can be attached where they belong
- the UI and lifecycle rules can reflect those relationships cleanly
