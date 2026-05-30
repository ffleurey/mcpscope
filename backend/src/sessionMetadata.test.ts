/**
 * Session metadata foundation tests.
 *
 * Covers: schema migration, repository persistence, validation, parent/child
 * lookups, primary-only listing, cascade delete, and API serialization of
 * the new session_type / parent_ref fields.
 */
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildBackendApp } from './app.js'
import { validateSessionParent } from './domain/sessionValidation.js'
import {
  createSessionRecord,
  deleteSessionRecord,
  getSessionRecord,
  listChildSessionSummaries,
  listSessionSummaries,
  updateSessionRecord,
} from './persistence/repository.js'
import { openBackendDatabase } from './persistence/db.js'
import { initializeBackendSchema, validateBackendSchema } from './persistence/schema.js'
import { importTraceBundle } from './runtime/traceImport.js'

const LEGACY_RUNTIME_TABLES = ['sessions', 'turns', 'rounds', 'parts', 'raw_exchanges']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTestConfig() {
  const dataDir = `.tmp-test-data/${crypto.randomUUID()}`
  return {
    host: '127.0.0.1',
    port: 3030,
    corsOrigin: true as const,
    dataDir,
    sqlitePath: `${dataDir}/test.db`,
    maxToolRounds: 5,
    appVersion: 'test',
  }
}

const BASE_MODEL_SNAPSHOT = {
  id: 'model-1',
  name: 'Model',
  connectionBaseUrl: 'https://example.com/v1',
  apiKey: null,
  modelKey: 'model-key',
  modelDisplayName: 'Model Key',
  systemPrompt: 'You are exact.',
  temperature: 0,
  reasoning: 'on' as const,
  createdAt: 1,
  updatedAt: 1,
}

function makeSessionRecord(overrides: Partial<Parameters<typeof createSessionRecord>[1]> = {}): Parameters<typeof createSessionRecord>[1] {
  const ts = Date.now()
  return {
    id: `TEST`,
    title: 'Test session',
    status: 'ready',
    initStatus: 'pending',
    sessionType: 'primary',
    parentKind: null,
    parentId: null,
    createdAt: ts,
    updatedAt: ts,
    modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
    mcpProfileSnapshot: null,
    loadedContextLength: null,
    systemPromptTokens: null,
    toolDefinitionsTokens: null,
    isContextExhausted: false,
    compactionStrategy: 'strip-reasoning',
    ...overrides,
  }
}

// ─── Validation rules ─────────────────────────────────────────────────────────

describe('session type / parent validation', () => {
  it('primary with no parent is valid', () => {
    expect(validateSessionParent('primary', null, null)).toBeNull()
  })

  it('primary with benchmark parent is valid', () => {
    expect(validateSessionParent('primary', 'benchmark', 'bench-1')).toBeNull()
  })

  it('primary with session parent is rejected', () => {
    expect(validateSessionParent('primary', 'session', 'sess-1')).toMatch(/benchmark/)
  })

  it('session_analysis with session parent is valid', () => {
    expect(validateSessionParent('session_analysis', 'session', 'sess-1')).toBeNull()
  })

  it('session_analysis without parent is rejected', () => {
    expect(validateSessionParent('session_analysis', null, null)).toMatch(/require a parent/)
  })

  it('session_analysis with benchmark parent is rejected', () => {
    expect(validateSessionParent('session_analysis', 'benchmark', 'bench-1')).toMatch(/session/)
  })

  it('session_compaction with session parent is valid', () => {
    expect(validateSessionParent('session_compaction', 'session', 'sess-1')).toBeNull()
  })

  it('session_compaction without parent is rejected', () => {
    expect(validateSessionParent('session_compaction', null, null)).toMatch(/require a parent/)
  })

  it('benchmark_analysis with benchmark parent is valid', () => {
    expect(validateSessionParent('benchmark_analysis', 'benchmark', 'bench-1')).toBeNull()
  })

  it('benchmark_analysis without parent is rejected', () => {
    expect(validateSessionParent('benchmark_analysis', null, null)).toMatch(/require a parent/)
  })

  it('benchmark_analysis with session parent is rejected', () => {
    expect(validateSessionParent('benchmark_analysis', 'session', 'sess-1')).toMatch(/benchmark/)
  })

  it('parent_kind and parent_id must both be set or both null', () => {
    expect(validateSessionParent('primary', 'benchmark', null)).toMatch(/both/)
    expect(validateSessionParent('primary', null, 'bench-1')).toMatch(/both/)
  })
})

