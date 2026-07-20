/**
 * mcpscope-engine — curated public surface of the embeddable chat/session
 * engine: the chat-path runtime (sessions, turns, scheduler, operations,
 * config, persistence) with no benchmark/analysis surface. External embedders
 * import from this package root; the workbench also deep-imports engine
 * internals via `mcpscope-engine/<path>.js` subpaths.
 *
 * Re-exports only — no logic, no side effects beyond module evaluation.
 *
 * Embedders use `createEngine()` below. The workbench's own in-process app
 * factory (`buildBackendApp`/`BackendHandle`) lives in the workbench, since it
 * wires HTTP/benchmark/analysis; the engine does not re-export it.
 */

// ── Standalone in-process factory ────────────────────────────────────────────
export { createEngine } from './createEngine.js'
export type {
  Engine,
  CreateEngineOptions,
  EngineStorage,
  EngineConfigSeed,
} from './createEngine.js'

// ── Scheduler ────────────────────────────────────────────────────────────────
export { ExecutionScheduler } from './runtime/scheduler.js'
export { SCHEDULER_ERROR } from './runtime/schedulerTypes.js'
export type {
  ExecutionTarget,
  ExecutionJob,
  ExecutionJobOwner,
  ActiveExecutionJob,
  TerminalJob,
  ExecutionSnapshot,
  SchedulerEvent,
  SchedulerEventListener,
  SchedulerExecutionEvent,
  ExecutorStreamEvent,
} from './runtime/schedulerTypes.js'

// Session-executor hook: the workbench registers per-session-type executors
// (e.g. the analysis executor) so the scheduler can dispatch concrete session
// types without the engine importing analysis code. The engine registers the
// `primary` executor itself.
export { registerSessionExecutor } from './runtime/schedulerDispatch.js'
export type { SessionExecutor, SessionExecutionOptions } from './runtime/schedulerDispatch.js'

// Turn stream events (chat path). Analysis stream events are deliberately
// excluded — they belong to the analysis subsystem, not the engine.
export type { TurnStreamEvent, TurnStreamEventSink } from './runtime/streamEvents.js'

// ── Operations (chat path only — no benchmark/analysis operations) ───────────
export type { OperationContext } from './operations/context.js'
export {
  OperationError,
  operationErrorResponse,
  operationErrorToHttpStatus,
} from './operations/errors.js'

export { createOperation } from './operations/create.js'
export type { CreateInput, CreateResult } from './operations/create.js'

export { createExplicitOperation } from './operations/createExplicit.js'
export type { CreateExplicitInput, CreateExplicitResult } from './operations/createExplicit.js'

export { launchPrimarySessionOperation } from './operations/launchPrimarySession.js'
export type {
  LaunchPrimarySessionInput,
  LaunchPrimarySessionResult,
} from './operations/launchPrimarySession.js'

export { sendOperation } from './operations/send.js'
export type { SendInput, SendResult } from './operations/send.js'

export { statusOperation } from './operations/status.js'
export type { StatusInput, StatusResult } from './operations/status.js'

export { listOperation } from './operations/list.js'
export type { ListInput, ListResult, SessionSummary } from './operations/list.js'

export { listModelConfigsOperation, listMcpProfilesOperation } from './operations/listConfigs.js'
export type {
  ListModelConfigsInput,
  ListModelConfigsResult,
  ModelConfigSummary,
  ListMcpProfilesInput,
  ListMcpProfilesResult,
  McpProfileSummary,
} from './operations/listConfigs.js'

export { inspectOperation, registerInspectIdResolver } from './operations/inspect.js'
export type { InspectInput, InspectResult, InspectIdResolver } from './operations/inspect.js'

export { deleteSessionOperation } from './operations/delete.js'
export type { DeleteInput, DeleteResult } from './operations/delete.js'

export { renameSessionOperation } from './operations/rename.js'
export type { RenameInput, RenameResult } from './operations/rename.js'

export { abortSessionOperation } from './operations/abort.js'
export type { AbortInput, AbortResult } from './operations/abort.js'

export { computeLifecycleState } from './operations/lifecycleState.js'
export type { LifecycleState } from './operations/lifecycleState.js'

// Session-presentation hook: the workbench registers per-session-type
// presenters (e.g. the analysis presenter) so generic operations can surface
// type-specific summaries without the engine importing concrete analysis code.
export { registerSessionPresenter } from './operations/sessionPresentation.js'
export type { SessionPresenter, SessionErrorSummary } from './operations/sessionPresentation.js'

// ── Domain records and trace ─────────────────────────────────────────────────
export type { SessionRecord, TurnRecord, PartRecord } from './domain/model.js'

export { buildSessionTraceBundle } from './domain/trace.js'
export type { SessionTraceBundle } from './domain/trace.js'

export { deriveTranscriptEntries, deriveContextEntries } from './domain/selectors.js'
export type { TranscriptEntry, ContextEntry } from './domain/selectors.js'

// ── Configuration ────────────────────────────────────────────────────────────
export { ConfigStore } from './config/configStore.js'
export type { ProviderConnection, ModelConfig, McpServerProfile } from './domain/configuration.js'

// ── Persistence ──────────────────────────────────────────────────────────────
export { openBackendDatabase } from './persistence/db.js'
export type { BackendDatabase } from './persistence/db.js'

// Schema-extension hook: the workbench registers extra DDL (e.g. the benchmark
// tables) so `openBackendDatabase` creates and validates it alongside the core
// engine schema. Register extensions BEFORE opening the database.
export { registerSchemaExtension } from './persistence/schema.js'
export type { SchemaExtension } from './persistence/schema.js'
