# Session batch runs

This task tracks a future workflow for creating and running **batches of sessions** on purpose.

## Problem

Today, testers sometimes want to evaluate:

- repeatability for the **same prompt**
- robustness across **slightly different prompts**
- behavior across a predefined **prompt set**

Right now, the system should prevent overlapping runs and keep experiments strictly sequential.

That is the correct short-term behavior.

But in the future, users will still need a convenient way to ask mcpscope to run:

- the same prompt N times
- a list of prompts one after another
- a named experiment batch that produces multiple sessions

without scripting that orchestration manually outside the product.

## Goal

Add a first-class **batch experiment** workflow that creates and runs multiple sessions in a controlled sequential order.

## Important scope boundary

This task is **not** about parallelism.

The intended model is:

- batch creation and execution are supported
- but the runs still execute **sequentially**, one after the other
- the global single-active-session rule remains compatible with that behavior

## Candidate capabilities

### 1. Repeat the same prompt

Examples:

- run prompt X 5 times against the same default setup
- compare how stable tool selection and final answers are across repeated runs

### 2. Run a prompt list

Examples:

- submit a small file or list of prompts
- create one session per prompt
- execute them in order

### 3. Batch metadata

Possible future needs:

- batch ID / experiment ID
- optional label
- per-run status
- summary of completed / failed runs

### 4. Batch-aware inspection

Possible future needs:

- list all sessions belonging to one batch
- compare outcomes across repeated runs
- identify regressions or instability

## Likely design direction

- keep one session per run so existing inspect/trace/session semantics remain intact
- add batch-level orchestration on top rather than overloading one session with many unrelated prompts
- preserve sequential execution so LM/MCP contention stays controlled

## Out of scope for now

- parallel experiment execution
- statistical analysis UI
- automatic scoring
- rich compare/replay tooling

## Dependency note

This task should follow the global lock / single-active-session work.

That lock gives the product a clear execution model first; batch runs can then be built as an intentional sequential scheduler on top of it.
