import type { BackendConnection } from '../persistence/connection.js'
import type { SessionRecord } from '../domain/model.js'

/**
 * Session-presentation registry — the engine-side hook that lets the workbench
 * teach generic operations (list/status/lifecycle) how to present concrete
 * session types without the engine importing any analysis code. Mirrors the
 * `registerAnalysisWorkflow()` registry pattern in
 * `analysis/analysisWorkflowFactory.ts`.
 *
 * Engine default (no presenter registered for a session type): plain primary
 * sessions — no workflow kind, terminal error derived only from
 * status/initStatus, latest_error from the persisted init failure.
 * The workbench registers the analysis presenter at startup (see
 * `registerAnalysisSessionPresenter()` in
 * `analysis/analysisSessionPresentation.ts`, called from `buildBackendApp`).
 */

/** Latest error for a session, in the shared latest_error result shape. */
export interface SessionErrorSummary {
  step_id: string | null
  error_kind: string | null
  message: string
}

export interface SessionPresenter {
  /** Session type this presenter handles (e.g. 'session_analysis'). */
  readonly sessionType: string
  /** Workflow kind surfaced as `workflow_kind` in list/status results, if any. */
  getWorkflowKind(connection: BackendConnection, sessionId: string): string | null
  /** Human-readable workflow label surfaced as `workflow_label` in inspect results, if any. */
  getWorkflowLabel(connection: BackendConnection, sessionId: string): string | null
  /** Session-type-specific terminal-error signal beyond the generic status/initStatus checks. */
  isTerminalError(
    connection: BackendConnection,
    summary: { id: string; status: string; initStatus: string; sessionType: string },
  ): boolean
  /** Session-type-specific latest-error summary, richer than the init-failure fallback. */
  getLatestErrorSummary(connection: BackendConnection, sessionId: string): SessionErrorSummary | null
  /**
   * Step-scoped latest-error summary (e.g. the step's latest analysis
   * diagnostic), surfaced as the step's `latest_error` in inspect results.
   */
  getStepErrorSummary(
    connection: BackendConnection,
    sessionId: string,
    stepId: string,
  ): SessionErrorSummary | null
}

const presenterRegistry = new Map<string, SessionPresenter>()

export function registerSessionPresenter(presenter: SessionPresenter): void {
  presenterRegistry.set(presenter.sessionType, presenter)
}

/** Workflow kind for a session, via its registered presenter (null for plain sessions). */
export function getSessionWorkflowKind(
  connection: BackendConnection,
  session: { id: string; sessionType: string },
): string | null {
  return presenterRegistry.get(session.sessionType)?.getWorkflowKind(connection, session.id) ?? null
}

/** Human-readable workflow label for a session, via its registered presenter (null for plain sessions). */
export function getSessionWorkflowLabel(
  connection: BackendConnection,
  session: { id: string; sessionType: string },
): string | null {
  return presenterRegistry.get(session.sessionType)?.getWorkflowLabel(connection, session.id) ?? null
}

/** Step-scoped latest-error summary for a session's step, via its registered presenter (null for plain sessions). */
export function getSessionStepErrorSummary(
  connection: BackendConnection,
  session: { id: string; sessionType: string },
  stepId: string,
): SessionErrorSummary | null {
  return (
    presenterRegistry.get(session.sessionType)?.getStepErrorSummary(connection, session.id, stepId) ?? null
  )
}

/**
 * Whether a session is in a terminal error state: the generic
 * initStatus/status === 'error' cases, plus any presenter-registered signal
 * for the session type (e.g. the analysis workflow's error phase).
 */
export function isSessionTerminalError(
  connection: BackendConnection,
  summary: { id: string; status: string; initStatus: string; sessionType: string },
): boolean {
  if (summary.initStatus === 'error' || summary.status === 'error') {
    return true
  }
  return presenterRegistry.get(summary.sessionType)?.isTerminalError(connection, summary) === true
}

/**
 * Latest error summary for any session, in the shared latest_error shape.
 * Prefers a presenter-provided summary (richest, e.g. the latest analysis
 * diagnostic for session_analysis workflows) and falls back to a persisted
 * session init failure — so an MCP-handshake or token-probe failure during
 * init is diagnosable from list/status/inspect, not just the live event
 * stream.
 */
export function getLatestSessionErrorSummary(
  connection: BackendConnection,
  session: Pick<SessionRecord, 'id' | 'sessionType' | 'initError'>,
): SessionErrorSummary | null {
  const presented = presenterRegistry
    .get(session.sessionType)
    ?.getLatestErrorSummary(connection, session.id)
  if (presented) return presented
  if (session.initError) {
    return { step_id: null, error_kind: session.initError.errorKind, message: session.initError.message }
  }
  return null
}
