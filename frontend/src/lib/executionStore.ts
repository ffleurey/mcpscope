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

export const sessionStreamCache = writable<Map<string, (TurnStreamEvent | AnalysisStreamEvent | PreludeStreamEvent)[]>>(new Map())

// ── Derived helpers ──────────────────────────────────────────────────────────

export const schedulerControlState = derived(
  schedulerSnapshot,
  $snap => $snap.controlState,
)

export const activeJob = derived(
  schedulerSnapshot,
  $snap => $snap.activeJob,
)

export const pendingJobs = derived(
  schedulerSnapshot,
  $snap => $snap.pendingJobs,
)

export const isExecuting = derived(
  schedulerSnapshot,
  $snap => $snap.activeJob !== null,
)

export const queueLength = derived(
  schedulerSnapshot,
  $snap => $snap.pendingJobs.length,
)

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
    schedulerSnapshot.update(snap => ({
      ...snap,
      pendingJobs: [...snap.pendingJobs, event.job],
    }))
    return
  }

  if (event.type === 'scheduler-job-started') {
    schedulerSnapshot.update(snap => ({
      ...snap,
      activeJob: event.job,
      pendingJobs: snap.pendingJobs.filter(j => j.jobId !== event.job.jobId),
    }))
    const sessionId = event.job.target.sessionId
    const prompt = event.job.prompt ?? ''
    import('./sessionStore').then(({ chatSessions, refreshSessions, initExternalTurnStream }) => {
      const known = get(chatSessions).some(s => s.id === sessionId)
      if (!known) refreshSessions().catch(() => {})
      initExternalTurnStream(sessionId, prompt)
    })
    return
  }

  if (event.type === 'scheduler-job-completed' || event.type === 'scheduler-job-failed') {
    recordTerminalJobId(event.job.jobId)
    schedulerSnapshot.update(snap => ({
      ...snap,
      activeJob: snap.activeJob?.jobId === event.job.jobId ? null : snap.activeJob,
      lastTerminalJob: event.job,
    }))
    const sessionId = event.job.target.sessionId
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
    schedulerSnapshot.update(snap => ({
      ...snap,
      pendingJobs: snap.pendingJobs.filter(j => j.jobId !== event.jobId),
    }))
    return
  }

  if (event.type === 'scheduler-paused') {
    schedulerSnapshot.update(snap => ({ ...snap, controlState: 'paused' }))
    return
  }

  if (event.type === 'scheduler-resumed') {
    schedulerSnapshot.update(snap => ({ ...snap, controlState: 'running' }))
    return
  }

  if (event.type === 'scheduler-execution-event') {
    const { sessionId, event: execEvent } = event
    sessionStreamCache.update(cache => {
      const updated = new Map(cache)
      const existing = updated.get(sessionId) ?? []
      updated.set(sessionId, [...existing, execEvent])
      return updated
    })
    // Route prelude events to the prelude handler; all other events to the turn/analysis handler.
    if (
      execEvent.type === 'part-committed'
      || execEvent.type === 'prelude-complete'
      || execEvent.type === 'prelude-failed'
    ) {
      import('./sessionStore').then(({ applyExternalPreludeEvent }) => {
        applyExternalPreludeEvent(sessionId, execEvent as PreludeStreamEvent)
      })
    } else {
      const prompt = get(schedulerSnapshot).activeJob?.prompt ?? ''
      import('./sessionStore').then(({ applyExternalStreamEvent }) => {
        applyExternalStreamEvent(sessionId, prompt, execEvent as TurnStreamEvent | AnalysisStreamEvent)
      })
    }
    return
  }
}

export function getSessionStreamEvents(sessionId: string): (TurnStreamEvent | AnalysisStreamEvent | PreludeStreamEvent)[] {
  return get(sessionStreamCache).get(sessionId) ?? []
}

export function clearSessionStreamCache(sessionId: string): void {
  sessionStreamCache.update(cache => {
    const updated = new Map(cache)
    updated.delete(sessionId)
    return updated
  })
}

async function connectSchedulerStream(): Promise<void> {
  streamAbort = new AbortController()
  schedulerConnected.set(false)
  schedulerError.set(null)

  try {
    // Fetch initial snapshot first
    const snapshot = await getSchedulerSnapshot()
    schedulerSnapshot.set(snapshot)
    schedulerConnected.set(true)

    // Then subscribe to SSE stream
    await streamSchedulerEvents(
      (event) => {
        applySchedulerEvent(event)
      },
      streamAbort.signal,
    )
  } catch (err) {
    if (streamAbort?.signal.aborted) return
    const message = err instanceof Error ? err.message : 'Scheduler stream error'
    schedulerError.set(message)
    schedulerConnected.set(false)

    // Reconnect after a short delay
    await new Promise(resolve => setTimeout(resolve, 3000))
    if (!streamAbort?.signal.aborted) {
      await connectSchedulerStream()
    }
  }
}

export async function initExecutionStore(): Promise<void> {
  if (streamAbort) {
    streamAbort.abort()
    streamAbort = null
  }
  connectSchedulerStream() // intentionally not awaited — runs in background
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
  schedulerSnapshot.update(snap => ({ ...snap, controlState: 'paused' }))
}

export async function resumeExecution(): Promise<void> {
  await resumeScheduler()
  schedulerSnapshot.update(snap => ({ ...snap, controlState: 'running' }))
}

export async function removePendingJob(jobId: string): Promise<void> {
  await removeSchedulerJob(jobId)
  schedulerSnapshot.update(snap => ({
    ...snap,
    pendingJobs: snap.pendingJobs.filter(j => j.jobId !== jobId),
  }))
}

export async function enqueueSessionExecution(sessionId: string, prompt: string): Promise<ExecutionJob> {
  const result = await enqueueSession(sessionId, prompt)
  schedulerSnapshot.update(snap => ({
    ...snap,
    pendingJobs: [...snap.pendingJobs, result.job],
  }))
  return result.job
}

export async function enqueueStepExecution(sessionId: string): Promise<ExecutionJob> {
  const result = await enqueueStep(sessionId)
  schedulerSnapshot.update(snap => ({
    ...snap,
    pendingJobs: [...snap.pendingJobs, result.job],
  }))
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
      if (timer !== null) { clearTimeout(timer); timer = null }
      unsub()
      resolve()
    }

    timer = setTimeout(() => {
      unsub()
      reject(new Error(`awaitJob(${sessionId}) timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const unsub = schedulerSnapshot.subscribe($snap => {
      if (jobId) {
        // Precise jobId matching — check terminalJobIds first (handles reconnect gaps)
        if (terminalJobIds.has(jobId)) { done(); return }

        const hasActive = $snap.activeJob?.jobId === jobId
        const hasPending = $snap.pendingJobs.some(j => j.jobId === jobId)
        if (hasActive || hasPending) { sawJob = true; return }

        // Job is no longer in active/pending
        if (sawJob || $snap.lastTerminalJob?.jobId === jobId) { done(); return }
        // Don't resolve yet if job hasn't appeared — it may still be queueing
        return
      }

      // Fallback: session-ID matching (for init job when jobId is unavailable)
      const hasActive = $snap.activeJob?.target.sessionId === sessionId
      const hasPending = $snap.pendingJobs.some(j => j.target.sessionId === sessionId)
      if (hasActive || hasPending) { sawJob = true; return }
      if (sawJob || $snap.lastTerminalJob?.target.sessionId === sessionId) { done() }
    })
  })
}
