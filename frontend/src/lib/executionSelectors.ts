import type { ExecutionSnapshot } from './backendTypes'

export function sessionHasQueuedOrActiveJob(snapshot: ExecutionSnapshot, sessionId: string | null | undefined): boolean {
  if (!sessionId) return false

  return snapshot.activeJob?.target.sessionId === sessionId
    || snapshot.pendingJobs.some((job) => job.target.sessionId === sessionId)
}