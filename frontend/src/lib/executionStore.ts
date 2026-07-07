/**
 * executionStore.ts — global frontend execution store.
 *
 * Connects to the backend scheduler SSE stream and maintains an up-to-date
 * view of the execution queue, active job, and control state.
 *
 * Session-keyed streaming state: execution events from the scheduler are also
 * routed into per-session streaming caches so that live output persists while
 * the user switches between sessions.
 */

import { writable, derived, get } from 'svelte/store'
import {
  getSchedulerSnapshot,
  streamSchedulerEvents,
  pauseScheduler,
  resumeScheduler,
  removeSchedulerJob,
  abortScheduler,
  enqueueSession,
  enqueueStep,
} from './api/backendClient'
import type {
  ExecutionSnapshot,
  ExecutionJob,
  SchedulerEvent,
  TurnStreamEvent,
  AnalysisStreamEvent,
  PreludeStreamEvent,
} from './backendTypes'

// ── Core scheduler state ─────────────────────────────────────────────────────

export const schedulerSnapshot = writable<ExecutionSnapshot>({
  controlState: 'running',
  activeJob: null,
  pendingJobs: [],
  lastTerminalJob: null,
})

export const schedulerConnected = writable(false)
export const schedulerError = writable<string | null>(null)

// ── Per-session streaming event cache ────────────────────────────────────────
// Maps sessionId → ordered list of execution events received while the session
// was executing. This allows the session transcript view to update from events
// that arrived while the user had a different session selected.

/**
 * A session-scoped execution event plus the kind of scheduler job that emitted
 * it. The kind matters for routing: 'part-committed' exists in both the
 * prelude (init-job) and turn vocabularies, so event type alone cannot decide
 * which handler an event belongs to.
 */
export interface CachedExecutionEvent {
  event: TurnStreamEvent | AnalysisStreamEvent | PreludeStreamEvent
  jobKind: 'session' | 'step' | 'init' | null
}

export const sessionStreamCache = writable<Map<string, CachedExecutionEvent[]>>(new Map())

/**
 * Prelude (session-init) events go to the prelude handler; everything else to
 * the turn/analysis handler. 'part-committed' is a prelude event only when the
 * job that emitted it is an init job — routing every part-committed to the
 * prelude handler used to leave the turn streaming overlay uncleared until
 * round-committed (the prelude handler only upserts the part).
 */
export function isPreludeExecutionEvent(
  event: TurnStreamEvent | AnalysisStreamEvent | PreludeStreamEvent,
  jobKind: CachedExecutionEvent['jobKind'],
): boolean {
  if (event.type === 'prelude-complete' || event.type === 'prelude-failed') return true
  return event.type === 'part-committed' && jobKind === 'init'
}

// ── Derived helpers ──────────────────────────────────────────────────────────

export const activeJob = derived(schedulerSnapshot, ($snap) => $snap.activeJob)

export const pendingJobs = derived(schedulerSnapshot, ($snap) => $snap.pendingJobs)

export const queueLength = derived(schedulerSnapshot, ($snap) => $snap.pendingJobs.length)

// ── Terminal job tracking ────────────────────────────────────────────────────
// Keeps a bounded record of terminal job IDs so awaitJob can resolve
// immediately after an SSE reconnect where lastTerminalJob moved on.
// Capped to prevent unbounded growth across long sessions.

const MAX_TERMINAL_JOB_HISTORY = 50
const terminalJobIds = new Set<string>()

function recordTerminalJobId(jobId: string): void {
  if (terminalJobIds.size >= MAX_TERMINAL_JOB_HISTORY) {
    const oldest = terminalJobIds.values().next().value
    if (oldest) terminalJobIds.delete(oldest)
  }
  terminalJobIds.add(jobId)
}

// Stream reconnection tuning.
const INITIAL_RECONNECT_MS = 1000
const MAX_RECONNECT_MS = 10000
// A connection that stayed up at least this long is treated as healthy, so the
// next drop restarts backoff from the bottom instead of escalating.
const HEALTHY_CONNECTION_MS = 5000

let streamAbort: AbortController | null = null

