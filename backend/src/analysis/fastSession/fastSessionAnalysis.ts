/**
 * Fast-session analysis — subclass of AnalysisSessionBase.
 *
 * buildPlan() produces a list of AnalysisCommands by reading the evidence
 * packet index artifact left by bootstrap, creating one AssessCommand per
 * packet and one TurnSummaryCommand per turn.
 */

import type { BackendDatabase } from '../../persistence/db.js'
import type { ChatCompletionGateway } from '../../runtime/modelTurns.js'
import type { McpGateway } from '../../runtime/toolTurns.js'
import {
  AnalysisSessionBase,
  type AnalysisCommand,
  type PartInfo,
  type RoundInfo,
  type TurnInfo,
} from '../analysisSessionBase.js'
import type { AnalysisWorkflowInput } from '../analysisWorkflowInput.js'
import {
  SCHEMA_KEY,
  type AnalysisSessionState,
  type AnalysisTarget,
  type EvidencePacketIndex,
  type EvidencePacket,
} from '../schemas.js'
import { SCHEMA_KEY as SELF_KEY, fastSessionFinalAnalysisReportSchema } from './schemas.js'
import { ANALYSIS_WORKFLOW_KIND } from '../workflowKinds.js'
import { STEP_TYPE } from '../../domain/executionModel.js'
import { BootstrapStep } from '../shared/bootstrapStep.js'
import { ToolCallAssessmentStep } from '../shared/toolCallAssessmentStep.js'
import { TurnSummaryStep } from '../shared/turnSummaryStep.js'
import { FinalAggregationStep } from '../shared/finalAggregationStep.js'
import { CoverageValidationStep } from '../coverageValidationStep.js'
import { buildFastSessionToolCallAssessmentPrompt } from './evaluationPrompts.js'
import { buildFastSessionTurnSummaryPrompt } from './evaluationPrompts.js'
import { buildFastSessionFinalAggregationPrompt } from './evaluationPrompts.js'
import { getLatestArtifactBySchemaKey, listArtifactsBySessionAndSchemaKey } from '../artifactRepository.js'
import { buildFastSessionSystemPrompt } from './systemPrompt.js'

export class FastSessionAnalysis extends AnalysisSessionBase {
  static readonly workflowKind = ANALYSIS_WORKFLOW_KIND.FAST_SESSION
  static readonly workflowLabel = 'Fast Session Analysis'
  static create(
    db: BackendDatabase,
    lm: ChatCompletionGateway,
    mcp: McpGateway,
    input: AnalysisWorkflowInput,
  ): FastSessionAnalysis {
    const state: AnalysisSessionState = {
      phase: 'bootstrap',
      analysisSessionId: input.analysisSessionId,
      targetSessionId: input.targetSessionId,
      targetTurnId: input.targetTurnId,
      analysisGoal: input.analysisGoal,
      selectedToolNames: input.selectedToolNames,
      onlyFailedToolCalls: input.onlyFailedToolCalls,
      evaluationCriteria: input.evaluationCriteria,
    }
    return new FastSessionAnalysis(db, lm, mcp, input, state)
  }

  static rehydrate(
    db: BackendDatabase,
    lm: ChatCompletionGateway,
    mcp: McpGateway,
    sessionId: string,
  ): FastSessionAnalysis | null {
    const state = AnalysisSessionBase.rehydrateState(db, sessionId)
    if (!state) return null
    const input: AnalysisWorkflowInput = {
      analysisSessionId: sessionId,
      targetSessionId: state.targetSessionId,
      targetTurnId: state.targetTurnId,
      analysisGoal: state.analysisGoal,
      selectedToolNames: state.selectedToolNames,
      onlyFailedToolCalls: state.onlyFailedToolCalls,
      evaluationCriteria: state.evaluationCriteria,
    }
    return new FastSessionAnalysis(db, lm, mcp, input, state)
  }

  protected getWorkflowKind(): string {
    return ANALYSIS_WORKFLOW_KIND.FAST_SESSION
  }

