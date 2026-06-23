/**
 * repositoryRuntime.ts
 *
 * Canonical session/turn/round/part/raw-exchange repository implementation
 * against the current v2 runtime tables.
 *
 * Key column mappings:
 *   sessions.session_type          → sessions.session_type_key
 *   sessions.parent_kind           → sessions.parent_container_type_key
 *   sessions.parent_id             → sessions.parent_container_id
 *   sessions.model_profile_*_json  → sessions.params_json.modelProfileSnapshot
 *   sessions.mcp_profile_*_json    → sessions.params_json.mcpProfileSnapshot
 *   sessions.compaction_strategy   → sessions.params_json.compactionStrategy
 *   sessions.loaded_context_length → sessions.state_json.loadedContextLength
 *   sessions.system_prompt_tokens  → sessions.state_json.systemPromptTokens
 *   sessions.tool_definitions_*    → sessions.state_json.toolDefinitionsTokens
 *   sessions.is_context_exhausted  → sessions.state_json.isContextExhausted
 *
 *   turns.*                        → steps.* + turns.*  (same id for top-level)
 *   turns.id                       → steps.id (top-level) = turns.id
 *   turns.sequence_number          → turns.turn_number
 *   steps.child_index           = turn_number - 1 (top-level)
 *
 *   rounds.turn_id                 → rounds.turn_id
 *   parts.turn_id                  → parts.turn_id
 *   parts.stripped_by_*_turn_id    → parts.stripped_by_compaction_at_step_id
 *   raw_exchanges.turn_id          → raw_exchanges.turn_id
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
  StepRecord,
} from '../domain/model.js'
import type { StepPersistenceRecord } from '../domain/persistenceContract.js'
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

type V2StepRow = {
  id: string
  session_id: string
  step_type_key: string
  parent_step_id: string | null
  child_index: number
  status: string
  params_json: string
  state_json: string
  created_at: number
  completed_at: number | null
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
  analysis_state_json: string | null
  created_at: number
  updated_at: number
}

type V2SessionParams = {
  modelProfileSnapshot: ModelProfileSnapshot
  mcpProfileSnapshots: McpProfileSnapshot[]
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
    mcpProfileSnapshots: session.mcpProfileSnapshots,
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

function mapV2StepRow(row: V2StepRow): StepRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    stepTypeKey: row.step_type_key,
    parentStepId: row.parent_step_id,
    childIndex: row.child_index,
    status: row.status,
    params: parseJson<Record<string, unknown>>(row.params_json) ?? {},
    state: parseJson<Record<string, unknown>>(row.state_json) ?? {},
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

function mapV2SessionRow(row: V2SessionRow): SessionRecord {
  const rawParams = JSON.parse(row.params_json) as Record<string, unknown>
  const params = rawParams as V2SessionParams
  const state = JSON.parse(row.state_json) as V2SessionState
  // Backward compat: old sessions have mcpProfileSnapshot (singular, nullable)
  const mcpSnapshots: McpProfileSnapshot[] = params.mcpProfileSnapshots ??
    (rawParams.mcpProfileSnapshot ? [rawParams.mcpProfileSnapshot as McpProfileSnapshot] : [])
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    initStatus: row.init_status,
    sessionType: (row.session_type_key as SessionRecord['sessionType']) ?? 'primary',
    parentKind: (row.parent_container_type_key as SessionRecord['parentKind']) ?? null,
    parentId: row.parent_container_id ?? null,
    modelProfileSnapshot: params.modelProfileSnapshot,
    mcpProfileSnapshots: mcpSnapshots,
    loadedContextLength: state.loadedContextLength ?? null,
    systemPromptTokens: state.systemPromptTokens ?? null,
    toolDefinitionsTokens: state.toolDefinitionsTokens ?? null,
    isContextExhausted: state.isContextExhausted ?? false,
    compactionStrategy: params.compactionStrategy,
    analysisState: row.analysis_state_json ? (JSON.parse(row.analysis_state_json) as Record<string, unknown>) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapV2SessionSummaryRow(row: V2SessionRow): SessionSummary {
  const params = JSON.parse(row.params_json) as {
    modelProfileSnapshot?: { name: string }
    mcpProfileSnapshot?: { name: string } | null
    mcpProfileSnapshots?: { name: string }[]
    compactionStrategy?: SessionSummary['compactionStrategy']
  }
  const state = JSON.parse(row.state_json) as {
    isContextExhausted?: boolean
    loadedContextLength?: number | null
  }
  const mcpNames: { name: string }[] = params.mcpProfileSnapshots ??
    (params.mcpProfileSnapshot ? [params.mcpProfileSnapshot] : [])
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
    mcpProfileSnapshots: mcpNames,
  }
}

export function insertStepRecord(
  connection: Database.Database,
  record: StepPersistenceRecord,
): void {
  connection.prepare(`
    INSERT INTO steps (
      id, session_id, step_type_key, parent_step_id, child_index, status,
      params_json, state_json, created_at, completed_at
    ) VALUES (
      @id, @sessionId, @stepTypeKey, @parentStepId, @childIndex, @status,
      @paramsJson, @stateJson, @createdAt, @completedAt
    )
  `).run({
    id: record.id,
    sessionId: record.sessionId,
    stepTypeKey: record.stepTypeKey,
    parentStepId: record.parentStepId,
    childIndex: record.childIndex,
    status: record.status,
    paramsJson: JSON.stringify(record.params ?? {}),
    stateJson: JSON.stringify(record.state ?? {}),
    createdAt: record.createdAt,
    completedAt: record.completedAt,
  })
}

export function updateStepRecord(
  connection: Database.Database,
  record: StepPersistenceRecord,
): void {
  connection.prepare(`
    UPDATE steps
    SET status = @status,
        params_json = @paramsJson,
        state_json = @stateJson,
        completed_at = @completedAt
    WHERE id = @id
  `).run({
    id: record.id,
    status: record.status,
    paramsJson: JSON.stringify(record.params ?? {}),
    stateJson: JSON.stringify(record.state ?? {}),
    completedAt: record.completedAt,
  })
}

export function getStepRecord(connection: Database.Database, stepId: string): StepRecord | null {
  const row = connection.prepare(`
    SELECT *
    FROM steps
    WHERE id = ?
  `).get(stepId) as V2StepRow | undefined

  return row ? mapV2StepRow(row) : null
}

export function listStepRecordsBySession(connection: Database.Database, sessionId: string): StepRecord[] {
  const rows = connection.prepare(`
    SELECT *
    FROM steps
    WHERE session_id = ?
    ORDER BY child_index ASC
  `).all(sessionId) as V2StepRow[]

  return rows.map(mapV2StepRow)
}

export function getNextChildIndex(connection: Database.Database, sessionId: string): number {
  const row = connection.prepare(`
    SELECT COALESCE(MAX(child_index), 0) AS max_child_index
    FROM steps
    WHERE session_id = ? AND parent_step_id IS NULL
  `).get(sessionId) as { max_child_index: number }

  return row.max_child_index + 1
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
    INSERT INTO sessions (
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

  for (const mcpSnapshot of session.mcpProfileSnapshots) {
    connection.prepare(`
      INSERT OR REPLACE INTO mcp_profiles (id, name, snapshot_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      mcpSnapshot.id,
      mcpSnapshot.name,
      JSON.stringify(mcpSnapshot),
      mcpSnapshot.createdAt,
      mcpSnapshot.updatedAt,
    )
  }
}

export function getSessionRecord(
  connection: Database.Database,
  sessionId: string,
): SessionRecord | null {
  const row = connection.prepare(`
    SELECT *
    FROM sessions
    WHERE id = ?
  `).get(sessionId) as V2SessionRow | undefined

  if (!row) return null
  return mapV2SessionRow(row)
}

export function updateSessionRecord(connection: Database.Database, session: SessionRecord): void {
  assertValidSessionParent(session)
  connection.prepare(`
    UPDATE sessions
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

export function updateSessionAnalysisState(
  connection: Database.Database,
  sessionId: string,
  analysisState: Record<string, unknown> | null,
): void {
  connection.prepare(`
    UPDATE sessions
    SET analysis_state_json = @analysisStateJson,
        updated_at = @updatedAt
    WHERE id = @id
  `).run({
    id: sessionId,
    analysisStateJson: analysisState ? JSON.stringify(analysisState) : null,
    updatedAt: Date.now(),
  })
}

export function deleteSessionRecord(connection: Database.Database, sessionId: string): boolean {
  const result = connection.prepare(`
    WITH RECURSIVE session_tree(id) AS (
      SELECT id
      FROM sessions
      WHERE id = ?
      UNION
      SELECT s.id
      FROM sessions s
      JOIN session_tree st
        ON s.parent_container_type_key = 'session'
       AND s.parent_container_id = st.id
    )
    DELETE FROM sessions
    WHERE id IN (SELECT id FROM session_tree)
  `).run(sessionId)

  return result.changes > 0
}

export function listSessionRecords(connection: Database.Database): SessionRecord[] {
  const rows = connection.prepare(`
    SELECT *
    FROM sessions
    ORDER BY updated_at DESC, created_at DESC
  `).all() as V2SessionRow[]

  return rows.map(mapV2SessionRow)
}

/** Returns only primary sessions (session_type_key = 'primary'). Used by GET /api/sessions. */
export function listSessionSummaries(connection: Database.Database): SessionSummary[] {
  const rows = connection.prepare(`
    SELECT *
    FROM sessions
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
    FROM sessions
    WHERE parent_container_type_key = ? AND parent_container_id = ?
    ORDER BY created_at ASC
  `).all(parentKind, parentId) as V2SessionRow[]

  return rows.map(mapV2SessionSummaryRow)
}

