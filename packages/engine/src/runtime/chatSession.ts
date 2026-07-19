/**
 * ChatSession and ChatTurnStep: concrete execution loop implementations.
 *
 * These classes introduce the Session.execute() / Session.advance() /
 * canContinue() boundary for the interactive (primary) chat session type,
 * and the Step.execute(context) boundary for LLM turns.
 *
 * Behavioral delegation: all actual turn execution is delegated to the
 * existing createModelOnlyTurn and createToolEnabledTurn functions so that
 * this step is purely structural — no behavioral change.
 */

import type { BackendDatabase } from '../persistence/db.js'
import {
  getNextPartOrdinal,
  getNextRoundPartSequence,
  insertPartRecord,
  listRoundRecordsBySession,
  listTurnRecordsBySession,
  updateRoundRecord,
  updateTurnRecord,
} from '../persistence/repository.js'
import { createModelOnlyTurn, type ChatCompletionGateway } from './modelTurns.js'
import { createToolEnabledTurn, type McpGateway } from './toolTurns.js'
import { buildDiagnosticNotePart } from './turnAssembly.js'
import type { SessionRecord, TurnRecord } from '../domain/model.js'
import { DEFAULT_MAX_TOOL_ROUNDS } from '../domain/model.js'
import type { TurnStreamEventSink } from './streamEvents.js'
import {
  CONTAINER_TYPE,
  SESSION_TYPE,
  STEP_TYPE,
  type Benchmark,
  type ContainerTypeKey,
  type GenericParams,
  type GenericState,
  type Session,
  type SessionLifecycleStatus,
  type SessionTypeKey,
  type Step,
  type StepExecutionContext,
  type StepResult,
  type StepStatus,
} from '../domain/executionModel.js'

type SessionContainer = Session | Benchmark

// ─────────────────────────────────────────────────────────────────────────────
// ChatTurnStep
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ChatTurnStep wraps a single LLM turn execution unit.
 *
 * Implements the Step interface so that orchestration code can execute a turn
 * through step.execute(context) without knowing whether it's a model-only or
 * tool-enabled turn.
 */
export class ChatTurnStep implements Step {
  constructor(
    private readonly record: TurnRecord,
    private readonly userContent: string,
    private readonly db: BackendDatabase,
    private readonly lmGateway: ChatCompletionGateway,
    private readonly mcpGateway: McpGateway | null,
    private readonly maxToolRounds: number,
    private readonly emitEvent?: TurnStreamEventSink,
  ) {}

  get stepId(): string {
    return this.record.id
  }
  get stepTypeKey() {
    return STEP_TYPE.TURN
  }
  get params(): GenericParams {
    return { userMessage: this.userContent }
  }
  get state(): GenericState {
    return {}
  }

  get status(): StepStatus {
    switch (this.record.status) {
      case 'complete':
        return 'complete'
      case 'error':
        return 'error'
      case 'draft':
      case 'streaming':
      case 'awaiting-tools':
        return 'running'
      default:
        return 'pending'
    }
  }

