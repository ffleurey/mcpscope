/**
 * repositoryRuntime.ts
 *
 * Canonical session/turn/round/part/raw-exchange repository implementation
 * against the current v2 runtime tables.
 *
 * Key column mappings:
 *   sessions.session_type          → v2_sessions.session_type_key
 *   sessions.parent_kind           → v2_sessions.parent_container_type_key
 *   sessions.parent_id             → v2_sessions.parent_container_id
 *   sessions.model_profile_*_json  → v2_sessions.params_json.modelProfileSnapshot
 *   sessions.mcp_profile_*_json    → v2_sessions.params_json.mcpProfileSnapshot
 *   sessions.compaction_strategy   → v2_sessions.params_json.compactionStrategy
 *   sessions.loaded_context_length → v2_sessions.state_json.loadedContextLength
 *   sessions.system_prompt_tokens  → v2_sessions.state_json.systemPromptTokens
 *   sessions.tool_definitions_*    → v2_sessions.state_json.toolDefinitionsTokens
 *   sessions.is_context_exhausted  → v2_sessions.state_json.isContextExhausted
 *
 *   turns.*                        → v2_steps.* + v2_turns.*  (same id)
 *   turns.id                       → v2_steps.id = v2_turns.step_id
 *   turns.sequence_number          → v2_turns.sequence_number; v2_steps.ordinal = seq-1
 *
 *   rounds.turn_id                 → v2_rounds.step_id
 *   parts.turn_id                  → v2_parts.step_id
 *   parts.stripped_by_*_turn_id    → v2_parts.stripped_by_compaction_at_step_id
 *   raw_exchanges.turn_id          → v2_raw_exchanges.step_id
 */

import type Database from 'better-sqlite3'
import type {
  ModelProfileSnapshot,
  McpProfileSnapshot,
  PartRecord,
  RawExchangeRecord,
  RoundRecord,
  SessionRecord,
  SessionSummary,
  TurnRecord,
} from '../domain/model.js'
import { validateSessionParent } from '../domain/sessionValidation.js'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseJson<T>(value: string | null): T | null {
  return value ? (JSON.parse(value) as T) : null
}

function stringifyJson(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value)
}

