# Coding agent prompt: session execution model refactor PR #16 follow-up

Use the [Coding Agent](.github/agents/coding.agent.md) to land a focused follow-up increment on the existing `session-execution-model-refactor` branch / PR.

This is not a restart of the task. Treat it as a review-driven completion pass for the already-open implementation of [backlog/completed/session-execution-model-refactor.md](backlog/completed/session-execution-model-refactor.md).

## Read first

Read these in order before editing:

- [backlog/completed/session-execution-model-refactor.md](backlog/completed/session-execution-model-refactor.md)
- [backlog/completed/session-backed-deterministic-harness-data-model.md](backlog/completed/session-backed-deterministic-harness-data-model.md)
- [AGENTS.md](AGENTS.md)
- [.github/agents/coding.agent.md](.github/agents/coding.agent.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DATA-MODEL.md](DATA-MODEL.md)
- [TESTING.md](TESTING.md)
- [CLI.md](CLI.md)
- [MCP.md](MCP.md)

Then inspect the current implementation surfaces called out by review:

- [backend/src/persistence/db.ts](backend/src/persistence/db.ts)
- [backend/src/persistence/schema.ts](backend/src/persistence/schema.ts)
- [backend/src/persistence/schemaV2.ts](backend/src/persistence/schemaV2.ts)
- [backend/src/persistence/repository.ts](backend/src/persistence/repository.ts)
- [backend/src/persistence/repositoryCompat.ts](backend/src/persistence/repositoryCompat.ts)
- [backend/src/domain/model.ts](backend/src/domain/model.ts)
- [backend/src/domain/executionModel.ts](backend/src/domain/executionModel.ts)
- [backend/src/app.ts](backend/src/app.ts)

## Branch / PR context

- Work on the existing task branch and update the existing PR instead of opening a new parallel implementation.
- Keep the increment tightly scoped to the review findings below.
- Do not broaden the product scope or redesign the task.

## Review findings to resolve

The current PR is close, but it does not yet cleanly satisfy the implementation task as written.

### 1. Finish the runtime/persistence convergence

The task's end-state for Step 9 is one clear runtime/persistence path for the refactored model. The current branch still initializes and validates both the legacy schema and the new schema in [backend/src/persistence/db.ts](backend/src/persistence/db.ts), while the docs now describe the v2 schema as the implemented canonical path.

Expected outcome:

- there is one clear canonical persistence path for the landed model
- no obsolete v1-only initialization or validation path remains silently required for normal runtime behavior
- if a narrow compatibility layer still needs to exist temporarily, it must be clearly justified, minimal, and must not contradict the docs or exported summaries

Concrete guidance:

- start from [backend/src/persistence/db.ts](backend/src/persistence/db.ts)
- decide whether legacy schema initialization/validation can now be removed from the startup path
- keep compatibility only where it is truly required for current behavior, not as a second canonical path
- make the smallest code change that brings the implementation into line with the Step 9 exit criteria

### 2. Align machine-readable summaries with the new canonical model

The runtime/docs now claim the canonical vocabulary is `SessionContainer`, `Session`, `Step`, and `Turn`, but the public backend summary exposed through [backend/src/app.ts](backend/src/app.ts) still comes from [backend/src/domain/model.ts](backend/src/domain/model.ts) and still reports the old domain-model version and old entity list.

Expected outcome:

- machine-readable summary output tells the truth about the landed implementation
- schema/domain summary does not advertise the pre-refactor model after the refactor is documented as complete
- tests are updated to lock the intended summary shape

Concrete guidance:

- inspect where `getDomainModelSummary()` is used in [backend/src/app.ts](backend/src/app.ts)
- update the exported summary, versioning, and/or source of truth so it matches the refactored model
- update focused tests for the backend summary / health / schema payload if the public payload changes
- keep adapter-facing output stable where possible, but do not preserve stale metadata just to avoid changing a test

### 3. Close the parity gap honestly

The implementation task requires backend, HTTP/API, CLI, MCP, and UI parity by the final gate. The current PR diff contains backend and docs work, but no CLI or frontend changes, and no validation evidence strong enough to justify claiming all rollout steps are complete.

Expected outcome:

- either the missing parity work is actually completed
- or the PR/task wording is narrowed so it no longer falsely claims work that was not done

Default preference:

- prefer completing the missing parity work if the remaining gap is small and local
- only narrow the claim if that is the technically correct outcome after inspection

Concrete guidance:

- review Step 7 through Step 9 in [backlog/completed/session-execution-model-refactor.md](backlog/completed/session-execution-model-refactor.md)
- inspect whether CLI, MCP, and frontend truly need code changes for this refactor, or whether they already ride unchanged on stable backend contracts
- if they need changes, implement the minimal required updates
- if they do not need changes, add the validation evidence and task/PR wording needed to make that explicit and reviewable
- do not leave the PR in a state where the code says one thing and the backlog/docs say another

## Constraints

- Preserve the backend-owned architecture described in [AGENTS.md](AGENTS.md) and [ARCHITECTURE.md](ARCHITECTURE.md).
- Do not introduce a second long-term abstraction layer just to keep legacy metadata alive.
- Keep changes minimal and merge-oriented.
- Update only the docs directly needed to keep implementation claims truthful.
- Prefer root-cause fixes over patching tests to fit stale behavior.

## Validation expectations

At minimum, run the validations that match the final changed surface:

- `npm run check:backend`
- `npm test -- backend/src/sessionMetadata.test.ts`
- `npm test -- backend/src/app.test.ts -t "analysis launch|send|sessions|trace|status"`

Run these as well when applicable:

- `npm run check:cli` if CLI code changes or if you continue to claim CLI parity as part of task completion
- `npm run check` if frontend code changes or if you continue to claim UI parity as part of task completion
- additional focused tests for any changed summary/schema/adapter surface

If the convergence work meaningfully changes persistence/runtime behavior, run the broader deterministic regression suite that best covers the touched slice.

## Deliverable

Update the existing branch / PR with the smallest increment that resolves the findings above.

When you finish, return:

- branch name
- PR updated
- exact review findings resolved
- concise implementation summary
- validation run
- any remaining risk that is real and review-worthy

If you discover that one of the requested completions would require scope beyond this PR, stop and report the smallest truthful follow-up split rather than quietly leaving the PR overstated.