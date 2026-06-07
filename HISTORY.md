# Project history

Timeline from first commit to current state. Each entry captures what was built and why.

## Pre-release: frontend-driven prototype (May 5–10, 2026)

The project started as a Svelte + IndexedDB chat UI over LM Studio. The initial idea was to build a chat that exposed what existing tools hid: reasoning blocks, token counts, context growth, tool calls.

- Increment 1: model/MCP profile management UI
- Increment 2: basic model-only chat with real-time streaming
- MCP integration with tool execution loop, context bar, per-round token accounting
- Reasoning content display, API key support, model status/load/eject UI
- Token formula corrections, multi-turn context bar fixes
- Diagnostic export button with full API payload reconstruction

The prototype proved the concept but had no backend — everything lived in the frontend, limiting persistence and replay.

**Release 0.1.0** — May 10, 2026. First tagged release of the frontend-driven prototype.

---

## Release 0.2.0 — backend-driven architecture (May 13, 2026)

**PR #1** `backend-refactoring` — Moved runtime ownership from Svelte/IndexedDB to a Fastify + SQLite backend. The frontend-driven prototype had proved the concept but browser-only state and IndexedDB persistence were too limiting for the inspection and replay goals. Moving to a backend-owned canonical model was the decision that made replay, trace export/import, CLI, and MCP integration possible. Canonical persistence model with sessions, turns, rounds, parts, and raw exchanges. Context compaction strategy (strip-reasoning). Token sanity tests. This was the architectural turning point.

---

## Between 0.2.0 and v0.5.0: UI polish and rename (May 13–14, 2026)

- Resizable sidebar, error dialogs, tool definitions as collapsible lists with parameter details
- Docker multi-stage build with docker-compose
- **PR #2** `backend-refactoring` — Renamed project to **mcpscope** (was previously unnamed/under old name)
- Versioned release workflow with GHCR image publishing

**Release v0.5.0** — May 14, 2026. First release under the mcpscope name with Docker packaging.

---

## Release v0.6.0 — markdown preview (May 14, 2026)

Markdown syntax highlighting dialog for assistant content blocks. JSON syntax highlighting viewer with wrap toggle.

---

## Release v0.7.0 — error handling (May 14, 2026)

Consistent error handling and reporting across the backend API surface. Error contract coverage tests. API key passthrough fix for authenticated LM Studio instances. Turn-failed error display in the UI.

---

## Release v0.8.0 — hierarchical IDs (May 17, 2026)

**PR #3** `docs/hierarchical-ids-spec` — Canonical hierarchical ID format for sessions, setups, turns, rounds, and parts (e.g. `QGWA`, `QGWA.S`, `QGWA.1T`, `QGWA.1T.2.3-U`). The format was designed to be human-readable, copy-pasteable, and machine-parseable: 4-char session IDs (no O/I/0/1), part type suffixes for quick visual scanning, and a lookup API returning the same tree shape in summary and full modes. Lookup API at `GET /api/lookup/:id`. IdBadge component replaces inline inspect buttons. Turn/round full content resolution.

The hierarchical ID model became the foundation for all inspection workflows across CLI, MCP, and UI.

---

## v0.8.0 to v0.9.0: CLI development (May 17–18, 2026)

**PR #4** `cli-sessions-list-v1` — Initial CLI skeleton with `sessions list` command. `GET /api/sessions` slimmed to `SessionSummary` type.

**PR #5** `cli-readonly-fetch-v2` — `mcpscope inspect <id>` command with hierarchical ID lookup. Tasteful text coloring (prompt emphasis, dimmed token counts). Tool name display for `tool_definitions` parts. CLI.md command reference.

**PR #6** `session-creation-defaults` — Defaults were a prerequisite for CLI lifecycle work — the CLI needed a way to create sessions without a UI to configure all fields. Persistent `session_creation_defaults` singleton table. 422 for unknown default IDs, 409 for deletion conflicts. Defaults apply only to future creation; existing sessions remain snapshot-based. NewSessionPanel pre-selects defaults. UI + API aligned.

**PR #7** `cli-session-lifecycle-mvp-v3` — `mcpscope create`, `send`, `status` commands. Polling-based automation loop. Turn start contract fixes.

**PR #8** `cli-packaging-and-tutorial` — CLI packaged inside the Docker container. TUTORIAL.md written for the Docker user path.

**Release v0.9.0** — May 18, 2026. CLI lifecycle complete, Docker-packaged.

---

## v0.9.0 to v0.10.0: execution lock and MCP interface (May 18–20, 2026)