  async execute(context: StepExecutionContext): Promise<StepResult> {
    try {
      const result = this.mcpGateway
        ? await createToolEnabledTurn(
            this.db,
            this.lmGateway,
            this.mcpGateway,
            {
              sessionId: context.sessionId,
              userContent: this.userContent,
              maxToolRounds: this.maxToolRounds,
              reservedTurn: this.record,
            },
            this.emitEvent,
          )
        : await createModelOnlyTurn(
            this.db,
            this.lmGateway,
            {
              sessionId: context.sessionId,
              userContent: this.userContent,
              reservedTurn: this.record,
            },
            this.emitEvent,
          )

      return {
        status: result.turn.status === 'complete' ? 'complete' : 'error',
        outputArtifacts: [],
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      // Emit turn-failed so streaming subscribers can close the stream.
      // This mirrors the old route-level catch block behavior.
      this.emitEvent?.({
        type: 'turn-failed',
        errorType: 'internal',
        turnId: this.record.id,
        message: errorMessage,
      })
      return {
        status: 'error',
        outputArtifacts: [],
        error: errorMessage,
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ChatSession
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ChatSession implements the Session interface for interactive (primary) chat.
 *
 * A ChatSession is created per send-operation with the pre-reserved turn and
 * user content.  canContinue() returns true for the single pending turn;
 * advance() creates and executes a ChatTurnStep.  execute() loops while
 * canContinue() — which for the chat model means it runs exactly once.
 *
 * This class makes the execution loop shape explicit and testable without
 * changing any current behavior.
 */
export class ChatSession implements Session {
  /** Mutable — set to false after advance() completes one turn. */
  private _pendingTurn: TurnRecord | null
  private _pendingUserContent: string | null

  constructor(
    private readonly sessionRecord: SessionRecord,
    private readonly db: BackendDatabase,
    private readonly lmGateway: ChatCompletionGateway,
    private readonly mcpGateway: McpGateway | null,
    pendingTurn: TurnRecord,
    pendingUserContent: string,
    private readonly emitEvent?: TurnStreamEventSink,
  ) {
    this._pendingTurn = pendingTurn
    this._pendingUserContent = pendingUserContent
  }

  // ── SessionContainer / Session identity ──────────────────────────────────

  get containerId(): string {
    return this.sessionRecord.id
  }
  get containerTypeKey(): ContainerTypeKey {
    return CONTAINER_TYPE.SESSION
  }
  get sessionId(): string {
    return this.sessionRecord.id
  }
  get sessionTypeKey(): SessionTypeKey {
    return SESSION_TYPE.PRIMARY
  }

  get status(): SessionLifecycleStatus {
    switch (this.sessionRecord.status) {
      case 'active':
        return 'active'
      case 'error':
        return 'error'
      case 'archived':
        return 'archived'
      default:
        return 'ready'
    }
  }

  /** Primary sessions have no parent in this increment. */
  get parent(): SessionContainer | null {
    return null
  }

  /** Steps lazily from DB — returns completed turns only. */
  get steps(): ReadonlyArray<Step> {
    return []
  }

  get params(): GenericParams {
    return {}
  }
  get state(): GenericState {
    return {}
  }

  // ── Execution loop ────────────────────────────────────────────────────────

  /**
   * Returns true when there is still a pending turn to execute.
   * For interactive chat sessions this is true once per send operation.
   */
  canContinue(): boolean {
    return this._pendingTurn !== null && this._pendingUserContent !== null
  }

  /**
   * Creates a ChatTurnStep for the pending turn and executes it.
   * After a successful advance the pending turn slot is cleared so
   * canContinue() returns false and execute() terminates.
   */
  async advance(): Promise<void> {
    const turn = this._pendingTurn
    const userContent = this._pendingUserContent
    if (!turn || !userContent) return

    // Clear the pending slot before executing so that concurrent callers
    // (unlikely for now, but safe) cannot double-execute the same turn.
    this._pendingTurn = null
    this._pendingUserContent = null

    const step = new ChatTurnStep(
      turn,
      userContent,
      this.db,
      this.lmGateway,
      this.mcpGateway,
      // The per-session tool-round budget is the source of truth (set at
      // session creation); fall back to the default for older sessions.
      this.sessionRecord.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS,
      this.emitEvent,
    )

    const context: StepExecutionContext = {
      sessionId: this.sessionRecord.id,
      visibleContext: { usedTokens: null, availableTokens: null },
      artifacts: [],
    }

    const result = await step.execute(context)

    // Last-resort safety net: mark the turn as error if step.execute absorbed
    // an exception that createModelOnlyTurn/createToolEnabledTurn didn't
    // already close out gracefully themselves (they catch stream failures
    // internally and return a normal result — see finalizeModelTurnStreamFailure
    // / finalizeToolTurnStreamFailure). This only fires for failures those
    // pipelines can't anticipate, e.g. a thrown error before any round exists.
    if (result.status === 'error' && result.error) {
      const failedTurn = listTurnRecordsBySession(this.db.connection, this.sessionRecord.id).find(
        (t) => t.id === turn.id,
      )
      if (
        failedTurn &&
        (failedTurn.status === 'draft' ||
          failedTurn.status === 'streaming' ||
          failedTurn.status === 'awaiting-tools')
      ) {
        const completedAt = Date.now()
        failedTurn.status = 'error'
        failedTurn.completedAt = completedAt
        failedTurn.outcome = `step-error: ${result.error}`

        // Reconcile any streaming round so the trace is whole, and attach a
        // diagnostic-note part so the failure renders in the transcript —
        // the same visibility mechanism the pipelines' own stream-failure
        // recovery uses.
        const streamingRound = listRoundRecordsBySession(this.db.connection, this.sessionRecord.id)
          .filter((r) => r.turnId === turn.id)
          .find((r) => r.status === 'streaming')
        if (streamingRound) {
          streamingRound.status = 'error'
          streamingRound.finishReason = 'error'
          streamingRound.completedAt = completedAt
          updateRoundRecord(this.db.connection, streamingRound)

          const diagnosticNote = buildDiagnosticNotePart({
            session: this.sessionRecord,
            turnId: turn.id,
            turnNumber: failedTurn.turnNumber,
            roundNumber: streamingRound.roundIndex + 1,
            roundId: streamingRound.id,
            ownerStepId: failedTurn.ownerStepId,
            partNumber: getNextRoundPartSequence(this.db.connection, streamingRound.id),
            ordinal: getNextPartOrdinal(this.db.connection, this.sessionRecord.id),
            text: `Turn failed: ${result.error}.`,
            summary: 'Turn failed',
            createdAt: completedAt,
          })
          insertPartRecord(this.db.connection, diagnosticNote)
        }

        updateTurnRecord(this.db.connection, failedTurn)
      }
    }
  }

  /**
   * Runs the full session loop: advance while canContinue().
   * For interactive sessions this iterates exactly once per user message.
   */
  async execute(): Promise<void> {
    while (this.canContinue()) {
      await this.advance()
    }
  }
}
