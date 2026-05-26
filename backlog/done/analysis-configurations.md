# Analysis configurations

This increment adds the configuration surface needed before analysis sessions can run.

Branch for implementation: `analysis-configurations`

Status: completed and merged from PR #13.

## Dependency

- `backlog/done/session-metadata-foundation.md`

## Goal

Introduce dedicated analysis profiles so analysis sessions do not depend on ordinary session-creation defaults.

This increment should leave mcpscope with a first-class analysis configuration surface that is usable and testable before any analysis runner exists.

## Fixed decisions for this increment

These decisions should be treated as part of the task, not rediscovered during implementation:

- this branch implements configuration only; it does **not** implement analysis launch, report generation, restricted MCP tools, tree navigation, or follow-up UX
- analysis configuration is **separate** from session-creation defaults
- analysis profiles are a first-class config record, parallel to model configs and MCP profiles
- v1 analysis profiles reference an existing **model config** by ID rather than duplicating LM connection/model selection fields directly
- v1 analysis profiles own their own `systemPrompt`, `temperature`, and optional `reasoning` setting
- v1 analysis profiles do **not** bind an MCP profile yet
- support multiple named analysis profiles and exactly one optional default analysis profile
- deleting a default analysis profile must be rejected until the default is changed or cleared
- deleting a model config that is still referenced by one or more analysis profiles must be rejected

## Concrete v1 data model

Use a backend/frontend shape equivalent to:

```ts
interface AnalysisProfile {
  id: string
  name: string
  modelConfigId: string
  systemPrompt: string
  temperature: number
  reasoning?: 'on' | 'off'
  createdAt: number
  updatedAt: number
}

interface AnalysisDefaults {
  defaultAnalysisProfileId: string | null
  updatedAt: number
}
```

Notes:

- `modelConfigId` must reference an existing ordinary model config
- `reasoning` should follow the same optional shape already used by model configs
- analysis defaults must remain separate from `session_creation_defaults`

## Scope

- define persisted analysis-profile records
- support multiple named analysis profiles
- support one default analysis profile
- store the profile fields needed for v1 analysis runs:
  - referenced model config
  - system prompt
  - temperature
  - optional reasoning setting
- add backend CRUD plus frontend configuration UI
- refactor the current configuration area if needed so this is not added as an ad-hoc special case

### Backend persistence

Implement this using the same repository pattern already used for LM connections, model configs, and MCP profiles.

- add an `analysis_profiles` table parallel to the existing JSON-backed config tables
- add an `analysis_defaults` singleton table parallel in spirit to `session_creation_defaults` but kept separate from it
- add additive schema migrations so existing databases upgrade in place
- bootstrap the singleton defaults row with `INSERT OR IGNORE`

Repository helpers should be added for:

- `upsertAnalysisProfile`
- `listAnalysisProfiles`
- `deleteAnalysisProfile`
- `getAnalysisDefaults`
- `upsertAnalysisDefaults`

### Backend API

Add backend-owned HTTP routes following the current config CRUD style:

- `GET /api/analysis-profiles`
- `PUT /api/analysis-profiles/:analysisProfileId`
- `DELETE /api/analysis-profiles/:analysisProfileId`
- `GET /api/analysis-defaults`
- `PUT /api/analysis-defaults`

Expected response shapes:

- `GET /api/analysis-profiles` -> `{ analysisProfiles: AnalysisProfile[] }`
- `PUT /api/analysis-profiles/:id` -> `{ analysisProfile: AnalysisProfile }`
- `GET /api/analysis-defaults` -> `{ analysisDefaults: AnalysisDefaults }`
- `PUT /api/analysis-defaults` -> `{ analysisDefaults: AnalysisDefaults }`

### Validation rules

The backend must enforce these rules:

