import type { BackendDatabase } from '../persistence/db.js'
import type { ChatCompletionGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import { getSessionRecord } from '../persistence/repository.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import { FullSessionAnalysis } from './fullSession/fullSessionAnalysis.js'
import { FastSessionAnalysis } from './fastSession/fastSessionAnalysis.js'
import { FastToolAnalysis } from './fastTool/fastToolAnalysis.js'
import { BenchmarkEvaluationAnalysis } from './benchmarkEvaluation/benchmarkEvaluationAnalysis.js'
import { ANALYSIS_WORKFLOW_KIND } from './workflowKinds.js'
import type { AnalysisSessionState } from './schemas.js'
import type { AnalysisSessionBase } from './analysisSessionBase.js'
import type { AnalysisCommand } from '../workflow/workflowStep.js'

export interface RehydratableAnalysisWorkflow {
  canContinue(): boolean
  resume(emitEvent?: AnalysisStreamEventSink): Promise<void>
  resumeOneStep(emitEvent?: AnalysisStreamEventSink): Promise<void>
  getPlan(): AnalysisCommand[]
  computeRetryPhase(): string
}

type AnalysisSubclassCtor = {
  rehydrate(db: BackendDatabase, lm: ChatCompletionGateway, mcp: McpGateway, sessionId: string): AnalysisSessionBase | null
  readonly workflowKind: string
  readonly workflowLabel: string
  buildSystemPrompt(input: { analysisGoal: string; additionalInstructions?: string }): string
}

const workflowRegistry = new Map<string, AnalysisSubclassCtor>()

export function registerAnalysisWorkflow(ctor: AnalysisSubclassCtor): void {
  workflowRegistry.set(ctor.workflowKind, ctor)
}

registerAnalysisWorkflow(FullSessionAnalysis as unknown as AnalysisSubclassCtor)
registerAnalysisWorkflow(FastSessionAnalysis as unknown as AnalysisSubclassCtor)
registerAnalysisWorkflow(FastToolAnalysis as unknown as AnalysisSubclassCtor)
registerAnalysisWorkflow(BenchmarkEvaluationAnalysis as unknown as AnalysisSubclassCtor)

export function rehydrateAnalysisWorkflow(
  database: BackendDatabase,
  lmGateway: ChatCompletionGateway,
  mcpGateway: McpGateway,
  analysisSessionId: string,
): RehydratableAnalysisWorkflow | null {
  const session = getSessionRecord(database.connection, analysisSessionId)
  if (!session || !session.analysisState) return null

  const workflowKind = (session.analysisState as unknown as AnalysisSessionState)?.workflow_kind
    ?? ANALYSIS_WORKFLOW_KIND.FULL_SESSION

  const ctor = workflowRegistry.get(workflowKind)
  if (!ctor) throw new Error(`Unsupported analysis workflow kind: ${workflowKind}`)
  return ctor.rehydrate(database, lmGateway, mcpGateway, analysisSessionId)
}

export function isKnownWorkflowKind(kind: string): boolean {
  return workflowRegistry.has(kind)
}

export function getWorkflowLabel(kind: string): string | null {
  return workflowRegistry.get(kind)?.workflowLabel ?? null
}

export function getWorkflowKinds(): string[] {
  return [...workflowRegistry.keys()]
}

export function buildAnalysisSystemPrompt(kind: string, input: {
  analysisGoal: string
  additionalInstructions?: string
}): string {
  const ctor = workflowRegistry.get(kind)
  if (!ctor) {
    // Fallback to full session
    const fallback = workflowRegistry.get('full_session_analysis')
    if (fallback) return fallback.buildSystemPrompt(input)
    throw new Error(`Unsupported analysis workflow kind: ${kind}`)
  }
  return ctor.buildSystemPrompt(input)
}