**PR #9** `global-session-execution-lock` — The lifecycle MVP only protected turn concurrency within one session, but multiple sessions could still compete for the same LM and MCP runtime. The global lock enforced at most one active session globally (initializing or running). 409 Conflict with `another_session_active` code. Interrupted turn recovery on startup. Imported traces excluded from active session restoration.

**PR #10** `mcpscope-mcp-interface` — The CLI was the right first step but the wrong architectural base for an MCP interface. The backend operation catalog (`backend/src/operations/catalog.ts`) was created as the single source of truth so CLI and MCP share one contract: every tool equals one command with the same params, validation, semantics, and error codes. Five MCP tools over Streamable HTTP (`mcpscope_list`, `mcpscope_create`, `mcpscope_send`, `mcpscope_status`, `mcpscope_inspect`). Structured output with `outputSchema`. MCP operates directly in the backend process (no loopback HTTP). CLI and MCP surface now share one contract.

**PR #11** `fix/session-title-preservation` — Explicit session titles preserved through the creation flow.

**Release v0.10.0** — May 20, 2026. MCP interface shipped, CLI and MCP share one operation catalog.

---

## v0.10.0 to v0.11.0: session metadata and analysis foundation (May 20–25, 2026)

**PR #12** `session-metadata-foundation` — Foundation for non-primary session types. Validation rules enforced: primary sessions can optionally have a benchmark parent, `session_analysis` must have a session parent. Child sessions hidden from ordinary list surfaces. Parent deletion cascades. Unified validated `createSession()` path for all session types.

**PR #13** `analysis-configurations` — Analysis profiles as first-class config records parallel to model configs and MCP profiles. v1 profiles reference a model config by ID (no duplication of LM fields) and own systemPrompt, temperature, and optional reasoning. Deleting a default analysis profile or a referenced model config is rejected. Analysis profile configuration UI.

**PR #14** `session-analysis-launch-report` — First end-to-end analysis workflow MVP. Created child `session_analysis` session bound to the restricted mcpscope MCP surface. Accepted freeform analysis prompt. Reused existing session store and chat view — no dedicated analysis viewer. Analysis launch modal with workflow kind, model, temperature, tool scope. Analysis session tree rendering in the UI.

The thinking evolved here: analysis should be a first-class session type, not a separate system. This enabled sharing the scheduler, inspection, and persistence paths.

**Release v0.11.0** — May 25, 2026. Session parent links and analysis launch UI.

---

## v0.11.0 to v0.12.0: execution model refactoring and analysis v2 (May 25 – June 2, 2026)

**PR #15** `pre-extension-runtime-generalization` — Before adding more session types and workflows, the foundation needed cleaning up: one unified `createSession()` path for primary and non-primary sessions, migrating the analysis launch flow to the same code path.

**PR #16** `session-execution-model-refactor` — The project had outgrown its chat-centered runtime. Sessions needed to be execution containers with a step-based execution loop, not just chat transcripts. This refactoring introduced `SessionContainer`, `Session`, `Step`, `WorkflowStep`, and `Turn` as the canonical domain vocabulary with a fresh v2 persistence schema (`v2_sessions`, `v2_steps`, `v2_turns`, `v2_rounds`, `v2_parts`, `v2_raw_exchanges`). SessionContainer ownership model with Benchmark container type. Step containment (workflow steps own turns). DATA-MODEL.md and ARCHITECTURE.md aligned.

**PR #17** `deterministic-compaction-step` — Previously compaction was a hidden post-turn mutation with no inspectable trace — it was not persisted as part of the session tree. Making it a real `Step` with hierarchical ID (e.g. `SESSION.C1`) proved the Step abstraction was materially real, not just preparatory architecture, and made compaction inspectable through the CLI, MCP, and UI surfaces.

**PR #18** `session-analysis-agent-v2` — First working analysis workflow using deterministic `WorkflowStep` subclasses. The key shift was from prompt-inject evidence (concatenating all trace data into one giant prompt) to deterministic inspect turns: each piece of evidence fetched separately via real `mcpscope_inspect` tool calls through the restricted `/mcp/analysis` endpoint. This made the analysis auditable and the context bounded. Bootstrap step creates evidence packet index. Bounded LLM assessment turns with context cleanup after each step.

**PR #19** `session-analysis-consolidation` — The shipped analysis workflow still leaked internal step names and looked like a special-case subsystem. Consolidation tightened the backend seam (launch has exported operation contract, execute is thin transport adapter), narrowed the workflow contract to real invariants, and decoupled the frontend from internal step naming.

