# Coding agent prompt: execution scheduler

Use the [Coding Agent](.github/agents/coding.agent.md) to implement [backlog/implementation/execution-scheduler.md](backlog/implementation/execution-scheduler.md).

Start by reading, in order:

- [backlog/implementation/execution-scheduler.md](backlog/implementation/execution-scheduler.md)
- [AGENTS.md](AGENTS.md)
- [README.md](README.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DATA-MODEL.md](DATA-MODEL.md)
- [TESTING.md](TESTING.md)

Then read the nearest implementation surfaces named in the task, especially:

- [backend/src/domain/executionModel.ts](backend/src/domain/executionModel.ts)
- [backend/src/runtime/chatSession.ts](backend/src/runtime/chatSession.ts)
- [backend/src/analysis/analysisSession.ts](backend/src/analysis/analysisSession.ts)
- [backend/src/operations/send.ts](backend/src/operations/send.ts)
- [backend/src/operations/executeAnalysis.ts](backend/src/operations/executeAnalysis.ts)
- [backend/src/persistence/repositoryRuntime.ts](backend/src/persistence/repositoryRuntime.ts)
- [backend/src/app.ts](backend/src/app.ts)
- [backend/src/app.test.ts](backend/src/app.test.ts)
- [frontend/src/lib/backendTypes.ts](frontend/src/lib/backendTypes.ts)
- [frontend/src/lib/api/backendClient.ts](frontend/src/lib/api/backendClient.ts)
- [frontend/src/lib/sessionStore.ts](frontend/src/lib/sessionStore.ts)
- [frontend/src/lib/traceStreaming.ts](frontend/src/lib/traceStreaming.ts)

Follow the branch and PR workflow in [.github/agents/coding.agent.md](.github/agents/coding.agent.md):

- create or switch to the feature branch named from the backlog task slug
- keep the work scoped to this task
- prepare or update the PR to `main` at the end

Implementation guidance:

- do not redesign the task; implement from the backlog file and its milestones, gates, and acceptance checks
- keep the scheduler generic over `Session` and `Step` targets; do not introduce workflow-specific job types
- keep the queue in memory only for this increment
- migrate existing execution entrypoints to enqueueing rather than preserving a second long-term execution path
- keep runtime ownership in the backend; do not move execution control or canonical scheduler state into the frontend
- use the milestone order in the task as the implementation order
- at each gate, stop and verify that the branch still matches the task before continuing
- prefer focused validation after each substantive slice, then broader validation as the task requires
- update only the documentation needed to keep canonical docs and the implementation aligned

When you finish, return:

- branch name
- backlog task completed
- short implementation summary
- validation run
- remaining risks, open questions, or review-sensitive areas
