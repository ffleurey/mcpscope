# Coding agent prompt: execution scheduler gap closure

Use the [Coding Agent](.github/agents/coding.agent.md) to implement [backlog/implementation/execution-scheduler-gap-closure.md](backlog/implementation/execution-scheduler-gap-closure.md).

Start by reading, in order:

- [backlog/implementation/execution-scheduler-gap-closure.md](backlog/implementation/execution-scheduler-gap-closure.md)
- [backlog/implementation/execution-scheduler.md](backlog/implementation/execution-scheduler.md)
- [AGENTS.md](AGENTS.md)
- [README.md](README.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DATA-MODEL.md](DATA-MODEL.md)
- [TESTING.md](TESTING.md)

Then read the nearest implementation surfaces named in the task, especially:

- [backend/src/runtime/scheduler.ts](backend/src/runtime/scheduler.ts)
- [backend/src/app.ts](backend/src/app.ts)
- [backend/src/operations/send.ts](backend/src/operations/send.ts)
- [backend/src/operations/executeAnalysis.ts](backend/src/operations/executeAnalysis.ts)
- [backend/src/operations/errors.ts](backend/src/operations/errors.ts)
- [backend/src/analysis/analysisSession.ts](backend/src/analysis/analysisSession.ts)
- [backend/src/domain/executionModel.ts](backend/src/domain/executionModel.ts)
- [backend/src/app.test.ts](backend/src/app.test.ts)
- [frontend/src/lib/backendTypes.ts](frontend/src/lib/backendTypes.ts)
- [frontend/src/lib/api/backendClient.ts](frontend/src/lib/api/backendClient.ts)
- [frontend/src/lib/executionStore.ts](frontend/src/lib/executionStore.ts)
- [frontend/src/lib/sessionStore.ts](frontend/src/lib/sessionStore.ts)

Follow the branch and PR workflow in [.github/agents/coding.agent.md](.github/agents/coding.agent.md):

- create or switch to the feature branch named from the backlog task slug
- keep the work scoped to this task
- prepare or update the PR to `main` at the end

Implementation guidance:

- this is a gap-closing follow-up, not a fresh scheduler redesign
- keep the scheduler generic over session and step targets
- route analysis Step behavior through real scheduler step execution
- restore the user-visible Step semantics before doing adjacent cleanup
- make session-switch stream continuity work from deterministic frontend state reconstruction
- require automated tests for each reviewed gap wherever the environment supports it
- prefer focused validation after each substantive slice, then run the full validation set required by the task
- keep documentation changes narrow and only where the corrected contract needs to be reflected

When you finish, return:

- branch name
- backlog task completed
- short implementation summary
- tests added or updated
- validation run
- remaining risks, open questions, or review-sensitive areas