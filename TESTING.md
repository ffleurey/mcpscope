# Testing Plan

## Why this work comes first

This project cannot safely evolve while its core value proposition is untested.

The highest-risk logic is:

- token attribution
- context inclusion/exclusion rules
- reasoning preservation and stripping policy
- round-by-round tool execution state
- reconstruction of model-visible payloads

The test strategy should start with the smallest framework that fits the stack and the problem.

## Test framework recommendation

Use **Vitest**.

Why:

- simplest fit for Vite + TypeScript
- fast startup
- good support for pure unit tests
- good mocking support for LM Studio and MCP client services
- easy to expand later if component tests are needed

Start with unit and integration-style logic tests. Do not begin with browser E2E tests.

## Test layers

### 1. Pure logic tests

These are the most important and should come first.

Target:

- token attribution helpers
- reasoning/context inclusion rules
- payload reconstruction
- context segment derivation
- round transition logic

These tests should use fixed fixtures and avoid UI or IndexedDB.

### 2. Turn pipeline tests

Once the monolith is split, test the orchestration with mocked dependencies:

- mock LM Studio streaming output
- mock MCP tool execution
- verify how rounds, parts, statuses, and token data evolve

These tests should prove the sequence of state transitions, not just the final text output.

### 3. Persistence tests

Add a small set of tests for:

- saving/loading sessions
- saving/loading turns and parts
- migration handling for the refactored schema

Keep these few and focused.

### 4. UI read-model tests

Only after the core logic is protected:

- context bar selector output
- transcript selector output
- export selector output

Prefer testing selectors over components when possible.

## Initial test suites

### A. Token provenance tests

Cases:

1. first-turn simple answer
2. non-first simple answer
3. first tool-calling turn
4. multi-round tool-calling turn
5. simple turn after a tool-calling turn
6. reasoning shown in chat but not forwarded later
7. reasoning forwarded inside a live multi-round turn

Assertions:

- token amounts
- provenance labels
- confidence labels
- exact vs estimated behavior

### B. Context membership tests

Cases:

1. visible and in-context
2. visible but historical-only
3. hidden from chat but in-context
4. reasoning preserved but stripped from later context
5. tool results included in the turn and then historical afterward

Assertions:

- exact payload reconstruction
- exact list of in-context parts at each step

### C. Turn pipeline tests

Cases:

1. simple model-only answer
2. single tool round
3. multiple tool rounds
4. tool failure
5. abort during streaming
6. context exhaustion

Assertions:

- statuses
- persisted objects
- timestamps and finish reasons
- round outputs
- resulting transcript/context views

### D. Regression fixtures

Create a small fixture library from real or sanitized sessions:

- model-only session
- tool-heavy session
- reasoning-heavy session
- edge case with truncated output

These fixtures should be reusable across many tests.

## Testing rules for the refactor

1. New pure calculation code must not ship without tests.
2. Every bug fixed in token or context logic should add a regression test.
3. Prefer deterministic fixtures over live network calls.
4. Avoid snapshot-heavy tests for core logic; assert exact fields and formulas.
5. Keep UI tests secondary to model/state tests.

## Suggested execution order

1. install Vitest
2. add a minimal `test` script
3. create fixtures for turns, rounds, parts, and usage payloads
4. write tests for token attribution and reasoning/context rules
5. extract pure functions from `chatStore.ts`
6. move orchestration into a turn pipeline and test that flow
7. add persistence tests for the new schema

## Acceptance criteria

Testing is sufficient to resume feature work when:

1. core token and context rules are covered by automated tests
2. the turn pipeline can be exercised without the UI
3. regressions in reasoning stripping/history retention are caught automatically
4. context-bar output is derived from tested canonical state
5. `npm test`, `npm run check`, `npm run lint`, and `npm run build` are part of the normal development baseline

The immediate goal is not exhaustive coverage. The goal is to protect the core trust model of the product.
