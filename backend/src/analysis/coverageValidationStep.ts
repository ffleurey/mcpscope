/**
 * AnalysisCoverageValidationStep
 *
 * Verifies that every tool-call part discovered by buildPlan() has an accepted
 * assessment artifact.  On failure, writes a diagnostic artifact and returns
 * { status: 'error' }.  On success, returns { status: 'complete' }.
 *
 * Modeled as a WorkflowStep subclass so the validation creates an inspectable
 * step record in the UI, same as every other command.
 */

import crypto from 'node:crypto'
import type { BackendDatabase } from '../persistence/db.js'
import type { ChatCompletionGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import { WorkflowStep } from '../workflow/workflowStep.js'
import type { StepContext } from '../workflow/stepContext.js'
import type { StepResult, StepTypeKey } from '../domain/executionModel.js'
import { STEP_TYPE } from '../domain/executionModel.js'
import {
  insertJsonArtifact,
  getLatestArtifactBySchemaKey,
  listArtifactsBySessionAndSchemaKey,
} from './artifactRepository.js'
import {
  SCHEMA_KEY,
  type EvidencePacketIndex,
} from './schemas.js'

function uuid(): string {
  return crypto.randomUUID()
}

function now(): number {
  return Date.now()
}

export interface CoverageValidationStepConfig {
  assessmentSchemaKey: string
}

export class CoverageValidationStep extends WorkflowStep {
  readonly stepLabel = 'Coverage Validation'
  readonly kind = 'coverage'
  readonly stepTypeKey: StepTypeKey = STEP_TYPE.ANALYSIS_COVERAGE_VALIDATION
  get semanticId(): string { return '' }

  isComplete(db: BackendDatabase, sessionId: string): boolean {
    const indexArtifact = getLatestArtifactBySchemaKey(db.connection, sessionId, SCHEMA_KEY.EVIDENCE_PACKET_INDEX)
    if (!indexArtifact) return false
    const packets = (indexArtifact.content as EvidencePacketIndex).packets
    if (packets.length === 0) return true
    const assessments = listArtifactsBySessionAndSchemaKey(db.connection, sessionId, this.config.assessmentSchemaKey)
    const assessedIds = new Set(assessments.map(a => a.metadata.tool_call_part_id as string | undefined).filter(Boolean))
    return packets.every(p => assessedIds.has(p.tool_call_part_id))
  }

  constructor(
    db: BackendDatabase,
    lm: ChatCompletionGateway,
    mcp: McpGateway,
    private readonly config: CoverageValidationStepConfig,
  ) {
    super(db, lm, mcp)
  }

  protected async run(ctx: StepContext): Promise<StepResult> {
    const analysisSessionId = ctx.sessionId

    const packetIndexArtifact = getLatestArtifactBySchemaKey(
      this.db.connection,
      analysisSessionId,
      SCHEMA_KEY.EVIDENCE_PACKET_INDEX,
    )
    if (!packetIndexArtifact) {
      insertJsonArtifact(this.db.connection, {
        id: uuid(),
        sessionId: analysisSessionId,
        stepId: this.stepId,
        content: {
          step_type: 'coverage_validation',
          error_kind: 'missing_packet_index',
          message: 'evidence_packet_index artifact missing — bootstrap may not have completed',
          detail: { has_packet_index: false },
        },
        metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC },
        createdAt: now(),
      })
      return { status: 'error', outputArtifacts: [] }
    }

    const packetIndex = packetIndexArtifact.content as EvidencePacketIndex
    const assessments = listArtifactsBySessionAndSchemaKey(
      this.db.connection,
      analysisSessionId,
      this.config.assessmentSchemaKey,
    )
    const assessedToolCallPartIds = new Set(
      assessments.map(a => {
        const meta = a.metadata as { tool_call_part_id?: string }
        return meta.tool_call_part_id
      }),
    )

    const unassessed = packetIndex.packets.filter(
      p => !assessedToolCallPartIds.has(p.tool_call_part_id),
    )

    if (unassessed.length > 0) {
      const failures = unassessed.map(
        p => `Tool call ${p.tool_call_part_id} (${p.tool_name}) has no accepted assessment`,
      )
      insertJsonArtifact(this.db.connection, {
        id: uuid(),
        sessionId: analysisSessionId,
        stepId: this.stepId,
        content: {
          step_type: 'coverage_validation',
          error_kind: 'incomplete_coverage',
          message: `${failures.length} packet(s) lack accepted assessments`,
          detail: { failures },
        },
        metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC },
        createdAt: now(),
      })
      return { status: 'error', outputArtifacts: [] }
    }

    return { status: 'complete', outputArtifacts: [] }
  }
}
