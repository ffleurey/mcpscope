# Current roadmap

## Status summary

The first backend increment is complete. The project now has a backend runtime foundation strong enough to build on.

## Completed

### 1. Backend runtime foundation

- Fastify + TypeScript backend added in-repo
- SQLite persistence established
- canonical runtime model implemented
- LM Studio and MCP integrations wired through the backend

### 2. Trustworthy runtime capture

- streamed reasoning/content/tool-call capture implemented
- reasoning retained in transcript but stripped from later context
- prompt-token probes persisted as raw exchanges
- full trace export added at `/api/sessions/:sessionId/trace`

### 3. Testing foundation

- local unit/runtime/app coverage in place
- live integration suite stabilized
- exported traces can now be replayed through a deterministic harness
- testing documentation updated around replay-first regression strategy

## Next

### 4. Frontend rewiring

Goal: make the frontend a thin client over the backend.

Work:

- replace remaining frontend-owned runtime logic with backend API usage
- render transcript/context/diagnostic state from backend responses
- expose trace export/import cleanly in the UI
- remove stale frontend-only data paths

### 5. Frontend cleanup and UX

Goal: make the UI fit the backend-native workflow.

Work:

- simplify state management around sessions and turns
- make trace inspection/export easier to use
- polish presentation for MCP debugging and data-analysis use cases

## Guiding constraints

- backend remains the runtime source of truth
- SQLite remains the canonical store
- trace export must stay replayable without reconstruction
- reasoning stays preserved in history even when stripped from later context