/** Returns all sessions regardless of type. */
export function listAllSessionSummaries(connection: Database.Database): SessionSummary[] {
  const rows = connection.prepare(`
    SELECT *
    FROM sessions
    ORDER BY updated_at DESC, created_at DESC
  `).all() as V2SessionRow[]

  return rows.map(mapV2SessionSummaryRow)
}

export function findActiveSession(
  connection: Database.Database,
  excludeSessionId?: string,
): ActiveSessionInfo | null {
  const whereInit = excludeSessionId ? 'AND id != @excludeId' : ''
  const whereRun = excludeSessionId ? 'AND sessions.id != @excludeId' : ''
  const params: Record<string, string> = excludeSessionId ? { excludeId: excludeSessionId } : {}

  const row = connection.prepare(`
    SELECT id, state FROM (
      SELECT id, 'initializing' AS state
      FROM sessions
      WHERE init_status = 'initializing'
      ${whereInit}
      UNION ALL
      SELECT DISTINCT sessions.id, 'running' AS state
      FROM sessions
      JOIN turns ON turns.session_id = sessions.id
      WHERE turns.status IN ('draft', 'streaming', 'awaiting-tools')
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
      UPDATE steps
      SET status = 'aborted', completed_at = ?
      WHERE status IN ('draft', 'streaming', 'awaiting-tools')
    `).run(now)

    connection.prepare(`
      UPDATE turns
      SET status = 'aborted', completed_at = ?
      WHERE status IN ('draft', 'streaming', 'awaiting-tools')
    `).run(now)

    connection.prepare(`
      UPDATE sessions
      SET init_status = 'error', updated_at = ?
      WHERE init_status = 'initializing'
    `).run(now)

    // Benchmark runs and evaluations are driven by in-process coordinators that do
    // not survive a restart. Any left non-terminal is orphaned → mark it 'stopped'
    // (the resumable rest state) so the user can resume/retry the remaining work,
    // rather than spinning forever as 'running'. Stale per-task sessions left
    // 'running' inside the record are reconciled to 'cancelled' when the coordinator
    // resumes. 'paused' runs are equally orphaned (the in-memory gate is gone).
    connection.prepare(`
      UPDATE benchmark_runs
      SET status = 'stopped',
          error = COALESCE(error, 'Interrupted by a server restart; resume to recover.'),
          updated_at = ?,
          completed_at = COALESCE(completed_at, ?)
      WHERE status IN ('pending', 'running', 'paused')
    `).run(now, now)

    connection.prepare(`
      UPDATE benchmark_evaluations
      SET status = 'stopped',
          error = COALESCE(error, 'Interrupted by a server restart; resume to recover.'),
          updated_at = ?
      WHERE status IN ('pending', 'running', 'paused')
    `).run(now)
  })()
}

