import type { TurnStreamEvent } from './streamEvents.js'
import type { PreludeStreamEvent } from './sessionInit.js'
import type { BackendDatabase } from '../persistence/db.js'
import type { ChatCompletionGateway } from './modelTurns.js'
import type { McpGateway } from './toolTurns.js'

export interface SchedulerContext {
  db: BackendDatabase
  chatCompletionGateway: ChatCompletionGateway
  mcpGateway: McpGateway
  maxToolRounds: number
  logger?: { error: (data: Record<string, unknown>, msg: string) => void }
}

export type ExecutionTarget =
  | { kind: 'session'; sessionId: string }
  | { kind: 'step'; sessionId: string }
  | { kind: 'init'; sessionId: string }

/**
 * The long-running coordinator that owns a job, when one does. Lets the UI group
 * a run's many jobs (init + turn per session) under one controllable unit instead
 * of showing loose sessions. Absent for ad-hoc (interactive) session jobs.
 *
 * `kind` is caller-defined: the engine attaches owners opaquely and never
 * branches on them. Coordinators built on top of the engine supply their own
 * kinds (the workbench uses 'benchmark-run' and 'benchmark-evaluation').
 */
export interface ExecutionJobOwner {
  kind: string
  id: string
}

/**
 * A stream event relayed through the scheduler while a job executes. The
 * engine itself emits TurnStreamEvent (chat turns) and PreludeStreamEvent
 * (session init); registered session executors may emit additional event
 * shapes (e.g. the analysis workflow's analysis-* events), which the
 * scheduler relays opaquely to subscribers.
 */
export type SchedulerExecutionEvent = TurnStreamEvent | PreludeStreamEvent | ExecutorStreamEvent

/** Executor-defined stream event; the scheduler relays it without interpreting it. */
export type ExecutorStreamEvent = { type: string; [key: string]: unknown }

export interface ExecutionJob {
  jobId: string
  target: ExecutionTarget
  prompt?: string
  createdAt: number
  owner?: ExecutionJobOwner
}

export interface ActiveExecutionJob extends ExecutionJob {
  startedAt: number
}

export interface TerminalJob extends ActiveExecutionJob {
  endedAt: number
  outcome: 'completed' | 'failed'
  error?: string
}

export interface ExecutionSnapshot {
  controlState: 'running' | 'paused'
  activeJob: ActiveExecutionJob | null
  pendingJobs: ExecutionJob[]
  lastTerminalJob: TerminalJob | null
}

export type SchedulerEvent =
  | { type: 'scheduler-job-enqueued'; job: ExecutionJob }
  | { type: 'scheduler-job-started'; job: ActiveExecutionJob }
  | { type: 'scheduler-job-completed'; job: TerminalJob }
  | { type: 'scheduler-job-failed'; job: TerminalJob }
  | { type: 'scheduler-job-removed'; jobId: string; target: ExecutionTarget }
  | { type: 'scheduler-paused' }
  | { type: 'scheduler-resumed' }
  | {
      type: 'scheduler-execution-event'
      sessionId: string
      jobId: string
      event: SchedulerExecutionEvent
    }

export type SchedulerEventListener = (event: SchedulerEvent) => void

export const SCHEDULER_ERROR = {
  SESSION_NOT_FOUND: 'session_not_found',
  SESSION_NOT_INITIALIZED: 'session_not_initialized',
  SESSION_ALREADY_QUEUED: 'session_already_queued',
  TURN_IN_PROGRESS: 'turn_in_progress',
  STEP_NOT_READY: 'step_not_ready',
} as const
