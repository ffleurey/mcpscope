import type { PartRecord, RoundRecord, TurnRecord } from '../domain/model.js'
import type { SessionTraceBundle } from '../domain/trace.js'
import type { StreamDelta } from '../services/openai/client.js'

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
  | {
      /** Emitted when the engine auto-titles a session from the first prompt. */
      type: 'session-title-changed'
      sessionId: string
      title: string
    }

export type TurnStreamEventSink = (event: TurnStreamEvent) => void

// The analysis subsystem's AnalysisStreamEvent/AnalysisStreamEventSink live in
// `analysis/analysisStreamEvents.ts` — they are analysis events, not engine
// events. Executor-emitted events flow through the scheduler as
// `SchedulerExecutionEvent` (see `schedulerTypes.ts`).

// Re-export scheduler types for consumers that import from streamEvents
export type { SchedulerEvent, SchedulerEventListener } from './scheduler.js'
