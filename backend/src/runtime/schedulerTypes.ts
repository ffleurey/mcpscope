import type { TurnStreamEvent, AnalysisStreamEvent } from './streamEvents.js'
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
 */
export type ExecutionJobOwner =
  | { kind: 'benchmark-run'; id: string }
  | { kind: 'benchmark-evaluation'; id: string }

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
  | { type: 'scheduler-execution-event'; sessionId: string; jobId: string; event: TurnStreamEvent | AnalysisStreamEvent | PreludeStreamEvent }

export type SchedulerEventListener = (event: SchedulerEvent) => void

export const SCHEDULER_ERROR = {
  SESSION_NOT_FOUND: 'session_not_found',
  SESSION_NOT_INITIALIZED: 'session_not_initialized',
  SESSION_ALREADY_QUEUED: 'session_already_queued',
  TURN_IN_PROGRESS: 'turn_in_progress',
  STEP_NOT_READY: 'step_not_ready',
} as const