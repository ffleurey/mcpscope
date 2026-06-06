import type Database from 'better-sqlite3'
import { getSessionRecord } from '../persistence/repository.js'
import { listArtifactsBySession, type ArtifactRecord } from './artifactRepository.js'
import { SCHEMA_KEY, type AnalysisPhase, type AnalysisSessionState } from './schemas.js'
import type { StepRecord } from '../domain/model.js'
import { isKnownWorkflowKind, getWorkflowLabel } from './analysisWorkflowFactory.js'

export interface AnalysisDiagnosticSummary {
  step_id: string | null
  error_kind: string | null
  message: string
}

export function getAnalysisWorkflowKindFromStep(step: Pick<StepRecord, 'params'> | null | undefined): string | null {
  const workflowKind = (step?.params as { workflow_kind?: string } | null)?.workflow_kind
  if (workflowKind && isKnownWorkflowKind(workflowKind)) {
    return workflowKind
  }
  return null
}

export function getAnalysisWorkflowLabel(workflowKind: string | null | undefined): string | null {
  return workflowKind ? getWorkflowLabel(workflowKind) : null
}

export function getAnalysisWorkflowKindFromSteps(
  steps: Array<Pick<StepRecord, 'stepTypeKey' | 'params'>>,
  connection?: Database.Database,
  sessionId?: string,
): string | null {
  const cursorStep = steps.find(step => step.stepTypeKey === 'analysis_v2_cursor')
  if (cursorStep) return getAnalysisWorkflowKindFromStep(cursorStep)
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

export function isAnalysisSessionTerminalError(
  connection: Database.Database,
  summary: { id: string; sessionType: string; status: string; initStatus: string },
): boolean {
  if (summary.initStatus === 'error' || summary.status === 'error') {
    return true
  }
  if (summary.sessionType !== 'session_analysis') {
    return false
  }

  const session = getSessionRecord(connection, summary.id)
  const analysisState = session?.analysisState as unknown as AnalysisSessionState | null
  return (analysisState?.phase === 'error') === true
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
  connection: Database.Database,
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
      return 'assessing'
    case 'analysis_turn_summary':
      return 'turn_summary'
    case 'analysis_final_aggregation':
      return 'final_aggregation'
    default:
      return null
  }
}