function applySchedulerEvent(event: SchedulerEvent): void {
  if (event.type === 'scheduler-snapshot') {
    if (event.lastTerminalJob) recordTerminalJobId(event.lastTerminalJob.jobId)
    schedulerSnapshot.set({
      controlState: event.controlState,
      activeJob: event.activeJob,
      pendingJobs: event.pendingJobs,
      lastTerminalJob: event.lastTerminalJob,
    })
    return
  }

  if (event.type === 'scheduler-job-enqueued') {
    schedulerSnapshot.update((snap) => ({
      ...snap,
      pendingJobs: snap.pendingJobs.some((job) => job.jobId === event.job.jobId)
        ? snap.pendingJobs
        : [...snap.pendingJobs, event.job],
    }))
    return
  }

  if (event.type === 'scheduler-job-started') {
    schedulerSnapshot.update((snap) => ({
      ...snap,
      activeJob: event.job,
      pendingJobs: snap.pendingJobs.filter((j) => j.jobId !== event.job.jobId),
    }))
    const sessionId = event.job.target.sessionId
    const prompt = event.job.prompt ?? ''
    import('./sessionStore').then(({ chatSessions, refreshSessions, initExternalTurnStream }) => {
      const known = get(chatSessions).some((s) => s.id === sessionId)
      if (!known) refreshSessions().catch(() => {})
      initExternalTurnStream(sessionId, prompt)
    })
    return
  }

  if (event.type === 'scheduler-job-completed' || event.type === 'scheduler-job-failed') {
    recordTerminalJobId(event.job.jobId)
    schedulerSnapshot.update((snap) => ({
      ...snap,
      activeJob: snap.activeJob?.jobId === event.job.jobId ? null : snap.activeJob,
      pendingJobs: snap.pendingJobs.filter((job) => job.jobId !== event.job.jobId),
      lastTerminalJob: event.job,
    }))
    const sessionId = event.job.target.sessionId
    // The replay cache is only consulted while a job for the session is
    // active; once terminal the trace is re-read from the backend, so keeping
    // full token-delta histories for every (possibly never-opened) benchmark
    // child session would just grow until reload.
    clearSessionStreamCache(sessionId)
    import('./sessionStore').then(({ refreshSessions, activeChatId, refreshActiveTurnTrace }) => {
      refreshSessions().catch(() => {})
      if (get(activeChatId) === sessionId) {
        refreshActiveTurnTrace().catch(() => {})
      }
    })
    return
  }

  if (event.type === 'scheduler-job-removed') {
    recordTerminalJobId(event.jobId)
    schedulerSnapshot.update((snap) => ({
      ...snap,
      pendingJobs: snap.pendingJobs.filter((j) => j.jobId !== event.jobId),
    }))
    return
  }

  if (event.type === 'scheduler-paused') {
    schedulerSnapshot.update((snap) => ({ ...snap, controlState: 'paused' }))
    return
  }

  if (event.type === 'scheduler-resumed') {
    schedulerSnapshot.update((snap) => ({ ...snap, controlState: 'running' }))
    return
  }

  if (event.type === 'scheduler-execution-event') {
    const { sessionId, event: execEvent } = event
    // Resolve the emitting job's kind (init vs session/step) — execution
    // events only flow for the active job, so the snapshot lookup is reliable.
    const snap = get(schedulerSnapshot)
    const jobKind =
      snap.activeJob?.jobId === event.jobId
        ? snap.activeJob.target.kind
        : (snap.pendingJobs.find((job) => job.jobId === event.jobId)?.target.kind ?? null)
    sessionStreamCache.update((cache) => {
      const updated = new Map(cache)
      const existing = updated.get(sessionId) ?? []
      updated.set(sessionId, [...existing, { event: execEvent, jobKind }])
      return updated
    })
    if (isPreludeExecutionEvent(execEvent, jobKind)) {
      import('./sessionStore').then(({ applyExternalPreludeEvent }) => {
        applyExternalPreludeEvent(sessionId, execEvent as PreludeStreamEvent)
      })
    } else {
      const prompt = snap.activeJob?.prompt ?? ''
      import('./sessionStore').then(({ applyExternalStreamEvent }) => {
        applyExternalStreamEvent(
          sessionId,
          prompt,
          execEvent as TurnStreamEvent | AnalysisStreamEvent,
        )
      })
    }
    return
  }
}

export function getSessionStreamEvents(sessionId: string): CachedExecutionEvent[] {
  return get(sessionStreamCache).get(sessionId) ?? []
}

export function clearSessionStreamCache(sessionId: string): void {
  sessionStreamCache.update((cache) => {
    const updated = new Map(cache)
    updated.delete(sessionId)
    return updated
  })
}

/**
 * Maintains the scheduler SSE connection: (re)connects, syncs the snapshot, and
 * streams events until the connection ends — for ANY reason, including a clean
 * server-side close (e.g. a dev backend restart) that resolves without an error.
 * Reconnects with capped exponential backoff until the controller is aborted, so
 * a dropped stream self-heals instead of leaving the UI silently stale.
 */