// ─── Repository persistence ───────────────────────────────────────────────────

describe('session metadata repository', () => {
  let dataDir: string | undefined

  afterEach(() => {
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true })
      dataDir = undefined
    }
  })

  it('openBackendDatabase initializes shared defaults and canonical runtime tables without legacy runtime tables', () => {
    const config = makeTestConfig()
    dataDir = config.dataDir

    const db = openBackendDatabase(config.sqlitePath)

    expect(db.schema.tables).toContain('session_creation_defaults')
    expect(db.schema.tables).toContain('analysis_defaults')
    expect(db.schema.tables).toContain('v2_sessions')

    for (const table of LEGACY_RUNTIME_TABLES) {
      expect(db.schema.tables).not.toContain(table)
    }

    db.connection.close()
  })

  it('persists and reads back session_type, parent_kind, parent_id', () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openBackendDatabase(config.sqlitePath)

    const ts = Date.now()
    const primary = makeSessionRecord({ id: 'PRIM', sessionType: 'primary', parentKind: null, parentId: null, createdAt: ts, updatedAt: ts })
    createSessionRecord(db.connection, primary)

    const analysis = makeSessionRecord({
      id: 'ANLZ',
      sessionType: 'session_analysis',
      parentKind: 'session',
      parentId: 'PRIM',
      createdAt: ts,
      updatedAt: ts,
    })
    createSessionRecord(db.connection, analysis)

    const readPrimary = getSessionRecord(db.connection, 'PRIM')!
    expect(readPrimary.sessionType).toBe('primary')
    expect(readPrimary.parentKind).toBeNull()
    expect(readPrimary.parentId).toBeNull()

    const readAnalysis = getSessionRecord(db.connection, 'ANLZ')!
    expect(readAnalysis.sessionType).toBe('session_analysis')
    expect(readAnalysis.parentKind).toBe('session')
    expect(readAnalysis.parentId).toBe('PRIM')

    db.connection.close()
  })

  it('createSessionRecord rejects invalid session metadata', () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openBackendDatabase(config.sqlitePath)

    expect(() => createSessionRecord(db.connection, makeSessionRecord({
      id: 'BAD1',
      sessionType: 'session_analysis',
      parentKind: null,
      parentId: null,
    }))).toThrow(/Invalid session metadata/)

    db.connection.close()
  })

  it('listSessionSummaries returns only primary sessions', () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openBackendDatabase(config.sqlitePath)

    const ts = Date.now()
    createSessionRecord(db.connection, makeSessionRecord({ id: 'PRM1', sessionType: 'primary', createdAt: ts, updatedAt: ts }))
    createSessionRecord(db.connection, makeSessionRecord({ id: 'PRM2', sessionType: 'primary', createdAt: ts + 1, updatedAt: ts + 1 }))
    createSessionRecord(db.connection, makeSessionRecord({
      id: 'ANL1',
      sessionType: 'session_analysis',
      parentKind: 'session',
      parentId: 'PRM1',
      createdAt: ts + 2,
      updatedAt: ts + 2,
    }))

    const summaries = listSessionSummaries(db.connection)
    expect(summaries.map(s => s.id)).toEqual(expect.arrayContaining(['PRM1', 'PRM2']))
    expect(summaries.find(s => s.id === 'ANL1')).toBeUndefined()

    db.connection.close()
  })

  it('listChildSessionSummaries returns children by parent', () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openBackendDatabase(config.sqlitePath)

    const ts = Date.now()
    createSessionRecord(db.connection, makeSessionRecord({ id: 'PRNT', sessionType: 'primary', createdAt: ts, updatedAt: ts }))
    createSessionRecord(db.connection, makeSessionRecord({
      id: 'CH01',
      sessionType: 'session_analysis',
      parentKind: 'session',
      parentId: 'PRNT',
      createdAt: ts + 1,
      updatedAt: ts + 1,
    }))
    createSessionRecord(db.connection, makeSessionRecord({
      id: 'CH02',
      sessionType: 'session_compaction',
      parentKind: 'session',
      parentId: 'PRNT',
      createdAt: ts + 2,
      updatedAt: ts + 2,
    }))
    createSessionRecord(db.connection, makeSessionRecord({ id: 'UNRL', sessionType: 'primary', createdAt: ts + 3, updatedAt: ts + 3 }))

    const children = listChildSessionSummaries(db.connection, 'session', 'PRNT')
    expect(children.map(c => c.id)).toEqual(['CH01', 'CH02'])
    expect(children.every(c => c.parentId === 'PRNT')).toBe(true)

    db.connection.close()
  })

  it('deleteSessionRecord cascades to session-child sessions', () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openBackendDatabase(config.sqlitePath)

    const ts = Date.now()
    createSessionRecord(db.connection, makeSessionRecord({ id: 'PRNT', sessionType: 'primary', createdAt: ts, updatedAt: ts }))
    createSessionRecord(db.connection, makeSessionRecord({
      id: 'CHLD',
      sessionType: 'session_analysis',
      parentKind: 'session',
      parentId: 'PRNT',
      createdAt: ts + 1,
      updatedAt: ts + 1,
    }))

    expect(getSessionRecord(db.connection, 'CHLD')).not.toBeNull()
    deleteSessionRecord(db.connection, 'PRNT')
    expect(getSessionRecord(db.connection, 'PRNT')).toBeNull()
    expect(getSessionRecord(db.connection, 'CHLD')).toBeNull()

    db.connection.close()
  })

  it('deleteSessionRecord cascades recursively to session descendants', () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openBackendDatabase(config.sqlitePath)

    const ts = Date.now()
    createSessionRecord(db.connection, makeSessionRecord({ id: 'ROOT', sessionType: 'primary', createdAt: ts, updatedAt: ts }))
    createSessionRecord(db.connection, makeSessionRecord({
      id: 'CHD1',
      sessionType: 'session_analysis',
      parentKind: 'session',
      parentId: 'ROOT',
      createdAt: ts + 1,
      updatedAt: ts + 1,
    }))
    createSessionRecord(db.connection, makeSessionRecord({
      id: 'GC11',
      sessionType: 'session_compaction',
      parentKind: 'session',
      parentId: 'CHD1',
      createdAt: ts + 2,
      updatedAt: ts + 2,
    }))

    deleteSessionRecord(db.connection, 'ROOT')
    expect(getSessionRecord(db.connection, 'ROOT')).toBeNull()
    expect(getSessionRecord(db.connection, 'CHD1')).toBeNull()
    expect(getSessionRecord(db.connection, 'GC11')).toBeNull()

    db.connection.close()
  })

  it('deleteSessionRecord does not cascade to benchmark-child sessions', () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openBackendDatabase(config.sqlitePath)

    const ts = Date.now()
    createSessionRecord(db.connection, makeSessionRecord({ id: 'PRM1', sessionType: 'primary', createdAt: ts, updatedAt: ts }))
    createSessionRecord(db.connection, makeSessionRecord({
      id: 'PRM2',
      sessionType: 'primary',
      parentKind: 'benchmark',
      parentId: 'BNCH',
      createdAt: ts + 1,
      updatedAt: ts + 1,
    }))

    deleteSessionRecord(db.connection, 'PRM1')
    // PRM2 has a benchmark parent (not a session parent), so it should not be deleted
    expect(getSessionRecord(db.connection, 'PRM2')).not.toBeNull()

    db.connection.close()
  })

  it('updateSessionRecord persists session_type and parent fields', () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openBackendDatabase(config.sqlitePath)

    const ts = Date.now()
    createSessionRecord(db.connection, makeSessionRecord({ id: 'UPD1', sessionType: 'primary', createdAt: ts, updatedAt: ts }))
    const record = getSessionRecord(db.connection, 'UPD1')!
    record.sessionType = 'session_analysis'
    record.parentKind = 'session'
    record.parentId = 'SOME'
    record.updatedAt = ts + 1
    updateSessionRecord(db.connection, record)

    const updated = getSessionRecord(db.connection, 'UPD1')!
    expect(updated.sessionType).toBe('session_analysis')
    expect(updated.parentKind).toBe('session')
    expect(updated.parentId).toBe('SOME')

    db.connection.close()
  })

  it('updateSessionRecord rejects invalid session metadata', () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openBackendDatabase(config.sqlitePath)

    const ts = Date.now()
    createSessionRecord(db.connection, makeSessionRecord({ id: 'UPD2', sessionType: 'primary', createdAt: ts, updatedAt: ts }))
    const record = getSessionRecord(db.connection, 'UPD2')!
    record.sessionType = 'benchmark_analysis'
    record.parentKind = 'session'
    record.parentId = 'SOME'

    expect(() => updateSessionRecord(db.connection, record)).toThrow(/Invalid session metadata/)

    db.connection.close()
  })

  it('migrated databases enforce enum checks for session metadata columns', () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    fs.mkdirSync(dataDir, { recursive: true })

    const connection = new Database(config.sqlitePath)
    connection.exec(`
      CREATE TABLE schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        init_status TEXT NOT NULL,
        model_profile_snapshot_json TEXT NOT NULL,
        mcp_profile_snapshot_json TEXT,
        loaded_context_length INTEGER,
        system_prompt_tokens INTEGER,
        tool_definitions_tokens INTEGER,
        is_context_exhausted INTEGER NOT NULL DEFAULT 0,
        compaction_strategy TEXT NOT NULL DEFAULT 'strip-reasoning',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)

    initializeBackendSchema(connection)
    validateBackendSchema(connection)

    expect(() => connection.prepare(`
      INSERT INTO sessions (
        id, title, status, init_status, session_type, parent_kind, parent_id,
        model_profile_snapshot_json, mcp_profile_snapshot_json,
        loaded_context_length, system_prompt_tokens, tool_definitions_tokens,
        is_context_exhausted, compaction_strategy, created_at, updated_at
      ) VALUES (
        'BAD2', 'Bad', 'ready', 'pending', 'invalid_type', NULL, NULL,
        '{}', NULL, NULL, NULL, NULL, 0, 'strip-reasoning', 1, 1
      )
    `).run()).toThrow()

    connection.close()
  })

  it('importTraceBundle rejects invalid imported session metadata', () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openBackendDatabase(config.sqlitePath)

    expect(() => importTraceBundle(db, {
      session: makeSessionRecord({
        id: 'IMPT',
        sessionType: 'session_analysis',
        parentKind: null,
        parentId: null,
      }),
      steps: [],
      turns: [],
      rounds: [],
      parts: [],
      rawExchanges: [],
      transcript: [],
      context: [],
    })).toThrow(/Invalid imported session metadata/)

    db.connection.close()
  })
})

// ─── API surface ──────────────────────────────────────────────────────────────

describe('session metadata API', () => {
  let app: FastifyInstance | undefined
  let dataDir: string | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true })
      dataDir = undefined
    }
  })

  it('GET /api/sessions lists only primary sessions', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    // Create a primary session
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        title: 'Primary session',
        modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      },
    })
    expect(createRes.statusCode).toBe(201)
    const primaryId = createRes.json().session.id as string

    // Insert a non-primary session directly into the DB
    const ts = Date.now()
    createSessionRecord(app.backendDb.connection, {
      id: 'ANLZ',
      title: 'Analysis session',
      status: 'ready',
      initStatus: 'pending',
      sessionType: 'session_analysis',
      parentKind: 'session',
      parentId: primaryId,
      createdAt: ts,
      updatedAt: ts,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshot: null,
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: 'strip-reasoning',
    })

    const listRes = await app.inject({ method: 'GET', url: '/api/sessions' })
    expect(listRes.statusCode).toBe(200)
    const sessionIds = listRes.json().sessions.map((s: { id: string }) => s.id)
    expect(sessionIds).toContain(primaryId)
    expect(sessionIds).not.toContain('ANLZ')
  })

  it('GET /api/sessions returns session_type in list payload', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { title: 'Primary', modelProfileSnapshot: BASE_MODEL_SNAPSHOT },
    })

    const listRes = await app.inject({ method: 'GET', url: '/api/sessions' })
    expect(listRes.statusCode).toBe(200)
    const sessions = listRes.json().sessions as Array<{ session_type: string; parent_kind: string | null; parent_id: string | null }>
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions[0]!.session_type).toBe('primary')
    expect(sessions[0]!.parent_kind).toBeNull()
    expect(sessions[0]!.parent_id).toBeNull()
  })

  it('GET /api/lookup/:id exposes session_type and parent_ref in session payload', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    // Insert a primary session
    const ts = Date.now()
    createSessionRecord(app.backendDb.connection, {
      id: 'PRNT',
      title: 'Parent session',
      status: 'ready',
      initStatus: 'ready',
      sessionType: 'primary',
      parentKind: null,
      parentId: null,
      createdAt: ts,
      updatedAt: ts,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshot: null,
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: 'strip-reasoning',
    })

    // Insert a child session
    createSessionRecord(app.backendDb.connection, {
      id: 'CHLD',
      title: 'Analysis child',
      status: 'ready',
      initStatus: 'ready',
      sessionType: 'session_analysis',
      parentKind: 'session',
      parentId: 'PRNT',
      createdAt: ts + 1,
      updatedAt: ts + 1,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshot: null,
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: 'strip-reasoning',
    })

    // Primary session lookup: no parent_ref
    const primaryLookup = await app.inject({ method: 'GET', url: '/api/lookup/PRNT' })
    expect(primaryLookup.statusCode).toBe(200)
    const primaryData = primaryLookup.json().data as Record<string, unknown>
    expect(primaryData.session_type).toBe('primary')
    expect(primaryData.parent_ref).toBeUndefined()

    // Child session lookup: has parent_ref
    const childLookup = await app.inject({ method: 'GET', url: '/api/lookup/CHLD' })
    expect(childLookup.statusCode).toBe(200)
    const childData = childLookup.json().data as Record<string, unknown>
    expect(childData.session_type).toBe('session_analysis')
    expect(childData.parent_ref).toEqual({ kind: 'session', id: 'PRNT' })
  })

  it('GET /api/sessions/:sessionId/children returns session children', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    const ts = Date.now()
    createSessionRecord(app.backendDb.connection, {
      id: 'PRNT',
      title: 'Parent',
      status: 'ready',
      initStatus: 'ready',
      sessionType: 'primary',
      parentKind: null,
      parentId: null,
      createdAt: ts,
      updatedAt: ts,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshot: null,
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: 'strip-reasoning',
    })
    createSessionRecord(app.backendDb.connection, {
      id: 'ANL1',
      title: 'Analysis 1',
      status: 'ready',
      initStatus: 'ready',
      sessionType: 'session_analysis',
      parentKind: 'session',
      parentId: 'PRNT',
      createdAt: ts + 1,
      updatedAt: ts + 1,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshot: null,
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: 'strip-reasoning',
    })

    const res = await app.inject({ method: 'GET', url: '/api/sessions/PRNT/children' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.api_version).toBe(1)
    expect(body.parent_session_id).toBe('PRNT')
    expect(body.children).toHaveLength(1)
    expect(body.children[0].id).toBe('ANL1')
    expect(body.children[0].session_type).toBe('session_analysis')
    expect(body.children[0].parent_id).toBe('PRNT')
  })

  it('GET /api/sessions/:sessionId/children returns 404 for unknown session', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    const res = await app.inject({ method: 'GET', url: '/api/sessions/XXXX/children' })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE /api/sessions/:sessionId cascades to session children', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    const ts = Date.now()
    createSessionRecord(app.backendDb.connection, {
      id: 'PRNT',
      title: 'Parent',
      status: 'ready',
      initStatus: 'ready',
      sessionType: 'primary',
      parentKind: null,
      parentId: null,
      createdAt: ts,
      updatedAt: ts,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshot: null,
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: 'strip-reasoning',
    })
    createSessionRecord(app.backendDb.connection, {
      id: 'CHLD',
      title: 'Child analysis',
      status: 'ready',
      initStatus: 'ready',
      sessionType: 'session_analysis',
      parentKind: 'session',
      parentId: 'PRNT',
      createdAt: ts + 1,
      updatedAt: ts + 1,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshot: null,
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: 'strip-reasoning',
    })

    const deleteRes = await app.inject({ method: 'DELETE', url: '/api/sessions/PRNT' })
    expect(deleteRes.statusCode).toBe(204)

    // Child should also be gone
    const childLookup = await app.inject({ method: 'GET', url: '/api/lookup/CHLD' })
    expect(childLookup.statusCode).toBe(404)
  })

  it('session_type and parent_ref appear in trace payload', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    const ts = Date.now()
    createSessionRecord(app.backendDb.connection, {
      id: 'PRNT',
      title: 'Parent',
      status: 'ready',
      initStatus: 'ready',
      sessionType: 'primary',
      parentKind: null,
      parentId: null,
      createdAt: ts,
      updatedAt: ts,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshot: null,
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: 'strip-reasoning',
    })
    createSessionRecord(app.backendDb.connection, {
      id: 'CHLD',
      title: 'Child',
      status: 'ready',
      initStatus: 'ready',
      sessionType: 'session_analysis',
      parentKind: 'session',
      parentId: 'PRNT',
      createdAt: ts + 1,
      updatedAt: ts + 1,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshot: null,
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: 'strip-reasoning',
    })

    const traceRes = await app.inject({ method: 'GET', url: '/api/sessions/CHLD/trace' })
    expect(traceRes.statusCode).toBe(200)
    const trace = traceRes.json()
    expect(trace.session.sessionType).toBe('session_analysis')
    expect(trace.session.parentKind).toBe('session')
    expect(trace.session.parentId).toBe('PRNT')
  })
})
