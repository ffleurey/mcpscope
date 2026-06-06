import type Database from 'better-sqlite3'
import type {
  LmStudioConnection as LmStudioConnectionRecord,
  ModelConfig as ModelConfigRecord,
  McpServerProfile as McpServerProfileRecord,
} from '../domain/configuration.js'

export { insertStepRecord } from './repositoryV2.js'

export type { ActiveSessionInfo } from './repositoryRuntime.js'
export {
  createSessionRecord,
  getSessionRecord,
  updateSessionRecord,
  updateSessionAnalysisState,
  deleteSessionRecord,
  listSessionRecords,
  listSessionSummaries,
  listChildSessionSummaries,
  listAllSessionSummaries,
  findActiveSession,
  recoverInterruptedState,
  getStepRecord,
  listStepRecordsBySession,
  getNextChildIndex,
  insertTurnRecord,
  updateTurnRecord,
  getTurnRecord,
  listTurnRecordsBySession,
  insertRoundRecord,
  updateRoundRecord,
  getRoundRecord,
  listRoundRecordsBySession,
  insertPartRecord,
  updatePartRecord,
  getPartRecord,
  listPartRecordsBySession,
  insertRawExchangeRecord,
  listRawExchangeRecordsBySession,
  getNextTurnNumber,
  getNextPartOrdinal,
  getNextRoundPartSequence,
  getNextPreludePartSequence,
} from './repositoryRuntime.js'


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

export interface SessionCreationDefaults {
  defaultModelConfigId: string | null
  updatedAt: number
}

export function getSessionCreationDefaults(connection: Database.Database): SessionCreationDefaults {
  const row = connection.prepare(`
    SELECT default_model_config_id, updated_at
    FROM session_creation_defaults
    WHERE id = 1
  `).get() as {
    default_model_config_id: string | null
    updated_at: number
  } | undefined

  if (!row) {
    return { defaultModelConfigId: null, updatedAt: 0 }
  }

  return {
    defaultModelConfigId: row.default_model_config_id,
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
        updated_at              = @updatedAt
    WHERE id = 1
  `).run({
    defaultModelConfigId: defaults.defaultModelConfigId,
    updatedAt: defaults.updatedAt,
  })
}


