import crypto from 'node:crypto'
import type { BackendDatabase } from '../persistence/db.js'
import { getSessionRecord } from '../persistence/repository.js'
import { insertJsonArtifact } from './artifactRepository.js'
import {
  SCHEMA_KEY,
  type AnalysisSessionState,
} from './schemas.js'
import {
  runDeterministicMcpToolCallsInSingleTurn,
  type McpGateway,
} from '../runtime/toolTurns.js'
import type { TurnStreamEventSink } from '../runtime/streamEvents.js'
import { buildFastToolWorkIndex, collectAnalysisPlanningData } from './analysisPlanning.js'

function uuid(): string {
  return crypto.randomUUID()
}

function now(): number {
  return Date.now()
}

export interface FastToolPlanningInput {
  state: AnalysisSessionState
  stepId: string
}

export interface FastToolPlanningResult {
  updatedState: AnalysisSessionState
  workUnitCount: number
}

export async function runFastToolPlanningStep(
  database: BackendDatabase,
  mcpGateway: McpGateway,
  input: FastToolPlanningInput,
  emitEvent?: TurnStreamEventSink,
): Promise<FastToolPlanningResult> {
  const { state, stepId } = input
  const { analysisTarget, packets, bootstrapInspectIds } = collectAnalysisPlanningData(database, state)
  const workIndex = buildFastToolWorkIndex(packets)
  const ts = now()

  database.connection.transaction(() => {
    insertJsonArtifact(database.connection, {
      id: uuid(),
      sessionId: state.analysisSessionId,
      stepId,
      content: analysisTarget,
      metadata: { schema_key: SCHEMA_KEY.ANALYSIS_TARGET },
      createdAt: ts,
    })
    insertJsonArtifact(database.connection, {
      id: uuid(),
      sessionId: state.analysisSessionId,
      stepId,
      content: workIndex,
      metadata: { schema_key: SCHEMA_KEY.FAST_TOOL_WORK_INDEX },
      createdAt: ts,
    })
  })()

  const analysisSession = getSessionRecord(database.connection, state.analysisSessionId)
  if (!analysisSession) {
    throw new Error(`FastToolPlanning: analysis session not found: ${state.analysisSessionId}`)
  }

  await runDeterministicMcpToolCallsInSingleTurn(
    database,
    mcpGateway,
    analysisSession,
    bootstrapInspectIds.map(id => ({ toolName: 'mcpscope_inspect', toolArgs: { id } })),
    emitEvent,
    stepId,
  )

  return {
    updatedState: {
      ...state,
      phase: workIndex.tool_groups.length > 0 ? 'assessing' : 'final_aggregation',
      bootstrapComplete: true,
      packetCount: workIndex.tool_groups.length,
      nextPacketIndex: 0,
      currentTurnId: null,
    },
    workUnitCount: workIndex.tool_groups.length,
  }
}