- path ID and body ID must match on `PUT /api/analysis-profiles/:analysisProfileId`
- `modelConfigId` must exist when an analysis profile is saved
- `defaultAnalysisProfileId`, when non-null, must exist when defaults are updated
- deleting the current default analysis profile must return a conflict
- deleting a model config that is referenced by any analysis profile must return a conflict

Recommended structured error codes:

- `analysis_profile_model_config_not_found`
- `default_analysis_profile_not_found`
- `default_analysis_profile_in_use`
- `model_config_in_use_by_analysis_profile`

### Frontend surface

Add a new configuration view in the same area as the existing connection/model/MCP configuration views.

- add a new top-level navigation target for analysis profiles
- add an `Analysis Profiles` entry under the Configuration section in the sidebar
- add a dedicated list/create/edit view component
- add a dedicated form component
- use the same store/API/component patterns already used for model configs and MCP profiles

The UI should support:

- list profiles
- create profile
- edit profile
- delete profile
- set as default
- clear default

The form should expose:

- `name`
- `modelConfigId` selector
- `temperature`
- optional `reasoning`
- `systemPrompt`

If there are no model configs yet, the UI should show a clear empty state and avoid a broken create flow.

### Documentation and code organization

Prefer extending the existing config architecture rather than creating a special-case analysis subsystem.

The expected implementation seams are:

- backend schema/config types/repository/app tests
- frontend backend-types/API/store/nav/components

The task should be implemented with minimal API and UI drift from the existing config surfaces.

## Non-goals

- no analysis-session launch yet
- no report generation yet
- no follow-up/viewing workflow yet
- no restricted analysis MCP tool subset yet
- no session tree navigation work
- no benchmark-specific analysis configuration

## Testability

This increment should be covered by:

1. backend CRUD tests for analysis profiles and default selection
2. validation tests for missing/deleted default profile references
3. validation tests that reject unknown `modelConfigId` references
4. validation tests that reject deleting a model config still referenced by an analysis profile
5. frontend checks that the configuration UI can create, edit, select, clear, and default profiles

Recommended validation order during implementation:

1. focused backend Vitest coverage for the new analysis-profile routes and constraints
2. `npm run check:backend`
3. `npm run check`

## Expected result

After this increment:

- mcpscope has a first-class analysis configuration surface
- analysis model/prompt experimentation is possible before the analysis runner itself is added
- the next increment can launch an analysis session by selecting either the default or an explicit analysis profile

## Implementation anchors

The coding agent should start from these existing files and patterns before editing:

- `backlog/done/analysis-configurations.md` — this task, the source of truth for the increment
- `backend/src/domain/configuration.ts` — existing config schemas and types
- `backend/src/persistence/schema.ts` — SQLite schema and additive migrations
- `backend/src/persistence/repository.ts` — config persistence helpers and defaults helpers
- `backend/src/app.ts` — config CRUD routes and validation patterns
- `backend/src/app.test.ts` — backend API test patterns for config CRUD
- `frontend/src/lib/types.ts` — frontend config and nav types
- `frontend/src/lib/backendTypes.ts` — response schemas mirrored from backend
- `frontend/src/lib/api/backendClient.ts` — typed backend client helpers
- `frontend/src/lib/connectionStore.ts` — config stores and defaults wiring
- `frontend/src/App.svelte` — top-level view switching
- `frontend/src/lib/components/Sidebar.svelte` — config navigation entry points
- `frontend/src/lib/components/ModelConfigs.svelte` — list/default UI pattern to mirror
- `frontend/src/lib/components/ModelConfigForm.svelte` — form pattern to mirror
- `frontend/src/lib/components/McpProfiles.svelte` — default/clear-default UI pattern to mirror

## Agent handoff note

The coding agent should treat this file as the authoritative task definition for the `analysis-configurations` branch.

The recommended reading order is:

1. this task file
2. existing backend config schemas/repository/routes/tests
3. existing frontend config types/API/store/components
4. then implement the smallest end-to-end slice that makes backend CRUD and validation real before finishing the frontend wiring
