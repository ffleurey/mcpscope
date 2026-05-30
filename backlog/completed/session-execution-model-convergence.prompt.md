# Coding agent prompt: session execution model convergence

Use the [Coding Agent](.github/agents/coding.agent.md) to implement [backlog/completed/session-execution-model-convergence.md](backlog/completed/session-execution-model-convergence.md).

This is a follow-up increment on the existing `session-execution-model-refactor` branch / PR. Treat it as the final convergence cleanup for the current refactor, not as a new product initiative.

## Read first

Read these in order before editing:

- [backlog/completed/session-execution-model-convergence.md](backlog/completed/session-execution-model-convergence.md)
- [backlog/completed/session-execution-model-refactor.md](backlog/completed/session-execution-model-refactor.md)
- [backlog/completed/session-backed-deterministic-harness-data-model.md](backlog/completed/session-backed-deterministic-harness-data-model.md)
- [AGENTS.md](AGENTS.md)
- [.github/agents/coding.agent.md](.github/agents/coding.agent.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DATA-MODEL.md](DATA-MODEL.md)
- [TESTING.md](TESTING.md)
- [CLI.md](CLI.md)
- [MCP.md](MCP.md)

Then inspect the current implementation surfaces most likely to be involved:

- [backend/src/persistence/db.ts](backend/src/persistence/db.ts)
- [backend/src/persistence/schema.ts](backend/src/persistence/schema.ts)
- [backend/src/persistence/schemaV2.ts](backend/src/persistence/schemaV2.ts)
- [backend/src/persistence/repository.ts](backend/src/persistence/repository.ts)
- [backend/src/persistence/repositoryCompat.ts](backend/src/persistence/repositoryCompat.ts)
- [backend/src/persistence/repositoryV2.ts](backend/src/persistence/repositoryV2.ts)

## Branch / PR context

- stay on the existing branch and update the existing PR
- keep the work tightly scoped to this convergence increment
- do not broaden into new workflow features or benchmark product work

## Implementation intent

The refactor is already behaviorally landed. This increment is about cleaning up the remaining transitional seams that should not ship as the long-term architecture.

Focus on three outcomes:

1. make the startup/schema ownership story singular and truthful
2. remove `compat` framing from the canonical runtime repository path
3. update docs so remaining intentional limitations are explicit and centralized

## Specific guidance

### 1. Persistence startup/schema cleanup

- start from [backend/src/persistence/db.ts](backend/src/persistence/db.ts)
- determine the smallest safe change that stops normal startup from creating obsolete v1 runtime tables if they are no longer used
- if needed, split config/singleton table initialization out from legacy runtime-table initialization
- update schema comments to describe the landed architecture, not an earlier porting phase

### 2. Repository convergence

- start from [backend/src/persistence/repository.ts](backend/src/persistence/repository.ts) and [backend/src/persistence/repositoryCompat.ts](backend/src/persistence/repositoryCompat.ts)
- keep existing caller behavior stable
- remove or minimize the apparent compatibility layer on the canonical runtime path
- do not add a fresh abstraction layer unless it clearly simplifies the implementation rather than hiding it

### 3. Documentation cleanup

- update the canonical docs touched by this cleanup only where needed
- make the current limitations easy to find and evaluate
- remove wording that falsely suggests the refactor is still in mid-port when it has actually landed

## Constraints

- preserve backend/API/CLI/MCP/UI behavior for current workflows
- keep machine-readable outputs stable unless a correction is necessary
- prefer minimal, high-confidence edits
- do not drift into “using the new architecture” feature work yet

## Validation expectations

At minimum run:

- `npm run check:backend`
- `npm test -- backend/src/sessionMetadata.test.ts`
- `npm test -- backend/src/app.test.ts -t "analysis launch|send|sessions|trace|status"`

Run these when applicable:

- `npm test` if the persistence cleanup changes enough backend behavior to justify broader deterministic coverage
- `npm run check:cli` if CLI code changes or CLI-facing contract wording materially changes
- `npm run check` if frontend code changes

## Deliverable

Update the current branch / PR with the smallest convergence increment that satisfies the implementation task.

When you finish, return:

- branch name
- PR updated
- exact transitional seams removed or reduced
- concise implementation summary
- validation run
- any remaining deliberate limitations that should be planned as the next task rather than hidden in this PR