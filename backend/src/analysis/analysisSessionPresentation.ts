import type Database from 'better-sqlite3'
import { listStepRecordsBySession } from '../persistence/repository.js'
import { listArtifactsBySession, type ArtifactRecord } from './artifactRepository.js'
import { SCHEMA_KEY, type AnalysisPhase } from './schemas.js'
import { ANALYSIS_WORKFLOW_KIND, type AnalysisWorkflowKind } from './workflowKinds.js'
import type { StepRecord } from '../domain/model.js'

export interface AnalysisDiagnosticSummary {
  step_id: string | null
  error_kind: string | null
  message: string
}

const WORKFLOW_LABELS: Record<AnalysisWorkflowKind, string> = {
  [ANALYSIS_WORKFLOW_KIND.FULL_SESSION]: 'Full Analysis',
  [ANALYSIS_WORKFLOW_KIND.FAST_SESSION]: 'Fast Session Analysis',
  [ANALYSIS_WORKFLOW_KIND.FAST_TOOL]: 'Fast Tool Analysis',
}

export function getAnalysisWorkflowKindFromStep(step: Pick<StepRecord, 'params'> | null | undefined): AnalysisWorkflowKind | null {
  const workflowKind = (step?.params as { workflow_kind?: AnalysisWorkflowKind } | null)?.workflow_kind
  if (
    workflowKind === ANALYSIS_WORKFLOW_KIND.FULL_SESSION
    || workflowKind === ANALYSIS_WORKFLOW_KIND.FAST_SESSION
    || workflowKind === ANALYSIS_WORKFLOW_KIND.FAST_TOOL
  ) {
    return workflowKind
  }
  return null
}

export function getAnalysisWorkflowLabel(workflowKind: AnalysisWorkflowKind | null | undefined): string | null {
  return workflowKind ? WORKFLOW_LABELS[workflowKind] : null
}

export function getAnalysisWorkflowKindFromSteps(steps: Array<Pick<StepRecord, 'stepTypeKey' | 'params'>>): AnalysisWorkflowKind | null {
  const cursorStep = steps.find(step => step.stepTypeKey === 'analysis_v2_cursor')
  return getAnalysisWorkflowKindFromStep(cursorStep)
}

export function getAnalysisTitlePrefix(workflowKind: AnalysisWorkflowKind): string {
  return WORKFLOW_LABELS[workflowKind]
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

  const steps = listStepRecordsBySession(connection, summary.id)
  const cursorStep = steps.find(step => step.stepTypeKey === 'analysis_v2_cursor')
  const phase = typeof cursorStep?.state.phase === 'string' ? cursorStep.state.phase : null
  return cursorStep?.status === 'error' || phase === 'error'
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
    case 'analysis_coverage_validation':
      return 'coverage_validation'
    case 'analysis_final_aggregation':
      return 'final_aggregation'
    default:
      return null
  }
}