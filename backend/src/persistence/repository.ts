import type Database from 'better-sqlite3'
import type {
  ModelProfileSnapshot,
  PartRecord,
  RawExchangeRecord,
  RoundRecord,
  SessionRecord,
  SessionSummary,
  TurnRecord,
} from '../domain/model.js'
import type { McpProfileSnapshot } from '../domain/model.js'
import type {
  LmStudioConnection as LmStudioConnectionRecord,
  ModelConfig as ModelConfigRecord,
  McpServerProfile as McpServerProfileRecord,
  AnalysisProfile as AnalysisProfileRecord,
} from '../domain/configuration.js'
import { validateSessionParent } from '../domain/sessionValidation.js'

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

export function createSessionRecord(
  connection: Database.Database,
  session: SessionRecord,
): void {
  assertValidSessionParent(session)
  connection.prepare(`
    INSERT INTO sessions (
      id, title, status, init_status, session_type, parent_kind, parent_id,
      model_profile_snapshot_json, mcp_profile_snapshot_json,
      loaded_context_length, system_prompt_tokens, tool_definitions_tokens,
      is_context_exhausted, compaction_strategy, created_at, updated_at
    ) VALUES (
      @id, @title, @status, @initStatus, @sessionType, @parentKind, @parentId,
      @modelProfileSnapshotJson, @mcpProfileSnapshotJson,
      @loadedContextLength, @systemPromptTokens, @toolDefinitionsTokens,
      @isContextExhausted, @compactionStrategy, @createdAt, @updatedAt
    )
  `).run({
    id: session.id,
    title: session.title,
    status: session.status,
    initStatus: session.initStatus,
    sessionType: session.sessionType,
    parentKind: session.parentKind,
    parentId: session.parentId,
    modelProfileSnapshotJson: JSON.stringify(session.modelProfileSnapshot),
    mcpProfileSnapshotJson: stringifyJson(session.mcpProfileSnapshot),
    loadedContextLength: session.loadedContextLength,
    systemPromptTokens: session.systemPromptTokens,
    toolDefinitionsTokens: session.toolDefinitionsTokens,
    isContextExhausted: session.isContextExhausted ? 1 : 0,
    compactionStrategy: session.compactionStrategy,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  })

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
    FROM sessions
    WHERE id = ?
  `).get(sessionId) as
    | {
        id: string
        title: string
        status: SessionRecord['status']
        init_status: SessionRecord['initStatus']
        session_type: SessionRecord['sessionType']
        parent_kind: SessionRecord['parentKind']
        parent_id: string | null
        model_profile_snapshot_json: string
        mcp_profile_snapshot_json: string | null
        loaded_context_length: number | null
        system_prompt_tokens: number | null
        tool_definitions_tokens: number | null
        is_context_exhausted: number
        compaction_strategy: SessionRecord['compactionStrategy']
        created_at: number
        updated_at: number
      }
    | undefined

  if (!row) return null

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    initStatus: row.init_status,
    sessionType: row.session_type ?? 'primary',
    parentKind: row.parent_kind ?? null,
    parentId: row.parent_id ?? null,
    modelProfileSnapshot: JSON.parse(row.model_profile_snapshot_json) as ModelProfileSnapshot,
    mcpProfileSnapshot: parseJson<McpProfileSnapshot>(row.mcp_profile_snapshot_json),
    loadedContextLength: row.loaded_context_length,
    systemPromptTokens: row.system_prompt_tokens,
    toolDefinitionsTokens: row.tool_definitions_tokens,
    isContextExhausted: row.is_context_exhausted === 1,
    compactionStrategy: row.compaction_strategy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getTurnRecord(connection: Database.Database, turnId: string): TurnRecord | null {
  const row = connection.prepare(`
    SELECT *
    FROM turns
    WHERE id = ?
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
        stripped_by_compaction_at_turn_id: string | null
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
      strippedByCompactionAtTurnId: row.stripped_by_compaction_at_turn_id,
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

export function listSessionRecords(connection: Database.Database): SessionRecord[] {
  const rows = connection.prepare(`
    SELECT *
    FROM sessions
    ORDER BY updated_at DESC, created_at DESC
  `).all() as Array<{
    id: string
    title: string
    status: SessionRecord['status']
    init_status: SessionRecord['initStatus']
    session_type: SessionRecord['sessionType']
    parent_kind: SessionRecord['parentKind']
    parent_id: string | null
    model_profile_snapshot_json: string
    mcp_profile_snapshot_json: string | null
    loaded_context_length: number | null
    system_prompt_tokens: number | null
    tool_definitions_tokens: number | null
    is_context_exhausted: number
    compaction_strategy: SessionRecord['compactionStrategy']
    created_at: number
    updated_at: number
  }>

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    status: row.status,
    initStatus: row.init_status,
    sessionType: row.session_type ?? 'primary',
    parentKind: row.parent_kind ?? null,
    parentId: row.parent_id ?? null,
    modelProfileSnapshot: JSON.parse(row.model_profile_snapshot_json) as ModelProfileSnapshot,
    mcpProfileSnapshot: parseJson<McpProfileSnapshot>(row.mcp_profile_snapshot_json),
    loadedContextLength: row.loaded_context_length,
    systemPromptTokens: row.system_prompt_tokens,
    toolDefinitionsTokens: row.tool_definitions_tokens,
    isContextExhausted: row.is_context_exhausted === 1,
    compactionStrategy: row.compaction_strategy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
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
        ON s.parent_kind = 'session'
       AND s.parent_id = st.id
    )
    DELETE FROM sessions
    WHERE id IN (SELECT id FROM session_tree)
  `).run(sessionId)

  return result.changes > 0
}

export interface ActiveSessionInfo {
  id: string
  state: 'initializing' | 'running'
}

/**
 * Returns the first session that is currently active (initializing or running a turn),
 * optionally excluding a specific session by ID.
 *
 * A session is "active" when:
 *   - its initStatus is 'initializing' (state: 'initializing')
 *   - or it has a turn with status 'draft', 'streaming', or 'awaiting-tools' (state: 'running')
 *
 * Note: 'pending' sessions are NOT considered active — a session that was created but whose
 * initialization was never started (e.g. after a server restart or abandoned UI flow) must not
 * permanently lock the system. The initialize route enforces the lock when real work begins.
 */
export function findActiveSession(
  connection: Database.Database,
  excludeSessionId?: string,
): ActiveSessionInfo | null {
  const whereInit = excludeSessionId ? 'AND id != @excludeId' : ''
  const whereRun = excludeSessionId ? 'AND s.id != @excludeId' : ''
  const params: Record<string, string> = excludeSessionId ? { excludeId: excludeSessionId } : {}

  const row = connection.prepare(`
    SELECT id, state FROM (
      SELECT id, 'initializing' AS state
      FROM sessions
      WHERE init_status = 'initializing'
      ${whereInit}
      UNION ALL
      SELECT DISTINCT s.id, 'running' AS state
      FROM sessions s
      JOIN turns t ON t.session_id = s.id
      WHERE t.status IN ('draft', 'streaming', 'awaiting-tools')
      ${whereRun}
    )
    LIMIT 1
  `).get(params) as { id: string; state: 'initializing' | 'running' } | undefined

  return row ?? null
}

/**
 * Recovers from an unclean server shutdown by marking any turns and sessions
 * that were left in an in-progress state as terminated.
 *
 * Must be called once at startup, before any requests are served. Without this,
 * a crash mid-turn leaves a 'streaming' turn in the DB which permanently blocks
 * findActiveSession and prevents any new session from ever starting.
 *
 * Transitions applied atomically:
 *  - turns:    'draft' | 'streaming' | 'awaiting-tools'  →  'aborted'
 *  - sessions: initStatus = 'initializing'               →  initStatus = 'error'
 */
export function recoverInterruptedState(connection: Database.Database): void {
  connection.transaction(() => {
    connection.prepare(`
      UPDATE turns
      SET status = 'aborted', completed_at = ?
      WHERE status IN ('draft', 'streaming', 'awaiting-tools')
    `).run(Date.now())

    connection.prepare(`
      UPDATE sessions
      SET init_status = 'error', updated_at = ?
      WHERE init_status = 'initializing'
    `).run(Date.now())
  })()
}

type SessionSummaryRow = {
  id: string
  title: string
  status: SessionSummary['status']
  init_status: SessionSummary['initStatus']
  session_type: SessionSummary['sessionType']
  parent_kind: SessionSummary['parentKind']
  parent_id: string | null
  created_at: number
  updated_at: number
  is_context_exhausted: number
  loaded_context_length: number | null
  compaction_strategy: SessionSummary['compactionStrategy']
  model_profile_snapshot_json: string
  mcp_profile_snapshot_json: string | null
}

function mapSessionSummaryRow(row: SessionSummaryRow): SessionSummary {
  const modelSnapshot = JSON.parse(row.model_profile_snapshot_json) as { name: string }
  const mcpSnapshot = row.mcp_profile_snapshot_json
    ? (JSON.parse(row.mcp_profile_snapshot_json) as { name: string })
    : null
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    initStatus: row.init_status,
    sessionType: row.session_type ?? 'primary',
    parentKind: row.parent_kind ?? null,
    parentId: row.parent_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isContextExhausted: row.is_context_exhausted === 1,
    loadedContextLength: row.loaded_context_length,
    compactionStrategy: row.compaction_strategy,
    modelProfileSnapshot: { name: modelSnapshot.name },
    mcpProfileSnapshot: mcpSnapshot ? { name: mcpSnapshot.name } : null,
  }
}

const SESSION_SUMMARY_COLS = `
  id, title, status, init_status, session_type, parent_kind, parent_id,
  created_at, updated_at, is_context_exhausted, loaded_context_length,
  compaction_strategy, model_profile_snapshot_json, mcp_profile_snapshot_json
`

/** Returns only primary sessions (session_type = 'primary'). Used by GET /api/sessions. */
export function listSessionSummaries(connection: Database.Database): SessionSummary[] {
  const rows = connection.prepare(`
    SELECT ${SESSION_SUMMARY_COLS}
    FROM sessions
    WHERE session_type = 'primary'
    ORDER BY updated_at DESC, created_at DESC
  `).all() as SessionSummaryRow[]

  return rows.map(mapSessionSummaryRow)
}

/** Returns child sessions attached to the given parent (any type, for parent lookup). */
export function listChildSessionSummaries(
  connection: Database.Database,
  parentKind: string,
  parentId: string,
): SessionSummary[] {
  const rows = connection.prepare(`
    SELECT ${SESSION_SUMMARY_COLS}
    FROM sessions
    WHERE parent_kind = ? AND parent_id = ?
    ORDER BY created_at ASC
  `).all(parentKind, parentId) as SessionSummaryRow[]

  return rows.map(mapSessionSummaryRow)
}

/** Returns all sessions regardless of type — used by GET /api/sessions?include_children=true for tree rendering. */
export function listAllSessionSummaries(connection: Database.Database): SessionSummary[] {
  const rows = connection.prepare(`
    SELECT ${SESSION_SUMMARY_COLS}
    FROM sessions
    ORDER BY updated_at DESC, created_at DESC
  `).all() as SessionSummaryRow[]

  return rows.map(mapSessionSummaryRow)
}

function upsertJsonRecord(
  connection: Database.Database,
  tableName: string,
  input: {
    id: string
    name: string
    recordJson: string
    createdAt: number
    updatedAt: number
  },
): void {
  connection.prepare(`
    INSERT INTO ${tableName} (id, name, record_json, created_at, updated_at)
    VALUES (@id, @name, @recordJson, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      record_json = excluded.record_json,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `).run(input)
}

function listJsonRecords<T>(connection: Database.Database, tableName: string): T[] {
  const rows = connection.prepare(`
    SELECT record_json
    FROM ${tableName}
    ORDER BY updated_at DESC, created_at DESC, name ASC
  `).all() as Array<{ record_json: string }>

  return rows.map(row => JSON.parse(row.record_json) as T)
}

function deleteJsonRecord(connection: Database.Database, tableName: string, id: string): boolean {
  const result = connection.prepare(`
    DELETE FROM ${tableName}
    WHERE id = ?
  `).run(id)

  return result.changes > 0
}

export function upsertLmConnection(
  connection: Database.Database,
  record: LmStudioConnectionRecord,
): void {
  upsertJsonRecord(connection, 'lm_connections', {
    id: record.id,
    name: record.name,
    recordJson: JSON.stringify(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
}

export function listLmConnections(connection: Database.Database): LmStudioConnectionRecord[] {
  return listJsonRecords<LmStudioConnectionRecord>(connection, 'lm_connections')
}

export function deleteLmConnection(connection: Database.Database, id: string): boolean {
  return deleteJsonRecord(connection, 'lm_connections', id)
}

export function upsertModelConfig(
  connection: Database.Database,
  record: ModelConfigRecord,
): void {
  upsertJsonRecord(connection, 'model_configs', {
    id: record.id,
    name: record.name,
    recordJson: JSON.stringify(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
}

export function listModelConfigs(connection: Database.Database): ModelConfigRecord[] {
  return listJsonRecords<ModelConfigRecord>(connection, 'model_configs')
}

export function deleteModelConfig(connection: Database.Database, id: string): boolean {
  return deleteJsonRecord(connection, 'model_configs', id)
}

export function upsertMcpServerProfile(
  connection: Database.Database,
  record: McpServerProfileRecord,
): void {
  upsertJsonRecord(connection, 'mcp_server_profiles', {
    id: record.id,
    name: record.name,
    recordJson: JSON.stringify(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
}

export function listMcpServerProfiles(connection: Database.Database): McpServerProfileRecord[] {
  return listJsonRecords<McpServerProfileRecord>(connection, 'mcp_server_profiles')
}

export function deleteMcpServerProfile(connection: Database.Database, id: string): boolean {
  return deleteJsonRecord(connection, 'mcp_server_profiles', id)
}

export function upsertAnalysisProfile(
  connection: Database.Database,
  record: AnalysisProfileRecord,
): void {
  upsertJsonRecord(connection, 'analysis_profiles', {
    id: record.id,
    name: record.name,
    recordJson: JSON.stringify(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
}

export function listAnalysisProfiles(connection: Database.Database): AnalysisProfileRecord[] {
  return listJsonRecords<AnalysisProfileRecord>(connection, 'analysis_profiles')
}

export function deleteAnalysisProfile(connection: Database.Database, id: string): boolean {
  return deleteJsonRecord(connection, 'analysis_profiles', id)
}

export interface AnalysisDefaults {
  defaultAnalysisProfileId: string | null
  updatedAt: number
}

export function getAnalysisDefaults(connection: Database.Database): AnalysisDefaults {
  const row = connection.prepare(`
    SELECT default_analysis_profile_id, updated_at
    FROM analysis_defaults
    WHERE id = 1
  `).get() as {
    default_analysis_profile_id: string | null
    updated_at: number
  } | undefined

  if (!row) {
    return { defaultAnalysisProfileId: null, updatedAt: 0 }
  }

  return {
    defaultAnalysisProfileId: row.default_analysis_profile_id,
    updatedAt: row.updated_at,
  }
}

export function upsertAnalysisDefaults(
  connection: Database.Database,
  defaults: AnalysisDefaults,
): void {
  connection.prepare(`
    UPDATE analysis_defaults
    SET default_analysis_profile_id = @defaultAnalysisProfileId,
        updated_at                  = @updatedAt
    WHERE id = 1
  `).run({
    defaultAnalysisProfileId: defaults.defaultAnalysisProfileId,
    updatedAt: defaults.updatedAt,
  })
}

export interface SessionCreationDefaults {
  defaultModelConfigId: string | null
  defaultMcpProfileId: string | null
  updatedAt: number
}

export function getSessionCreationDefaults(connection: Database.Database): SessionCreationDefaults {
  const row = connection.prepare(`
    SELECT default_model_config_id, default_mcp_profile_id, updated_at
    FROM session_creation_defaults
    WHERE id = 1
  `).get() as {
    default_model_config_id: string | null
    default_mcp_profile_id: string | null
    updated_at: number
  } | undefined

  if (!row) {
    return { defaultModelConfigId: null, defaultMcpProfileId: null, updatedAt: 0 }
  }

  return {
    defaultModelConfigId: row.default_model_config_id,
    defaultMcpProfileId: row.default_mcp_profile_id,
    updatedAt: row.updated_at,
  }
}

export function upsertSessionCreationDefaults(
  connection: Database.Database,
  defaults: SessionCreationDefaults,
): void {
  connection.prepare(`
    UPDATE session_creation_defaults
    SET default_model_config_id = @defaultModelConfigId,
        default_mcp_profile_id  = @defaultMcpProfileId,
        updated_at              = @updatedAt
    WHERE id = 1
  `).run({
    defaultModelConfigId: defaults.defaultModelConfigId,
    defaultMcpProfileId: defaults.defaultMcpProfileId,
    updatedAt: defaults.updatedAt,
  })
}

export function insertTurnRecord(connection: Database.Database, turn: TurnRecord): void {
  connection.prepare(`
    INSERT INTO turns (
      id, session_id, sequence_number, status, outcome,
      prompt_tokens, completion_tokens, reasoning_tokens, total_tokens,
      context_tokens_at_turn_end, context_tokens_after_compaction,
      compaction_applied, compaction_tokens_removed,
      created_at, completed_at
    ) VALUES (
      @id, @sessionId, @sequenceNumber, @status, @outcome,
      @promptTokens, @completionTokens, @reasoningTokens, @totalTokens,
      @contextTokensAtTurnEnd, @contextTokensAfterCompaction,
      @compactionApplied, @compactionTokensRemoved,
      @createdAt, @completedAt
    )
  `).run({
    id: turn.id,
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
    UPDATE turns
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
    WHERE id = @id
  `).run({
    id: turn.id,
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

export function insertRoundRecord(connection: Database.Database, round: RoundRecord): void {
  connection.prepare(`
    INSERT INTO rounds (
      id, turn_id, round_index, status, finish_reason,
      prompt_tokens, completion_tokens, reasoning_tokens, total_tokens,
      request_payload_json, response_trace_json, started_at, completed_at
    ) VALUES (
      @id, @turnId, @roundIndex, @status, @finishReason,
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

export function insertPartRecord(connection: Database.Database, part: PartRecord): void {
  connection.prepare(`
    INSERT INTO parts (
      id, session_id, turn_id, round_id, parent_part_id, ordinal, part_type, role_label,
      payload_text, payload_json, payload_mime_type, payload_summary,
      display_state, collapsed_by_default, context_state, context_note,
      stripped_by_compaction_at_turn_id,
      token_count, token_source, token_confidence, token_note,
      provenance_json, created_at, updated_at
    ) VALUES (
      @id, @sessionId, @turnId, @roundId, @parentPartId, @ordinal, @partType, @roleLabel,
      @payloadText, @payloadJson, @payloadMimeType, @payloadSummary,
      @displayState, @collapsedByDefault, @contextState, @contextNote,
      @strippedByCompactionAtTurnId,
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
    strippedByCompactionAtTurnId: part.context.strippedByCompactionAtTurnId,
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
        stripped_by_compaction_at_turn_id = @strippedByCompactionAtTurnId,
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
    strippedByCompactionAtTurnId: part.context.strippedByCompactionAtTurnId,
    tokenCount: part.tokens.count,
    tokenSource: part.tokens.source,
    tokenConfidence: part.tokens.confidence,
    tokenNote: part.tokens.note,
    provenanceJson: stringifyJson(part.provenanceJson),
    updatedAt: part.updatedAt,
  })
}

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

export function updateSessionRecord(connection: Database.Database, session: SessionRecord): void {
  assertValidSessionParent(session)
  connection.prepare(`
    UPDATE sessions
    SET title = @title,
        status = @status,
        init_status = @initStatus,
        session_type = @sessionType,
        parent_kind = @parentKind,
        parent_id = @parentId,
        loaded_context_length = @loadedContextLength,
        system_prompt_tokens = @systemPromptTokens,
        tool_definitions_tokens = @toolDefinitionsTokens,
        is_context_exhausted = @isContextExhausted,
        compaction_strategy = @compactionStrategy,
        updated_at = @updatedAt
    WHERE id = @id
  `).run({
    id: session.id,
    title: session.title,
    status: session.status,
    initStatus: session.initStatus,
    sessionType: session.sessionType,
    parentKind: session.parentKind,
    parentId: session.parentId,
    loadedContextLength: session.loadedContextLength,
    systemPromptTokens: session.systemPromptTokens,
    toolDefinitionsTokens: session.toolDefinitionsTokens,
    isContextExhausted: session.isContextExhausted ? 1 : 0,
    compactionStrategy: session.compactionStrategy,
    updatedAt: session.updatedAt,
  })
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
    stripped_by_compaction_at_turn_id: string | null
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
      strippedByCompactionAtTurnId: row.stripped_by_compaction_at_turn_id,
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

export function listTurnRecordsBySession(
  connection: Database.Database,
  sessionId: string,
): TurnRecord[] {
  const rows = connection.prepare(`
    SELECT *
    FROM turns
    WHERE session_id = ?
    ORDER BY sequence_number ASC
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

export function listRoundRecordsBySession(
  connection: Database.Database,
  sessionId: string,
): RoundRecord[] {
  const rows = connection.prepare(`
    SELECT rounds.*
    FROM rounds
    JOIN turns ON turns.id = rounds.turn_id
    WHERE turns.session_id = ?
    ORDER BY turns.sequence_number ASC, rounds.round_index ASC
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

export function getNextTurnSequenceNumber(connection: Database.Database, sessionId: string): number {
  const row = connection.prepare(`
    SELECT COALESCE(MAX(sequence_number), 0) AS max_sequence_number
    FROM turns
    WHERE session_id = ?
  `).get(sessionId) as { max_sequence_number: number }

  return row.max_sequence_number + 1
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
