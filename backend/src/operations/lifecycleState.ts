import type Database from 'better-sqlite3'
import { listTurnRecordsBySession } from '../persistence/repository.js'
import { isAnalysisSessionTerminalError } from '../analysis/analysisSessionPresentation.js'

export type LifecycleState = 'initializing' | 'ready' | 'running' | 'error'

/**
 * Canonical session lifecycle-state computation. Single source of truth shared by
 * the list operation, the status operation, and the route-summary builder so they
 * cannot diverge. `isAnalysisSessionTerminalError` already covers the
 * initStatus/status === 'error' cases (and the analysis terminal-error phase).
 */
export function computeLifecycleState(
  connection: Database.Database,
  summary: { id: string; status: string; initStatus: string; sessionType: string },
): LifecycleState {
  const turns = listTurnRecordsBySession(connection, summary.id)
  const activeTurn =
    [...turns]
      .reverse()
      .find(t => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools') ?? null
  const latestTurn = turns.at(-1) ?? null

  if (isAnalysisSessionTerminalError(connection, summary) || latestTurn?.status === 'error') {
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
