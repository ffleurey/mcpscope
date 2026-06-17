import { formatCompactionStepId } from "./hierarchicalIds.js";
import { STEP_TYPE } from "./executionModel.js";
import type Database from "better-sqlite3";
import type {
  CompactionStrategy,
  PartRecord,
  StepRecord,
  TurnRecord,
} from "./model.js";
import { getNextChildIndex } from "../persistence/repository.js";

export interface CompactionStepResult {
  turn: TurnRecord;
  step: StepRecord;
  parts: PartRecord[];
  strippedPartIds: string[];
  strippedPartCount: number;
  contextTokensAtTurnEnd: number | null;
  contextTokensAfterCompaction: number | null;
  compactionTokensRemoved: number | null;
}

export function applyContextCompaction(
  connection: Database.Database,
  completedTurn: TurnRecord,
  strategy: CompactionStrategy,
): CompactionStepResult {
  const now = Date.now();

  // The cumulative context total is anchored to the exact API-reported
  // totalTokens for the current turn (promptTokens + completionTokens).
  // This eliminates drift from estimated part-level counts (e.g.
  // reasoning tokens estimated from text length for Ollama).
  //   - When totalTokens is available: use it directly.
  //   - When totalTokens is null: fall back to the part-sum heuristic
  //     (Math.max(SUM(part_counts), promptTokens)).
  const totalTokens = completedTurn.usage.totalTokens;
  const promptTokens = completedTurn.usage.promptTokens ?? null;
  let contextTokensAtTurnEnd: number | null;

  if (totalTokens != null) {
    contextTokensAtTurnEnd = totalTokens;
  } else {
    const tokenSumRow = connection
      .prepare<[string], { total: number | null }>(
        `
        SELECT SUM(token_count) AS total
        FROM parts
        WHERE session_id = (SELECT session_id FROM turns WHERE id = ?)
          AND context_state IN ('included', 'round-only')
      `,
      )
      .get(completedTurn.id) as { total: number | null };
    const tokenSum = tokenSumRow.total ?? null;
    contextTokensAtTurnEnd =
      tokenSum !== null && promptTokens !== null
        ? Math.max(tokenSum, promptTokens)
        : (tokenSum ?? promptTokens);
  }

  let contextTokensAfterCompaction: number | null = contextTokensAtTurnEnd;
  let compactionTokensRemoved: number | null = 0;
  let strippedPartIds: string[] = [];

  const childIndex = getNextChildIndex(connection, completedTurn.sessionId);
  const stepId = formatCompactionStepId(completedTurn.sessionId, childIndex);

  // Create and insert the compaction step first so the FK on parts is satisfied.
  const step: StepRecord = {
    id: stepId,
    sessionId: completedTurn.sessionId,
    stepTypeKey: STEP_TYPE.COMPACTION,
    parentStepId: null,
    childIndex,
    status: "complete",
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
  };

  connection
    .prepare(
      `
    INSERT INTO steps (
      id, session_id, step_type_key, child_index, status,
      params_json, state_json, created_at, completed_at
    ) VALUES (
      @id, @sessionId, @stepTypeKey, @childIndex, @status,
      @paramsJson, @stateJson, @createdAt, @completedAt
    )
  `,
    )
    .run({
      id: step.id,
      sessionId: step.sessionId,
      stepTypeKey: step.stepTypeKey,
      childIndex: step.childIndex,
      status: step.status,
      paramsJson: JSON.stringify(step.params),
      stateJson: JSON.stringify(step.state),
      createdAt: step.createdAt,
      completedAt: step.completedAt,
    });

  if (strategy === "strip-reasoning") {
    const reasoningParts = connection
      .prepare<
        [string],
        { id: string; token_count: number | null; token_source: string | null }
      >(
        `
        SELECT id, token_count, token_source
        FROM parts
        WHERE turn_id = ?
          AND part_type = 'assistant-reasoning'
          AND context_state = 'included'
      `,
      )
      .all(completedTurn.id) as Array<{
      id: string;
      token_count: number | null;
      token_source: string | null;
    }>;

    if (reasoningParts.length > 0) {
      strippedPartIds = reasoningParts.map((part) => part.id);

      // Only use exact-from-API token counts in compaction math.
      // Estimated-from-text counts are display-only and would cause
      // context tracking drift if used here.
      const allCountsAreExact = reasoningParts.every(
        (p) => p.token_source === "exact-api",
      );
      if (allCountsAreExact) {
        const strippedTokens = reasoningParts.reduce(
          (sum, p) => sum + (p.token_count ?? 0),
          0,
        );
        compactionTokensRemoved = strippedTokens;
        contextTokensAfterCompaction =
          contextTokensAtTurnEnd !== null
            ? contextTokensAtTurnEnd - strippedTokens
            : null;
      } else {
        // When any reasoning part has a non-exact token count (estimated,
        // delta-derived, or unknown), we cannot reliably determine how
        // many tokens were removed.  Set tokensRemoved to null to indicate
        // unknown, and leave contextTokensAfterCompaction unchanged.
        compactionTokensRemoved = null;
        contextTokensAfterCompaction = contextTokensAtTurnEnd;
      }

      const updatePart = connection.prepare(`
        UPDATE parts
        SET context_state = 'stripped',
            stripped_by_compaction_at_step_id = ?,
            updated_at = ?
        WHERE id = ?
      `);

      const updateAll = connection.transaction(() => {
        for (const partId of strippedPartIds) {
          updatePart.run(stepId, now, partId);
        }
      });
      updateAll();

      // Update the step state with actual compaction results.
      connection
        .prepare(
          `
        UPDATE steps
        SET state_json = @stateJson
        WHERE id = @id
      `,
        )
        .run({
          id: step.id,
          stateJson: JSON.stringify({
            strippedPartIds,
            strippedPartCount: strippedPartIds.length,
            contextTokensAtTurnEnd,
            contextTokensAfterCompaction,
            compactionTokensRemoved,
          }),
        });
    }
  }

  const updatedTurn: TurnRecord = {
    ...completedTurn,
    contextTokensAtTurnEnd,
    contextTokensAfterCompaction,
    compactionApplied: strategy,
    compactionTokensRemoved,
  };

  connection
    .prepare(
      `
    UPDATE turns
    SET context_tokens_at_turn_end = @contextTokensAtTurnEnd,
        context_tokens_after_compaction = @contextTokensAfterCompaction,
        compaction_applied = @compactionApplied,
        compaction_tokens_removed = @compactionTokensRemoved
    WHERE id = @id
  `,
    )
    .run({
      id: completedTurn.id,
      contextTokensAtTurnEnd,
      contextTokensAfterCompaction,
      compactionApplied: strategy,
      compactionTokensRemoved,
    });

  return {
    turn: updatedTurn,
    step,
    parts: [],
    strippedPartIds,
    strippedPartCount: strippedPartIds.length,
    contextTokensAtTurnEnd,
    contextTokensAfterCompaction,
    compactionTokensRemoved,
  };
}
