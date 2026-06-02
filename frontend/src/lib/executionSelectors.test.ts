import { describe, expect, it } from 'vitest'
import type { ExecutionSnapshot } from './backendTypes'
import { sessionHasQueuedOrActiveJob } from './executionSelectors'

function makeSnapshot(overrides: Partial<ExecutionSnapshot> = {}): ExecutionSnapshot {
  return {
    controlState: 'running',
    activeJob: null,
    pendingJobs: [],
    lastTerminalJob: null,
    ...overrides,
  }
}

describe('executionSelectors', () => {
  it('does not mark a session busy when a different session is running', () => {
    const snapshot = makeSnapshot({
      activeJob: {
        jobId: 'job-1',
        target: { kind: 'session', sessionId: 'session-a' },
        prompt: 'Hello',
        createdAt: 1,
        startedAt: 2,
      },
    })

    expect(sessionHasQueuedOrActiveJob(snapshot, 'session-b')).toBe(false)
  })

  it('marks a session busy when that same session is active or queued', () => {
    const activeSnapshot = makeSnapshot({
      activeJob: {
        jobId: 'job-1',
        target: { kind: 'session', sessionId: 'session-a' },
        prompt: 'Hello',
        createdAt: 1,
        startedAt: 2,
      },
    })
    const queuedSnapshot = makeSnapshot({
      pendingJobs: [{
        jobId: 'job-2',
        target: { kind: 'step', sessionId: 'session-a', stepId: 'step-1' },
        createdAt: 3,
      }],
    })

    expect(sessionHasQueuedOrActiveJob(activeSnapshot, 'session-a')).toBe(true)
    expect(sessionHasQueuedOrActiveJob(queuedSnapshot, 'session-a')).toBe(true)
  })
})