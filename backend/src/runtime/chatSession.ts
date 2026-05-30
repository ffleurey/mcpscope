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
import { listTurnRecordsBySession, updateTurnRecord } from '../persistence/repository.js'
import { createModelOnlyTurn, type LmStudioGateway } from './modelTurns.js'
import { createToolEnabledTurn, type McpGateway } from './toolTurns.js'
import type { SessionRecord, TurnRecord } from '../domain/model.js'
import {
  CONTAINER_TYPE,
  SESSION_TYPE,
  STEP_TYPE,
  type ContainerTypeKey,
  type Session,
  type SessionContainer,
  type SessionLifecycleStatus,
  type SessionTypeKey,
  type Step,
  type StepExecutionContext,
  type StepResult,
  type StepStatus,
  type GenericParams,
  type GenericState,
} from '../domain/executionModel.js'

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
    private readonly lmGateway: LmStudioGateway,
    private readonly mcpGateway: McpGateway | null,
    private readonly maxToolRounds: number,
  ) {}

  get stepId(): string { return this.record.id }
  get stepTypeKey() { return STEP_TYPE.TURN }
  get params(): GenericParams { return { userMessage: this.userContent } }
  get state(): GenericState { return {} }

  get status(): StepStatus {
    switch (this.record.status) {
      case 'complete': return 'complete'
      case 'error': return 'error'
      case 'draft':
      case 'streaming':
      case 'awaiting-tools': return 'running'
      default: return 'pending'
    }
  }

  async execute(context: StepExecutionContext): Promise<StepResult> {
    try {
      const result = this.mcpGateway
        ? await createToolEnabledTurn(this.db, this.lmGateway, this.mcpGateway, {
            sessionId: context.sessionId,
            userContent: this.userContent,
            maxToolRounds: this.maxToolRounds,
            reservedTurn: this.record,
          })
        : await createModelOnlyTurn(this.db, this.lmGateway, {
            sessionId: context.sessionId,
            userContent: this.userContent,
            reservedTurn: this.record,
          })

      return {
        status: result.turn.status === 'complete' ? 'complete' : 'error',
        outputArtifacts: [],
      }
    } catch (err) {
      return {
        status: 'error',
        outputArtifacts: [],
        error: err instanceof Error ? err.message : String(err),
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
    private readonly lmGateway: LmStudioGateway,
    private readonly mcpGateway: McpGateway | null,
    private readonly maxToolRounds: number,
    pendingTurn: TurnRecord,
    pendingUserContent: string,
  ) {
    this._pendingTurn = pendingTurn
    this._pendingUserContent = pendingUserContent
  }

  // ── SessionContainer / Session identity ──────────────────────────────────

  get containerId(): string { return this.sessionRecord.id }
  get containerTypeKey(): ContainerTypeKey { return CONTAINER_TYPE.SESSION }
  get sessionId(): string { return this.sessionRecord.id }
  get sessionTypeKey(): SessionTypeKey { return SESSION_TYPE.PRIMARY }

  get status(): SessionLifecycleStatus {
    switch (this.sessionRecord.status) {
      case 'active': return 'active'
      case 'error': return 'error'
      case 'archived': return 'archived'
      default: return 'ready'
    }
  }

  /** Primary sessions have no parent in this increment. */
  get parent(): SessionContainer | null { return null }

  /** Steps lazily from DB — returns completed turns only. */
  get steps(): ReadonlyArray<Step> { return [] }

  get params(): GenericParams { return {} }
  get state(): GenericState { return {} }

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
      this.maxToolRounds,
    )

    const context: StepExecutionContext = {
      sessionId: this.sessionRecord.id,
      visibleContext: { usedTokens: null, availableTokens: null },
      artifacts: [],
    }

    const result = await step.execute(context)

    // Surface error: mark turn as error if step.execute absorbed an exception.
    if (result.status === 'error' && result.error) {
      const failedTurn = listTurnRecordsBySession(this.db.connection, this.sessionRecord.id)
        .find(t => t.id === turn.id)
      if (failedTurn && (failedTurn.status === 'draft' || failedTurn.status === 'streaming' || failedTurn.status === 'awaiting-tools')) {
        failedTurn.status = 'error'
        failedTurn.completedAt = Date.now()
        failedTurn.outcome = failedTurn.outcome ?? 'step-error'
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
