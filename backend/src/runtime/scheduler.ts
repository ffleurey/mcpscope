/**
 * ExecutionScheduler — backend-owned generic sequential execution scheduler.
 *
 * Accepts Session and Step targets into one in-memory queue, enforces
 * readiness and duplicate-target rejection before enqueue, and executes
 * exactly one target at a time via a sequential worker loop.
 *
 * The scheduler is intentionally generic over Session and Step targets.
 * Session-type-specific dispatch (primary vs session_analysis) stays behind
 * the scheduler boundary — the public API only exposes ExecutionTarget.
 *
 * The queue is in memory only and is cleared on backend restart.
 * Persisted runtime records remain the source of truth for what completed,
 * what failed, and what remains to run.
 */

import { randomUUID } from 'node:crypto'
import {
  findActiveSession,
  getSessionRecord,
  listTurnRecordsBySession,
  listRoundRecordsBySession,
  listPartRecordsBySession,
  listRawExchangeRecordsBySession,
  listStepRecordsBySession,
  updateTurnRecord,
  updateSessionRecord,
  getNextTurnSequenceNumber,
  insertTurnRecord,
} from '../persistence/repository.js'
import { AnalysisSession } from '../analysis/analysisSession.js'
import { listArtifactsBySession } from '../analysis/artifactRepository.js'
import { buildSessionTraceBundle } from '../domain/trace.js'
import { deriveTranscriptEntries, deriveContextEntries } from '../domain/selectors.js'
import { ChatSession } from './chatSession.js'
import type { TurnStreamEvent, AnalysisStreamEvent } from './streamEvents.js'
import { runSessionInitialization } from './sessionInit.js'
import type { PreludeStreamEvent } from './sessionInit.js'
import { OperationError } from '../operations/errors.js'
import { formatTurnId } from '../domain/hierarchicalIds.js'
import type { TurnRecord } from '../domain/model.js'
import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from './modelTurns.js'
import type { McpGateway } from './toolTurns.js'

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler's own context interface (avoids circular import with SchedulerContext)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal runtime context the scheduler needs to execute jobs.
 * This mirrors the relevant fields of SchedulerContext without importing it
 * (which would create a circular dependency since SchedulerContext references
 * ExecutionScheduler).
 */
