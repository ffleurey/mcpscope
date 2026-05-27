# Session analysis launch and report

This increment delivers the first end-to-end analysis workflow.

Status: completed in the current PR, with the remaining backend-owned launch orchestration and CLI/MCP trigger work deferred to `backlog/specification/session-analysis-backend-owned-launch.md`.

## Dependencies

- `backlog/completed/session-metadata-foundation.md`
- `backlog/completed/analysis-configurations.md`

For the MVP, this task also absorbs the minimum tree-navigation work needed to show analysis child sessions beneath their parent. Use `backlog/specification/session-tree-navigation.md` as a design reference for tree shaping and display rules, not as a separate prerequisite branch.

## Goal

Allow a user or script to launch an analysis against one finished session and receive a compact structured report.

## Scope

### Analysis launch

- accept one target session plus an explicit analysis prompt describing the expectations for that session
- create a child session of type `session_analysis`
- bind it to the selected analysis profile
- connect it to mcpscope's own MCP server surface so it can inspect the target session
- run the first analysis turn automatically

### Analysis prompt input

Keep v1 input simple and useful for a real evaluator prompt.

- accept one freeform prompt from the user that gives the evaluation instructions and expectations for the session being analyzed
- this prompt may mention expected result, expected tools, expected tool sequence, failure modes, or any other evaluation guidance the user wants to supply
- do not require a rigid structured expectations schema in the MVP UI

This is guided evaluation, not deterministic exact matching.

### Restricted MCP tool subset

The analysis agent should use a restricted, session-focused tool surface, for example:

- inspect session
- inspect setup
- inspect turn
- inspect round
- inspect part
- fetch compact analysis-relevant metadata

It should **not** get broad operational tools such as:

- list all sessions
- create arbitrary sessions
- send arbitrary prompts outside the controlled analysis workflow

### MCP binding

The created analysis session must be wired to mcpscope's own MCP server endpoint rather than to an arbitrary external MCP profile.

- use the mcpscope-hosted MCP surface introduced by `backlog/completed/mcpscope-mcp-interface.md`
- the analysis session should be able to inspect the target session through that backend-owned surface
- the backend should provide the MCP snapshot/connection details for this internal analysis flow rather than asking the user to configure an MCP server for it
- the tool exposure on that endpoint must be restricted to the analysis-focused subset for this workflow

### Report contract

The output should be compact and stable, with sections such as:

- overall judgment
- expected vs observed outcome
- tool-use assessment
- main issues
- recommended next improvement

### Surfaces

- backend launch surface suitable for UI and CLI use
- UI launch flow integrated with tree navigation and the existing session view/components
- CLI command to analyze one session explicitly
- JSON output for automation
- text output for normal use

### Concrete execution seam

The implementation should follow the existing backend-owned operation pattern rather than inventing a frontend-only workflow.

- add a backend-owned analysis-launch execution path that creates the child session, binds its internal MCP snapshot, and starts the first turn
- expose that path through a backend HTTP route suitable for the existing frontend client
- expose the same backend-owned behavior through a CLI command for explicit one-session analysis
- keep the backend as the owner of the launch semantics, validation rules, prompt assembly, and MCP binding

For the UI, prefer extending the existing session store and backend client rather than creating a parallel analysis-specific state system.

### Required backend decisions

- launching analysis must reject unknown target sessions
- launching analysis must reject target sessions that are not eligible for evaluation in v1
- if no explicit analysis profile is supplied, use the configured default analysis profile
- if no default analysis profile exists and no explicit profile is supplied, return a clear validation error
- the created analysis session must persist `session_type = session_analysis`, `parent_kind = session`, and `parent_id = <target session id>`
- the created analysis session should get a sensible default title pattern derived from the selected analysis profile and/or target session

### Required frontend decisions

- reuse the existing session list/tree store rather than introducing a second navigation model
- extend the existing left-pane session component from flat-list rendering to tree rendering for this MVP slice
- after successful launch, refresh the session tree, reveal the created child session beneath its parent, select it, and switch to the normal chat view
- reuse the existing streaming path after selection rather than creating a separate analysis-only live update path

## MVP UI contract

This increment should make the analysis workflow usable in the product UI with the smallest possible amount of new UI while still using the parent/child tree.

Use the existing session selection, session transcript, live streaming, and composer surfaces rather than inventing a dedicated analysis viewer.

### Launch entry point

- allow launching an analysis from an existing finished base session in the current UI
- include the tree navigation behavior needed to show the created analysis session beneath its parent session
- do not build a split-pane or alternate viewing surface in this increment

### Launch form

The UI only needs a minimal launch form for:

- analysis profile selection, prefilled from the default analysis profile when one exists
- one freeform prompt field for the analysis instructions and expectations

The form can be implemented inline or as a simple modal, whichever best fits the existing component structure.

### Post-launch behavior

- once the child `session_analysis` session is created, immediately navigate to it
- after navigation, it should behave like any other active session in the existing chat view
- show live streaming through the normal transcript flow
- allow follow-up questions through the normal composer after the first analysis turn completes

### Tree visibility for v1

- the left-pane UI for this increment should use the tree model, not a flat list
- analysis sessions should appear beneath the base session they analyze
- the created child session should be visible in that tree immediately after launch
- keep the primary/non-primary visibility behavior simple, but do not fall back to a flat list for the MVP

The point of this MVP is not to postpone the parent/child navigation model. The MVP should already represent analysis sessions where they belong in the tree.

### Reuse of normal session behavior

- after the new child session is selected, it should stream and continue exactly like a normal session
- follow-up prompts should remain in the same analysis session
- this task should reuse the normal session transcript/composer behavior rather than invent a special analysis-only interaction model

## Prompt guidance

The initial analysis prompt should optimize for:

- trace-grounded reasoning
- concrete observations
- restrained claims
- low hallucination risk

The model should be pushed to:

- inspect setup before judging tool use
- cite observed evidence from the trace
- separate fact from interpretation
- evaluate the MCP tool surface, not just the model in isolation

## Non-goals

- no dedicated split-pane or alternate analysis window yet
- no benchmark automation yet
- no special analysis-only viewer beyond the normal session screen

## Testability

This increment should be covered by deterministic end-to-end tests for:

1. child analysis-session creation with correct parent link and type
2. default/non-default analysis profile selection
3. created analysis sessions are bound to mcpscope's own MCP endpoint and not an arbitrary external MCP profile
4. restricted tool-surface registration/exposure
5. compact report schema and CLI JSON shape
6. sequential locking behavior during analysis execution
7. UI launch navigates to the created analysis session and the normal chat view can stream and continue it
8. tree navigation shows analysis child sessions beneath their parent session and keeps them reachable after refresh

Recommended validation order during implementation:

1. focused backend tests for launch validation, child-session creation, internal MCP binding, and report output
2. focused frontend/component tests for tree rendering and post-launch navigation
3. `npm run check:backend`
4. `npm run check`

## Expected result

After this increment:

- mcpscope can launch a real analysis session against one finished session
- that analysis session produces a compact report
- that analysis session is connected to mcpscope's own MCP surface for inspection of the target session
- the UI can launch an analysis and immediately use it as a normal live session
- the UI shows analysis sessions in the tree beneath the session they analyze
- the result is scriptable and testable before the richer UI workflow lands

## Implementation anchors

The coding agent should start from these files and patterns before editing:

- `backlog/completed/session-analysis-launch-and-report.md` — this task, the source of truth for the increment
- `backlog/specification/session-tree-navigation.md` — design reference for tree shaping and display rules used by this MVP
- `backlog/completed/mcpscope-mcp-interface.md` — source of truth for the internal mcpscope MCP surface
- `backend/src/app.ts` — existing session routes, child-session route, and HTTP wiring patterns
- `backend/src/operations/createExplicit.ts` — backend-owned HTTP execution pattern to mirror for a frontend-consumed action
- `backend/src/operations/catalog.ts` and neighboring operations — CLI/MCP operation patterns to mirror when adding analysis launch
- `backend/src/persistence/repository.ts` — session summary listing, child-session lookup, and config lookup helpers
- `backend/src/app.test.ts` — backend API test patterns for session creation, streaming, and config-backed validation
- `backend/src/sessionMetadata.test.ts` — parent/child session behavior and children listing coverage
- `frontend/src/lib/sessionStore.ts` — session selection, refresh, and streaming flow to extend
- `frontend/src/lib/api/backendClient.ts` — typed backend client helpers for list/select/launch wiring
- `frontend/src/lib/components/ChatList.svelte` — current left-pane session rendering to evolve into the MVP tree
- `frontend/src/lib/components/ChatView.svelte` — existing session transcript/composer behavior to reuse unchanged after navigation

## Agent handoff note

The coding agent should treat this file as the authoritative task definition for the branch.

Recommended reading order:

1. this task file
2. `backlog/completed/mcpscope-mcp-interface.md`
3. existing backend session routes, operations, and tests
4. existing frontend session store, list rendering, and chat view
5. `backlog/specification/session-tree-navigation.md` only as supporting guidance for the tree UI details that this MVP absorbs

The agent should implement the smallest end-to-end slice that makes backend launch real first, then wire the tree/UI navigation on top of that backend-owned path.
