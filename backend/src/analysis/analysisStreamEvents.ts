import type { StepRecord } from 'mcpscope-engine/domain/model.js'
import type { SessionTraceBundle } from 'mcpscope-engine/domain/trace.js'
import type { TurnStreamEvent } from 'mcpscope-engine/runtime/streamEvents.js'

// ── Analysis execution stream events ────────────────────────────────────────
// The analysis workflow's execution events. They extend the engine's
// TurnStreamEvent (analysis steps run ordinary turns) with analysis-* events,
// and flow through the scheduler as executor-emitted stream events (see
// `SchedulerExecutionEvent` in `runtime/schedulerTypes.ts`).

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
