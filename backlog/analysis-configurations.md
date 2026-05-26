# Analysis configurations

This increment adds the configuration surface needed before analysis sessions can run.

## Dependency

- `backlog/session-metadata-foundation.md`

## Goal

Introduce dedicated analysis profiles so analysis sessions do not depend on ordinary session-creation defaults.

## Scope

- define persisted analysis-profile records
- support multiple named analysis profiles
- support one default analysis profile
- store the profile fields needed for v1 analysis runs:
  - model selection
  - system prompt
  - temperature / reasoning settings if needed
- add backend CRUD plus frontend configuration UI
- refactor the current configuration area if needed so this is not added as an ad-hoc special case

## Non-goals

- no analysis-session launch yet
- no report generation yet
- no follow-up/viewing workflow yet

## Testability

This increment should be covered by:

1. backend CRUD tests for analysis profiles and default selection
2. validation tests for missing/deleted default profile references
3. frontend checks that the configuration UI can create, edit, select, and default profiles

## Expected result

After this increment:

- mcpscope has a first-class analysis configuration surface
- analysis model/prompt experimentation is possible before the analysis runner itself is added
