import type Database from 'better-sqlite3'
import type { CompactionStrategy, PartRecord, StepRecord, TurnRecord } from './model.js'
import { formatCompactionStepId } from './hierarchicalIds.js'
import { STEP_TYPE } from './executionModel.js'

export interface CompactionStepResult {
  turn: TurnRecord
  step: StepRecord
  parts: PartRecord[]
}

/**
 * Applies the configured compaction strategy to the parts produced by a completed turn,
 * then updates the turn record with token counts before and after compaction.
 *
 * Context compaction is applied once per turn — after the turn completes and before
 * the next turn starts. It never runs between rounds within a turn.
 */
export function applyContextCompaction(
  connection: Database.Database,
  completedTurn: TurnRecord,
  strategy: CompactionStrategy,
): CompactionStepResult {
  const now = Date.now()

  // Compute context tokens at turn end (before any compaction).
  // Includes all 'included' and 'round-only' parts across the whole session
  // (the full model-visible context after this turn).
  const tokenSumRow = connection
    .prepare<[string], { total: number | null }>(`
      SELECT SUM(token_count) AS total
      FROM v2_parts
      WHERE session_id = (SELECT session_id FROM v2_turns WHERE step_id = ?)
        AND context_state IN ('included', 'round-only')
    `)
    .get(completedTurn.id) as { total: number | null }

  const contextTokensAtTurnEnd = tokenSumRow.total ?? null

  let contextTokensAfterCompaction: number | null = contextTokensAtTurnEnd
  let compactionTokensRemoved: number | null = 0
  let strippedPartIds: string[] = []

  if (strategy === 'strip-reasoning') {
    // Find all assistant-reasoning parts from the completed turn that are currently 'included'.
    const reasoningParts = connection
      .prepare<[string], { id: string; token_count: number | null }>(`
        SELECT id, token_count
        FROM v2_parts
        WHERE step_id = ?
          AND part_type = 'assistant-reasoning'
          AND context_state = 'included'
      `)
      .all(completedTurn.id) as Array<{ id: string; token_count: number | null }>

    if (reasoningParts.length > 0) {
      const strippedTokens = reasoningParts.reduce(
        (sum, p) => sum + (p.token_count ?? 0),
        0,
      )

      // Update each reasoning part: mark as stripped, record which turn's compaction did it.
      const updatePart = connection.prepare(`
        UPDATE v2_parts
        SET context_state = 'stripped',
            stripped_by_compaction_at_step_id = ?,
            updated_at = ?
        WHERE id = ?
      `)

      const updateAll = connection.transaction(() => {
        for (const part of reasoningParts) {
          updatePart.run(completedTurn.id, now, part.id)
        }
      })
      updateAll()

      strippedPartIds = reasoningParts.map(part => part.id)
      compactionTokensRemoved = strippedTokens
      contextTokensAfterCompaction =
        contextTokensAtTurnEnd !== null ? contextTokensAtTurnEnd - strippedTokens : null
    }
  }

  // Update the turn record with compaction results.
  const updatedTurn: TurnRecord = {
    ...completedTurn,
    contextTokensAtTurnEnd,
    contextTokensAfterCompaction,
    compactionApplied: strategy,
    compactionTokensRemoved,
  }

  connection
    .prepare(`
      UPDATE v2_turns
      SET context_tokens_at_turn_end = @contextTokensAtTurnEnd,
          context_tokens_after_compaction = @contextTokensAfterCompaction,
          compaction_applied = @compactionApplied,
          compaction_tokens_removed = @compactionTokensRemoved
      WHERE step_id = @id
    `)
    .run({
      id: completedTurn.id,
      contextTokensAtTurnEnd,
      contextTokensAfterCompaction,
      compactionApplied: strategy,
      compactionTokensRemoved,
    })

  const stepOrdinalRow = connection
    .prepare< [string], { max_ordinal: number }>(`
      SELECT COALESCE(MAX(ordinal), -1) AS max_ordinal
      FROM v2_steps
      WHERE session_id = ?
    `)
    .get(completedTurn.sessionId) as { max_ordinal: number }

  const step: StepRecord = {
    id: formatCompactionStepId(completedTurn.sessionId, completedTurn.sequenceNumber),
    sessionId: completedTurn.sessionId,
    stepTypeKey: STEP_TYPE.COMPACTION,
    ordinal: stepOrdinalRow.max_ordinal + 1,
    status: 'complete',
    params: {
      strategy,
      sourceTurnId: completedTurn.id,
      sourceTurnSequenceNumber: completedTurn.sequenceNumber,
    },
    state: {
      strippedPartIds,
      strippedPartCount: strippedPartIds.length,
      contextTokensAtTurnEnd,
      contextTokensAfterCompaction,
      compactionTokensRemoved,
    },
    createdAt: now,
    completedAt: now,
  }

  connection.prepare(`
    INSERT INTO v2_steps (
      id, session_id, step_type_key, ordinal, status,
      params_json, state_json, created_at, completed_at
    ) VALUES (
      @id, @sessionId, @stepTypeKey, @ordinal, @status,
      @paramsJson, @stateJson, @createdAt, @completedAt
    )
  `).run({
    id: step.id,
    sessionId: step.sessionId,
    stepTypeKey: step.stepTypeKey,
    ordinal: step.ordinal,
    status: step.status,
    paramsJson: JSON.stringify(step.params),
    stateJson: JSON.stringify(step.state),
    createdAt: step.createdAt,
    completedAt: step.completedAt,
  })

  return {
    turn: updatedTurn,
    step,
    parts: [],
  }
}
