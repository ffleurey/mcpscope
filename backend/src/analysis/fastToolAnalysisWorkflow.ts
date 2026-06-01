import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import {
  insertStepRecord,
  updateStepRecord,
  getNextStepOrdinal,
} from '../persistence/repositoryV2.js'
import type { StepPersistenceRecord } from '../domain/persistenceContract.js'
import { stepTypeKey as mkStepTypeKey } from '../domain/executionModel.js'
import { formatStepId } from '../domain/hierarchicalIds.js'
import { getLatestArtifactBySchemaKey } from './artifactRepository.js'
import {
  SCHEMA_KEY,
  type AnalysisSessionState,
  type FastToolWorkIndex,
} from './schemas.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import { ANALYSIS_WORKFLOW_KIND } from './workflowKinds.js'
import type { FullSessionAnalysisWorkflowInput } from './fullSessionAnalysisWorkflow.js'
import { runFastToolPlanningStep } from './fastToolPlanningStep.js'
import { runFastToolGroupedAssessmentTurn } from './fastToolGroupedAssessmentTurn.js'
import { runFastToolFinalAggregationTurn } from './fastToolFinalAggregationTurn.js'

function now(): number {
  return Date.now()
}

export type FastToolAnalysisWorkflowInput = FullSessionAnalysisWorkflowInput

export interface FastToolAnalysisWorkflowDeps {
  database: BackendDatabase
  lmGateway: LmStudioGateway
  mcpGateway: McpGateway
}

export function createFastToolAnalysisState(input: FastToolAnalysisWorkflowInput): AnalysisSessionState {
  return {
    phase: 'bootstrap',
    bootstrapComplete: false,
    nextPacketIndex: 0,
    packetCount: 0,
    currentTurnId: null,
    coverageValidated: false,
    finalAggregationComplete: false,
    analysisSessionId: input.analysisSessionId,
    targetSessionId: input.targetSessionId,
    targetTurnId: input.targetTurnId,
    analysisGoal: input.analysisGoal,
    selectedToolNames: input.selectedToolNames,
    onlyFailedToolCalls: input.onlyFailedToolCalls,
    evaluationCriteria: input.evaluationCriteria,
  }
}

export function getFastToolAnalysisCursorParams(state: AnalysisSessionState): Record<string, unknown> {
  return {
    workflow_kind: ANALYSIS_WORKFLOW_KIND.FAST_TOOL,
    targetSessionId: state.targetSessionId,
    targetTurnId: state.targetTurnId,
    analysisGoal: state.analysisGoal,
    selectedToolNames: state.selectedToolNames,
    onlyFailedToolCalls: state.onlyFailedToolCalls,
    evaluationCriteria: state.evaluationCriteria,
  }
}

export function isFastToolAnalysisTerminal(state: AnalysisSessionState): boolean {
  return state.phase === 'complete' || state.phase === 'error'
}

export async function advanceFastToolAnalysisStep(
  deps: FastToolAnalysisWorkflowDeps,
  state: AnalysisSessionState,
  emitEvent?: AnalysisStreamEventSink,
): Promise<AnalysisSessionState> {
  if (state.phase === 'bootstrap') {
    return runBootstrap(deps, state, emitEvent)
  }
  if (state.phase === 'assessing') {
    return runGroupedAssessment(deps, state, emitEvent)
  }
  if (state.phase === 'final_aggregation') {
    return runFinalAggregation(deps, state, emitEvent)
  }
  return state
}

async function runBootstrap(
  deps: FastToolAnalysisWorkflowDeps,
  state: AnalysisSessionState,
  emitEvent?: AnalysisStreamEventSink,
): Promise<AnalysisSessionState> {
  const ordinal = getNextStepOrdinal(deps.database.connection, state.analysisSessionId)
  const stepId = formatStepId(state.analysisSessionId, ordinal)
  const stepRecord: StepPersistenceRecord = {
    id: stepId,
    sessionId: state.analysisSessionId,
    stepTypeKey: mkStepTypeKey('analysis_bootstrap'),
    ordinal,
    status: 'running',
    params: {},
    state: {},
    createdAt: now(),
    completedAt: null,
  }
  insertStepRecord(deps.database.connection, stepRecord)
  emitEvent?.({ type: 'analysis-step-started', step: { ...stepRecord } })
  emitEvent?.({ type: 'analysis-phase-changed', phase: 'bootstrap' })

  const result = await runFastToolPlanningStep(deps.database, deps.mcpGateway, { state, stepId }, emitEvent)

  const completedStep: StepPersistenceRecord = {
    ...stepRecord,
    status: 'complete',
    state: { work_unit_count: result.workUnitCount },
    completedAt: now(),
  }
  updateStepRecord(deps.database.connection, completedStep)
  emitEvent?.({ type: 'analysis-step-completed', step: completedStep })
  emitEvent?.({ type: 'analysis-phase-changed', phase: result.updatedState.phase })

  return result.updatedState
}

