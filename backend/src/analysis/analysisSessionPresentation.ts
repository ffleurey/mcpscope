import type { BackendConnection } from "mcpscope-engine/persistence/connection.js";
import { getSessionRecord } from 'mcpscope-engine/persistence/repository.js'
import { listArtifactsBySession, type ArtifactRecord } from './artifactRepository.js'
import { SCHEMA_KEY, type AnalysisPhase, type AnalysisSessionState } from './schemas.js'
import type { StepRecord } from 'mcpscope-engine/domain/model.js'
import { getWorkflowLabel } from './analysisWorkflowFactory.js'
import {
  registerSessionPresenter,
  type SessionErrorSummary,
} from 'mcpscope-engine/operations/sessionPresentation.js'

/** Analysis diagnostics use the engine's shared latest_error shape. */
export type AnalysisDiagnosticSummary = SessionErrorSummary

export function getAnalysisWorkflowLabel(workflowKind: string | null | undefined): string | null {
  return workflowKind ? getWorkflowLabel(workflowKind) : null
}

export function getAnalysisWorkflowKindFromSteps(
  connection?: BackendConnection,
  sessionId?: string,
): string | null {
  if (connection && sessionId) {
    const session = getSessionRecord(connection, sessionId)
    const analysisState = session?.analysisState as unknown as AnalysisSessionState | null
    if (analysisState?.workflow_kind) return analysisState.workflow_kind as string
  }
  return null
}

export function getAnalysisTitlePrefix(workflowKind: string): string {
  return getWorkflowLabel(workflowKind) ?? workflowKind
}

/**
 * Register the analysis presenter in the engine's session-presentation
 * registry so generic operations (list/status/lifecycle) surface analysis
 * sessions' workflow_kind, terminal error phase, and latest diagnostic
 * without importing analysis code. Called by the workbench at startup
 * (`buildBackendApp`), mirroring `registerAnalysisWorkflow()`.
 */
export function registerAnalysisSessionPresenter(): void {
  registerSessionPresenter({
    sessionType: 'session_analysis',
    getWorkflowKind: getAnalysisWorkflowKindFromSteps,
    getWorkflowLabel(connection, sessionId) {
      return getAnalysisWorkflowLabel(getAnalysisWorkflowKindFromSteps(connection, sessionId))
    },
    isTerminalError(connection, summary) {
      const session = getSessionRecord(connection, summary.id)
      const analysisState = session?.analysisState as unknown as AnalysisSessionState | null
      return analysisState?.phase === 'error'
    },
    getLatestErrorSummary: getLatestAnalysisDiagnosticSummaryForSession,
    getStepErrorSummary(connection, sessionId, stepId) {
      return getLatestAnalysisDiagnosticSummaryForStep(listArtifactsBySession(connection, sessionId), stepId)
    },
  })
}

export function getLatestAnalysisDiagnosticSummary(artifacts: ArtifactRecord[]): AnalysisDiagnosticSummary | null {
  const diagnostic = [...artifacts]
    .filter(artifact => artifact.metadata.schema_key === SCHEMA_KEY.DIAGNOSTIC)
    .sort((left, right) => right.createdAt - left.createdAt)[0]

  if (!diagnostic) return null

  const content = diagnostic.content as {
    message?: string
    error_kind?: string
  } | null

  return {
    step_id: diagnostic.stepId,
    error_kind: typeof content?.error_kind === 'string' ? content.error_kind : null,
    message: typeof content?.message === 'string' ? content.message : 'Analysis step failed',
  }
}

export function getLatestAnalysisDiagnosticSummaryForSession(
  connection: BackendConnection,
  sessionId: string,
): AnalysisDiagnosticSummary | null {
  return getLatestAnalysisDiagnosticSummary(listArtifactsBySession(connection, sessionId))
}

export function getLatestAnalysisDiagnosticSummaryForStep(
  artifacts: ArtifactRecord[],
  stepId: string,
): AnalysisDiagnosticSummary | null {
  return getLatestAnalysisDiagnosticSummary(artifacts.filter(artifact => artifact.stepId === stepId))
}

export function getRetryPhaseForFailedAnalysisStep(step: Pick<StepRecord, 'stepTypeKey'>): AnalysisPhase | null {
  switch (step.stepTypeKey) {
    case 'analysis_bootstrap':
      return 'bootstrap'
    case 'analysis_tool_call_assessment':
    case 'analysis_tool_group_assessment':
    case 'analysis_benchmark_evaluation':
      return 'assessing'
    case 'analysis_turn_summary':
      return 'turn_summary'
    case 'analysis_final_aggregation':
      return 'final_aggregation'
    default:
      return null
  }
}