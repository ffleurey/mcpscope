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
  ContainerRef,
  SessionPersistenceRecord,
  StepPersistenceRecord,
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
    parent_step_id: string | null
    child_index: number
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
    ORDER BY child_index ASC
  `).all(sessionId) as Array<{
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
  }>

  return rows.map(mapStepRow)
}

export function getNextChildIndex(
  connection: Database.Database,
  sessionId: string,
): number {
  const row = connection.prepare(`
    SELECT COALESCE(MAX(child_index), 0) AS max_child_index
    FROM v2_steps
    WHERE session_id = ?
  `).get(sessionId) as { max_child_index: number }
  return row.max_child_index + 1
}

function mapStepRow(row: {
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
}): StepPersistenceRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    stepTypeKey: row.step_type_key as StepPersistenceRecord['stepTypeKey'],
    parentStepId: row.parent_step_id,
    childIndex: row.child_index,
    status: row.status,
    params: parseJson(row.params_json),
    state: parseJson(row.state_json),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