export interface SchedulerContext {
  db: BackendDatabase
  lmStudioGateway: LmStudioGateway
  mcpGateway: McpGateway
  maxToolRounds: number
  logger?: { error: (data: Record<string, unknown>, msg: string) => void }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generic execution target.
 * Session target: continue the session until it blocks or completes.
 * Step target: execute exactly one ready step.
 * Init target: run session initialization (prelude) for a primary session.
 */
export type ExecutionTarget =
  | { kind: 'session'; sessionId: string }
  | { kind: 'step'; sessionId: string; stepId: string }
  | { kind: 'init'; sessionId: string }

/** A queued execution job. */
export interface ExecutionJob {
  jobId: string
  target: ExecutionTarget
  /** For primary session turns: the user message content to execute. */
  prompt?: string
  createdAt: number
}

/** An execution job that is currently running. */
export interface ActiveExecutionJob extends ExecutionJob {
  startedAt: number
}

/** Terminal outcome for a completed, failed, or removed job. */
export interface TerminalJob extends ActiveExecutionJob {
  endedAt: number
  outcome: 'completed' | 'failed' | 'removed'
  error?: string
}

/** Current scheduler state snapshot. */
export interface ExecutionSnapshot {
  controlState: 'running' | 'paused'
  activeJob: ActiveExecutionJob | null
  pendingJobs: ExecutionJob[]
  lastTerminalJob: TerminalJob | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler events
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Admission error codes
// ─────────────────────────────────────────────────────────────────────────────

export const SCHEDULER_ERROR = {
  SESSION_NOT_FOUND: 'session_not_found',
  SESSION_NOT_INITIALIZED: 'session_not_initialized',
  SESSION_ALREADY_QUEUED: 'session_already_queued',
  TURN_IN_PROGRESS: 'turn_in_progress',
  STEP_NOT_FOUND: 'step_not_found',
  STEP_NOT_READY: 'step_not_ready',
  SESSION_ACTIVE: 'another_session_active',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionScheduler
// ─────────────────────────────────────────────────────────────────────────────

export class ExecutionScheduler {
  private controlState: 'running' | 'paused' = 'running'
  private activeJob: ActiveExecutionJob | null = null
  private pendingJobs: ExecutionJob[] = []
  private lastTerminalJob: TerminalJob | null = null
  private subscribers: Set<SchedulerEventListener> = new Set()

  /** Resolves when the scheduler is resumed from a paused state. */
  private resumeResolve: (() => void) | null = null

  // ── Public query / control ──────────────────────────────────────────────────

  getSnapshot(): ExecutionSnapshot {
    return {
      controlState: this.controlState,
      activeJob: this.activeJob ? { ...this.activeJob } : null,
      pendingJobs: [...this.pendingJobs],
      lastTerminalJob: this.lastTerminalJob ? { ...this.lastTerminalJob } : null,
    }
  }

  subscribe(listener: SchedulerEventListener): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  pause(): void {
    if (this.controlState === 'paused') return
    this.controlState = 'paused'
    this.emit({ type: 'scheduler-paused' })
  }

  resume(): void {
    if (this.controlState === 'running') return
    this.controlState = 'running'
    const resolve = this.resumeResolve
    this.resumeResolve = null
    resolve?.()
    this.emit({ type: 'scheduler-resumed' })
  }

  /**
   * Resolves when the given job reaches a terminal state (completed, failed, or
   * removed). Resolves immediately if the job is already terminal.
   *
   * This is the canonical backend wait helper — use it inside route handlers
   * that enqueue a job and need to await its outcome without opening an SSE
   * stream. It removes the repeated subscribe-and-check boilerplate.
   */
  awaitJob(jobId: string): Promise<void> {
    // Fast path: already terminal
    if (this.lastTerminalJob?.jobId === jobId) return Promise.resolve()
    const stillPresent = this.activeJob?.jobId === jobId
      || this.pendingJobs.some(j => j.jobId === jobId)
    if (!stillPresent) return Promise.resolve()

    return new Promise<void>(resolve => {
      const unsub = this.subscribe(evt => {
        if (
          (evt.type === 'scheduler-job-completed' || evt.type === 'scheduler-job-failed')
          && evt.job.jobId === jobId
        ) {
          unsub(); resolve()
          return
        }
        if (evt.type === 'scheduler-job-removed' && evt.jobId === jobId) {
          unsub(); resolve()
        }
      })
      // Re-check after subscribing to close the race window
      if (this.lastTerminalJob?.jobId === jobId) { unsub(); resolve(); return }
      if (
        this.activeJob?.jobId !== jobId
        && !this.pendingJobs.some(j => j.jobId === jobId)
      ) { unsub(); resolve() }
    })
  }

  /**
   * Remove a pending job from the queue.
   * Has no effect on the currently active job.
   * Returns true if the job was found and removed.
   */
  removeJob(jobId: string): boolean {
    const idx = this.pendingJobs.findIndex(j => j.jobId === jobId)
    if (idx === -1) return false
    const [job] = this.pendingJobs.splice(idx, 1)
    if (!job) return false
    this.emit({ type: 'scheduler-job-removed', jobId, target: job.target })
    return true
  }

  /**
   * Enqueue a session initialization (prelude) job for a primary session.
   *
   * Admission: the session must exist, be a primary session, have initStatus
   * in ['pending', 'initializing'], no other session must be active, and no
   * duplicate job for the same session may be pending or active.
   *
   * Prelude events (part-committed, prelude-complete, prelude-failed) are
   * emitted through the scheduler event stream as scheduler-execution-events.
   *
   * Returns the new job.
   */
  enqueueInit(opCtx: SchedulerContext, sessionId: string): ExecutionJob {
    const { db } = opCtx

    const session = getSessionRecord(db.connection, sessionId)
    if (!session) {
      throw new OperationError('Session not found', SCHEDULER_ERROR.SESSION_NOT_FOUND)
    }
    if (session.sessionType !== 'primary') {
      throw new OperationError(
        'Init jobs are only supported for primary sessions.',
        'validation',
      )
    }
    if (session.initStatus === 'ready') {
      throw new OperationError(
        'Session is already initialized.',
        'session_already_initialized' as const,
      )
    }
    const active = findActiveSession(db.connection, sessionId)
    if (active) {
      throw new OperationError(
        'Another session is currently active. Nothing was started.',
        SCHEDULER_ERROR.SESSION_ACTIVE,
        active,
      )
    }
    if (this.hasJobForSession(sessionId)) {
      throw new OperationError(
        'This session already has an active or pending job in the scheduler.',
        SCHEDULER_ERROR.SESSION_ALREADY_QUEUED,
      )
    }

    const job: ExecutionJob = {
      jobId: randomUUID(),
      target: { kind: 'init', sessionId },
      createdAt: Date.now(),
    }
    this.pendingJobs.push(job)
    this.emit({ type: 'scheduler-job-enqueued', job: { ...job } })
    this.kickWorker(opCtx)
    return job
  }

  /**
   * Enqueue a session target.
   *
   * For primary sessions: `prompt` must be supplied; the turn will be reserved
   * in the DB atomically before the job is accepted.
   *
   * For analysis sessions: no prompt is needed; the session must be in 'ready'
   * state with a non-complete cursor step.
   *
   * Throws OperationError if admission checks fail.
   *
   * Returns the new job.
   */
  enqueueSession(opCtx: SchedulerContext, sessionId: string, prompt?: string): ExecutionJob {
    const { db } = opCtx

    // ── Validate session exists ───────────────────────────────────────────────
    const session = getSessionRecord(db.connection, sessionId)
    if (!session) {
      throw new OperationError('Session not found', SCHEDULER_ERROR.SESSION_NOT_FOUND)
    }

    // ── Session-type-specific admission ──────────────────────────────────────
    if (session.sessionType === 'primary') {
      if (!prompt || prompt.trim() === '') {
        throw new OperationError(
          'A prompt is required to enqueue a primary session turn.',
          'validation',
        )
      }
      // For primary sessions: check for another active session BEFORE checking
      // initStatus (mirrors original turns/stream route behavior — allows the
      // global-lock error to take precedence over not-initialized error).
      const activeFirst = findActiveSession(db.connection, sessionId)
      if (activeFirst) {
        throw new OperationError(
          'Another session is currently active. Nothing was queued.',
          SCHEDULER_ERROR.SESSION_ACTIVE,
          activeFirst,
        )
      }
      if (session.initStatus !== 'ready') {
        throw new OperationError(
          `Session is not ready (initStatus = '${session.initStatus}')`,
          SCHEDULER_ERROR.SESSION_NOT_INITIALIZED,
        )
      }
      // For primary sessions the transactional turn check in enqueuePrimarySession
      // handles the in-progress guard. The in-memory hasJobForSession is an
      // additional early-reject, but uses the same canonical error code.
      if (this.hasJobForSession(sessionId)) {
        throw new OperationError(
          'A turn is already in progress or reserved for this session.',
          SCHEDULER_ERROR.TURN_IN_PROGRESS,
        )
      }
      return this.enqueuePrimarySession(opCtx, session, sessionId, prompt)
    }

    if (session.sessionType === 'session_analysis') {
      if (session.initStatus !== 'ready') {
        throw new OperationError(
          `Session is not ready (initStatus = '${session.initStatus}')`,
          SCHEDULER_ERROR.SESSION_NOT_INITIALIZED,
        )
      }
      // ── Reject duplicate jobs for the same session ──────────────────────────
      if (this.hasJobForSession(sessionId)) {
        throw new OperationError(
          'This session already has an active or pending job in the scheduler.',
          SCHEDULER_ERROR.SESSION_ALREADY_QUEUED,
        )
      }
      return this.enqueueAnalysisSession(opCtx, sessionId)
    }

    throw new OperationError(
      `Session type '${session.sessionType}' is not supported by the scheduler.`,
      'validation',
    )
  }

  // ── Private admission helpers ───────────────────────────────────────────────

  private enqueuePrimarySession(
    opCtx: SchedulerContext,
    _session: ReturnType<typeof getSessionRecord>,
    sessionId: string,
    prompt: string,
  ): ExecutionJob {
    const { db } = opCtx

    // Reserve the turn atomically in the DB
    type ReservationResult =
      | { kind: 'another_session_active'; active: { id: string; state: string } }
      | { kind: 'turn_in_progress' }
      | { kind: 'reserved'; turn: TurnRecord }

    const reservation = db.connection.transaction((): ReservationResult => {
      const active = findActiveSession(db.connection, sessionId)
      if (active) return { kind: 'another_session_active', active }

      const hasPendingTurn = listTurnRecordsBySession(db.connection, sessionId)
        .some(t => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools')
      if (hasPendingTurn) return { kind: 'turn_in_progress' }

      const createdAt = Date.now()
      const nextSeq = getNextTurnSequenceNumber(db.connection, sessionId)
      const turn: TurnRecord = {
        id: formatTurnId(sessionId, nextSeq),
        sessionId,
        ownerStepId: null,
        sequenceNumber: nextSeq,
        status: 'draft',
        createdAt,
        completedAt: null,
        outcome: null,
        usage: {
          promptTokens: null,
          completionTokens: null,
          reasoningTokens: null,
          totalTokens: null,
        },
        contextTokensAtTurnEnd: null,
        contextTokensAfterCompaction: null,
        compactionApplied: null,
        compactionTokensRemoved: null,
      }
      insertTurnRecord(db.connection, turn)
      return { kind: 'reserved', turn }
    })()

    if (reservation.kind === 'another_session_active') {
      throw new OperationError(
        'Another session is currently active. Nothing was queued.',
        SCHEDULER_ERROR.SESSION_ACTIVE,
        reservation.active,
      )
    }
    if (reservation.kind === 'turn_in_progress') {
      throw new OperationError(
        'A turn is already in progress or reserved for this session.',
        SCHEDULER_ERROR.TURN_IN_PROGRESS,
      )
    }

    // Turn reserved as 'draft'; will become 'streaming' when the worker starts it
    const job: ExecutionJob = {
      jobId: randomUUID(),
      target: { kind: 'session', sessionId },
      prompt,
      createdAt: Date.now(),
    }
    this.pendingJobs.push(job)
    this.emit({ type: 'scheduler-job-enqueued', job: { ...job } })
    this.kickWorker(opCtx)
    return job
  }

  private enqueueAnalysisSession(opCtx: SchedulerContext, sessionId: string): ExecutionJob {
    const { db } = opCtx

    // Check that there isn't another session already running
    const active = findActiveSession(db.connection, sessionId)
    if (active) {
      throw new OperationError(
        'Another session is currently active. Nothing was queued.',
        SCHEDULER_ERROR.SESSION_ACTIVE,
        { id: active.id, state: active.state },
      )
    }

    const job: ExecutionJob = {
      jobId: randomUUID(),
      target: { kind: 'session', sessionId },
      createdAt: Date.now(),
    }
    this.pendingJobs.push(job)
    this.emit({ type: 'scheduler-job-enqueued', job: { ...job } })
    this.kickWorker(opCtx)
    return job
  }

  // ── Worker ────────────────────────────────────────────────────────────────

  private workerActive = false

  private kickWorker(opCtx: SchedulerContext): void {
    if (this.workerActive) return
    this.workerActive = true
    this.runWorker(opCtx).finally(() => {
      this.workerActive = false
      // If jobs arrived during the window between the worker's last while-check
      // and this .finally() (e.g. a route handler continued from a job-completed
      // subscription before workerActive was cleared), restart the worker now.
      if (this.pendingJobs.length > 0) {
        this.kickWorker(opCtx)
      }
    })
  }

  private async runWorker(opCtx: SchedulerContext): Promise<void> {
    while (this.pendingJobs.length > 0) {
      // Wait if paused (boundary-based: waits before starting next job)
      if (this.controlState === 'paused') {
        await new Promise<void>(resolve => {
          this.resumeResolve = resolve
        })
      }

      const job = this.pendingJobs.shift()
      if (!job) break

      const activeJob: ActiveExecutionJob = {
        ...job,
        startedAt: Date.now(),
      }
      this.activeJob = activeJob
      this.emit({ type: 'scheduler-job-started', job: { ...activeJob } })

      try {
        await this.executeJob(activeJob, opCtx)

        const terminal: TerminalJob = {
          ...activeJob,
          endedAt: Date.now(),
          outcome: 'completed',
        }
        this.activeJob = null
        this.lastTerminalJob = terminal
        this.emit({ type: 'scheduler-job-completed', job: { ...terminal } })
      } catch (err) {
        const terminal: TerminalJob = {
          ...activeJob,
          endedAt: Date.now(),
          outcome: 'failed',
          error: err instanceof Error ? err.message : String(err),
        }
        this.activeJob = null
        this.lastTerminalJob = terminal
        opCtx.logger?.error(
          {
            jobId: activeJob.jobId,
            sessionId: activeJob.target.sessionId,
            err: terminal.error,
          },
          'Scheduler job failed',
        )
        this.emit({ type: 'scheduler-job-failed', job: { ...terminal } })
      }
    }
  }

  /**
   * Enqueue a step target.
   *
   * Admission: the session must be a ready analysis session, the step must be
   * the cursor step (analysis_v2_cursor) for that session, the cursor phase must
   * not be complete or error, and the session must not already have an active
   * or pending job.
   *
   * Returns the new job.
   */
  enqueueStep(opCtx: SchedulerContext, sessionId: string, stepId: string): ExecutionJob {
    const { db } = opCtx

    const session = getSessionRecord(db.connection, sessionId)
    if (!session) {
      throw new OperationError('Session not found', SCHEDULER_ERROR.SESSION_NOT_FOUND)
    }
    if (session.sessionType !== 'session_analysis') {
      throw new OperationError(
        'Step execution is only supported for analysis sessions.',
        SCHEDULER_ERROR.STEP_NOT_READY,
      )
    }
    if (session.initStatus !== 'ready') {
      throw new OperationError(
        `Session is not ready (initStatus = '${session.initStatus}')`,
        SCHEDULER_ERROR.SESSION_NOT_INITIALIZED,
      )
    }

    // Validate the step exists and belongs to this session
    const steps = listStepRecordsBySession(db.connection, sessionId)
    const targetStep = steps.find(s => s.id === stepId)
    if (!targetStep) {
      throw new OperationError(
        `Step '${stepId}' not found in session '${sessionId}'.`,
        SCHEDULER_ERROR.STEP_NOT_FOUND,
      )
    }

    // The step must be the cursor step — only the cursor tracks what comes next
    const CURSOR_STEP_TYPE = 'analysis_v2_cursor'
    if (targetStep.stepTypeKey !== CURSOR_STEP_TYPE) {
      throw new OperationError(
        `Step '${stepId}' is not the cursor step for this session.`,
        SCHEDULER_ERROR.STEP_NOT_READY,
      )
    }

    // Cursor phase must be runnable (not complete / error)
    const phase = (targetStep.state as { phase?: string }).phase
    if (phase === 'complete' || phase === 'error') {
      throw new OperationError(
        `Analysis workflow is already in terminal phase '${phase}'.`,
        SCHEDULER_ERROR.STEP_NOT_READY,
      )
    }

    // No duplicate jobs for the same session
    if (this.hasJobForSession(sessionId)) {
      throw new OperationError(
        'This session already has an active or pending job in the scheduler.',
        SCHEDULER_ERROR.SESSION_ALREADY_QUEUED,
      )
    }

    // Check for another active session
    const active = findActiveSession(db.connection, sessionId)
    if (active) {
      throw new OperationError(
        'Another session is currently active. Nothing was queued.',
        SCHEDULER_ERROR.SESSION_ACTIVE,
        { id: active.id, state: active.state },
      )
    }

    const job: ExecutionJob = {
      jobId: randomUUID(),
      target: { kind: 'step', sessionId, stepId },
      createdAt: Date.now(),
    }
    this.pendingJobs.push(job)
    this.emit({ type: 'scheduler-job-enqueued', job: { ...job } })
    this.kickWorker(opCtx)
    return job
  }

  // ── Execution dispatch ────────────────────────────────────────────────────

  private async executeJob(job: ActiveExecutionJob, opCtx: SchedulerContext): Promise<void> {
    const { target } = job
    const session = getSessionRecord(opCtx.db.connection, target.sessionId)
    if (!session) {
      throw new Error(`Session ${target.sessionId} not found at execution time`)
    }

    const emitExecutionEvent = (event: TurnStreamEvent | AnalysisStreamEvent | PreludeStreamEvent) => {
      this.emit({
        type: 'scheduler-execution-event',
        sessionId: target.sessionId,
        jobId: job.jobId,
        event,
      })
    }

    if (target.kind === 'init') {
      await this.executeInitJob(job, opCtx, emitExecutionEvent)
    } else if (target.kind === 'step') {
      await this.executeAnalysisOneStepJob(job, opCtx, emitExecutionEvent as (e: TurnStreamEvent | AnalysisStreamEvent) => void)
    } else if (session.sessionType === 'primary') {
      await this.executePrimaryJob(job, opCtx, emitExecutionEvent as (e: TurnStreamEvent) => void)
    } else if (session.sessionType === 'session_analysis') {
      await this.executeAnalysisJob(job, opCtx, emitExecutionEvent as (e: TurnStreamEvent | AnalysisStreamEvent) => void)
    } else {
      throw new Error(`Unsupported session type: ${session.sessionType}`)
    }
  }

  private async executeInitJob(
    job: ActiveExecutionJob,
    opCtx: SchedulerContext,
    emitExecutionEvent: (event: PreludeStreamEvent) => void,
  ): Promise<void> {
    const { db, lmStudioGateway, mcpGateway } = opCtx
    const sessionId = job.target.sessionId
    await runSessionInitialization(db, lmStudioGateway, mcpGateway, sessionId, emitExecutionEvent)
  }

  private async executePrimaryJob(
    job: ActiveExecutionJob,
    opCtx: SchedulerContext,
    emitExecutionEvent: (event: TurnStreamEvent) => void,
  ): Promise<void> {
    const { db, lmStudioGateway, mcpGateway, maxToolRounds } = opCtx
    const sessionId = job.target.sessionId
    const prompt = job.prompt

    if (!prompt) {
      throw new Error('Primary session job is missing prompt')
    }

    const session = getSessionRecord(db.connection, sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    // Find the draft turn reserved during enqueue
    const turns = listTurnRecordsBySession(db.connection, sessionId)
    const draftTurn = turns.find(t => t.status === 'draft')
    if (!draftTurn) {
      throw new Error(`No draft turn found for session ${sessionId}`)
    }

    // Promote turn to 'streaming' before execution
    const activeTurn: TurnRecord = { ...draftTurn, status: 'streaming' }
    updateTurnRecord(db.connection, activeTurn)

    const chatSession = new ChatSession(
      session,
      db,
      lmStudioGateway,
      session.mcpProfileSnapshot ? mcpGateway : null,
      maxToolRounds,
      activeTurn,
      prompt,
      emitExecutionEvent,
    )

    await chatSession.execute()
  }

  private async executeAnalysisJob(
    job: ActiveExecutionJob,
    opCtx: SchedulerContext,
    emitExecutionEvent: (event: TurnStreamEvent | AnalysisStreamEvent) => void,
  ): Promise<void> {
    const { db, lmStudioGateway, mcpGateway } = opCtx
    const sessionId = job.target.sessionId

    const session = getSessionRecord(db.connection, sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found at analysis execution time`)

    // Mark session active (mirrors executeAnalysisWorkflow behavior)
    session.status = 'active'
    session.updatedAt = Date.now()
    updateSessionRecord(db.connection, session)

    try {
      const instance = AnalysisSession.rehydrateFromDb(db, lmStudioGateway, mcpGateway, sessionId)
      if (!instance) {
        throw new Error('Failed to rehydrate analysis session from cursor step')
      }

      while (instance.canContinue()) {
        await instance.resumeOneStep(emitExecutionEvent)
        if (this.controlState === 'paused') {
          break
        }
      }
    } finally {
      // Mark session ready after completion (or on error, keep active state for error detection)
      const finalSession = getSessionRecord(db.connection, sessionId) ?? session
      if (finalSession.status === 'active') {
        finalSession.status = 'ready'
        finalSession.updatedAt = Date.now()
        updateSessionRecord(db.connection, finalSession)
      }
    }

    // Build and emit the latest trace bundle for the completed run segment.
    // When paused, the job ends at the current boundary without claiming the
    // workflow itself is complete; the SSE wrapper closes on job completion.
    const finalSession = getSessionRecord(db.connection, sessionId)!
    const finalParts = listPartRecordsBySession(db.connection, sessionId)
    const trace = buildSessionTraceBundle({
      session: finalSession,
      steps: listStepRecordsBySession(db.connection, sessionId),
      turns: listTurnRecordsBySession(db.connection, sessionId),
      rounds: listRoundRecordsBySession(db.connection, sessionId),
      parts: finalParts,
      rawExchanges: listRawExchangeRecordsBySession(db.connection, sessionId),
      artifacts: listArtifactsBySession(db.connection, sessionId),
      transcript: deriveTranscriptEntries(finalParts),
      context: deriveContextEntries(finalParts),
    })
    const cursorStep = trace.steps.find(step => step.stepTypeKey === 'analysis_v2_cursor')
    const phase = typeof cursorStep?.state.phase === 'string' ? cursorStep.state.phase : null
    if (phase === 'complete' || phase === 'error') {
      emitExecutionEvent({ type: 'analysis-complete', trace })
    }
  }

  private async executeAnalysisOneStepJob(
    job: ActiveExecutionJob,
    opCtx: SchedulerContext,
    emitExecutionEvent: (event: TurnStreamEvent | AnalysisStreamEvent) => void,
  ): Promise<void> {
    const { db, lmStudioGateway, mcpGateway } = opCtx
    const sessionId = job.target.sessionId

    const session = getSessionRecord(db.connection, sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found at one-step execution time`)

    // Mark session active
    session.status = 'active'
    session.updatedAt = Date.now()
    updateSessionRecord(db.connection, session)

    try {
      const instance = AnalysisSession.rehydrateFromDb(db, lmStudioGateway, mcpGateway, sessionId)
      if (!instance) {
        throw new Error('Failed to rehydrate analysis session from cursor step')
      }
      // Execute exactly one step, then stop
      await instance.resumeOneStep(emitExecutionEvent)
    } finally {
      const finalSession = getSessionRecord(db.connection, sessionId) ?? session
      if (finalSession.status === 'active') {
        finalSession.status = 'ready'
        finalSession.updatedAt = Date.now()
        updateSessionRecord(db.connection, finalSession)
      }
    }

    // Emit final trace after the one step completes
    const finalSession = getSessionRecord(db.connection, sessionId)!
    const finalParts = listPartRecordsBySession(db.connection, sessionId)
    const trace = buildSessionTraceBundle({
      session: finalSession,
      steps: listStepRecordsBySession(db.connection, sessionId),
      turns: listTurnRecordsBySession(db.connection, sessionId),
      rounds: listRoundRecordsBySession(db.connection, sessionId),
      parts: finalParts,
      rawExchanges: listRawExchangeRecordsBySession(db.connection, sessionId),
      artifacts: listArtifactsBySession(db.connection, sessionId),
      transcript: deriveTranscriptEntries(finalParts),
      context: deriveContextEntries(finalParts),
    })
    emitExecutionEvent({ type: 'analysis-complete', trace })
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private hasJobForSession(sessionId: string): boolean {
    if (this.activeJob?.target.sessionId === sessionId) return true
    return this.pendingJobs.some(j => j.target.sessionId === sessionId)
  }

  private emit(event: SchedulerEvent): void {
    for (const listener of this.subscribers) {
      try {
        listener(event)
      } catch {
        // Never let a listener crash the scheduler
      }
    }
  }
}
