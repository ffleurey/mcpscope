import { formatCompactionStepId } from './hierarchicalIds.js'
import {
  STEP_TYPE,
} from './executionModel.js'
import type Database from 'better-sqlite3'
import type {
  CompactionStrategy,
  PartRecord,
  StepRecord,
  TurnRecord,
} from './model.js'
import { getNextChildIndex } from '../persistence/repositoryV2.js'

export interface CompactionStepResult {
  turn: TurnRecord
  step: StepRecord
  parts: PartRecord[]
  strippedPartIds: string[]
  strippedPartCount: number
  contextTokensAtTurnEnd: number | null
  contextTokensAfterCompaction: number | null
  compactionTokensRemoved: number | null
}

export function applyContextCompaction(
  connection: Database.Database,
  completedTurn: TurnRecord,
  strategy: CompactionStrategy,
): CompactionStepResult {
  const now = Date.now()

  const tokenSumRow = connection
    .prepare<[string], { total: number | null }>(`
      SELECT SUM(token_count) AS total
      FROM v2_parts
      WHERE session_id = (SELECT session_id FROM v2_turns WHERE id = ?)
        AND context_state IN ('included', 'round-only')
    `)
    .get(completedTurn.id) as { total: number | null }

  const tokenSum = tokenSumRow.total ?? null
  const promptTokens = completedTurn.usage.promptTokens ?? null
  const contextTokensAtTurnEnd =
    tokenSum !== null && promptTokens !== null
      ? Math.max(tokenSum, promptTokens)
      : (tokenSum ?? promptTokens)

  let contextTokensAfterCompaction: number | null = contextTokensAtTurnEnd
  let compactionTokensRemoved: number | null = 0
  let strippedPartIds: string[] = []

  const childIndex = getNextChildIndex(connection, completedTurn.sessionId)
  const stepId = formatCompactionStepId(completedTurn.sessionId, childIndex)

  // Create and insert the compaction step first so the FK on v2_parts is satisfied.
  const step: StepRecord = {
    id: stepId,
    sessionId: completedTurn.sessionId,
    stepTypeKey: STEP_TYPE.COMPACTION,
    parentStepId: null,
    childIndex,
    status: 'complete',
    params: {
      strategy,
      sourceTurnId: completedTurn.id,
      sourceTurnSequenceNumber: completedTurn.turnNumber,
    },
    state: {
      strippedPartIds: [],
      strippedPartCount: 0,
      contextTokensAtTurnEnd,
      contextTokensAfterCompaction,
      compactionTokensRemoved,
    },
    createdAt: now,
    completedAt: now,
  }

  connection.prepare(`
    INSERT INTO v2_steps (
      id, session_id, step_type_key, child_index, status,
      params_json, state_json, created_at, completed_at
    ) VALUES (
      @id, @sessionId, @stepTypeKey, @childIndex, @status,
      @paramsJson, @stateJson, @createdAt, @completedAt
    )
  `).run({
    id: step.id,
    sessionId: step.sessionId,
    stepTypeKey: step.stepTypeKey,
    childIndex: step.childIndex,
    status: step.status,
    paramsJson: JSON.stringify(step.params),
    stateJson: JSON.stringify(step.state),
    createdAt: step.createdAt,
    completedAt: step.completedAt,
  })

  if (strategy === 'strip-reasoning') {
    const reasoningParts = connection
      .prepare<[string], { id: string; token_count: number | null }>(`
        SELECT id, token_count
        FROM v2_parts
        WHERE turn_id = ?
          AND part_type = 'assistant-reasoning'
          AND context_state = 'included'
      `)
      .all(completedTurn.id) as Array<{ id: string; token_count: number | null }>

    if (reasoningParts.length > 0) {
      strippedPartIds = reasoningParts.map(part => part.id)
      const strippedTokens = reasoningParts.reduce(
        (sum, p) => sum + (p.token_count ?? 0), 0,
      )
      compactionTokensRemoved = strippedTokens
      contextTokensAfterCompaction =
        contextTokensAtTurnEnd !== null ? contextTokensAtTurnEnd - strippedTokens : null

      const updatePart = connection.prepare(`
        UPDATE v2_parts
        SET context_state = 'stripped',
            stripped_by_compaction_at_step_id = ?,
            updated_at = ?
        WHERE id = ?
      `)

      const updateAll = connection.transaction(() => {
        for (const partId of strippedPartIds) {
          updatePart.run(stepId, now, partId)
        }
      })
      updateAll()

      // Update the step state with actual compaction results.
      connection.prepare(`
        UPDATE v2_steps
        SET state_json = @stateJson
        WHERE id = @id
      `).run({
        id: step.id,
        stateJson: JSON.stringify({
          strippedPartIds,
          strippedPartCount: strippedPartIds.length,
          contextTokensAtTurnEnd,
          contextTokensAfterCompaction,
          compactionTokensRemoved,
        }),
      })
    }
  }

  const updatedTurn: TurnRecord = {
    ...completedTurn,
    contextTokensAtTurnEnd,
    contextTokensAfterCompaction,
    compactionApplied: strategy,
    compactionTokensRemoved,
  }

  connection.prepare(`
    UPDATE v2_turns
    SET context_tokens_at_turn_end = @contextTokensAtTurnEnd,
        context_tokens_after_compaction = @contextTokensAfterCompaction,
        compaction_applied = @compactionApplied,
        compaction_tokens_removed = @compactionTokensRemoved
    WHERE id = @id
  `).run({
    id: completedTurn.id,
    contextTokensAtTurnEnd,
    contextTokensAfterCompaction,
    compactionApplied: strategy,
    compactionTokensRemoved,
  })

  return {
    turn: updatedTurn,
    step,
    parts: [],
    strippedPartIds,
    strippedPartCount: strippedPartIds.length,
    contextTokensAtTurnEnd,
    contextTokensAfterCompaction,
    compactionTokensRemoved,
  }
}