  static buildSystemPrompt(input: { analysisGoal: string; selectedToolNames: string[]; onlyFailedToolCalls: boolean; evaluationCriteria: string[] }): string {
    return buildFastSessionSystemPrompt(input)
  }

  // ── Hooks — called by buildPlan() during tree traversal ───────────────────

  protected onBeforeSession(): void {
    this.addCommand(new BootstrapCommand(this.db, this.lm, this.mcp))
  }

  protected onToolCall(part: PartInfo, _round: RoundInfo, _turn: TurnInfo): void {
    const targetArtifact = this.readArtifact(SCHEMA_KEY.ANALYSIS_TARGET)
    const indexArtifact = this.readArtifact(SCHEMA_KEY.EVIDENCE_PACKET_INDEX)
    if (!targetArtifact || !indexArtifact) return
    const target = targetArtifact.content as AnalysisTarget

    const knownPackets = (indexArtifact.content as EvidencePacketIndex).packets
    let packet: EvidencePacket | undefined = knownPackets.find(p => p.tool_call_part_id === part.id)
    if (!packet) {
      const knownIds = new Set(knownPackets.map(p => p.tool_call_part_id))
      packet = this.discoverNewPackets(knownIds).find(p => p.tool_call_part_id === part.id)
    }
    if (packet) {
      this.addCommand(new AssessCommand(this.db, this.lm, this.mcp, packet, target))
    }
  }

  protected onAfterTurn(turn: TurnInfo): void {
    const hasToolCalls = turn.rounds.some(r => r.parts.some(p => p.type === 'tool_call'))
    if (hasToolCalls) {
      this.addCommand(new TurnSummaryCommand(this.db, this.lm, this.mcp, turn.id))
    }
  }

  protected onAfterSession(): void {
    this.addCommand(new CoverageCommand(this.db, this.lm, this.mcp))
    this.addCommand(new FinalCommand(this.db, this.lm, this.mcp))
  }
}

// ── Command implementations ─────────────────────────────────────────────────

class BootstrapCommand implements AnalysisCommand {
  readonly kind = 'bootstrap'
  readonly semanticId = ''
  readonly stepTypeKey = STEP_TYPE.ANALYSIS_BOOTSTRAP

  constructor(
    private readonly db: BackendDatabase,
    private readonly lm: ChatCompletionGateway,
    private readonly mcp: McpGateway,
  ) {}

  isComplete(db: BackendDatabase, sessionId: string): boolean {
    return getLatestArtifactBySchemaKey(db.connection, sessionId, SCHEMA_KEY.EVIDENCE_PACKET_INDEX) !== null
  }

  buildStep(): BootstrapStep {
    return new BootstrapStep(this.db, this.lm, this.mcp, {
      indexSchemaKey: SCHEMA_KEY.EVIDENCE_PACKET_INDEX,
    })
  }
}

class AssessCommand implements AnalysisCommand {
  readonly kind = 'assess'
  readonly stepTypeKey = STEP_TYPE.ANALYSIS_TOOL_CALL_ASSESSMENT

  constructor(
    private readonly db: BackendDatabase,
    private readonly lm: ChatCompletionGateway,
    private readonly mcp: McpGateway,
    private readonly packet: EvidencePacket,
    private readonly analysisTarget: AnalysisTarget,
  ) {}

  get semanticId(): string { return this.packet.tool_call_part_id }

  isComplete(db: BackendDatabase, sessionId: string): boolean {
    return listArtifactsBySessionAndSchemaKey(db.connection, sessionId, SELF_KEY.TOOL_CALL_ASSESSMENT)
      .some(a => (a.metadata.tool_call_part_id as string | undefined) === this.semanticId)
  }

  buildStep(): ToolCallAssessmentStep {
    return new ToolCallAssessmentStep(this.db, this.lm, this.mcp, {
      artifactSchemaKey: SELF_KEY.TOOL_CALL_ASSESSMENT,
      buildPrompt: buildFastSessionToolCallAssessmentPrompt,
      packet: this.packet,
      analysisTarget: this.analysisTarget,
    })
  }
}