function assertValidSessionParent(session: Pick<SessionRecord, 'sessionType' | 'parentKind' | 'parentId'>): void {
  const error = validateSessionParent(session.sessionType, session.parentKind, session.parentId)
  if (error) {
    throw new Error(`Invalid session metadata: ${error}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ActiveSessionInfo {
  id: string
  state: 'initializing' | 'running'
}

type V2SessionRow = {
  id: string
  title: string
  status: SessionRecord['status']
  init_status: SessionRecord['initStatus']
  session_type_key: string
  parent_container_type_key: string | null
  parent_container_id: string | null
  params_json: string
  state_json: string
  created_at: number
  updated_at: number
}

type V2SessionParams = {
  modelProfileSnapshot: ModelProfileSnapshot
  mcpProfileSnapshot: McpProfileSnapshot | null
  compactionStrategy: SessionRecord['compactionStrategy']
}

type V2SessionState = {
  loadedContextLength: number | null
  systemPromptTokens: number | null
  toolDefinitionsTokens: number | null
  isContextExhausted: boolean
}

function buildSessionParams(session: SessionRecord): string {
  const params: V2SessionParams = {
    modelProfileSnapshot: session.modelProfileSnapshot,
    mcpProfileSnapshot: session.mcpProfileSnapshot,
    compactionStrategy: session.compactionStrategy,
  }
  return JSON.stringify(params)
}

function buildSessionState(session: SessionRecord): string {
  const state: V2SessionState = {
    loadedContextLength: session.loadedContextLength,
    systemPromptTokens: session.systemPromptTokens,
    toolDefinitionsTokens: session.toolDefinitionsTokens,
    isContextExhausted: session.isContextExhausted,
  }
  return JSON.stringify(state)
}

function mapV2SessionRow(row: V2SessionRow): SessionRecord {
  const params = JSON.parse(row.params_json) as V2SessionParams
  const state = JSON.parse(row.state_json) as V2SessionState
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    initStatus: row.init_status,
    sessionType: (row.session_type_key as SessionRecord['sessionType']) ?? 'primary',
    parentKind: (row.parent_container_type_key as SessionRecord['parentKind']) ?? null,
    parentId: row.parent_container_id ?? null,
    modelProfileSnapshot: params.modelProfileSnapshot,
    mcpProfileSnapshot: params.mcpProfileSnapshot ?? null,
    loadedContextLength: state.loadedContextLength ?? null,
    systemPromptTokens: state.systemPromptTokens ?? null,
    toolDefinitionsTokens: state.toolDefinitionsTokens ?? null,
    isContextExhausted: state.isContextExhausted ?? false,
    compactionStrategy: params.compactionStrategy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapV2SessionSummaryRow(row: V2SessionRow): SessionSummary {
  const params = JSON.parse(row.params_json) as {
    modelProfileSnapshot?: { name: string }
    mcpProfileSnapshot?: { name: string } | null
    compactionStrategy?: SessionSummary['compactionStrategy']
  }
  const state = JSON.parse(row.state_json) as {
    isContextExhausted?: boolean
    loadedContextLength?: number | null
  }
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    initStatus: row.init_status,
    sessionType: (row.session_type_key as SessionSummary['sessionType']) ?? 'primary',
    parentKind: (row.parent_container_type_key as SessionSummary['parentKind']) ?? null,
    parentId: row.parent_container_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isContextExhausted: state.isContextExhausted ?? false,
    loadedContextLength: state.loadedContextLength ?? null,
    compactionStrategy: params.compactionStrategy ?? 'none',
    modelProfileSnapshot: { name: params.modelProfileSnapshot?.name ?? '' },
    mcpProfileSnapshot: params.mcpProfileSnapshot ? { name: params.mcpProfileSnapshot.name } : null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session CRUD
// ─────────────────────────────────────────────────────────────────────────────

export function createSessionRecord(
  connection: Database.Database,
  session: SessionRecord,
): void {
  assertValidSessionParent(session)
  connection.prepare(`
    INSERT INTO v2_sessions (
      id, title, session_type_key, parent_container_type_key, parent_container_id,
      status, init_status, params_json, state_json,
      created_at, updated_at
    ) VALUES (
      @id, @title, @sessionTypeKey, @parentContainerTypeKey, @parentContainerId,
      @status, @initStatus, @paramsJson, @stateJson,
      @createdAt, @updatedAt
    )
  `).run({
    id: session.id,
    title: session.title,
    sessionTypeKey: session.sessionType,
    parentContainerTypeKey: session.parentKind,
    parentContainerId: session.parentId,
    status: session.status,
    initStatus: session.initStatus,
    paramsJson: buildSessionParams(session),
    stateJson: buildSessionState(session),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  })

  // Also keep model_profiles and mcp_profiles tables up to date
  connection.prepare(`
    INSERT OR REPLACE INTO model_profiles (id, name, snapshot_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    session.modelProfileSnapshot.id,
    session.modelProfileSnapshot.name,
    JSON.stringify(session.modelProfileSnapshot),
    session.modelProfileSnapshot.createdAt,
    session.modelProfileSnapshot.updatedAt,
  )

  if (session.mcpProfileSnapshot) {
    connection.prepare(`
      INSERT OR REPLACE INTO mcp_profiles (id, name, snapshot_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      session.mcpProfileSnapshot.id,
      session.mcpProfileSnapshot.name,
      JSON.stringify(session.mcpProfileSnapshot),
      session.mcpProfileSnapshot.createdAt,
      session.mcpProfileSnapshot.updatedAt,
    )
  }
}

export function getSessionRecord(
  connection: Database.Database,
  sessionId: string,
): SessionRecord | null {
  const row = connection.prepare(`
    SELECT *
    FROM v2_sessions
    WHERE id = ?
  `).get(sessionId) as V2SessionRow | undefined

  if (!row) return null
  return mapV2SessionRow(row)
}

export function updateSessionRecord(connection: Database.Database, session: SessionRecord): void {
  assertValidSessionParent(session)
  connection.prepare(`
    UPDATE v2_sessions
    SET title = @title,
        status = @status,
        init_status = @initStatus,
        session_type_key = @sessionTypeKey,
        parent_container_type_key = @parentContainerTypeKey,
        parent_container_id = @parentContainerId,
        state_json = @stateJson,
        params_json = json_patch(params_json, @paramsPatch),
        updated_at = @updatedAt
    WHERE id = @id
  `).run({
    id: session.id,
    title: session.title,
    status: session.status,
    initStatus: session.initStatus,
    sessionTypeKey: session.sessionType,
    parentContainerTypeKey: session.parentKind,
    parentContainerId: session.parentId,
    stateJson: buildSessionState(session),
    paramsPatch: JSON.stringify({ compactionStrategy: session.compactionStrategy }),
    updatedAt: session.updatedAt,
  })
}

export function deleteSessionRecord(connection: Database.Database, sessionId: string): boolean {
  const result = connection.prepare(`
    WITH RECURSIVE session_tree(id) AS (
      SELECT id
      FROM v2_sessions
      WHERE id = ?
      UNION
      SELECT s.id
      FROM v2_sessions s
      JOIN session_tree st
        ON s.parent_container_type_key = 'session'
       AND s.parent_container_id = st.id
    )
    DELETE FROM v2_sessions
    WHERE id IN (SELECT id FROM session_tree)
  `).run(sessionId)

  return result.changes > 0
}

export function listSessionRecords(connection: Database.Database): SessionRecord[] {
  const rows = connection.prepare(`
    SELECT *
    FROM v2_sessions
    ORDER BY updated_at DESC, created_at DESC
  `).all() as V2SessionRow[]

  return rows.map(mapV2SessionRow)
}

/** Returns only primary sessions (session_type_key = 'primary'). Used by GET /api/sessions. */
export function listSessionSummaries(connection: Database.Database): SessionSummary[] {
  const rows = connection.prepare(`
    SELECT *
    FROM v2_sessions
    WHERE session_type_key = 'primary'
    ORDER BY updated_at DESC, created_at DESC
  `).all() as V2SessionRow[]

  return rows.map(mapV2SessionSummaryRow)
}

/** Returns child sessions attached to the given parent. */
export function listChildSessionSummaries(
  connection: Database.Database,
  parentKind: string,
  parentId: string,
): SessionSummary[] {
  const rows = connection.prepare(`
    SELECT *
    FROM v2_sessions
    WHERE parent_container_type_key = ? AND parent_container_id = ?
    ORDER BY created_at ASC
  `).all(parentKind, parentId) as V2SessionRow[]

  return rows.map(mapV2SessionSummaryRow)
}

/** Returns all sessions regardless of type. */
export function listAllSessionSummaries(connection: Database.Database): SessionSummary[] {
  const rows = connection.prepare(`
    SELECT *
    FROM v2_sessions
    ORDER BY updated_at DESC, created_at DESC
  `).all() as V2SessionRow[]

  return rows.map(mapV2SessionSummaryRow)
}

export function findActiveSession(
  connection: Database.Database,
  excludeSessionId?: string,
): ActiveSessionInfo | null {
  const whereInit = excludeSessionId ? 'AND id != @excludeId' : ''
  const whereRun = excludeSessionId ? 'AND v2_sessions.id != @excludeId' : ''
  const params: Record<string, string> = excludeSessionId ? { excludeId: excludeSessionId } : {}

  const row = connection.prepare(`
    SELECT id, state FROM (
      SELECT id, 'initializing' AS state
      FROM v2_sessions
      WHERE init_status = 'initializing'
      ${whereInit}
      UNION ALL
      SELECT DISTINCT v2_sessions.id, 'running' AS state
      FROM v2_sessions
      JOIN v2_turns ON v2_turns.session_id = v2_sessions.id
      WHERE v2_turns.status IN ('draft', 'streaming', 'awaiting-tools')
      ${whereRun}
    )
    LIMIT 1
  `).get(params) as { id: string; state: 'initializing' | 'running' } | undefined

  return row ?? null
}

/**
 * Recovers from an unclean server shutdown by marking any steps/turns and sessions
 * that were left in an in-progress state as terminated.
 */
export function recoverInterruptedState(connection: Database.Database): void {
  connection.transaction(() => {
    const now = Date.now()

    connection.prepare(`
      UPDATE v2_steps
      SET status = 'aborted', completed_at = ?
      WHERE status IN ('draft', 'streaming', 'awaiting-tools')
    `).run(now)

    connection.prepare(`
      UPDATE v2_turns
      SET status = 'aborted', completed_at = ?
      WHERE status IN ('draft', 'streaming', 'awaiting-tools')
    `).run(now)

    connection.prepare(`
      UPDATE v2_sessions
      SET init_status = 'error', updated_at = ?
      WHERE init_status = 'initializing'
    `).run(now)
  })()
}

// ─────────────────────────────────────────────────────────────────────────────
// Turn CRUD  (v2_steps + v2_turns, same id)
// ─────────────────────────────────────────────────────────────────────────────

export function insertTurnRecord(connection: Database.Database, turn: TurnRecord): void {
  // ordinal is 0-based; sequenceNumber is 1-based
  const ordinal = turn.sequenceNumber - 1

  connection.prepare(`
    INSERT INTO v2_steps (
      id, session_id, step_type_key, ordinal, status,
      params_json, state_json, created_at, completed_at
    ) VALUES (
      @id, @sessionId, 'turn', @ordinal, @status,
      '{}', '{}', @createdAt, @completedAt
    )
  `).run({
    id: turn.id,
    sessionId: turn.sessionId,
    ordinal,
    status: turn.status,
    createdAt: turn.createdAt,
    completedAt: turn.completedAt,
  })

  connection.prepare(`
    INSERT INTO v2_turns (
      step_id, session_id, sequence_number, status, outcome,
      prompt_tokens, completion_tokens, reasoning_tokens, total_tokens,
      context_tokens_at_turn_end, context_tokens_after_compaction,
      compaction_applied, compaction_tokens_removed,
      created_at, completed_at
    ) VALUES (
      @stepId, @sessionId, @sequenceNumber, @status, @outcome,
      @promptTokens, @completionTokens, @reasoningTokens, @totalTokens,
      @contextTokensAtTurnEnd, @contextTokensAfterCompaction,
      @compactionApplied, @compactionTokensRemoved,
      @createdAt, @completedAt
    )
  `).run({
    stepId: turn.id,
    sessionId: turn.sessionId,
    sequenceNumber: turn.sequenceNumber,
    status: turn.status,
    outcome: turn.outcome,
    promptTokens: turn.usage.promptTokens,
    completionTokens: turn.usage.completionTokens,
    reasoningTokens: turn.usage.reasoningTokens,
    totalTokens: turn.usage.totalTokens,
    contextTokensAtTurnEnd: turn.contextTokensAtTurnEnd,
    contextTokensAfterCompaction: turn.contextTokensAfterCompaction,
    compactionApplied: turn.compactionApplied,
    compactionTokensRemoved: turn.compactionTokensRemoved,
    createdAt: turn.createdAt,
    completedAt: turn.completedAt,
  })
}

export function updateTurnRecord(connection: Database.Database, turn: TurnRecord): void {
  connection.prepare(`
    UPDATE v2_steps
    SET status = @status,
        completed_at = @completedAt
    WHERE id = @id
  `).run({
    id: turn.id,
    status: turn.status,
    completedAt: turn.completedAt,
  })

  connection.prepare(`
    UPDATE v2_turns
    SET status = @status,
        outcome = @outcome,
        prompt_tokens = @promptTokens,
        completion_tokens = @completionTokens,
        reasoning_tokens = @reasoningTokens,
        total_tokens = @totalTokens,
        context_tokens_at_turn_end = @contextTokensAtTurnEnd,
        context_tokens_after_compaction = @contextTokensAfterCompaction,
        compaction_applied = @compactionApplied,
        compaction_tokens_removed = @compactionTokensRemoved,
        completed_at = @completedAt
    WHERE step_id = @stepId
  `).run({
    stepId: turn.id,
    status: turn.status,
    outcome: turn.outcome,
    promptTokens: turn.usage.promptTokens,
    completionTokens: turn.usage.completionTokens,
    reasoningTokens: turn.usage.reasoningTokens,
    totalTokens: turn.usage.totalTokens,
    contextTokensAtTurnEnd: turn.contextTokensAtTurnEnd,
    contextTokensAfterCompaction: turn.contextTokensAfterCompaction,
    compactionApplied: turn.compactionApplied,
    compactionTokensRemoved: turn.compactionTokensRemoved,
    completedAt: turn.completedAt,
  })
}

export function getTurnRecord(connection: Database.Database, turnId: string): TurnRecord | null {
  const row = connection.prepare(`
    SELECT
      v2_steps.id,
      v2_steps.session_id,
      v2_turns.sequence_number,
      v2_turns.status,
      v2_turns.outcome,
      v2_turns.prompt_tokens,
      v2_turns.completion_tokens,
      v2_turns.reasoning_tokens,
      v2_turns.total_tokens,
      v2_turns.context_tokens_at_turn_end,
      v2_turns.context_tokens_after_compaction,
      v2_turns.compaction_applied,
      v2_turns.compaction_tokens_removed,
      v2_steps.created_at,
      v2_turns.completed_at
    FROM v2_turns
    JOIN v2_steps ON v2_steps.id = v2_turns.step_id
    WHERE v2_turns.step_id = ?
  `).get(turnId) as
    | {
        id: string
        session_id: string
        sequence_number: number
        status: TurnRecord['status']
        outcome: string | null
        prompt_tokens: number | null
        completion_tokens: number | null
        reasoning_tokens: number | null
        total_tokens: number | null
        context_tokens_at_turn_end: number | null
        context_tokens_after_compaction: number | null
        compaction_applied: TurnRecord['compactionApplied']
        compaction_tokens_removed: number | null
        created_at: number
        completed_at: number | null
      }
    | undefined

  if (!row) return null

  return {
    id: row.id,
    sessionId: row.session_id,
    sequenceNumber: row.sequence_number,
    status: row.status,
    outcome: row.outcome,
    usage: {
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      reasoningTokens: row.reasoning_tokens,
      totalTokens: row.total_tokens,
    },
    contextTokensAtTurnEnd: row.context_tokens_at_turn_end,
    contextTokensAfterCompaction: row.context_tokens_after_compaction,
    compactionApplied: row.compaction_applied,
    compactionTokensRemoved: row.compaction_tokens_removed,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

export function listTurnRecordsBySession(
  connection: Database.Database,
  sessionId: string,
): TurnRecord[] {
  const rows = connection.prepare(`
    SELECT
      v2_steps.id,
      v2_steps.session_id,
      v2_turns.sequence_number,
      v2_turns.status,
      v2_turns.outcome,
      v2_turns.prompt_tokens,
      v2_turns.completion_tokens,
      v2_turns.reasoning_tokens,
      v2_turns.total_tokens,
      v2_turns.context_tokens_at_turn_end,
      v2_turns.context_tokens_after_compaction,
      v2_turns.compaction_applied,
      v2_turns.compaction_tokens_removed,
      v2_steps.created_at,
      v2_turns.completed_at
    FROM v2_turns
    JOIN v2_steps ON v2_steps.id = v2_turns.step_id
    WHERE v2_turns.session_id = ?
    ORDER BY v2_turns.sequence_number ASC
  `).all(sessionId) as Array<{
    id: string
    session_id: string
    sequence_number: number
    status: TurnRecord['status']
    outcome: string | null
    prompt_tokens: number | null
    completion_tokens: number | null
    reasoning_tokens: number | null
    total_tokens: number | null
    context_tokens_at_turn_end: number | null
    context_tokens_after_compaction: number | null
    compaction_applied: TurnRecord['compactionApplied']
    compaction_tokens_removed: number | null
    created_at: number
    completed_at: number | null
  }>

  return rows.map(row => ({
    id: row.id,
    sessionId: row.session_id,
    sequenceNumber: row.sequence_number,
    status: row.status,
    outcome: row.outcome,
    usage: {
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      reasoningTokens: row.reasoning_tokens,
      totalTokens: row.total_tokens,
    },
    contextTokensAtTurnEnd: row.context_tokens_at_turn_end,
    contextTokensAfterCompaction: row.context_tokens_after_compaction,
    compactionApplied: row.compaction_applied,
    compactionTokensRemoved: row.compaction_tokens_removed,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Round CRUD  (v2_rounds; turn_id → step_id)
// ─────────────────────────────────────────────────────────────────────────────

export function insertRoundRecord(connection: Database.Database, round: RoundRecord): void {
  connection.prepare(`
    INSERT INTO v2_rounds (
      id, step_id, session_id, round_index, status, finish_reason,
      prompt_tokens, completion_tokens, reasoning_tokens, total_tokens,
      request_payload_json, response_trace_json, started_at, completed_at
    ) VALUES (
      @id, @stepId, (SELECT session_id FROM v2_steps WHERE id = @stepId),
      @roundIndex, @status, @finishReason,
      @promptTokens, @completionTokens, @reasoningTokens, @totalTokens,
      @requestPayloadJson, @responseTraceJson, @startedAt, @completedAt
    )
  `).run({
    id: round.id,
    stepId: round.turnId,
    roundIndex: round.roundIndex,
    status: round.status,
    finishReason: round.finishReason,
    promptTokens: round.usage.promptTokens,
    completionTokens: round.usage.completionTokens,
    reasoningTokens: round.usage.reasoningTokens,
    totalTokens: round.usage.totalTokens,
    requestPayloadJson: stringifyJson(round.requestPayloadJson),
    responseTraceJson: stringifyJson(round.responseTraceJson),
    startedAt: round.startedAt,
    completedAt: round.completedAt,
  })
}

export function updateRoundRecord(connection: Database.Database, round: RoundRecord): void {
  connection.prepare(`
    UPDATE v2_rounds
    SET status = @status,
        finish_reason = @finishReason,
        prompt_tokens = @promptTokens,
        completion_tokens = @completionTokens,
        reasoning_tokens = @reasoningTokens,
        total_tokens = @totalTokens,
        request_payload_json = @requestPayloadJson,
        response_trace_json = @responseTraceJson,
        completed_at = @completedAt
    WHERE id = @id
  `).run({
    id: round.id,
    status: round.status,
    finishReason: round.finishReason,
    promptTokens: round.usage.promptTokens,
    completionTokens: round.usage.completionTokens,
    reasoningTokens: round.usage.reasoningTokens,
    totalTokens: round.usage.totalTokens,
    requestPayloadJson: stringifyJson(round.requestPayloadJson),
    responseTraceJson: stringifyJson(round.responseTraceJson),
    completedAt: round.completedAt,
  })
}

export function getRoundRecord(connection: Database.Database, roundId: string): RoundRecord | null {
  const row = connection.prepare(`
    SELECT *
    FROM v2_rounds
    WHERE id = ?
  `).get(roundId) as
    | {
        id: string
        step_id: string
        round_index: number
        status: RoundRecord['status']
        finish_reason: RoundRecord['finishReason']
        prompt_tokens: number | null
        completion_tokens: number | null
        reasoning_tokens: number | null
        total_tokens: number | null
        request_payload_json: string | null
        response_trace_json: string | null
        started_at: number
        completed_at: number | null
      }
    | undefined

  if (!row) return null

  return {
    id: row.id,
    turnId: row.step_id,
    roundIndex: row.round_index,
    status: row.status,
    finishReason: row.finish_reason,
    usage: {
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      reasoningTokens: row.reasoning_tokens,
      totalTokens: row.total_tokens,
    },
    requestPayloadJson: parseJson(row.request_payload_json),
    responseTraceJson: parseJson(row.response_trace_json),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

export function listRoundRecordsBySession(
  connection: Database.Database,
  sessionId: string,
): RoundRecord[] {
  const rows = connection.prepare(`
    SELECT v2_rounds.*
    FROM v2_rounds
    JOIN v2_steps ON v2_steps.id = v2_rounds.step_id
    WHERE v2_rounds.session_id = ?
    ORDER BY v2_steps.ordinal ASC, v2_rounds.round_index ASC
  `).all(sessionId) as Array<{
    id: string
    step_id: string
    round_index: number
    status: RoundRecord['status']
    finish_reason: RoundRecord['finishReason']
    prompt_tokens: number | null
    completion_tokens: number | null
    reasoning_tokens: number | null
    total_tokens: number | null
    request_payload_json: string | null
    response_trace_json: string | null
    started_at: number
    completed_at: number | null
  }>

  return rows.map(row => ({
    id: row.id,
    turnId: row.step_id,
    roundIndex: row.round_index,
    status: row.status,
    finishReason: row.finish_reason,
    usage: {
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      reasoningTokens: row.reasoning_tokens,
      totalTokens: row.total_tokens,
    },
    requestPayloadJson: parseJson(row.request_payload_json),
    responseTraceJson: parseJson(row.response_trace_json),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Part CRUD  (v2_parts; turn_id → step_id)
// ─────────────────────────────────────────────────────────────────────────────

export function insertPartRecord(connection: Database.Database, part: PartRecord): void {
  connection.prepare(`
    INSERT INTO v2_parts (
      id, session_id, step_id, round_id, parent_part_id, ordinal, part_type, role_label,
      payload_text, payload_json, payload_mime_type, payload_summary,
      display_state, collapsed_by_default, context_state, context_note,
      stripped_by_compaction_at_step_id,
      token_count, token_source, token_confidence, token_note,
      provenance_json, created_at, updated_at
    ) VALUES (
      @id, @sessionId, @stepId, @roundId, @parentPartId, @ordinal, @partType, @roleLabel,
      @payloadText, @payloadJson, @payloadMimeType, @payloadSummary,
      @displayState, @collapsedByDefault, @contextState, @contextNote,
      @strippedByCompactionAtStepId,
      @tokenCount, @tokenSource, @tokenConfidence, @tokenNote,
      @provenanceJson, @createdAt, @updatedAt
    )
  `).run({
    id: part.id,
    sessionId: part.sessionId,
    stepId: part.turnId,
    roundId: part.roundId,
    parentPartId: part.parentPartId,
    ordinal: part.ordinal,
    partType: part.partType,
    roleLabel: part.roleLabel,
    payloadText: part.payload.text,
    payloadJson: stringifyJson(part.payload.json),
    payloadMimeType: part.payload.mimeType,
    payloadSummary: part.payload.summary,
    displayState: part.display.state,
    collapsedByDefault: part.display.collapsedByDefault ? 1 : 0,
    contextState: part.context.state,
    contextNote: part.context.note,
    strippedByCompactionAtStepId: part.context.strippedByCompactionAtTurnId,
    tokenCount: part.tokens.count,
    tokenSource: part.tokens.source,
    tokenConfidence: part.tokens.confidence,
    tokenNote: part.tokens.note,
    provenanceJson: stringifyJson(part.provenanceJson),
    createdAt: part.createdAt,
    updatedAt: part.updatedAt,
  })
}

export function updatePartRecord(connection: Database.Database, part: PartRecord): void {
  connection.prepare(`
    UPDATE v2_parts
    SET parent_part_id = @parentPartId,
        ordinal = @ordinal,
        part_type = @partType,
        role_label = @roleLabel,
        payload_text = @payloadText,
        payload_json = @payloadJson,
        payload_mime_type = @payloadMimeType,
        payload_summary = @payloadSummary,
        display_state = @displayState,
        collapsed_by_default = @collapsedByDefault,
        context_state = @contextState,
        context_note = @contextNote,
        stripped_by_compaction_at_step_id = @strippedByCompactionAtStepId,
        token_count = @tokenCount,
        token_source = @tokenSource,
        token_confidence = @tokenConfidence,
        token_note = @tokenNote,
        provenance_json = @provenanceJson,
        updated_at = @updatedAt
    WHERE id = @id
  `).run({
    id: part.id,
    parentPartId: part.parentPartId,
    ordinal: part.ordinal,
    partType: part.partType,
    roleLabel: part.roleLabel,
    payloadText: part.payload.text,
    payloadJson: stringifyJson(part.payload.json),
    payloadMimeType: part.payload.mimeType,
    payloadSummary: part.payload.summary,
    displayState: part.display.state,
    collapsedByDefault: part.display.collapsedByDefault ? 1 : 0,
    contextState: part.context.state,
    contextNote: part.context.note,
    strippedByCompactionAtStepId: part.context.strippedByCompactionAtTurnId,
    tokenCount: part.tokens.count,
    tokenSource: part.tokens.source,
    tokenConfidence: part.tokens.confidence,
    tokenNote: part.tokens.note,
    provenanceJson: stringifyJson(part.provenanceJson),
    updatedAt: part.updatedAt,
  })
}

export function getPartRecord(connection: Database.Database, partId: string): PartRecord | null {
  const row = connection.prepare(`
    SELECT *
    FROM v2_parts
    WHERE id = ?
  `).get(partId) as
    | {
        id: string
        session_id: string
        step_id: string | null
        round_id: string | null
        parent_part_id: string | null
        ordinal: number
        part_type: PartRecord['partType']
        role_label: string | null
        payload_text: string | null
        payload_json: string | null
        payload_mime_type: string | null
        payload_summary: string | null
        display_state: PartRecord['display']['state']
        collapsed_by_default: number
        context_state: PartRecord['context']['state']
        context_note: string | null
        stripped_by_compaction_at_step_id: string | null
        token_count: number | null
        token_source: PartRecord['tokens']['source']
        token_confidence: PartRecord['tokens']['confidence']
        token_note: string | null
        provenance_json: string | null
        created_at: number
        updated_at: number
      }
    | undefined

  if (!row) return null

  return {
    id: row.id,
    sessionId: row.session_id,
    turnId: row.step_id,
    roundId: row.round_id,
    parentPartId: row.parent_part_id,
    ordinal: row.ordinal,
    partType: row.part_type,
    roleLabel: row.role_label,
    payload: {
      text: row.payload_text,
      json: parseJson(row.payload_json),
      mimeType: row.payload_mime_type,
      summary: row.payload_summary,
    },
    display: {
      state: row.display_state,
      collapsedByDefault: row.collapsed_by_default === 1,
    },
    context: {
      state: row.context_state,
      note: row.context_note,
      strippedByCompactionAtTurnId: row.stripped_by_compaction_at_step_id,
    },
    tokens: {
      count: row.token_count,
      source: row.token_source,
      confidence: row.token_confidence,
      note: row.token_note,
    },
    provenanceJson: parseJson(row.provenance_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listPartRecordsBySession(
  connection: Database.Database,
  sessionId: string,
): PartRecord[] {
  const rows = connection.prepare(`
    SELECT *
    FROM v2_parts
    WHERE session_id = ?
    ORDER BY ordinal ASC
  `).all(sessionId) as Array<{
    id: string
    session_id: string
    step_id: string | null
    round_id: string | null
    parent_part_id: string | null
    ordinal: number
    part_type: PartRecord['partType']
    role_label: string | null
    payload_text: string | null
    payload_json: string | null
    payload_mime_type: string | null
    payload_summary: string | null
    display_state: PartRecord['display']['state']
    collapsed_by_default: number
    context_state: PartRecord['context']['state']
    context_note: string | null
    stripped_by_compaction_at_step_id: string | null
    token_count: number | null
    token_source: PartRecord['tokens']['source']
    token_confidence: PartRecord['tokens']['confidence']
    token_note: string | null
    provenance_json: string | null
    created_at: number
    updated_at: number
  }>

  return rows.map(row => ({
    id: row.id,
    sessionId: row.session_id,
    turnId: row.step_id,
    roundId: row.round_id,
    parentPartId: row.parent_part_id,
    ordinal: row.ordinal,
    partType: row.part_type,
    roleLabel: row.role_label,
    payload: {
      text: row.payload_text,
      json: parseJson(row.payload_json),
      mimeType: row.payload_mime_type,
      summary: row.payload_summary,
    },
    display: {
      state: row.display_state,
      collapsedByDefault: row.collapsed_by_default === 1,
    },
    context: {
      state: row.context_state,
      note: row.context_note,
      strippedByCompactionAtTurnId: row.stripped_by_compaction_at_step_id,
    },
    tokens: {
      count: row.token_count,
      source: row.token_source,
      confidence: row.token_confidence,
      note: row.token_note,
    },
    provenanceJson: parseJson(row.provenance_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw exchange CRUD  (v2_raw_exchanges; turn_id → step_id)
// ─────────────────────────────────────────────────────────────────────────────

export function insertRawExchangeRecord(connection: Database.Database, exchange: RawExchangeRecord): void {
  connection.prepare(`
    INSERT INTO v2_raw_exchanges (
      id, session_id, step_id, round_id, kind, request_url, request_method,
      request_headers_json, request_body, response_status, response_headers_json, response_body, created_at
    ) VALUES (
      @id, @sessionId, @stepId, @roundId, @kind, @requestUrl, @requestMethod,
      @requestHeadersJson, @requestBody, @responseStatus, @responseHeadersJson, @responseBody, @createdAt
    )
  `).run({
    id: exchange.id,
    sessionId: exchange.sessionId,
    stepId: exchange.turnId,
    roundId: exchange.roundId,
    kind: exchange.kind,
    requestUrl: exchange.requestUrl,
    requestMethod: exchange.requestMethod,
    requestHeadersJson: stringifyJson(exchange.requestHeadersJson),
    requestBody: exchange.requestBody,
    responseStatus: exchange.responseStatus,
    responseHeadersJson: stringifyJson(exchange.responseHeadersJson),
    responseBody: exchange.responseBody,
    createdAt: exchange.createdAt,
  })
}

export function listRawExchangeRecordsBySession(
  connection: Database.Database,
  sessionId: string,
): RawExchangeRecord[] {
  const rows = connection.prepare(`
    SELECT *
    FROM v2_raw_exchanges
    WHERE session_id = ?
    ORDER BY created_at ASC, rowid ASC
  `).all(sessionId) as Array<{
    id: string
    session_id: string
    step_id: string | null
    round_id: string | null
    kind: RawExchangeRecord['kind']
    request_url: string
    request_method: string
    request_headers_json: string | null
    request_body: string | null
    response_status: number | null
    response_headers_json: string | null
    response_body: string | null
    created_at: number
  }>

  return rows.map(row => ({
    id: row.id,
    sessionId: row.session_id,
    turnId: row.step_id,
    roundId: row.round_id,
    kind: row.kind,
    requestUrl: row.request_url,
    requestMethod: row.request_method,
    requestHeadersJson: parseJson(row.request_headers_json),
    requestBody: row.request_body,
    responseStatus: row.response_status,
    responseHeadersJson: parseJson(row.response_headers_json),
    responseBody: row.response_body,
    createdAt: row.created_at,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Sequence helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getNextTurnSequenceNumber(connection: Database.Database, sessionId: string): number {
  const row = connection.prepare(`
    SELECT COALESCE(MAX(sequence_number), 0) AS max_sequence_number
    FROM v2_turns
    WHERE session_id = ?
  `).get(sessionId) as { max_sequence_number: number }

  return row.max_sequence_number + 1
}

export function getNextPartOrdinal(connection: Database.Database, sessionId: string): number {
  const row = connection.prepare(`
    SELECT COALESCE(MAX(ordinal), 0) AS max_ordinal
    FROM v2_parts
    WHERE session_id = ?
  `).get(sessionId) as { max_ordinal: number }

  return row.max_ordinal + 1
}

export function getNextRoundPartSequence(connection: Database.Database, roundId: string): number {
  const row = connection.prepare(`
    SELECT COUNT(*) AS part_count
    FROM v2_parts
    WHERE round_id = ?
  `).get(roundId) as { part_count: number }

  return row.part_count + 1
}

export function getNextPreludePartSequence(connection: Database.Database, sessionId: string): number {
  const row = connection.prepare(`
    SELECT COUNT(*) AS part_count
    FROM v2_parts
    WHERE session_id = ? AND step_id IS NULL
  `).get(sessionId) as { part_count: number }

  return row.part_count + 1
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark container CRUD  (session_containers table, type_key = 'benchmark')
// ─────────────────────────────────────────────────────────────────────────────

import type { BenchmarkRecord } from '../domain/model.js'

export function createBenchmarkRecord(
  connection: Database.Database,
  benchmark: BenchmarkRecord,
): void {
  connection.prepare(`
    INSERT INTO session_containers (
      id, container_type_key, title, params_json, state_json, created_at, updated_at
    ) VALUES (
      @id, 'benchmark', @title, @paramsJson, @stateJson, @createdAt, @updatedAt
    )
  `).run({
    id: benchmark.id,
    title: benchmark.title,
    paramsJson: JSON.stringify(benchmark.params ?? {}),
    stateJson: JSON.stringify(benchmark.state ?? {}),
    createdAt: benchmark.createdAt,
    updatedAt: benchmark.updatedAt,
  })
}

export function getBenchmarkRecord(
  connection: Database.Database,
  id: string,
): BenchmarkRecord | null {
  const row = connection.prepare(`
    SELECT * FROM session_containers WHERE id = ? AND container_type_key = 'benchmark'
  `).get(id) as {
    id: string
    title: string
    params_json: string
    state_json: string
    created_at: number
    updated_at: number
  } | undefined

  if (!row) return null

  return {
    id: row.id,
    title: row.title,
    params: JSON.parse(row.params_json) as Record<string, unknown>,
    state: JSON.parse(row.state_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listBenchmarkRecords(
  connection: Database.Database,
): BenchmarkRecord[] {
  const rows = connection.prepare(`
    SELECT * FROM session_containers
    WHERE container_type_key = 'benchmark'
    ORDER BY created_at DESC
  `).all() as Array<{
    id: string
    title: string
    params_json: string
    state_json: string
    created_at: number
    updated_at: number
  }>

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    params: JSON.parse(row.params_json) as Record<string, unknown>,
    state: JSON.parse(row.state_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export function deleteBenchmarkRecord(
  connection: Database.Database,
  id: string,
): boolean {
  const result = connection.prepare(`
    DELETE FROM session_containers WHERE id = ? AND container_type_key = 'benchmark'
  `).run(id)
  return result.changes > 0
}
