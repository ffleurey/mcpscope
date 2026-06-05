import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import {
  insertStepRecord,
  updateStepRecord,
  getNextStepDisplayNumber,
  getNextChildIndex,
} from '../persistence/repositoryV2.js'
import type { StepPersistenceRecord } from '../domain/persistenceContract.js'
import { stepTypeKey as mkStepTypeKey } from '../domain/executionModel.js'
import { formatStepId } from '../domain/hierarchicalIds.js'
import { getLatestArtifactBySchemaKey } from './artifactRepository.js'
import { runBootstrapStep } from './bootstrapStep.js'
import { runCoverageValidationStep } from './coverageValidationStep.js'
import { runToolCallAssessmentTurn } from './fullSession/toolCallAssessmentTurn.js'
import { runTurnSummaryTurn } from './fullSession/turnSummaryTurn.js'
import { runFinalAggregationTurn } from './fullSession/finalAggregationTurn.js'
import {
  SCHEMA_KEY,
  type AnalysisSessionState,
  type EvidencePacketIndex,
} from './schemas.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import { ANALYSIS_WORKFLOW_KIND } from './workflowKinds.js'

function now(): number {
  return Date.now()
}

export interface FullSessionAnalysisWorkflowInput {
  analysisSessionId: string
  targetSessionId: string
  targetTurnId: string
  analysisGoal: string
  selectedToolNames: string[]
  onlyFailedToolCalls: boolean
  evaluationCriteria: string[]
}

export interface FullSessionAnalysisWorkflowDeps {
  database: BackendDatabase
  lmGateway: LmStudioGateway
  mcpGateway: McpGateway
}

