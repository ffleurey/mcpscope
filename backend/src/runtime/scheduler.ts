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
  assertInitJobAllowed,
  assertStepJobAllowed,
  getSessionExecutionKind,
  reservePrimaryTurn,
} from './schedulerAdmission.js'
import { dispatchSchedulerJob } from './schedulerDispatch.js'
import type { ChatCompletionGateway } from './modelTurns.js'
import type {
  ActiveExecutionJob,
  ExecutionJob,
  ExecutionSnapshot,
  SchedulerContext,
  SchedulerEvent,
  SchedulerEventListener,
  TerminalJob,
} from './schedulerTypes.js'

/**
 * Wrap a gateway so every chat-completion call carries the active job's abort
 * signal — the basis of the hard "stop" control. Aborting the signal cancels the
 * in-flight provider request for any OpenAI-compatible backend (no provider-specific
 * code). Probe/context calls are forwarded unchanged (they are fast, init-time).
 */
function gatewayWithAbortSignal(
  gateway: ChatCompletionGateway,
  signal: AbortSignal,
): ChatCompletionGateway {
  return {
    createChatCompletion: (baseUrl, apiKey, body) =>
      gateway.createChatCompletion(baseUrl, apiKey, body, signal),
    ...(gateway.streamChatCompletion
      ? {
          streamChatCompletion: (baseUrl, apiKey, body, callbacks) =>
            gateway.streamChatCompletion!(baseUrl, apiKey, body, callbacks, signal),
        }
      : {}),
    ...(gateway.probePromptTokens
      ? { probePromptTokens: gateway.probePromptTokens.bind(gateway) }
      : {}),
    ...(gateway.probePromptTokensDetailed
      ? { probePromptTokensDetailed: gateway.probePromptTokensDetailed.bind(gateway) }
      : {}),
    ...(gateway.getLoadedContextLength
      ? { getLoadedContextLength: gateway.getLoadedContextLength.bind(gateway) }
      : {}),
  }
}

export type {
  SchedulerContext,
  ExecutionTarget,
  ExecutionJob,
  ActiveExecutionJob,
  TerminalJob,
  ExecutionSnapshot,
  SchedulerEvent,
  SchedulerEventListener,
} from './schedulerTypes.js'

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionScheduler
// ─────────────────────────────────────────────────────────────────────────────

export class ExecutionScheduler {
  private controlState: 'running' | 'paused' = 'running'
  private activeJob: ActiveExecutionJob | null = null
  /** Abort controller for the in-flight job's model calls (the hard-stop kill switch). */
  private activeAbort: AbortController | null = null
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
   * Hard stop: abort the active job's in-flight model call immediately (unlike
   * pause(), which only stops new turns from starting). The aborted request throws,
   * the turn fails, and the session ends in a retryable terminal state. No-op if
   * nothing is active. Returns true if an active job was signalled.
   */
  abortActive(): boolean {
    if (this.activeJob && this.activeAbort) {
      this.activeAbort.abort()
      return true
    }
    return false
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
   * Admission: the session must exist, be a primary session, not already be
   * initialized (initStatus !== 'ready'), and have no duplicate job for the same
   * session already pending or active.
   *
   * Prelude events (part-committed, prelude-complete, prelude-failed) are
   * emitted through the scheduler event stream as scheduler-execution-events.
   *
   * Returns the new job.
   */
  enqueueInit(opCtx: SchedulerContext, sessionId: string): ExecutionJob {
    assertInitJobAllowed(opCtx, sessionId, value => this.hasJobForSession(value))

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
    const executionKind = getSessionExecutionKind(opCtx, sessionId, prompt, value => this.hasJobForSession(value))
    return executionKind === 'primary'
      ? this.enqueuePrimarySession(opCtx, sessionId, prompt as string)
      : this.enqueueAnalysisSession(opCtx, sessionId)
  }

  // ── Private admission helpers ───────────────────────────────────────────────

  private enqueuePrimarySession(
    opCtx: SchedulerContext,
    sessionId: string,
    prompt: string,
  ): ExecutionJob {
    reservePrimaryTurn(opCtx, sessionId)

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
      const abort = new AbortController()
      this.activeJob = activeJob
      this.activeAbort = abort
      this.emit({ type: 'scheduler-job-started', job: { ...activeJob } })

      try {
        await this.executeJob(activeJob, opCtx, abort.signal)

        const terminal: TerminalJob = {
          ...activeJob,
          endedAt: Date.now(),
          outcome: 'completed',
        }
        this.activeJob = null
        this.activeAbort = null
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
        this.activeAbort = null
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
   * Admission: the session must be a ready analysis session, the analysis
    * state phase must not be complete or error, and the session must not already
    * have an active or pending job.
   *
   * Returns the new job.
   */
  enqueueStep(opCtx: SchedulerContext, sessionId: string): ExecutionJob {
    assertStepJobAllowed(opCtx, sessionId, value => this.hasJobForSession(value))

    const job: ExecutionJob = {
      jobId: randomUUID(),
      target: { kind: 'step', sessionId },
      createdAt: Date.now(),
    }
    this.pendingJobs.push(job)
    this.emit({ type: 'scheduler-job-enqueued', job: { ...job } })
    this.kickWorker(opCtx)
    return job
  }

  // ── Execution dispatch ────────────────────────────────────────────────────

  private async executeJob(
    job: ActiveExecutionJob,
    opCtx: SchedulerContext,
    signal: AbortSignal,
  ): Promise<void> {
    const emitExecutionEvent = (
      event: Extract<SchedulerEvent, { type: 'scheduler-execution-event' }>['event'],
    ) => {
      this.emit({
        type: 'scheduler-execution-event',
        sessionId: job.target.sessionId,
        jobId: job.jobId,
        event,
      })
    }

    // Per-job context whose gateway carries this job's abort signal, so abortActive()
    // cancels the in-flight model request without threading a signal through every
    // execution layer.
    const jobCtx: SchedulerContext = {
      ...opCtx,
      chatCompletionGateway: gatewayWithAbortSignal(opCtx.chatCompletionGateway, signal),
    }

    await dispatchSchedulerJob(job, jobCtx, {
      emitExecutionEvent,
      shouldPauseAtBoundary: () => this.controlState === 'paused',
    })
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
