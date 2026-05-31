import type { PartRecord, RoundRecord, StepRecord, TurnRecord } from '../domain/model.js'
import type { SessionTraceBundle } from '../domain/trace.js'
import type { LmStudioStreamDelta } from '../services/lmstudio/client.js'

export type TurnStreamEvent =
  | {
      type: 'turn-started'
      turn: TurnRecord
    }
  | {
      type: 'round-started'
      round: RoundRecord
    }
  | {
      type: 'part-delta'
      turnId: string
      roundId: string
      delta: LmStudioStreamDelta
    }
  | {
      type: 'part-committed'
      part: PartRecord
    }
  | {
      type: 'round-committed'
      round: RoundRecord
    }
  | {
      type: 'turn-committed'
      turn: TurnRecord
      trace: SessionTraceBundle
    }
  | {
      type: 'turn-failed'
      turnId: string | null
      message: string
    }

export type TurnStreamEventSink = (event: TurnStreamEvent) => void

// ── Analysis execution stream events ────────────────────────────────────────

export type AnalysisStreamEvent =
  | TurnStreamEvent
  | {
      type: 'analysis-step-started'
      step: StepRecord
    }
  | {
      type: 'analysis-step-completed'
      step: StepRecord
    }
  | {
      type: 'analysis-phase-changed'
      phase: string
    }
  | {
      type: 'analysis-complete'
      trace: SessionTraceBundle
    }
  | {
      type: 'analysis-failed'
      message: string
    }

export type AnalysisStreamEventSink = (event: AnalysisStreamEvent) => void
