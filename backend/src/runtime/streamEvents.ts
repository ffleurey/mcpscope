import type { PartRecord, RoundRecord, StepRecord, TurnRecord } from '../domain/model.js'
import type { SessionTraceBundle } from '../domain/trace.js'
import type { StreamDelta } from '../services/lmstudio/client.js'

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
      delta: StreamDelta
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
      errorType?: string
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
      commandKind: string
      commandId: string
      completedCount: number
      totalCount: number
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

// Re-export scheduler types for consumers that import from streamEvents
export type { SchedulerEvent, SchedulerEventListener } from './scheduler.js'