// ─────────────────────────────────────────────────────────────────────────────
// Turn CRUD  (steps for top-level + turns for all)
// ─────────────────────────────────────────────────────────────────────────────

export function insertTurnRecord(
  connection: Database.Database,
  turn: TurnRecord,
): void {
  const ownerStepId = turn.ownerStepId
  if (!ownerStepId) {
    const childIndex = getNextChildIndex(connection, turn.sessionId)

    connection.prepare(`
      INSERT INTO steps (
        id, session_id, step_type_key, parent_step_id, child_index, status,
        params_json, state_json, created_at, completed_at
      ) VALUES (
        @id, @sessionId, 'turn', @parentStepId, @childIndex, @status,
        '{}', '{}', @createdAt, @completedAt
      )
    `).run({
      id: turn.id,
      sessionId: turn.sessionId,
      parentStepId: null,
      childIndex,
      status: turn.status,
      createdAt: turn.createdAt,
      completedAt: turn.completedAt,
    })
  }

  connection.prepare(`
    INSERT INTO turns (
      id, session_id, owner_step_id, turn_number, status, outcome,
      prompt_tokens, completion_tokens, reasoning_tokens, total_tokens,
      context_tokens_at_turn_end, context_tokens_after_compaction,
      compaction_applied, compaction_tokens_removed,
      created_at, completed_at
    ) VALUES (
      @id, @sessionId, @ownerStepId, @turnNumber, @status, @outcome,
      @promptTokens, @completionTokens, @reasoningTokens, @totalTokens,
      @contextTokensAtTurnEnd, @contextTokensAfterCompaction,
      @compactionApplied, @compactionTokensRemoved,
      @createdAt, @completedAt
    )
  `).run({
    id: turn.id,
    sessionId: turn.sessionId,
    ownerStepId: ownerStepId ?? null,
    turnNumber: turn.turnNumber,
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
  if (!turn.ownerStepId) {
    connection.prepare(`
      UPDATE steps
      SET status = @status,
          completed_at = @completedAt
      WHERE id = @id
    `).run({
      id: turn.id,
      status: turn.status,
      completedAt: turn.completedAt,
    })
  }

  connection.prepare(`
    UPDATE turns
    SET owner_step_id = @ownerStepId,
      status = @status,
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
    WHERE id = @id
  `).run({
    id: turn.id,
    ownerStepId: turn.ownerStepId,
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
      turns.id,
      turns.session_id,
      turns.owner_step_id,
      turns.turn_number,
      turns.status,
      turns.outcome,
      turns.prompt_tokens,
      turns.completion_tokens,
      turns.reasoning_tokens,
      turns.total_tokens,
      turns.context_tokens_at_turn_end,
      turns.context_tokens_after_compaction,
      turns.compaction_applied,
      turns.compaction_tokens_removed,
      COALESCE(steps.created_at, turns.created_at) AS created_at,
      turns.completed_at
    FROM turns
    LEFT JOIN steps ON steps.id = turns.id
    WHERE turns.id = ?
  `).get(turnId) as
    | {
        id: string
        session_id: string
        owner_step_id: string | null
        turn_number: number
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
    ownerStepId: row.owner_step_id,
    turnNumber: row.turn_number,
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
      turns.id,
      turns.session_id,
      turns.owner_step_id,
      turns.turn_number,
      turns.status,
      turns.outcome,
      turns.prompt_tokens,
      turns.completion_tokens,
      turns.reasoning_tokens,
      turns.total_tokens,
      turns.context_tokens_at_turn_end,
      turns.context_tokens_after_compaction,
      turns.compaction_applied,
      turns.compaction_tokens_removed,
      COALESCE(steps.created_at, turns.created_at) AS created_at,
      turns.completed_at
    FROM turns
    LEFT JOIN steps ON steps.id = turns.id
    WHERE turns.session_id = ?
    ORDER BY turns.turn_number ASC
  `).all(sessionId) as Array<{
    id: string
    session_id: string
    owner_step_id: string | null
    turn_number: number
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
    ownerStepId: row.owner_step_id,
    turnNumber: row.turn_number,
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
// Round CRUD  (rounds)
// ─────────────────────────────────────────────────────────────────────────────

export function insertRoundRecord(connection: Database.Database, round: RoundRecord): void {
  connection.prepare(`
    INSERT INTO rounds (
      id, turn_id, session_id, round_index, status, finish_reason,
      prompt_tokens, completion_tokens, reasoning_tokens, total_tokens,
      request_payload_json, response_trace_json, started_at, completed_at
    ) VALUES (
      @id, @turnId, (SELECT session_id FROM turns WHERE id = @turnId),
      @roundIndex, @status, @finishReason,
      @promptTokens, @completionTokens, @reasoningTokens, @totalTokens,
      @requestPayloadJson, @responseTraceJson, @startedAt, @completedAt
    )
  `).run({
    id: round.id,
    turnId: round.turnId,
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
    UPDATE rounds
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
    FROM rounds
    WHERE id = ?
  `).get(roundId) as
    | {
        id: string
        turn_id: string
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
    turnId: row.turn_id,
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
    SELECT rounds.*
    FROM rounds
    JOIN turns ON turns.id = rounds.turn_id
    WHERE rounds.session_id = ?
    ORDER BY turns.turn_number ASC, rounds.round_index ASC
  `).all(sessionId) as Array<{
    id: string
    turn_id: string
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
    turnId: row.turn_id,
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
// Part CRUD  (parts)
// ─────────────────────────────────────────────────────────────────────────────

export function insertPartRecord(connection: Database.Database, part: PartRecord): void {
  connection.prepare(`
    INSERT INTO parts (
      id, session_id, turn_id, round_id, parent_part_id, ordinal, part_type, role_label,
      payload_text, payload_json, payload_mime_type, payload_summary,
      display_state, collapsed_by_default, context_state, context_note,
      stripped_by_compaction_at_step_id,
      token_count, token_source, token_confidence, token_note,
      provenance_json, created_at, updated_at
    ) VALUES (
      @id, @sessionId, @turnId, @roundId, @parentPartId, @ordinal, @partType, @roleLabel,
      @payloadText, @payloadJson, @payloadMimeType, @payloadSummary,
      @displayState, @collapsedByDefault, @contextState, @contextNote,
      @strippedByCompactionAtStepId,
      @tokenCount, @tokenSource, @tokenConfidence, @tokenNote,
      @provenanceJson, @createdAt, @updatedAt
    )
  `).run({
    id: part.id,
    sessionId: part.sessionId,
    turnId: part.turnId,
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
    UPDATE parts
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
    FROM parts
    WHERE id = ?
  `).get(partId) as
    | {
        id: string
        session_id: string
        turn_id: string | null
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
    turnId: row.turn_id,
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
    FROM parts
    WHERE session_id = ?
    ORDER BY ordinal ASC
  `).all(sessionId) as Array<{
    id: string
    session_id: string
    turn_id: string | null
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
    turnId: row.turn_id,
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
// Raw exchange CRUD  (raw_exchanges)
// ─────────────────────────────────────────────────────────────────────────────

export function insertRawExchangeRecord(connection: Database.Database, exchange: RawExchangeRecord): void {
  connection.prepare(`
    INSERT INTO raw_exchanges (
      id, session_id, turn_id, round_id, kind, request_url, request_method,
      request_headers_json, request_body, response_status, response_headers_json, response_body, created_at
    ) VALUES (
      @id, @sessionId, @turnId, @roundId, @kind, @requestUrl, @requestMethod,
      @requestHeadersJson, @requestBody, @responseStatus, @responseHeadersJson, @responseBody, @createdAt
    )
  `).run({
    id: exchange.id,
    sessionId: exchange.sessionId,
    turnId: exchange.turnId,
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
    FROM raw_exchanges
    WHERE session_id = ?
    ORDER BY created_at ASC, rowid ASC
  `).all(sessionId) as Array<{
    id: string
    session_id: string
    turn_id: string | null
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
    turnId: row.turn_id,
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

export function getNextTurnNumber(connection: Database.Database, sessionId: string, ownerStepId: string | null): number {
  if (ownerStepId) {
    const row = connection.prepare(`
      SELECT COUNT(*) AS cnt
      FROM turns
      WHERE owner_step_id = ?
    `).get(ownerStepId) as { cnt: number }
    return row.cnt + 1
  }

  const row = connection.prepare(`
    SELECT COALESCE(MAX(turn_number), 0) AS max_turn_number
    FROM turns
    WHERE session_id = ? AND owner_step_id IS NULL
  `).get(sessionId) as { max_turn_number: number }

  return row.max_turn_number + 1
}

export function getNextPartOrdinal(connection: Database.Database, sessionId: string): number {
  const row = connection.prepare(`
    SELECT COALESCE(MAX(ordinal), 0) AS max_ordinal
    FROM parts
    WHERE session_id = ?
  `).get(sessionId) as { max_ordinal: number }

  return row.max_ordinal + 1
}

export function getNextRoundPartSequence(connection: Database.Database, roundId: string): number {
  const row = connection.prepare(`
    SELECT COUNT(*) AS part_count
    FROM parts
    WHERE round_id = ?
  `).get(roundId) as { part_count: number }

  return row.part_count + 1
}

export function getNextPreludePartSequence(connection: Database.Database, sessionId: string): number {
  const row = connection.prepare(`
    SELECT COUNT(*) AS part_count
    FROM parts
    WHERE session_id = ? AND turn_id IS NULL
  `).get(sessionId) as { part_count: number }

  return row.part_count + 1
}
