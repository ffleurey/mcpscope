/**
 * BootstrapStep — discovers analysis work from the target session.
 *
 * Reads the target session, builds the index artifact (evidence packets or
 * tool work index depending on the caller), writes analysis_target and the
 * index artifact, then runs deterministic MCP inspect calls to load evidence.
 *
 * The caller provides `indexSchemaKey` and an optional `buildIndexContent`
 * function to control what index artifact is produced.  Defaults to the
 * EvidencePacketIndex shape used by session-based analysis workflows.
 */

import crypto from 'node:crypto'
import type { BackendDatabase } from 'mcpscope-engine/persistence/db.js'
import { runInTransaction } from 'mcpscope-engine/persistence/connection.js'
import type { ChatCompletionGateway } from 'mcpscope-engine/runtime/modelTurns.js'
import type { McpGateway } from 'mcpscope-engine/runtime/toolTurns.js'
import { WorkflowStep } from '../../workflow/workflowStep.js'
import type { StepContext } from '../../workflow/stepContext.js'
import type { StepResult, StepTypeKey } from 'mcpscope-engine/domain/executionModel.js'
import { STEP_TYPE } from 'mcpscope-engine/domain/executionModel.js'
import { getSessionRecord } from 'mcpscope-engine/persistence/repository.js'
import { insertJsonArtifact, getLatestArtifactBySchemaKey } from '../artifactRepository.js'
import { runDeterministicMcpToolCallsInSingleTurn } from 'mcpscope-engine/runtime/toolTurns.js'
import {
  SCHEMA_KEY,
  type EvidencePacketIndex,
  type AnalysisSessionState,
  type EvidencePacket,
} from '../schemas.js'
import { collectAnalysisPlanningData } from '../analysisPlanning.js'

function uuid(): string { return crypto.randomUUID() }
function now(): number { return Date.now() }

export interface BootstrapStepConfig {
  indexSchemaKey: string
  buildIndexContent?: (packets: EvidencePacket[]) => unknown
  /**
   * When true (default), the bootstrap turn deterministically inspects the
   * target session and pushes that evidence into the analysis session's context.
   * Set false for interactive, tool-enabled workflows (e.g. the benchmark
   * evaluation judge) that should pull evidence on demand via the inspect tool
   * instead of having it pre-injected — keeping context lean and dog-fooding the
   * inspect surface. Planning artifacts are still written either way.
   */
  injectEvidence?: boolean
}

function defaultIndexContent(packets: EvidencePacket[]): EvidencePacketIndex {
  return { packets }
}

export class BootstrapStep extends WorkflowStep {
  readonly stepLabel = 'Bootstrap'
  readonly kind = 'bootstrap'
  readonly stepTypeKey: StepTypeKey = STEP_TYPE.ANALYSIS_BOOTSTRAP
  get semanticId(): string { return '' }

  isComplete(db: BackendDatabase, sessionId: string): boolean {
    return getLatestArtifactBySchemaKey(db.connection, sessionId, this.config.indexSchemaKey) !== null
  }

  constructor(
    db: BackendDatabase,
    lm: ChatCompletionGateway,
    mcp: McpGateway,
    private readonly config: BootstrapStepConfig,
  ) {
    super(db, lm, mcp)
  }

  protected async run(ctx: StepContext): Promise<StepResult> {
    const state = ctx.workflowState as unknown as AnalysisSessionState | undefined
    if (!state) throw new Error('BootstrapStep: workflowState required')

    const { analysisTarget, packets, bootstrapInspectIds } = collectAnalysisPlanningData(this.db, state)
    const { analysisSessionId } = state
    const ts = now()

    const buildIndex = this.config.buildIndexContent ?? defaultIndexContent
    const indexContent = buildIndex(packets)

    runInTransaction(this.db.connection, () => {
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
        content: indexContent,
        metadata: { schema_key: this.config.indexSchemaKey },
        createdAt: ts,
      })
    })

    // Interactive judges pull evidence themselves via the inspect tool; only
    // pre-inject the trace when the workflow relies on it being in context.
    if (this.config.injectEvidence !== false) {
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
    }

    return { status: 'complete', outputArtifacts: [] }
  }
}