async function connectSchedulerStream(abort: AbortController): Promise<void> {
  let backoffMs = INITIAL_RECONNECT_MS

  while (!abort.signal.aborted) {
    let connectedAt = 0
    try {
      schedulerError.set(null)
      const snapshot = await getSchedulerSnapshot()
      if (abort.signal.aborted) return
      schedulerSnapshot.set(snapshot)
      schedulerConnected.set(true)
      connectedAt = Date.now()
      // Resolves on a clean close, throws on error — either way, fall through
      // below and reconnect.
      await streamSchedulerEvents((event) => {
        applySchedulerEvent(event)
      }, abort.signal)
    } catch (err) {
      if (abort.signal.aborted) return
      schedulerError.set(err instanceof Error ? err.message : 'Scheduler stream error')
    }

    schedulerConnected.set(false)
    if (abort.signal.aborted) return

    // Reset backoff after a healthy session; otherwise grow it so a downed or
    // crash-looping backend isn't hammered.
    if (connectedAt > 0 && Date.now() - connectedAt >= HEALTHY_CONNECTION_MS) {
      backoffMs = INITIAL_RECONNECT_MS
    }
    await new Promise((resolve) => setTimeout(resolve, backoffMs))
    backoffMs = Math.min(backoffMs * 2, MAX_RECONNECT_MS)
  }
}

export function initExecutionStore(): void {
  if (streamAbort) streamAbort.abort()
  const abort = new AbortController()
  streamAbort = abort
  void connectSchedulerStream(abort) // runs in background until aborted
}

export function destroyExecutionStore(): void {
  if (streamAbort) {
    streamAbort.abort()
    streamAbort = null
  }
  schedulerConnected.set(false)
}

// ── Control actions ───────────────────────────────────────────────────────────

export async function pauseExecution(): Promise<void> {
  await pauseScheduler()
}

export async function resumeExecution(): Promise<void> {
  await resumeScheduler()
}

/** Hard stop: abort the active job's in-flight model call (the kill switch). */
export async function abortExecution(): Promise<void> {
  await abortScheduler()
}

export async function removePendingJob(jobId: string): Promise<void> {
  await removeSchedulerJob(jobId)
}

export async function enqueueSessionExecution(
  sessionId: string,
  prompt: string,
): Promise<ExecutionJob> {
  const result = await enqueueSession(sessionId, prompt)
  return result.job
}

export async function enqueueStepExecution(sessionId: string): Promise<ExecutionJob> {
  const result = await enqueueStep(sessionId)
  return result.job
}

/**
 * Waits until the scheduler has finished with the given job.
 *
 * Pass `jobId` (from the enqueue response) whenever possible — it enables
 * precise per-job matching that survives SSE reconnects and overlapping jobs.
 * Without `jobId`, falls back to session-ID matching (less precise, still
 * correct for the common single-job-per-session case).
 *
 * The default timeout (10 minutes) is intentionally long to accommodate slow
 * LLM inference. Timeouts before that threshold indicate a genuine stall or
 * backend error, not normal latency.
 */
export function awaitJob(sessionId: string, jobId?: string, timeoutMs = 600000): Promise<void> {
  // Fast path: already recorded as terminal
  if (jobId && terminalJobIds.has(jobId)) return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    let sawJob = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const done = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      unsub()
      resolve()
    }

    timer = setTimeout(() => {
      unsub()
      reject(new Error(`awaitJob(${sessionId}) timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const unsub = schedulerSnapshot.subscribe(($snap) => {
      if (jobId) {
        // Precise jobId matching — check terminalJobIds first (handles reconnect gaps)
        if (terminalJobIds.has(jobId)) {
          done()
          return
        }

        const hasActive = $snap.activeJob?.jobId === jobId
        const hasPending = $snap.pendingJobs.some((j) => j.jobId === jobId)
        if (hasActive || hasPending) {
          sawJob = true
          return
        }

        // Job is no longer in active/pending
        if (sawJob || $snap.lastTerminalJob?.jobId === jobId) {
          done()
          return
        }
        // Don't resolve yet if job hasn't appeared — it may still be queueing
        return
      }

      // Fallback: session-ID matching (for init job when jobId is unavailable)
      const hasActive = $snap.activeJob?.target.sessionId === sessionId
      const hasPending = $snap.pendingJobs.some((j) => j.target.sessionId === sessionId)
      if (hasActive || hasPending) {
        sawJob = true
        return
      }
      if (sawJob || $snap.lastTerminalJob?.target.sessionId === sessionId) {
        done()
      }
    })
  })
}
