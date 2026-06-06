/**
 * BootstrapStep — discovers analysis work from the target session.
 *
 * Reads the target session, builds the evidence packet index, and writes
 * analysis_target and evidence_packet_index artifacts.
 *
 * Modes: 'session' (FullSession, FastSession) and 'tool' (FastTool).
 * Tool mode groups tool calls by tool name into FastToolWorkIndex.
 */

import crypto from 'node:crypto'
import type { BackendDatabase } from '../../persistence/db.js'
import type { LmStudioGateway } from '../../runtime/modelTurns.js'
import type { McpGateway } from '../../runtime/toolTurns.js'
import { WorkflowStep } from '../../workflow/workflowStep.js'
import type { StepContext } from '../../workflow/stepContext.js'
import type { StepResult } from '../../domain/executionModel.js'
import { getSessionRecord } from '../../persistence/repository.js'
import { insertJsonArtifact } from '../artifactRepository.js'
import {
  runDeterministicMcpToolCallsInSingleTurn,
} from '../../runtime/toolTurns.js'
import {
  SCHEMA_KEY,
  type EvidencePacketIndex,
  type AnalysisSessionState,
} from '../schemas.js'
import { collectAnalysisPlanningData, buildFastToolWorkIndex } from '../analysisPlanning.js'

function uuid(): string { return crypto.randomUUID() }
function now(): number { return Date.now() }

export type BootstrapPlanningMode = 'session' | 'tool'

export class BootstrapStep extends WorkflowStep {
  readonly stepLabel = 'Bootstrap'

  constructor(
    db: BackendDatabase,
    lm: LmStudioGateway,
    mcp: McpGateway,
    private readonly planningMode: BootstrapPlanningMode,
  ) {
    super(db, lm, mcp)
  }

  protected async run(ctx: StepContext): Promise<StepResult> {
    const state = ctx.workflowState as unknown as AnalysisSessionState | undefined
    if (!state) throw new Error('BootstrapStep: workflowState required')

    const { analysisTarget, packets, bootstrapInspectIds } = collectAnalysisPlanningData(this.db, state)
    const { analysisSessionId } = state
    const ts = now()

    if (this.planningMode === 'tool') {
      const workIndex = buildFastToolWorkIndex(packets)

      this.db.connection.transaction(() => {
        insertJsonArtifact(this.db.connection, {
          id: uuid(),
          sessionId: analysisSessionId,
          stepId: this.stepId,
          content: analysisTarget,
          metadata: { schema_key: SCHEMA_KEY.ANALYSIS_TARGET },
          createdAt: ts,
        })
        insertJsonArtifact(this.db.connection, {
          id: uuid(),
          sessionId: analysisSessionId,
          stepId: this.stepId,
          content: workIndex,
          metadata: { schema_key: SCHEMA_KEY.FAST_TOOL_WORK_INDEX },
          createdAt: ts,
        })
      })()
    } else {
      const evidencePacketIndex: EvidencePacketIndex = { packets }

      this.db.connection.transaction(() => {
        insertJsonArtifact(this.db.connection, {
          id: uuid(),
          sessionId: analysisSessionId,
          stepId: this.stepId,
          content: analysisTarget,
          metadata: { schema_key: SCHEMA_KEY.ANALYSIS_TARGET },
          createdAt: ts,
        })
        insertJsonArtifact(this.db.connection, {
          id: uuid(),
          sessionId: analysisSessionId,
          stepId: this.stepId,
          content: evidencePacketIndex,
          metadata: { schema_key: SCHEMA_KEY.EVIDENCE_PACKET_INDEX },
          createdAt: ts,
        })
      })()
    }

    const analysisSession = getSessionRecord(this.db.connection, analysisSessionId)
    if (!analysisSession) {
      throw new Error(`Bootstrap: analysis session not found: ${analysisSessionId}`)
    }

    await runDeterministicMcpToolCallsInSingleTurn(
      this.db,
      this.mcp,
      analysisSession,
      bootstrapInspectIds.map(id => ({ toolName: 'mcpscope_inspect', toolArgs: { id } })),
      ctx.emitSink,
      this.stepId,
    )

    Object.assign(state, {
      phase: packets.length > 0 ? 'assessing' : 'coverage_validation',
      bootstrapComplete: true,
      packetCount: packets.length,
      nextPacketIndex: 0,
      currentTurnId: null,
    })

    return { status: 'complete', outputArtifacts: [] }
  }
}
