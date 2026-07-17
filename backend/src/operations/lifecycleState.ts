import type { BackendConnection } from "../persistence/connection.js";
import { listTurnRecordsBySession } from '../persistence/repository.js'
import { isSessionTerminalError } from './sessionPresentation.js'

export type LifecycleState = 'initializing' | 'ready' | 'running' | 'error'

/**
 * Canonical session lifecycle-state computation. Single source of truth shared by
 * the list operation, the status operation, and the route-summary builder so they
 * cannot diverge. `isSessionTerminalError` already covers the
 * initStatus/status === 'error' cases (plus any presenter-registered terminal
 * signal, e.g. the analysis workflow's error phase).
 */
export function computeLifecycleState(
  connection: BackendConnection,
  summary: { id: string; status: string; initStatus: string; sessionType: string },
): LifecycleState {
  const turns = listTurnRecordsBySession(connection, summary.id)
  const activeTurn =
    [...turns]
      .reverse()
      .find(t => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools') ?? null
  const latestTurn = turns.at(-1) ?? null

  if (isSessionTerminalError(connection, summary) || latestTurn?.status === 'error') {
    return 'error'
  }
  if (summary.initStatus === 'pending' || summary.initStatus === 'initializing') {
    return 'initializing'
  }
  if (activeTurn) {
    return 'running'
  }
  return 'ready'
}
