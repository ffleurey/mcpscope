/**
 * Tests for analysis session tree rebuilding and new-turn detection.
 *
 * When resumeOneStep() is called, the hook list is rebuilt from the current
 * DB state. If new turns were added to the target session, the new hook list
 * should include them — the walk cursor must regress (or at least not skip)
 * the new positions.
 *
 * This test verifies that the rebuilt hook list after adding a new turn is
 * longer than the original, and that the walk cursor can reach the new hooks.
 * Expected to FAIL until cursor regression logic is implemented.
 */

import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { openBackendDatabase } from '../persistence/db.js'
import { createSessionRecord, insertStepRecord, insertTurnRecord } from '../persistence/repository.js'
import type { BackendDatabase } from '../persistence/db.js'

function makeDb(): BackendDatabase {
  return openBackendDatabase(`/tmp/test-tree-${crypto.randomUUID()}.db`)
}

function createTargetSession(db: BackendDatabase, id: string, setup: boolean): void {
  if (!setup) return
  createSessionRecord(db.connection, {
    id, title: id, status: 'ready', initStatus: 'ready',
    sessionType: 'primary', parentKind: null, parentId: null,
    createdAt: 1, updatedAt: 1,
    modelProfileSnapshot: { id:'m', name:'m', modelKey:'m', modelDisplayName:'m',
      connectionBaseUrl:'https://x.com/v1', apiKey:null,
      systemPrompt:'Reply.', temperature:0, reasoning:null, loadedContextLength:null,
      createdAt:1, updatedAt:1 },
    mcpProfileSnapshots: [], loadedContextLength:null,
    systemPromptTokens:null, toolDefinitionsTokens:null, isContextExhausted:false,
    compactionStrategy:'strip-reasoning',
  })
  insertStepRecord(db.connection, {
    id: `${id}.1W`, sessionId: id, stepTypeKey: 'model_turn' as any,
    parentStepId: null, childIndex: 0, status: 'complete',
    params: {}, state: {}, createdAt: 1, completedAt: 1,
  })
  insertTurnRecord(db.connection, {
    id: `${id}.1T`, sessionId: id, ownerStepId: `${id}.1W`, turnNumber: 1,
    status: 'complete', outcome: 'model-response',
    usage: { promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null },
    contextTokensAtTurnEnd: null, contextTokensAfterCompaction: null,
    compactionApplied: null, compactionTokensRemoved: null,
    createdAt: 1, completedAt: 1,
  })
}

describe('analysis session tree rebuild after new turns', () => {

  it('the flattened hook list grows when a new turn is added to the target session', async () => {
    const db = makeDb()
    createTargetSession(db, 'TARG', true)

    // Simulate what flatten() does internally: it loads the target session's
    // turns and builds hooks for each. We can't call flatten() directly since
    // it's protected, but we can measure the number of turns that would be
    // included by checking the session's step/turn count.
    const turnsBefore = db.connection.prepare(
      "SELECT COUNT(*) FROM v2_turns WHERE session_id = 'TARG'"
    ).pluck().get() as number

    // Add a new turn (turn-2) to the target session
    insertStepRecord(db.connection, {
      id: 'TARG.2W', sessionId: 'TARG', stepTypeKey: 'model_turn' as any,
      parentStepId: null, childIndex: 1, status: 'complete',
      params: {}, state: {}, createdAt: 2, completedAt: 2,
    })
    insertTurnRecord(db.connection, {
      id: 'TARG.2T', sessionId: 'TARG', ownerStepId: 'TARG.2W', turnNumber: 2,
      status: 'complete', outcome: 'model-response',
      usage: { promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null },
      contextTokensAtTurnEnd: null, contextTokensAfterCompaction: null,
      compactionApplied: null, compactionTokensRemoved: null,
      createdAt: 2, completedAt: 2,
    })

    const turnsAfter = db.connection.prepare(
      "SELECT COUNT(*) FROM v2_turns WHERE session_id = 'TARG'"
    ).pluck().get() as number

    // There are now more turns in the target session.
    expect(turnsAfter).toBeGreaterThan(turnsBefore)

    // When resumeOneStep() is called, the walk cursor starts from its persisted
    // position (which was based on the old hook list). The new hook list is
    // longer but the cursor is an index into the NEW list, so it should be able
    // to reach the new positions at the end.
    //
    // However, there is currently no mechanism to REGRESS the cursor to include
    // hooks that should precede it. If the original walk was past afterSession
    // (phase=complete), adding a new turn doesn't change anything because
    // canContinue() returns false.
    //
    // For a partial execution (phase=assessing, cursor in middle), the walk
    // continues from cursor position. If the new turn's hooks are at positions
    // AFTER the cursor, they WOULD be reached. But if the analysis framework
    // filters turns by targetTurnId, new turns are excluded entirely.
    //
    // This test documents the current limitation: the hook list is rebuilt
    // each resumeOneStep(), but targetTurnId limits which turns participate.
    // Expect this to fail if the analysis should instead update targetTurnId
    // dynamically to include newly discovered turns.
    // Correct behaviour: the analysis should detect new turns in the target
    // session and widen targetTurnId (or re-run bootstrap) to include them.
    // Once implemented, replace the line below with:
    //   const state = JSON.parse(db.connection.prepare(
    //     "SELECT analysis_state_json FROM v2_sessions WHERE id='ANLY'"
    //   ).pluck().get() as string)
    //   expect(state.targetTurnId).toContain('TARG.2T')
    expect(false).toBe(true) // known limitation — targetTurnId is fixed
  })
})
