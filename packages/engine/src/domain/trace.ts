import { z } from 'zod'
import type {
  PartRecord,
  RawExchangeRecord,
  RoundRecord,
  SessionRecord,
  StepRecord,
  TurnRecord,
} from './model.js'
import {
  partRecordSchema,
  rawExchangeRecordSchema,
  roundRecordSchema,
  sessionRecordSchema,
  stepRecordSchema,
  turnRecordSchema,
} from './model.js'
import type { deriveContextEntries, deriveTranscriptEntries } from './selectors.js'

export const traceArtifactSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  stepId: z.string().nullable(),
  content: z.unknown(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.number().int().nonnegative(),
})

export const workflowStepTraceSchema = z.object({
  step: stepRecordSchema,
  ownedTurns: z.array(turnRecordSchema).default([]),
  postambleSteps: z.array(stepRecordSchema).default([]),
  artifacts: z.array(traceArtifactSchema).default([]),
})

export const sessionTraceBundleSchema = z.object({
  session: sessionRecordSchema,
  steps: z.array(stepRecordSchema).default([]),
  turns: z.array(turnRecordSchema),
  rounds: z.array(roundRecordSchema),
  parts: z.array(partRecordSchema),
  rawExchanges: z.array(rawExchangeRecordSchema),
  artifacts: z.array(traceArtifactSchema).default([]),
  workflowSteps: z.array(workflowStepTraceSchema).default([]),
  transcript: z.array(z.unknown()),
  context: z.array(z.unknown()),
})

export interface TraceArtifactRecord {
  id: string
  sessionId: string
  stepId: string | null
  content: unknown
  metadata: Record<string, unknown>
  createdAt: number
}

export interface WorkflowStepTrace {
  step: StepRecord
  ownedTurns: TurnRecord[]
  postambleSteps: StepRecord[]
  artifacts: TraceArtifactRecord[]
}

export interface SessionTraceBundle {
  session: SessionRecord
  steps: StepRecord[]
  turns: TurnRecord[]
  rounds: RoundRecord[]
  parts: PartRecord[]
  rawExchanges: RawExchangeRecord[]
  artifacts?: TraceArtifactRecord[]
  workflowSteps?: WorkflowStepTrace[]
  transcript: ReturnType<typeof deriveTranscriptEntries>
  context: ReturnType<typeof deriveContextEntries>
}

function isVisibleTraceStep(_step: StepRecord): boolean {
  return true
}

function deriveWorkflowSteps(
  steps: StepRecord[],
  turns: TurnRecord[],
  artifacts: TraceArtifactRecord[],
): WorkflowStepTrace[] {
  const ownedTurnsByStepId = new Map<string, TurnRecord[]>()
  for (const turn of turns) {
    if (!turn.ownerStepId) continue
    ownedTurnsByStepId.set(turn.ownerStepId, [...(ownedTurnsByStepId.get(turn.ownerStepId) ?? []), turn])
  }

  const postambleStepsByTurnId = new Map<string, StepRecord[]>()
  for (const step of steps) {
    if (step.stepTypeKey !== 'compaction') continue
    const sourceTurnId = typeof step.params.sourceTurnId === 'string' ? step.params.sourceTurnId : null
    if (!sourceTurnId) continue
    postambleStepsByTurnId.set(sourceTurnId, [...(postambleStepsByTurnId.get(sourceTurnId) ?? []), step])
  }

  const artifactsByStepId = new Map<string, TraceArtifactRecord[]>()
  for (const artifact of artifacts) {
    if (!artifact.stepId) continue
    artifactsByStepId.set(artifact.stepId, [...(artifactsByStepId.get(artifact.stepId) ?? []), artifact])
  }

  return [...steps]
    .filter(step => step.stepTypeKey !== 'turn' && step.stepTypeKey !== 'compaction')
    .sort((left, right) => left.childIndex - right.childIndex)
    .map((step) => {
      const ownedTurns = [...(ownedTurnsByStepId.get(step.id) ?? [])]
        .sort((left, right) => left.turnNumber - right.turnNumber)
      const postambleSteps = ownedTurns
        .flatMap(turn => postambleStepsByTurnId.get(turn.id) ?? [])
        .sort((left, right) => left.childIndex - right.childIndex)
      const stepArtifacts = [...(artifactsByStepId.get(step.id) ?? [])]
        .sort((left, right) => left.createdAt - right.createdAt)

      return {
        step,
        ownedTurns,
        postambleSteps,
        artifacts: stepArtifacts,
      }
    })
}

export function buildSessionTraceBundle(input: {
  session: SessionRecord
  steps?: StepRecord[]
  turns: TurnRecord[]
  rounds: RoundRecord[]
  parts: PartRecord[]
  rawExchanges: RawExchangeRecord[]
  artifacts?: TraceArtifactRecord[]
  transcript: ReturnType<typeof deriveTranscriptEntries>
  context: ReturnType<typeof deriveContextEntries>
}): SessionTraceBundle {
  const steps = (input.steps ?? []).filter(isVisibleTraceStep)
  const artifacts = input.artifacts ?? []

  return {
    session: input.session,
    steps,
    turns: input.turns,
    rounds: input.rounds,
    parts: input.parts,
    rawExchanges: input.rawExchanges,
    artifacts,
    workflowSteps: deriveWorkflowSteps(steps, input.turns, artifacts),
    transcript: input.transcript,
    context: input.context,
  }
}
