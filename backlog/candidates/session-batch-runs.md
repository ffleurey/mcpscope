# Session batch runs

This task tracks a future workflow for creating and running **batches of sessions** on purpose.

## Problem

Today, testers sometimes want to evaluate:

- repeatability for the **same prompt**
- robustness across **slightly different prompts**
- behavior across a predefined **prompt set**
- behavior of one specific **version of the MCP server under test**

Right now, the system should prevent overlapping runs and keep experiments strictly sequential.

That is the correct short-term behavior.

But in the future, users will still need a convenient way to ask mcpscope to run:

- the same prompt N times
- a list of prompts one after another
- a named experiment batch that produces multiple sessions
- a group of sessions that all belong to the same evaluation campaign or MCP version

without scripting that orchestration manually outside the product.

## Goal

Add a first-class **batch experiment** workflow that creates and runs multiple sessions in a controlled sequential order, while preserving a first-class notion of an **experiment** or **session group**.

## Important scope boundary

This task is **not** about parallelism.

The intended model is:

- batch creation and execution are supported
- but the runs still execute **sequentially**, one after the other
- the global single-active-session rule remains compatible with that behavior

This task is about intentional orchestration and grouping, not about weakening the global execution model.

## Candidate capabilities

### 1. Repeat the same prompt

Examples:

- run prompt X 5 times against the same default setup
- compare how stable tool selection and final answers are across repeated runs
- keep those sessions grouped under one experiment so they can be inspected together

### 2. Run a prompt list

Examples:

- submit a small file or list of prompts
- create one session per prompt
- execute them in order
- preserve prompt order and per-run identity within the experiment

### 3. Experiment / batch grouping

One important missing concept is that these runs usually belong to one named evaluation effort.

Examples:

- "ha-weather-tools v7"
- "compare wording variants for get_history"
- "May 2026 prompt-set regression"

Possible needs:

- experiment ID / batch ID
- experiment title / label
- optional description or notes
- creation time
- optional link to MCP version, git ref, or manual label
- one-to-many relation from experiment to sessions

The core product value is:

- create the experiment once
- see all sessions belonging to it
- inspect the experiment as a whole
- delete the whole experiment at once when it is no longer needed

### 4. Batch run metadata

- per-run status
- summary of completed / failed runs
- stable ordering of runs inside the experiment
- enough metadata to distinguish:
  - repeated runs of the same prompt
  - prompt-set runs
  - ad-hoc single sessions that are not part of a batch

### 5. Batch-aware inspection and lifecycle

Possible future needs:

- list all sessions belonging to one experiment
- inspect the experiment summary first, then drill into sessions
- compare outcomes across repeated runs
- identify regressions or instability
- delete an entire experiment in one action instead of deleting sessions one by one
- keep normal session-level inspect/export behavior intact inside the experiment

### 6. Experiment-level operations

Minimum likely operations:

- create an experiment definition
- add repeated runs or a prompt list
- run the experiment sequentially
- list experiments
- inspect one experiment
- delete one experiment and all of its sessions

## Likely design direction

- keep one session per run so existing inspect/trace/session semantics remain intact
- add experiment-level orchestration on top rather than overloading one session with many unrelated prompts
- preserve sequential execution so LM/MCP contention stays controlled
- treat experiments as a grouping and lifecycle layer above sessions, not as a replacement for sessions
- make experiment deletion explicit and safe because it implies deleting multiple sessions
- in the future typed parent-linked session model, a primary run session may optionally belong to a benchmark/experiment parent object

## Out of scope for now

- parallel experiment execution
- statistical analysis UI
- automatic scoring
- rich compare/replay tooling
- automatic inference of MCP version from git without an explicit design

## Dependency note

This task should follow the global lock / single-active-session work.

That lock gives the product a clear execution model first; experiment batches can then be built as an intentional sequential scheduler on top of it.

It also overlaps conceptually with future naming and metadata work because experiments will need clear labels and grouping semantics.

It should also align with:

- `backlog/candidates/session-types-and-parent-links.md`

so benchmark/experiment grouping and child analysis/synthesis sessions do not end up with competing ownership models.