**PR #20** `execution-scheduler` — Prior to the scheduler, each session had its own execution semantics — no central queue, no queue inspection, no live monitoring across sessions. The scheduler unified all execution under one sequential worker with one in-memory queue, enabling pause/resume and a single SSE event stream consumed by all surfaces. Analysis sessions run through the same scheduler as primary sessions.

**PR #21** `execution-thinning-and-queue-unification` — Multiple overlapping execution paths remained after the scheduler was introduced (direct route handlers, legacy SSE endpoints, scheduler). This returned to one simple execution model: scheduler as the sole execution owner for all work, frontend with one subscription path through `executionStore`, and all overlapping surfaces cleaned up. `awaitJob()` for deterministic polling. Shared vs internal backend operations separated.

**PR #22** `multiple-types-of-analysis-sessions` — Three analysis workflow types: `fullSession` (rich interpretive evaluation with per-tool-call assessment), `fastSession` (simpler linear traversal), `fastTool` (non-linear grouped-by-tool-name traversal). The goal was proving the framework supported different workflow shapes. Each type has an explicit canonical step contract defining what is added to context, what prompt is used, and what output schema is produced. Analysis single-step completion semantics fixed.

**PR #23** `project-doc-cleanup` — Cleaned up backlog, research artifacts, and obsolete project files.

**Release v0.12.0** — June 2, 2026. Sequential scheduler live, three analysis workflow types shipped.

---

## Post-v0.12.0: analysis refinement and provider expansion (June 2–7, 2026)

**PR #24** `improve-fast-session-analysis` — Consolidated evaluation output to one generic JSON format with optional parameters and template-based prompt generation. Verdict (pass/partial/fail/unclear) and score (0-5) made evaluation machine-readable across all analysis types. Subfolder organization for analysis types. Prompt refinement across all analysis workflows.

**PR #25** `refactor-step-containement` — Full schema alignment for the step containment model. Steps became first-class parts of the canonical session containment tree. The analysis cursor (formerly a pseudo-step in `v2_steps`) moved to a session state column. Step IDs use sequence position + type suffix with shared numbering across all step subtypes. All tests fixed, docs updated.

**PR #26** `analysis-sessions-refactoring` — `WorkflowStep` class hierarchy with template-method pattern. Previously shared step classes received type-specific config parameters (promptVariant, planningMode) making them aware of which analysis subclass called them — adding a 4th analysis type required editing 10+ files. The refactoring eliminated all coupling: behavior injected via constructor functions, zero `as any` casts, registry instead of switch. Self-describing subclasses with static `workflowKind` and `buildSystemPrompt`. Design patterns section added to ARCHITECTURE.md.

**PR #27** `multiple-mcp-servers` — Support for multiple MCP servers per session. `SessionRecord.mcpProfileSnapshot` became `mcpProfileSnapshots`. Default MCP profiles switched from a single `default_mcp_profile_id` to all profiles with `defaultEnabled=true`. Parallel initialization with merged tool list and first-server-wins on name collision. Single-transaction persistence, structured logging, CLI type fixes, docs updated across all adapter surfaces.

**PR #28** `support-openrouter-provider` — OpenRouter as a provider alongside LM Studio. Chose minimal rename over full provider abstraction: `LmStudioGateway` became `ChatCompletionGateway`, a thin 54-line OpenRouter client re-exporting shared OAI functions. Full provider abstraction was deferred as premature. Analysis step error persistence fix. Walk cursor reliability: retry endpoint resets cursor so failing hooks re-execute. Targeted analysis execution tests without LLM.

**PR #29** `automated-test-improvements` — A gap audit identified high-value test coverage missing: token sanity was excluded from the default run, multi-turn compaction had no replay fixture, and MCP/CLI structural parity had no automated guard. Deterministic token-sanity tests activated. Replay/compaction fixtures added. MCP and CLI structural tests (parity with backend catalog). TESTING.md updated.

**PR #30** `execution-model-refactoring` — Plan + Interpret execution model replacing flatten/walk cursor. The walk cursor (a bare integer index) had no causal link to work done — it could not answer which packet was being assessed, could not regress when the tree grew, and retry required full re-walk. The Plan + Interpret model derived position from artifact existence instead, making retry a simple cascade removal. Visitor restoration: hooks drive plan construction via `addCommand()`. Plan-level progress in API events and frontend. `AnalysisCommand` and `WorkflowStep` merged — steps *are* the commands. ARCHITECTURE.md finalized to reflect step-as-command design.

---

*V1 scope document drafted and under discussion — see `backlog/what-should-v1-look-like.md`.*

*Last updated: 2026-06-07*