async function runGroupedAssessment(
  deps: FastToolAnalysisWorkflowDeps,
  state: AnalysisSessionState,
  emitEvent?: AnalysisStreamEventSink,
): Promise<AnalysisSessionState> {
  const workIndexArtifact = getLatestArtifactBySchemaKey(
    deps.database.connection,
    state.analysisSessionId,
    SCHEMA_KEY.FAST_TOOL_WORK_INDEX,
  )
  const targetArtifact = getLatestArtifactBySchemaKey(
    deps.database.connection,
    state.analysisSessionId,
    SCHEMA_KEY.ANALYSIS_TARGET,
  )
  if (!workIndexArtifact || !targetArtifact) {
    return { ...state, phase: 'error' }
  }
  const workIndex = workIndexArtifact.content as FastToolWorkIndex
  const workUnit = workIndex.tool_groups[state.nextPacketIndex]
  if (!workUnit) {
    return { ...state, phase: 'final_aggregation' }
  }

  const ordinal = getNextStepOrdinal(deps.database.connection, state.analysisSessionId)
  const stepId = formatStepId(state.analysisSessionId, ordinal)
  const stepRecord: StepPersistenceRecord = {
    id: stepId,
    sessionId: state.analysisSessionId,
    stepTypeKey: mkStepTypeKey('analysis_tool_group_assessment'),
    ordinal,
    status: 'running',
    params: { work_unit_id: workUnit.work_unit_id, tool_name: workUnit.tool_name },
    state: {},
    createdAt: now(),
    completedAt: null,
  }
  insertStepRecord(deps.database.connection, stepRecord)
  emitEvent?.({ type: 'analysis-step-started', step: { ...stepRecord } })

  const result = await runFastToolGroupedAssessmentTurn(
    deps.database,
    deps.lmGateway,
    deps.mcpGateway,
    { state, stepId, workUnit, analysisTarget: targetArtifact.content as any },
    emitEvent,
  )

  const completedStep: StepPersistenceRecord = {
    ...stepRecord,
    status: result.success ? 'complete' : 'error',
    state: { assessment_artifact_id: result.assessmentArtifactId },
    completedAt: now(),
  }
  updateStepRecord(deps.database.connection, completedStep)
  emitEvent?.({ type: 'analysis-step-completed', step: completedStep })
  emitEvent?.({ type: 'analysis-phase-changed', phase: result.updatedState.phase })

  return result.updatedState
}

async function runFinalAggregation(
  deps: FastToolAnalysisWorkflowDeps,
  state: AnalysisSessionState,
  emitEvent?: AnalysisStreamEventSink,
): Promise<AnalysisSessionState> {
  const ordinal = getNextStepOrdinal(deps.database.connection, state.analysisSessionId)
  const stepId = formatStepId(state.analysisSessionId, ordinal)
  const stepRecord: StepPersistenceRecord = {
    id: stepId,
    sessionId: state.analysisSessionId,
    stepTypeKey: mkStepTypeKey('analysis_final_aggregation'),
    ordinal,
    status: 'running',
    params: {},
    state: {},
    createdAt: now(),
    completedAt: null,
  }
  insertStepRecord(deps.database.connection, stepRecord)
  emitEvent?.({ type: 'analysis-step-started', step: { ...stepRecord } })
  emitEvent?.({ type: 'analysis-phase-changed', phase: 'final_aggregation' })

  const result = await runFastToolFinalAggregationTurn(deps.database, deps.lmGateway, deps.mcpGateway, {
    state,
    stepId,
  }, emitEvent)

  const completedStep: StepPersistenceRecord = {
    ...stepRecord,
    status: result.success ? 'complete' : 'error',
    state: { report_artifact_id: result.reportArtifactId },
    completedAt: now(),
  }
  updateStepRecord(deps.database.connection, completedStep)
  emitEvent?.({ type: 'analysis-step-completed', step: completedStep })
  emitEvent?.({ type: 'analysis-phase-changed', phase: result.updatedState.phase })

  return result.updatedState
}