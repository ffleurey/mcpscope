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

export const sessionTraceBundleSchema = z.object({
  session: sessionRecordSchema,
  steps: z.array(stepRecordSchema).default([]),
  turns: z.array(turnRecordSchema),
  rounds: z.array(roundRecordSchema),
  parts: z.array(partRecordSchema),
  rawExchanges: z.array(rawExchangeRecordSchema),
  transcript: z.array(z.unknown()),
  context: z.array(z.unknown()),
})

export interface SessionTraceBundle {
  session: SessionRecord
  steps: StepRecord[]
  turns: TurnRecord[]
  rounds: RoundRecord[]
  parts: PartRecord[]
  rawExchanges: RawExchangeRecord[]
  transcript: ReturnType<typeof deriveTranscriptEntries>
  context: ReturnType<typeof deriveContextEntries>
}

export function buildSessionTraceBundle(input: {
  session: SessionRecord
  steps?: StepRecord[]
  turns: TurnRecord[]
  rounds: RoundRecord[]
  parts: PartRecord[]
  rawExchanges: RawExchangeRecord[]
  transcript: ReturnType<typeof deriveTranscriptEntries>
  context: ReturnType<typeof deriveContextEntries>
}): SessionTraceBundle {
  return {
    session: input.session,
    steps: input.steps ?? [],
    turns: input.turns,
    rounds: input.rounds,
    parts: input.parts,
    rawExchanges: input.rawExchanges,
    transcript: input.transcript,
    context: input.context,
  }
}