class TurnSummaryCommand implements AnalysisCommand {
  readonly kind = 'turn_summary'
  readonly stepTypeKey = STEP_TYPE.ANALYSIS_TURN_SUMMARY

  constructor(
    private readonly db: BackendDatabase,
    private readonly lm: ChatCompletionGateway,
    private readonly mcp: McpGateway,
    readonly semanticId: string,
  ) {}

  isComplete(db: BackendDatabase, sessionId: string): boolean {
    return listArtifactsBySessionAndSchemaKey(db.connection, sessionId, SELF_KEY.TURN_SUMMARY)
      .some(a => (a.metadata.turn_id as string | undefined) === this.semanticId)
  }

  buildStep(): TurnSummaryStep {
    return new TurnSummaryStep(this.db, this.lm, this.mcp, {
      assessmentSchemaKey: SELF_KEY.TOOL_CALL_ASSESSMENT,
      summarySchemaKey: SELF_KEY.TURN_SUMMARY,
      turnId: this.semanticId,
      buildPrompt: (params) => buildFastSessionTurnSummaryPrompt({
        analysisTarget: params.analysisTarget as AnalysisTarget,
        subjectId: params.subjectId as string,
        turnPacketCount: params.turnPacketCount as number,
        repeatedTools: params.repeatedTools as string,
      }),
    })
  }
}

class CoverageCommand implements AnalysisCommand {
  readonly kind = 'coverage'
  readonly semanticId = ''
  readonly stepTypeKey = STEP_TYPE.ANALYSIS_COVERAGE_VALIDATION

  constructor(
    private readonly db: BackendDatabase,
    private readonly lm: ChatCompletionGateway,
    private readonly mcp: McpGateway,
  ) {}

  isComplete(db: BackendDatabase, sessionId: string): boolean {
    const indexArtifact = getLatestArtifactBySchemaKey(db.connection, sessionId, SCHEMA_KEY.EVIDENCE_PACKET_INDEX)
    if (!indexArtifact) return false
    const packets = (indexArtifact.content as EvidencePacketIndex).packets
    if (packets.length === 0) return true
    const assessments = listArtifactsBySessionAndSchemaKey(db.connection, sessionId, SELF_KEY.TOOL_CALL_ASSESSMENT)
    const assessedIds = new Set(assessments.map(a => a.metadata.tool_call_part_id as string | undefined).filter(Boolean))
    return packets.every(p => assessedIds.has(p.tool_call_part_id))
  }

  buildStep(): CoverageValidationStep {
    return new CoverageValidationStep(this.db, this.lm, this.mcp, {
      assessmentSchemaKey: SELF_KEY.TOOL_CALL_ASSESSMENT,
    })
  }
}

class FinalCommand implements AnalysisCommand {
  readonly kind = 'final_aggregation'
  readonly semanticId = ''
  readonly stepTypeKey = STEP_TYPE.ANALYSIS_FINAL_AGGREGATION

  constructor(
    private readonly db: BackendDatabase,
    private readonly lm: ChatCompletionGateway,
    private readonly mcp: McpGateway,
  ) {}

  isComplete(db: BackendDatabase, sessionId: string): boolean {
    return getLatestArtifactBySchemaKey(db.connection, sessionId, SELF_KEY.FINAL_ANALYSIS_REPORT) !== null
  }

  buildStep(): FinalAggregationStep {
    return new FinalAggregationStep(this.db, this.lm, this.mcp, {
      assessmentSchemaKey: SELF_KEY.TOOL_CALL_ASSESSMENT,
      summarySchemaKey: SELF_KEY.TURN_SUMMARY,
      reportSchemaKey: SELF_KEY.FINAL_ANALYSIS_REPORT,
      buildPrompt: (params) => buildFastSessionFinalAggregationPrompt({
        analysisTarget: params.analysisTarget as AnalysisTarget,
        assessmentCount: params.assessmentCount as number,
        turnSummaryCount: params.turnSummaryCount as number,
      }),
      reportSchema: fastSessionFinalAnalysisReportSchema,
    })
  }
}
