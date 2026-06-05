/**
 * Repository implementations for the generic v2 persistence contract.
 *
 * Implements the repository interfaces from `domain/persistenceContract.ts`
 * against the new table layout defined in `persistence/schemaV2.ts`.
 *
 * The canonical runtime CRUD used by current behavior lives in
 * `persistence/repositoryRuntime.ts`; this file remains the lower-level generic
 * container/session/step persistence surface for the execution model.
 *
 * All repository functions are pure database operations:
 *   - no transport semantics
 *   - no operation-catalog semantics
 *   - no domain validation beyond what the schema enforces
 */

import type Database from 'better-sqlite3'
import type {
  ContainerPersistenceRecord,
  ContainerRef,
  SessionPersistenceRecord,
  StepPersistenceRecord,
  TurnPersistenceRecord,
} from '../domain/persistenceContract.js'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseJson<T>(value: string | null): T {
  return value ? (JSON.parse(value) as T) : ({} as T)
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? {})
}

// ─────────────────────────────────────────────────────────────────────────────
// Container repository  (session_containers table)
// ─────────────────────────────────────────────────────────────────────────────

export function insertContainerRecord(
  connection: Database.Database,
  record: ContainerPersistenceRecord,
): void {
  connection.prepare(`
    INSERT INTO session_containers (
      id, container_type_key, title, params_json, state_json, created_at, updated_at
    ) VALUES (
      @id, @containerTypeKey, @title, @paramsJson, @stateJson, @createdAt, @updatedAt
    )
  `).run({
    id: record.id,
    containerTypeKey: record.containerTypeKey,
    title: record.title,
    paramsJson: stringifyJson(record.params),
    stateJson: stringifyJson(record.state),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
}

export function getContainerRecord(
  connection: Database.Database,
  id: string,
): ContainerPersistenceRecord | null {
  const row = connection.prepare(`
    SELECT * FROM session_containers WHERE id = ?
  `).get(id) as {
    id: string
    container_type_key: string
    title: string
    params_json: string
    state_json: string
    created_at: number
    updated_at: number
  } | undefined

  if (!row) return null

  return {
    id: row.id,
    containerTypeKey: row.container_type_key as ContainerPersistenceRecord['containerTypeKey'],
    title: row.title,
    params: parseJson(row.params_json),
    state: parseJson(row.state_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function updateContainerRecord(
  connection: Database.Database,
  record: ContainerPersistenceRecord,
): void {
  connection.prepare(`
    UPDATE session_containers
    SET container_type_key = @containerTypeKey,
        title = @title,
        params_json = @paramsJson,
        state_json = @stateJson,
        updated_at = @updatedAt
    WHERE id = @id
  `).run({
    id: record.id,
    containerTypeKey: record.containerTypeKey,
    title: record.title,
    paramsJson: stringifyJson(record.params),
    stateJson: stringifyJson(record.state),
    updatedAt: record.updatedAt,
  })
}

export function deleteContainerRecord(
  connection: Database.Database,
  id: string,
): boolean {
  const result = connection.prepare(`
    DELETE FROM session_containers WHERE id = ?
  `).run(id)
  return result.changes > 0
}

export function listContainerRecords(
  connection: Database.Database,
): ContainerPersistenceRecord[] {
  const rows = connection.prepare(`
    SELECT * FROM session_containers
    ORDER BY created_at DESC
  `).all() as Array<{
    id: string
    container_type_key: string
    title: string
    params_json: string
    state_json: string
    created_at: number
    updated_at: number
  }>

  return rows.map(row => ({
    id: row.id,
    containerTypeKey: row.container_type_key as ContainerPersistenceRecord['containerTypeKey'],
    title: row.title,
    params: parseJson(row.params_json),
    state: parseJson(row.state_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Session repository  (v2_sessions table)
// ─────────────────────────────────────────────────────────────────────────────

export function insertSessionV2Record(
  connection: Database.Database,
  record: SessionPersistenceRecord,
): void {
  connection.prepare(`
    INSERT INTO v2_sessions (
      id, title, session_type_key,
      parent_container_type_key, parent_container_id,
      status, init_status,
      params_json, state_json,
      created_at, updated_at
    ) VALUES (
      @id, @title, @sessionTypeKey,
      @parentContainerTypeKey, @parentContainerId,
      @status, @initStatus,
      @paramsJson, @stateJson,
      @createdAt, @updatedAt
    )
  `).run({
    id: record.id,
    title: record.title,
    sessionTypeKey: record.sessionTypeKey,
    parentContainerTypeKey: record.parentRef?.containerTypeKey ?? null,
    parentContainerId: record.parentRef?.containerId ?? null,
    status: record.status,
    initStatus: record.initStatus,
    paramsJson: stringifyJson(record.params),
    stateJson: stringifyJson(record.state),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
}

export function getSessionV2Record(
  connection: Database.Database,
  id: string,
): SessionPersistenceRecord | null {
  const row = connection.prepare(`
    SELECT * FROM v2_sessions WHERE id = ?
  `).get(id) as {
    id: string
    title: string
    session_type_key: string
    parent_container_type_key: string | null
    parent_container_id: string | null
    status: string
    init_status: string
    params_json: string
    state_json: string
    created_at: number
    updated_at: number
  } | undefined

  if (!row) return null

  return mapSessionV2Row(row)
}

export function updateSessionV2Record(
  connection: Database.Database,
  record: SessionPersistenceRecord,
): void {
  connection.prepare(`
    UPDATE v2_sessions
    SET title = @title,
        session_type_key = @sessionTypeKey,
        parent_container_type_key = @parentContainerTypeKey,
        parent_container_id = @parentContainerId,
        status = @status,
        init_status = @initStatus,
        params_json = @paramsJson,
        state_json = @stateJson,
        updated_at = @updatedAt
    WHERE id = @id
  `).run({
    id: record.id,
    title: record.title,
    sessionTypeKey: record.sessionTypeKey,
    parentContainerTypeKey: record.parentRef?.containerTypeKey ?? null,
    parentContainerId: record.parentRef?.containerId ?? null,
    status: record.status,
    initStatus: record.initStatus,
    paramsJson: stringifyJson(record.params),
    stateJson: stringifyJson(record.state),
    updatedAt: record.updatedAt,
  })
}

export function deleteSessionV2Record(
  connection: Database.Database,
  id: string,
): boolean {
  // Cascade-delete the session and all child sessions recursively
  const result = connection.prepare(`
    WITH RECURSIVE session_tree(id) AS (
      SELECT id FROM v2_sessions WHERE id = ?
      UNION
      SELECT s.id
      FROM v2_sessions s
      JOIN session_tree st
        ON s.parent_container_type_key = 'session'
       AND s.parent_container_id = st.id
    )
    DELETE FROM v2_sessions
    WHERE id IN (SELECT id FROM session_tree)
  `).run(id)
  return result.changes > 0
}

export function listSessionV2Records(
  connection: Database.Database,
  filter?: { parentRef?: ContainerRef | null },
): SessionPersistenceRecord[] {
  let sql: string
  let params: unknown[]

  if (filter === undefined) {
    // No filter: list all sessions
    sql = `SELECT * FROM v2_sessions ORDER BY updated_at DESC, created_at DESC`
    params = []
  } else if (filter.parentRef === null) {
    // Top-level sessions only
    sql = `SELECT * FROM v2_sessions WHERE parent_container_id IS NULL ORDER BY updated_at DESC, created_at DESC`
    params = []
  } else if (filter.parentRef) {
    // Sessions with a specific parent
    sql = `SELECT * FROM v2_sessions WHERE parent_container_type_key = ? AND parent_container_id = ? ORDER BY created_at ASC`
    params = [filter.parentRef.containerTypeKey, filter.parentRef.containerId]
  } else {
    sql = `SELECT * FROM v2_sessions ORDER BY updated_at DESC, created_at DESC`
    params = []
  }

  const rows = connection.prepare(sql).all(...params) as Array<{
    id: string
    title: string
    session_type_key: string
    parent_container_type_key: string | null
    parent_container_id: string | null
    status: string
    init_status: string
    params_json: string
    state_json: string
    created_at: number
    updated_at: number
  }>

  return rows.map(mapSessionV2Row)
}

function mapSessionV2Row(row: {
  id: string
  title: string
  session_type_key: string
  parent_container_type_key: string | null
  parent_container_id: string | null
  status: string
  init_status: string
  params_json: string
  state_json: string
  created_at: number
  updated_at: number
}): SessionPersistenceRecord {
  const parentRef: ContainerRef | null =
    row.parent_container_type_key && row.parent_container_id
      ? {
          containerTypeKey: row.parent_container_type_key as ContainerRef['containerTypeKey'],
          containerId: row.parent_container_id,
        }
      : null

  return {
    id: row.id,
    title: row.title,
    sessionTypeKey: row.session_type_key as SessionPersistenceRecord['sessionTypeKey'],
    parentRef,
    status: row.status,
    initStatus: row.init_status,
    params: parseJson(row.params_json),
    state: parseJson(row.state_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step repository  (v2_steps table)
// ─────────────────────────────────────────────────────────────────────────────

export function insertStepRecord(
  connection: Database.Database,
  record: StepPersistenceRecord,
): void {
  connection.prepare(`
    INSERT INTO v2_steps (
      id, session_id, step_type_key, ordinal, status,
      params_json, state_json, created_at, completed_at
    ) VALUES (
      @id, @sessionId, @stepTypeKey, @ordinal, @status,
      @paramsJson, @stateJson, @createdAt, @completedAt
    )
  `).run({
    id: record.id,
    sessionId: record.sessionId,
    stepTypeKey: record.stepTypeKey,
    ordinal: record.ordinal,
    status: record.status,
    paramsJson: stringifyJson(record.params),
    stateJson: stringifyJson(record.state),
    createdAt: record.createdAt,
    completedAt: record.completedAt,
  })
}

export function getStepRecord(
  connection: Database.Database,
  id: string,
): StepPersistenceRecord | null {
  const row = connection.prepare(`
    SELECT * FROM v2_steps WHERE id = ?
  `).get(id) as {
    id: string
    session_id: string
    step_type_key: string
    ordinal: number
    status: string
    params_json: string
    state_json: string
    created_at: number
    completed_at: number | null
  } | undefined

  if (!row) return null

  return mapStepRow(row)
}

export function updateStepRecord(
  connection: Database.Database,
  record: StepPersistenceRecord,
): void {
  connection.prepare(`
    UPDATE v2_steps
    SET status = @status,
        params_json = @paramsJson,
        state_json = @stateJson,
        completed_at = @completedAt
    WHERE id = @id
  `).run({
    id: record.id,
    status: record.status,
    paramsJson: stringifyJson(record.params),
    stateJson: stringifyJson(record.state),
    completedAt: record.completedAt,
  })
}

export function listStepRecordsBySession(
  connection: Database.Database,
  sessionId: string,
): StepPersistenceRecord[] {
  const rows = connection.prepare(`
    SELECT * FROM v2_steps
    WHERE session_id = ?
    ORDER BY ordinal ASC
  `).all(sessionId) as Array<{
    id: string
    session_id: string
    step_type_key: string
    ordinal: number
    status: string
    params_json: string
    state_json: string
    created_at: number
    completed_at: number | null
  }>

  return rows.map(mapStepRow)
}

export function getNextStepOrdinal(
  connection: Database.Database,
  sessionId: string,
): number {
  const row = connection.prepare(`
    SELECT COALESCE(MAX(ordinal), -1) AS max_ordinal
    FROM v2_steps
    WHERE session_id = ?
  `).get(sessionId) as { max_ordinal: number }
  return row.max_ordinal + 1
}

export function getNextWorkflowStepOrdinal(
  connection: Database.Database,
  sessionId: string,
): number {
  const row = connection.prepare(`
    SELECT COALESCE(MAX(ordinal), 0) AS max_ordinal
    FROM v2_steps
    WHERE session_id = ?
      AND step_type_key NOT IN ('turn', 'compaction', 'analysis_v2_cursor')
  `).get(sessionId) as { max_ordinal: number }
  return row.max_ordinal + 1
}

function mapStepRow(row: {
  id: string
  session_id: string
  step_type_key: string
  ordinal: number
  status: string
  params_json: string
  state_json: string
  created_at: number
  completed_at: number | null
}): StepPersistenceRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    stepTypeKey: row.step_type_key as StepPersistenceRecord['stepTypeKey'],
    ordinal: row.ordinal,
    status: row.status,
    params: parseJson(row.params_json),
    state: parseJson(row.state_json),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Turn repository  (v2_turns table — LLM-specific step extension)
// ─────────────────────────────────────────────────────────────────────────────

export function insertTurnV2Record(
  connection: Database.Database,
  record: TurnPersistenceRecord,
): void {
  connection.prepare(`
    INSERT INTO v2_turns (
      step_id, session_id, owner_step_id, sequence_number, status, outcome,
      prompt_tokens, completion_tokens, reasoning_tokens, total_tokens,
      context_tokens_at_turn_end, context_tokens_after_compaction,
      compaction_applied, compaction_tokens_removed,
      created_at, completed_at
    ) VALUES (
      @stepId, @sessionId, @ownerStepId, @sequenceNumber, @status, @outcome,
      @promptTokens, @completionTokens, @reasoningTokens, @totalTokens,
      @contextTokensAtTurnEnd, @contextTokensAfterCompaction,
      @compactionApplied, @compactionTokensRemoved,
      @createdAt, @completedAt
    )
  `).run({
    stepId: record.stepId,
    sessionId: record.sessionId,
    ownerStepId: record.ownerStepId,
    sequenceNumber: record.sequenceNumber,
    status: 'draft',
    outcome: record.outcome,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
    reasoningTokens: record.reasoningTokens,
    totalTokens: record.totalTokens,
    contextTokensAtTurnEnd: record.contextTokensAtTurnEnd,
    contextTokensAfterCompaction: record.contextTokensAfterCompaction,
    compactionApplied: record.compactionApplied,
    compactionTokensRemoved: record.compactionTokensRemoved,
    createdAt: Date.now(),
    completedAt: null,
  })
}

export function getTurnV2Record(
  connection: Database.Database,
  stepId: string,
): TurnPersistenceRecord | null {
  const row = connection.prepare(`
    SELECT * FROM v2_turns WHERE step_id = ?
  `).get(stepId) as {
    step_id: string
    session_id: string
    owner_step_id: string | null
    sequence_number: number
    status: string
    outcome: string | null
    prompt_tokens: number | null
    completion_tokens: number | null
    reasoning_tokens: number | null
    total_tokens: number | null
    context_tokens_at_turn_end: number | null
    context_tokens_after_compaction: number | null
    compaction_applied: string | null
    compaction_tokens_removed: number | null
    created_at: number
    completed_at: number | null
  } | undefined

  if (!row) return null

  return {
    stepId: row.step_id,
    sessionId: row.session_id,
    ownerStepId: row.owner_step_id,
    sequenceNumber: row.sequence_number,
    outcome: row.outcome,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    reasoningTokens: row.reasoning_tokens,
    totalTokens: row.total_tokens,
    contextTokensAtTurnEnd: row.context_tokens_at_turn_end,
    contextTokensAfterCompaction: row.context_tokens_after_compaction,
    compactionApplied: row.compaction_applied,
    compactionTokensRemoved: row.compaction_tokens_removed,
  }
}

export function updateTurnV2Record(
  connection: Database.Database,
  stepId: string,
  fields: Partial<Omit<TurnPersistenceRecord, 'stepId' | 'sessionId' | 'sequenceNumber'>>,
): void {
  const updates: string[] = []
  const params: Record<string, unknown> = { stepId }

  if (fields.ownerStepId !== undefined) { updates.push('owner_step_id = @ownerStepId'); params.ownerStepId = fields.ownerStepId }
  if (fields.outcome !== undefined) { updates.push('outcome = @outcome'); params.outcome = fields.outcome }
  if (fields.promptTokens !== undefined) { updates.push('prompt_tokens = @promptTokens'); params.promptTokens = fields.promptTokens }
  if (fields.completionTokens !== undefined) { updates.push('completion_tokens = @completionTokens'); params.completionTokens = fields.completionTokens }
  if (fields.reasoningTokens !== undefined) { updates.push('reasoning_tokens = @reasoningTokens'); params.reasoningTokens = fields.reasoningTokens }
  if (fields.totalTokens !== undefined) { updates.push('total_tokens = @totalTokens'); params.totalTokens = fields.totalTokens }
  if (fields.contextTokensAtTurnEnd !== undefined) { updates.push('context_tokens_at_turn_end = @contextTokensAtTurnEnd'); params.contextTokensAtTurnEnd = fields.contextTokensAtTurnEnd }
  if (fields.contextTokensAfterCompaction !== undefined) { updates.push('context_tokens_after_compaction = @contextTokensAfterCompaction'); params.contextTokensAfterCompaction = fields.contextTokensAfterCompaction }
  if (fields.compactionApplied !== undefined) { updates.push('compaction_applied = @compactionApplied'); params.compactionApplied = fields.compactionApplied }
  if (fields.compactionTokensRemoved !== undefined) { updates.push('compaction_tokens_removed = @compactionTokensRemoved'); params.compactionTokensRemoved = fields.compactionTokensRemoved }

  if (updates.length === 0) return

  connection.prepare(`
    UPDATE v2_turns SET ${updates.join(', ')} WHERE step_id = @stepId
  `).run(params)
}

export function listTurnV2RecordsBySession(
  connection: Database.Database,
  sessionId: string,
): TurnPersistenceRecord[] {
  const rows = connection.prepare(`
    SELECT vt.*
    FROM v2_turns vt
    WHERE vt.session_id = ?
    ORDER BY vt.sequence_number ASC
  `).all(sessionId) as Array<{
    step_id: string
    session_id: string
    owner_step_id: string | null
    sequence_number: number
    status: string
    outcome: string | null
    prompt_tokens: number | null
    completion_tokens: number | null
    reasoning_tokens: number | null
    total_tokens: number | null
    context_tokens_at_turn_end: number | null
    context_tokens_after_compaction: number | null
    compaction_applied: string | null
    compaction_tokens_removed: number | null
    created_at: number
    completed_at: number | null
  }>

  return rows.map(row => ({
    stepId: row.step_id,
    sessionId: row.session_id,
    ownerStepId: row.owner_step_id,
    sequenceNumber: row.sequence_number,
    outcome: row.outcome,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    reasoningTokens: row.reasoning_tokens,
    totalTokens: row.total_tokens,
    contextTokensAtTurnEnd: row.context_tokens_at_turn_end,
    contextTokensAfterCompaction: row.context_tokens_after_compaction,
    compactionApplied: row.compaction_applied,
    compactionTokensRemoved: row.compaction_tokens_removed,
  }))
}

export function getNextTurnV2SequenceNumber(
  connection: Database.Database,
  sessionId: string,
): number {
  const row = connection.prepare(`
    SELECT COALESCE(MAX(sequence_number), 0) AS max_seq
    FROM v2_turns
    WHERE session_id = ?
  `).get(sessionId) as { max_seq: number }
  return row.max_seq + 1
}
