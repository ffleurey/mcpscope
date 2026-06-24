/**
 * RunControl — backend-owned control plane for long-running *coordinators*
 * (benchmark runs and evaluation passes).
 *
 * Background: the ExecutionScheduler controls individual *jobs* (one turn/step
 * at a time). Coordinators are fire-and-forget loops that sit *above* the
 * scheduler, expanding a run into many sequential jobs. They had no control
 * surface, so "stop" only killed the in-flight model call and the loop marched
 * on to the next task. This registry gives each coordinator a controllable
 * lifecycle keyed by its run id:
 *
 *   - pause  → the loop finishes the current task, then holds before the next
 *     (a clean, between-task pause).
 *   - stop   → the in-flight job is aborted now and the loop unwinds; the run
 *     comes to rest in a resumable 'stopped' state.
 *
 * The coordinator cooperates by calling `await controller.checkpoint()` at the
 * top of each task and reporting its in-flight job via setActiveJob/clearActiveJob
 * so a stop can target precisely that job (and nothing else on the shared queue).
 *
 * State is in memory only, mirroring the scheduler. A backend restart clears it;
 * orphaned runs are reconciled to 'stopped' at startup and recovered via resume.
 */

import type { ExecutionScheduler } from './scheduler.js'

/** Thrown by checkpoint() when the run was stopped — coordinators catch this to unwind cleanly. */
export class RunStoppedError extends Error {
  constructor(public readonly runId: string) {
    super(`Run ${runId} was stopped`)
    this.name = 'RunStoppedError'
  }
}

export type RunControlState = 'running' | 'paused' | 'stopping'

export class RunController {
  private state: RunControlState = 'running'
  /** The scheduler job the coordinator is currently awaiting (for precise stop). */
  private activeJobId: string | null = null
  /** Resolves the pause gate when the run is resumed or stopped. */
  private gateResolve: (() => void) | null = null

  /**
   * Resolves once a stop is requested. The coordinator races its job waits
   * against this so a stop unwinds the run *immediately* — even if the in-flight
   * job never settles (a model/MCP call that ignores the abort signal). Without
   * this, awaitJob could hang and the run would stay stuck 'running'.
   */
  readonly whenStopRequested: Promise<void>
  private resolveStop!: () => void

  constructor(
    readonly runId: string,
    private readonly scheduler: ExecutionScheduler,
  ) {
    this.whenStopRequested = new Promise<void>(resolve => {
      this.resolveStop = resolve
    })
  }

  getState(): RunControlState {
    return this.state
  }

  isStopping(): boolean {
    return this.state === 'stopping'
  }

  isPaused(): boolean {
    return this.state === 'paused'
  }

  /** The coordinator reports the job it is about to await, so stop() can target it. */
  setActiveJob(jobId: string): void {
    this.activeJobId = jobId
  }

  clearActiveJob(): void {
    this.activeJobId = null
  }

  /**
   * Cooperative control point — called at the top of each coordinator task.
   * Throws RunStoppedError if the run was stopped; blocks while paused and
   * returns once resumed.
   */
  async checkpoint(): Promise<void> {
    for (;;) {
      if (this.state === 'stopping') throw new RunStoppedError(this.runId)
      if (this.state === 'paused') {
        await new Promise<void>(resolve => {
          this.gateResolve = resolve
        })
        continue
      }
      return
    }
  }

  /** Request a clean, between-task pause. No-op unless currently running. */
  requestPause(): boolean {
    if (this.state !== 'running') return false
    this.state = 'paused'
    return true
  }

  /** Resume a paused run (release the gate). No-op unless currently paused. */
  requestResume(): boolean {
    if (this.state !== 'paused') return false
    this.state = 'running'
    this.releaseGate()
    return true
  }

  /**
   * Hard stop: mark the run stopping, wake it if paused, and abort the in-flight
   * job *now* (or drop it if still pending). The coordinator's next checkpoint
   * throws RunStoppedError and the run unwinds to 'stopped'.
   */
  requestStop(): boolean {
    if (this.state === 'stopping') return false
    this.state = 'stopping'
    this.releaseGate()
    this.resolveStop()
    const jobId = this.activeJobId
    if (jobId) {
      const active = this.scheduler.getSnapshot().activeJob
      if (active?.jobId === jobId) {
        this.scheduler.abortActive()
      } else {
        this.scheduler.removeJob(jobId)
      }
    }
    return true
  }

  private releaseGate(): void {
    const resolve = this.gateResolve
    this.gateResolve = null
    resolve?.()
  }
}

/**
 * In-memory registry of active run controllers, keyed by run id (benchmark
 * run id or evaluation id — both are globally unique). One instance per app,
 * created alongside the scheduler and shared through OperationContext.
 */
export class RunControlRegistry {
  private controllers = new Map<string, RunController>()

  constructor(private readonly scheduler: ExecutionScheduler) {}

  /**
   * Register a fresh controller for a coordinator that is starting. Replaces any
   * stale controller for the same id (e.g. a previous, already-released run).
   */
  acquire(runId: string): RunController {
    const controller = new RunController(runId, this.scheduler)
    this.controllers.set(runId, controller)
    return controller
  }

  get(runId: string): RunController | undefined {
    return this.controllers.get(runId)
  }

  /** Remove a controller once its coordinator has exited. */
  release(runId: string): void {
    this.controllers.delete(runId)
  }

  /** Request a pause on a live run. Returns false if no live controller exists. */
  pause(runId: string): boolean {
    return this.controllers.get(runId)?.requestPause() ?? false
  }

  /** Un-pause a live, paused run. Returns false if no live paused controller exists. */
  resume(runId: string): boolean {
    return this.controllers.get(runId)?.requestResume() ?? false
  }

  /** Stop a live run. Returns false if no live controller exists. */
  stop(runId: string): boolean {
    return this.controllers.get(runId)?.requestStop() ?? false
  }
}
