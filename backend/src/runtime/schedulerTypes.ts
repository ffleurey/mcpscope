import type { TurnStreamEvent, AnalysisStreamEvent } from './streamEvents.js'
import type { PreludeStreamEvent } from './sessionInit.js'
import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from './modelTurns.js'
import type { McpGateway } from './toolTurns.js'

export interface SchedulerContext {
  db: BackendDatabase
  lmStudioGateway: LmStudioGateway
  mcpGateway: McpGateway
  maxToolRounds: number
  logger?: { error: (data: Record<string, unknown>, msg: string) => void }
}

export type ExecutionTarget =
  | { kind: 'session'; sessionId: string }
  | { kind: 'step'; sessionId: string; stepId: string }
  | { kind: 'init'; sessionId: string }

export interface ExecutionJob {
  jobId: string
  target: ExecutionTarget
  prompt?: string
  createdAt: number
}

export interface ActiveExecutionJob extends ExecutionJob {
  startedAt: number
}

export interface TerminalJob extends ActiveExecutionJob {
  endedAt: number
  outcome: 'completed' | 'failed' | 'removed'
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
  STEP_NOT_FOUND: 'step_not_found',
  STEP_NOT_READY: 'step_not_ready',
  SESSION_ACTIVE: 'another_session_active',
} as const