export function createFullSessionAnalysisState(
  input: FullSessionAnalysisWorkflowInput,
): AnalysisSessionState {
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

export function getFullSessionAnalysisCursorParams(state: AnalysisSessionState): Record<string, unknown> {
  return {
    workflow_kind: ANALYSIS_WORKFLOW_KIND.FULL_SESSION,
    targetSessionId: state.targetSessionId,
    targetTurnId: state.targetTurnId,
    analysisGoal: state.analysisGoal,
    selectedToolNames: state.selectedToolNames,
    onlyFailedToolCalls: state.onlyFailedToolCalls,
    evaluationCriteria: state.evaluationCriteria,
  }
}

export function isFullSessionAnalysisTerminal(state: AnalysisSessionState): boolean {
  return state.phase === 'complete' || state.phase === 'error'
}

export async function advanceFullSessionAnalysisStep(
  deps: FullSessionAnalysisWorkflowDeps,
  state: AnalysisSessionState,
  emitEvent?: AnalysisStreamEventSink,
): Promise<AnalysisSessionState> {
  if (state.phase === 'bootstrap') {
    return runBootstrap(deps, state, emitEvent)
  }
  if (state.phase === 'assessing') {
    return runNextAssessment(deps, state, emitEvent)
  }
  if (state.phase === 'turn_summary') {
    return runTurnSummary(deps, state, emitEvent)
  }
  if (state.phase === 'coverage_validation') {
    return runCoverageValidation(deps, state, emitEvent)
  }
  if (state.phase === 'final_aggregation') {
    return runFinalAggregation(deps, state, emitEvent)
  }
  return state
}

async function runBootstrap(
  deps: FullSessionAnalysisWorkflowDeps,
  state: AnalysisSessionState,
  emitEvent?: AnalysisStreamEventSink,
): Promise<AnalysisSessionState> {
  const childIndex = getNextChildIndex(deps.database.connection, state.analysisSessionId)
  const stepNumber = getNextStepDisplayNumber(deps.database.connection, state.analysisSessionId)
const stepId = formatStepId(state.analysisSessionId, stepNumber)
  const stepRecord: StepPersistenceRecord = {
    id: stepId,
    sessionId: state.analysisSessionId,
    stepTypeKey: mkStepTypeKey('analysis_bootstrap'),
    parentStepId: null,
    childIndex,
    status: 'running',
    params: {},
    state: {},
    createdAt: now(),
    completedAt: null,
  }
  insertStepRecord(deps.database.connection, stepRecord)
  emitEvent?.({ type: 'analysis-step-started', step: { ...stepRecord } })
  emitEvent?.({ type: 'analysis-phase-changed', phase: 'bootstrap' })

  const result = await runBootstrapStep(deps.database, deps.mcpGateway, { state, stepId }, emitEvent)

  const completedStep: StepPersistenceRecord = {
    ...stepRecord,
    status: 'complete',
    state: { packetCount: result.packetCount },
    completedAt: now(),
  }
  updateStepRecord(deps.database.connection, completedStep)
  emitEvent?.({ type: 'analysis-step-completed', step: completedStep })
  emitEvent?.({ type: 'analysis-phase-changed', phase: result.updatedState.phase })

  return result.updatedState
}

async function runNextAssessment(
  deps: FullSessionAnalysisWorkflowDeps,
  state: AnalysisSessionState,
  emitEvent?: AnalysisStreamEventSink,
): Promise<AnalysisSessionState> {
  const packetIndexArtifact = getLatestArtifactBySchemaKey(
    deps.database.connection,
    state.analysisSessionId,
    SCHEMA_KEY.EVIDENCE_PACKET_INDEX,
  )
  const targetArtifact = getLatestArtifactBySchemaKey(
    deps.database.connection,
    state.analysisSessionId,
    SCHEMA_KEY.ANALYSIS_TARGET,
  )
  if (!packetIndexArtifact || !targetArtifact) {
    return { ...state, phase: 'error' }
  }

  const packetIndex = packetIndexArtifact.content as EvidencePacketIndex
  const packet = packetIndex.packets[state.nextPacketIndex]
  if (!packet) {
    return { ...state, phase: 'turn_summary' }
  }

  const childIndex = getNextChildIndex(deps.database.connection, state.analysisSessionId)
  const stepNumber = getNextStepDisplayNumber(deps.database.connection, state.analysisSessionId)
const stepId = formatStepId(state.analysisSessionId, stepNumber)
  const assessStep: StepPersistenceRecord = {
    id: stepId,
    sessionId: state.analysisSessionId,
    stepTypeKey: mkStepTypeKey('analysis_tool_call_assessment'),
    parentStepId: null,
    childIndex,
    status: 'running',
    params: { tool_call_part_id: packet.tool_call_part_id },
    state: {},
    createdAt: now(),
    completedAt: null,
  }
  insertStepRecord(deps.database.connection, assessStep)
  emitEvent?.({ type: 'analysis-step-started', step: { ...assessStep } })

  const result = await runToolCallAssessmentTurn(
    deps.database,
    deps.lmGateway,
    deps.mcpGateway,
    {
      state: state.currentTurnId === packet.turn_id ? state : { ...state, currentTurnId: packet.turn_id },
      stepId,
      packet,
      analysisTarget: targetArtifact.content as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    },
    emitEvent,
  )

  const completedAssessStep: StepPersistenceRecord = {
    ...assessStep,
    status: result.success ? 'complete' : 'error',
    state: { assessment_artifact_id: result.assessmentArtifactId },
    completedAt: now(),
  }
  updateStepRecord(deps.database.connection, completedAssessStep)
  emitEvent?.({ type: 'analysis-step-completed', step: completedAssessStep })

  return result.updatedState
}

async function runTurnSummary(
  deps: FullSessionAnalysisWorkflowDeps,
  state: AnalysisSessionState,
  emitEvent?: AnalysisStreamEventSink,
): Promise<AnalysisSessionState> {
  const childIndex = getNextChildIndex(deps.database.connection, state.analysisSessionId)
  const stepNumber = getNextStepDisplayNumber(deps.database.connection, state.analysisSessionId)
const stepId = formatStepId(state.analysisSessionId, stepNumber)
  const stepRecord: StepPersistenceRecord = {
    id: stepId,
    sessionId: state.analysisSessionId,
    stepTypeKey: mkStepTypeKey('analysis_turn_summary'),
    parentStepId: null,
    childIndex,
    status: 'running',
    params: { turn_id: state.currentTurnId },
    state: {},
    createdAt: now(),
    completedAt: null,
  }
  insertStepRecord(deps.database.connection, stepRecord)
  emitEvent?.({ type: 'analysis-step-started', step: { ...stepRecord } })
  emitEvent?.({ type: 'analysis-phase-changed', phase: 'turn_summary' })

  const result = await runTurnSummaryTurn(deps.database, deps.lmGateway, deps.mcpGateway, {
    state,
    stepId,
  }, emitEvent)

  const completedStep: StepPersistenceRecord = {
    ...stepRecord,
    status: result.success ? 'complete' : 'error',
    state: { summary_artifact_id: result.summaryArtifactId },
    completedAt: now(),
  }
  updateStepRecord(deps.database.connection, completedStep)
  emitEvent?.({ type: 'analysis-step-completed', step: completedStep })
  emitEvent?.({ type: 'analysis-phase-changed', phase: result.updatedState.phase })

  return result.updatedState
}

function runCoverageValidation(
  deps: FullSessionAnalysisWorkflowDeps,
  state: AnalysisSessionState,
  emitEvent?: AnalysisStreamEventSink,
): AnalysisSessionState {
  const result = runCoverageValidationStep(deps.database, {
    state,
    stepId: state.analysisSessionId,
  })
  emitEvent?.({ type: 'analysis-phase-changed', phase: result.updatedState.phase })
  return result.updatedState
}

async function runFinalAggregation(
  deps: FullSessionAnalysisWorkflowDeps,
  state: AnalysisSessionState,
  emitEvent?: AnalysisStreamEventSink,
): Promise<AnalysisSessionState> {
  const childIndex = getNextChildIndex(deps.database.connection, state.analysisSessionId)
  const stepNumber = getNextStepDisplayNumber(deps.database.connection, state.analysisSessionId)
const stepId = formatStepId(state.analysisSessionId, stepNumber)
  const stepRecord: StepPersistenceRecord = {
    id: stepId,
    sessionId: state.analysisSessionId,
    stepTypeKey: mkStepTypeKey('analysis_final_aggregation'),
    parentStepId: null,
    childIndex,
    status: 'running',
    params: {},
    state: {},
    createdAt: now(),
    completedAt: null,
  }
  insertStepRecord(deps.database.connection, stepRecord)
  emitEvent?.({ type: 'analysis-step-started', step: { ...stepRecord } })
  emitEvent?.({ type: 'analysis-phase-changed', phase: 'final_aggregation' })

  const result = await runFinalAggregationTurn(deps.database, deps.lmGateway, deps.mcpGateway, {
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