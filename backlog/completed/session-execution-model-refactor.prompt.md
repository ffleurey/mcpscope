# Coding agent prompt: session execution model refactor

Use the [Coding Agent](.github/agents/coding.agent.md) to implement [backlog/completed/session-execution-model-refactor.md](backlog/completed/session-execution-model-refactor.md).

Start by reading, in order:

- [backlog/completed/session-execution-model-refactor.md](backlog/completed/session-execution-model-refactor.md)
- [backlog/completed/session-backed-deterministic-harness-data-model.md](backlog/completed/session-backed-deterministic-harness-data-model.md)
- [AGENTS.md](AGENTS.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DATA-MODEL.md](DATA-MODEL.md)
- [TESTING.md](TESTING.md)
- [CLI.md](CLI.md)
- [MCP.md](MCP.md)

Follow the branch and PR workflow in [.github/agents/coding.agent.md](.github/agents/coding.agent.md):

- create or switch to the feature branch named from the backlog task slug
- keep the work scoped to this task
- prepare or update the PR to `main` at the end

Implementation guidance:

- do not restate or redesign the task; implement from the backlog file and linked canonical docs
- preserve backend-owned semantics and adapter parity
- keep machine-readable outputs stable unless the task explicitly calls for a change
- keep the frontend thin; do not move runtime ownership into the UI
- use the step sequence in the implementation task as the execution order
- at the end of each step increment, stop at the gate defined in the task and verify that the work is still on track before continuing
- if a gate fails or the implementation starts to drift from the specification, stop and report the smallest concrete blocker or planning question rather than pushing through all remaining steps
- prefer focused validation after each substantive slice, then broader validation as the task requires
- update only the documentation needed to keep the implementation and canonical docs aligned

When you finish, return:

- branch name
- backlog task completed
- short implementation summary
- validation run
- remaining risks, open questions, or review-sensitive areas
