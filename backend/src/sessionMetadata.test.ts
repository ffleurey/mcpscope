/**
 * Session metadata foundation tests.
 *
 * Covers: schema migration, repository persistence, validation, parent/child
 * lookups, session listing, cascade delete, and API serialization of
 * session_type / parent_ref plus analysis-session metadata.
 */
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildBackendApp } from "./app.js";
import { validateSessionParent } from "./domain/sessionValidation.js";
import {
  createSessionRecord,
  deleteSessionRecord,
  getPartRecord,
  getSessionRecord,
  insertPartRecord,
  insertStepRecord,
  insertTurnRecord,
  listChildSessionSummaries,
  listSessionSummaries,
  updateSessionAnalysisState,
  updateSessionRecord,
} from "./persistence/repository.js";
import { openBackendDatabase } from "./persistence/db.js";
import { validateSchema } from "./persistence/schema.js";
import { importTraceBundle } from "./runtime/traceImport.js";
import { insertJsonArtifact } from "./analysis/artifactRepository.js";
import { SCHEMA_KEY } from "./analysis/schemas.js";
import { stepTypeKey } from "./domain/executionModel.js";
import { DEFAULT_MAX_TOOL_ROUNDS } from "./domain/model.js";
import type { PartRecord } from "./domain/model.js";
import type { StepPersistenceRecord } from "./domain/persistenceContract.js";

const RUNTIME_TABLES = [
  "sessions",
  "steps",
  "turns",
  "rounds",
  "parts",
  "raw_exchanges",
  "artifacts",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTestConfig() {
  const dataDir = `.tmp-test-data/${crypto.randomUUID()}`;
  return {
    host: "127.0.0.1",
    port: 3066,
    corsOrigin: true as const,
    dataDir,
    sqlitePath: `${dataDir}/test.db`,
    maxToolRounds: 5,
    appVersion: "test",
  };
}

const BASE_MODEL_SNAPSHOT = {
  id: "model-1",
  name: "Model",
  connectionBaseUrl: "https://example.com/v1",
  apiKey: null,
  modelKey: "model-key",
  modelDisplayName: "Model Key",
  systemPrompt: "You are exact.",
  temperature: 0,
  reasoning: "on" as const,
  createdAt: 1,
  updatedAt: 1,
};

function makeSessionRecord(
  overrides: Partial<Parameters<typeof createSessionRecord>[1]> = {},
): Parameters<typeof createSessionRecord>[1] {
  const ts = Date.now();
  return {
    id: `TEST`,
    title: "Test session",
    status: "ready",
    initStatus: "pending",
    sessionType: "primary",
    parentKind: null,
    parentId: null,
    createdAt: ts,
    updatedAt: ts,
    modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
    mcpProfileSnapshots: [],
    loadedContextLength: null,
    systemPromptTokens: null,
    toolDefinitionsTokens: null,
    isContextExhausted: false,
    compactionStrategy: "strip-reasoning",
    ...overrides,
  };
}

function makeStepRecord(
  overrides: Partial<StepPersistenceRecord> &
    Pick<
      StepPersistenceRecord,
      "id" | "sessionId" | "stepTypeKey" | "childIndex"
    >,
): StepPersistenceRecord {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId,
    stepTypeKey: overrides.stepTypeKey,
    parentStepId: null,
    childIndex: overrides.childIndex,
    status: overrides.status ?? "complete",
    params: overrides.params ?? {},
    state: overrides.state ?? {},
    createdAt: overrides.createdAt ?? 1,
    completedAt: overrides.completedAt ?? 1,
  };
}

function makePartRecord(
  overrides: Partial<PartRecord> &
    Pick<PartRecord, "id" | "sessionId" | "ordinal" | "partType">,
): PartRecord {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId,
    turnId: overrides.turnId ?? null,
    roundId: overrides.roundId ?? null,
    parentPartId: overrides.parentPartId ?? null,
    ordinal: overrides.ordinal,
    partType: overrides.partType,
    roleLabel: overrides.roleLabel ?? null,
    payload: overrides.payload ?? {
      text: null,
      json: null,
      mimeType: null,
      summary: null,
    },
    display: overrides.display ?? {
      state: "transcript",
      collapsedByDefault: false,
    },
    context: overrides.context ?? {
      state: "included",
      note: null,
      strippedByCompactionAtTurnId: null,
    },
    tokens: overrides.tokens ?? {
      count: null,
      source: "unknown",
      confidence: "unknown",
      note: null,
    },
    provenanceJson: overrides.provenanceJson ?? null,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

// ─── Validation rules ─────────────────────────────────────────────────────────

describe("session type / parent validation", () => {
  it("primary with no parent is valid", () => {
    expect(validateSessionParent("primary", null, null)).toBeNull();
  });

  it("primary with benchmark parent is valid", () => {
    expect(validateSessionParent("primary", "benchmark", "bench-1")).toBeNull();
  });

  it("primary with session parent is rejected", () => {
    expect(validateSessionParent("primary", "session", "sess-1")).toMatch(
      /benchmark/,
    );
  });

  it("session_analysis with session parent is valid", () => {
    expect(
      validateSessionParent("session_analysis", "session", "sess-1"),
    ).toBeNull();
  });

  it("session_analysis without parent is rejected", () => {
    expect(validateSessionParent("session_analysis", null, null)).toMatch(
      /require a parent/,
    );
  });

  it("session_analysis with benchmark parent is rejected", () => {
    expect(
      validateSessionParent("session_analysis", "benchmark", "bench-1"),
    ).toMatch(/session/);
  });

  it("parent_kind and parent_id must both be set or both null", () => {
    expect(validateSessionParent("primary", "benchmark", null)).toMatch(/both/);
    expect(validateSessionParent("primary", null, "bench-1")).toMatch(/both/);
  });
});

// ─── Repository persistence ───────────────────────────────────────────────────

describe("session metadata repository", () => {
  let dataDir: string | undefined;

  afterEach(() => {
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
  });

  it("openBackendDatabase initializes shared defaults and the runtime tables", () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;

    const db = openBackendDatabase(config.sqlitePath);

    for (const table of RUNTIME_TABLES) {
      expect(db.schema.tables).toContain(table);
    }

    expect(() => validateSchema(db.connection)).not.toThrow();

    db.connection.close();
  });

  it("persists and reads back session_type, parent_kind, parent_id", () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    const db = openBackendDatabase(config.sqlitePath);

    const ts = Date.now();
    const primary = makeSessionRecord({
      id: "PRIM",
      sessionType: "primary",
      parentKind: null,
      parentId: null,
      createdAt: ts,
      updatedAt: ts,
    });
    createSessionRecord(db.connection, primary);

    const analysis = makeSessionRecord({
      id: "ANLZ",
      sessionType: "session_analysis",
      parentKind: "session",
      parentId: "PRIM",
      createdAt: ts,
      updatedAt: ts,
    });
    createSessionRecord(db.connection, analysis);

    const readPrimary = getSessionRecord(db.connection, "PRIM")!;
    expect(readPrimary.sessionType).toBe("primary");
    expect(readPrimary.parentKind).toBeNull();
    expect(readPrimary.parentId).toBeNull();

    const readAnalysis = getSessionRecord(db.connection, "ANLZ")!;
    expect(readAnalysis.sessionType).toBe("session_analysis");
    expect(readAnalysis.parentKind).toBe("session");
    expect(readAnalysis.parentId).toBe("PRIM");

    db.connection.close();
  });

  it("persists and reads back a session init error", () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    const db = openBackendDatabase(config.sqlitePath);

    createSessionRecord(
      db.connection,
      makeSessionRecord({
        id: "FAIL",
        initStatus: "error",
        initError: {
          errorKind: "mcp_init_error",
          message: "fetch failed — initializing MCP server 'HA Oslo'",
        },
      }),
    );

    const read = getSessionRecord(db.connection, "FAIL")!;
    expect(read.initStatus).toBe("error");
    expect(read.initError).toEqual({
      errorKind: "mcp_init_error",
      message: "fetch failed — initializing MCP server 'HA Oslo'",
    });

    // A session with no init failure round-trips with no initError.
    createSessionRecord(db.connection, makeSessionRecord({ id: "OKAY" }));
    expect(getSessionRecord(db.connection, "OKAY")!.initError ?? null).toBeNull();

    db.connection.close();
  });

  it("persists an explicit maxToolRounds and defaults old rows on read", () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    const db = openBackendDatabase(config.sqlitePath);

    // Explicit budget round-trips through the params JSON.
    createSessionRecord(
      db.connection,
      makeSessionRecord({ id: "BUDG", maxToolRounds: 7 }),
    );
    expect(getSessionRecord(db.connection, "BUDG")!.maxToolRounds).toBe(7);

    // A record written without the field (an "old" row) reads back as the
    // default rather than undefined — the backward-compat fallback on read.
    createSessionRecord(db.connection, makeSessionRecord({ id: "OLDR" }));
    expect(getSessionRecord(db.connection, "OLDR")!.maxToolRounds).toBe(
      DEFAULT_MAX_TOOL_ROUNDS,
    );

    db.connection.close();
  });

  it("createSessionRecord rejects invalid session metadata", () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    const db = openBackendDatabase(config.sqlitePath);

    expect(() =>
      createSessionRecord(
        db.connection,
        makeSessionRecord({
          id: "BAD1",
          sessionType: "session_analysis",
          parentKind: null,
          parentId: null,
        }),
      ),
    ).toThrow(/Invalid session metadata/);

    db.connection.close();
  });

  it("listSessionSummaries returns only primary sessions", () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    const db = openBackendDatabase(config.sqlitePath);

    const ts = Date.now();
    createSessionRecord(
      db.connection,
      makeSessionRecord({
        id: "PRM1",
        sessionType: "primary",
        createdAt: ts,
        updatedAt: ts,
      }),
    );
    createSessionRecord(
      db.connection,
      makeSessionRecord({
        id: "PRM2",
        sessionType: "primary",
        createdAt: ts + 1,
        updatedAt: ts + 1,
      }),
    );
    createSessionRecord(
      db.connection,
      makeSessionRecord({
        id: "ANL1",
        sessionType: "session_analysis",
        parentKind: "session",
        parentId: "PRM1",
        createdAt: ts + 2,
        updatedAt: ts + 2,
      }),
    );

    const summaries = listSessionSummaries(db.connection);
    expect(summaries.map((s) => s.id)).toEqual(
      expect.arrayContaining(["PRM1", "PRM2"]),
    );
    expect(summaries.find((s) => s.id === "ANL1")).toBeUndefined();

    db.connection.close();
  });

  it("listChildSessionSummaries returns children by parent", () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    const db = openBackendDatabase(config.sqlitePath);

    const ts = Date.now();
    createSessionRecord(
      db.connection,
      makeSessionRecord({
        id: "PRNT",
        sessionType: "primary",
        createdAt: ts,
        updatedAt: ts,
      }),
    );
    createSessionRecord(
      db.connection,
      makeSessionRecord({
        id: "CH01",
        sessionType: "session_analysis",
        parentKind: "session",
        parentId: "PRNT",
        createdAt: ts + 1,
        updatedAt: ts + 1,
      }),
    );
    createSessionRecord(
      db.connection,
      makeSessionRecord({
        id: "UNRL",
        sessionType: "primary",
        createdAt: ts + 3,
        updatedAt: ts + 3,
      }),
    );

    const children = listChildSessionSummaries(
      db.connection,
      "session",
      "PRNT",
    );
    expect(children.map((c) => c.id)).toEqual(["CH01"]);
    expect(children.every((c) => c.parentId === "PRNT")).toBe(true);

    db.connection.close();
  });

  it("deleteSessionRecord cascades to session-child sessions", () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    const db = openBackendDatabase(config.sqlitePath);

    const ts = Date.now();
    createSessionRecord(
      db.connection,
      makeSessionRecord({
        id: "PRNT",
        sessionType: "primary",
        createdAt: ts,
        updatedAt: ts,
      }),
    );
    createSessionRecord(
      db.connection,
      makeSessionRecord({
        id: "CHLD",
        sessionType: "session_analysis",
        parentKind: "session",
        parentId: "PRNT",
        createdAt: ts + 1,
        updatedAt: ts + 1,
      }),
    );

    expect(getSessionRecord(db.connection, "CHLD")).not.toBeNull();
    deleteSessionRecord(db.connection, "PRNT");
    expect(getSessionRecord(db.connection, "PRNT")).toBeNull();
    expect(getSessionRecord(db.connection, "CHLD")).toBeNull();

    db.connection.close();
  });

  it("deleteSessionRecord cascades recursively to session descendants", () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    const db = openBackendDatabase(config.sqlitePath);

    const ts = Date.now();
    createSessionRecord(
      db.connection,
      makeSessionRecord({
        id: "ROOT",
        sessionType: "primary",
        createdAt: ts,
        updatedAt: ts,
      }),
    );
    createSessionRecord(
      db.connection,
      makeSessionRecord({
        id: "CHD1",
        sessionType: "session_analysis",
        parentKind: "session",
        parentId: "ROOT",
        createdAt: ts + 1,
        updatedAt: ts + 1,
      }),
    );
    createSessionRecord(
      db.connection,
      makeSessionRecord({
        id: "GC11",
        sessionType: "session_analysis",
        parentKind: "session",
        parentId: "CHD1",
        createdAt: ts + 2,
        updatedAt: ts + 2,
      }),
    );

    deleteSessionRecord(db.connection, "ROOT");
    expect(getSessionRecord(db.connection, "ROOT")).toBeNull();
    expect(getSessionRecord(db.connection, "CHD1")).toBeNull();
    expect(getSessionRecord(db.connection, "GC11")).toBeNull();

    db.connection.close();
  });

  it("deleteSessionRecord does not cascade to benchmark-child sessions", () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    const db = openBackendDatabase(config.sqlitePath);

    const ts = Date.now();
    createSessionRecord(
      db.connection,
      makeSessionRecord({
        id: "PRM1",
        sessionType: "primary",
        createdAt: ts,
        updatedAt: ts,
      }),
    );
    createSessionRecord(
      db.connection,
      makeSessionRecord({
        id: "PRM2",
        sessionType: "primary",
        parentKind: "benchmark",
        parentId: "BNCH",
        createdAt: ts + 1,
        updatedAt: ts + 1,
      }),
    );

    deleteSessionRecord(db.connection, "PRM1");
    // PRM2 has a benchmark parent (not a session parent), so it should not be deleted
    expect(getSessionRecord(db.connection, "PRM2")).not.toBeNull();

    db.connection.close();
  });

  it("updateSessionRecord persists session_type and parent fields", () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    const db = openBackendDatabase(config.sqlitePath);

    const ts = Date.now();
    createSessionRecord(
      db.connection,
      makeSessionRecord({
        id: "UPD1",
        sessionType: "primary",
        createdAt: ts,
        updatedAt: ts,
      }),
    );
    const record = getSessionRecord(db.connection, "UPD1")!;
    record.sessionType = "session_analysis";
    record.parentKind = "session";
    record.parentId = "SOME";
    record.updatedAt = ts + 1;
    updateSessionRecord(db.connection, record);

    const updated = getSessionRecord(db.connection, "UPD1")!;
    expect(updated.sessionType).toBe("session_analysis");
    expect(updated.parentKind).toBe("session");
    expect(updated.parentId).toBe("SOME");

    db.connection.close();
  });

  it("updateSessionRecord rejects invalid session metadata", () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    const db = openBackendDatabase(config.sqlitePath);

    const ts = Date.now();
    createSessionRecord(
      db.connection,
      makeSessionRecord({
        id: "UPD2",
        sessionType: "primary",
        createdAt: ts,
        updatedAt: ts,
      }),
    );
    const record = getSessionRecord(db.connection, "UPD2")!;
    record.sessionType = "session_analysis";
    record.parentKind = "benchmark";
    record.parentId = "SOME";

    expect(() => updateSessionRecord(db.connection, record)).toThrow(
      /Invalid session metadata/,
    );

    db.connection.close();
  });

  it("importTraceBundle rejects invalid imported session metadata", () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    const db = openBackendDatabase(config.sqlitePath);

    expect(() =>
      importTraceBundle(db, {
        session: makeSessionRecord({
          id: "IMPT",
          sessionType: "session_analysis",
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
      }),
    ).toThrow(/Invalid imported session metadata/);

    db.connection.close();
  });
});

// ─── API surface ──────────────────────────────────────────────────────────────

describe("session metadata API", () => {
  let app: FastifyInstance | undefined;
  let dataDir: string | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
  });

  it("GET /api/sessions includes analysis sessions and their failure metadata", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    app = await buildBackendApp(config);

    // Create a primary session
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        title: "Primary session",
        modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const primaryId = createRes.json().session.id as string;

    // Insert a failed analysis session directly into the DB.
    const ts = Date.now();
    createSessionRecord(app.backendDb.connection, {
      id: "ANLZ",
      title: "Fast session analysis",
      status: "ready",
      initStatus: "ready",
      sessionType: "session_analysis",
      parentKind: "session",
      parentId: primaryId,
      createdAt: ts,
      updatedAt: ts,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshots: [],
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: "strip-reasoning",
    });
    updateSessionAnalysisState(app.backendDb.connection, "ANLZ", {
      phase: "error",
      analysisSessionId: "ANLZ",
      targetSessionId: "PRNT",
      targetTurnId: "",
      analysisGoal: "",
      selectedToolNames: [],
      onlyFailedToolCalls: false,
      evaluationCriteria: [],
      workflow_kind: "fast_session_analysis",
    });

    insertStepRecord(
      app.backendDb.connection,
      makeStepRecord({
        id: "ANLZ.3W",
        sessionId: "ANLZ",
        stepTypeKey: stepTypeKey("analysis_tool_call_assessment"),
        childIndex: 3,
        status: "error",
        createdAt: ts + 2,
        completedAt: ts + 2,
      }),
    );
    insertJsonArtifact(app.backendDb.connection, {
      id: "artifact-1",
      sessionId: "ANLZ",
      stepId: "ANLZ.3W",
      content: {
        step_type: "fast_tool_call_assessment",
        error_kind: "schema_validation_error",
        message: "Fast assessment response did not match fast schema",
      },
      metadata: {
        schema_key: SCHEMA_KEY.DIAGNOSTIC,
      },
      createdAt: ts + 3,
    });

    const listRes = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(listRes.statusCode).toBe(200);
    const sessions = listRes.json().sessions as Array<{
      id: string;
      status: string;
      workflow_kind?: string;
      latest_error?: {
        message: string;
        error_kind: string | null;
        step_id: string | null;
      };
    }>;
    const sessionIds = sessions.map((s) => s.id);
    expect(sessionIds).toContain(primaryId);
    expect(sessionIds).toContain("ANLZ");
    expect(sessions).toContainEqual(
      expect.objectContaining({
        id: "ANLZ",
        status: "error",
        workflow_kind: "fast_session_analysis",
        latest_error: {
          step_id: "ANLZ.3W",
          error_kind: "schema_validation_error",
          message: "Fast assessment response did not match fast schema",
        },
      }),
    );

    const statusRes = await app.inject({
      method: "GET",
      url: "/api/sessions/ANLZ/status",
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json()).toMatchObject({
      session: {
        id: "ANLZ",
        state: "error",
        workflow_kind: "fast_session_analysis",
        latest_error: {
          step_id: "ANLZ.3W",
          error_kind: "schema_validation_error",
          message: "Fast assessment response did not match fast schema",
        },
      },
    });
  });

  it("GET /api/sessions returns session_type in list payload", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    app = await buildBackendApp(config);

    await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "Primary", modelProfileSnapshot: BASE_MODEL_SNAPSHOT },
    });

    const listRes = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(listRes.statusCode).toBe(200);
    const sessions = listRes.json().sessions as Array<{
      session_type: string;
      parent_kind: string | null;
      parent_id: string | null;
    }>;
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]!.session_type).toBe("primary");
    expect(sessions[0]!.parent_kind).toBeNull();
    expect(sessions[0]!.parent_id).toBeNull();
  });

  it("GET /api/lookup/:id exposes session_type and parent_ref in session payload", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    app = await buildBackendApp(config);

    // Insert a primary session
    const ts = Date.now();
    createSessionRecord(app.backendDb.connection, {
      id: "PRNT",
      title: "Parent session",
      status: "ready",
      initStatus: "ready",
      sessionType: "primary",
      parentKind: null,
      parentId: null,
      createdAt: ts,
      updatedAt: ts,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshots: [],
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: "strip-reasoning",
    });

    // Insert a child session
    createSessionRecord(app.backendDb.connection, {
      id: "CHLD",
      title: "Analysis child",
      status: "ready",
      initStatus: "ready",
      sessionType: "session_analysis",
      parentKind: "session",
      parentId: "PRNT",
      createdAt: ts + 1,
      updatedAt: ts + 1,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshots: [],
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: "strip-reasoning",
    });

    // Primary session lookup: no parent_ref
    const primaryLookup = await app.inject({
      method: "GET",
      url: "/api/lookup/PRNT",
    });
    expect(primaryLookup.statusCode).toBe(200);
    const primaryData = primaryLookup.json().data as Record<string, unknown>;
    expect(primaryData.session_type).toBe("primary");
    expect(primaryData.parent_ref).toBeUndefined();

    // Child session lookup: has parent_ref
    const childLookup = await app.inject({
      method: "GET",
      url: "/api/lookup/CHLD",
    });
    expect(childLookup.statusCode).toBe(200);
    const childData = childLookup.json().data as Record<string, unknown>;
    expect(childData.session_type).toBe("session_analysis");
    expect(childData.parent_ref).toEqual({ kind: "session", id: "PRNT" });
  });

  it("GET /api/sessions/:sessionId/children returns session children", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    app = await buildBackendApp(config);

    const ts = Date.now();
    createSessionRecord(app.backendDb.connection, {
      id: "PRNT",
      title: "Parent",
      status: "ready",
      initStatus: "ready",
      sessionType: "primary",
      parentKind: null,
      parentId: null,
      createdAt: ts,
      updatedAt: ts,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshots: [],
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: "strip-reasoning",
    });
    createSessionRecord(app.backendDb.connection, {
      id: "ANL1",
      title: "Analysis 1",
      status: "ready",
      initStatus: "ready",
      sessionType: "session_analysis",
      parentKind: "session",
      parentId: "PRNT",
      createdAt: ts + 1,
      updatedAt: ts + 1,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshots: [],
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: "strip-reasoning",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/sessions/PRNT/children",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.api_version).toBe(1);
    expect(body.parent_session_id).toBe("PRNT");
    expect(body.children).toHaveLength(1);
    expect(body.children[0].id).toBe("ANL1");
    expect(body.children[0].session_type).toBe("session_analysis");
    expect(body.children[0].parent_id).toBe("PRNT");
  });

  it("GET /api/lookup and retry-failed-step expose and reset failed analysis sessions", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    app = await buildBackendApp(config);

    const ts = Date.now();
    createSessionRecord(app.backendDb.connection, {
      id: "PRNT",
      title: "Parent",
      status: "ready",
      initStatus: "ready",
      sessionType: "primary",
      parentKind: null,
      parentId: null,
      createdAt: ts,
      updatedAt: ts,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshots: [],
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: "strip-reasoning",
    });
    createSessionRecord(app.backendDb.connection, {
      id: "ANLZ",
      title: "Fast session analysis",
      status: "ready",
      initStatus: "ready",
      sessionType: "session_analysis",
      parentKind: "session",
      parentId: "PRNT",
      createdAt: ts + 1,
      updatedAt: ts + 1,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshots: [],
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: "strip-reasoning",
    });
    updateSessionAnalysisState(app.backendDb.connection, "ANLZ", {
      phase: "error",
      analysisSessionId: "ANLZ",
      targetSessionId: "PRNT",
      targetTurnId: "",
      analysisGoal: "",
      selectedToolNames: [],
      onlyFailedToolCalls: false,
      evaluationCriteria: [],
      workflow_kind: "fast_session_analysis",
    });

    // A completed bootstrap step with its artifact.
    insertStepRecord(
      app.backendDb.connection,
      makeStepRecord({
        id: "ANLZ.1W",
        sessionId: "ANLZ",
        stepTypeKey: stepTypeKey("analysis_bootstrap"),
        childIndex: 1,
        status: "complete",
        createdAt: ts + 1,
        completedAt: ts + 2,
      }),
    );
    insertJsonArtifact(app.backendDb.connection, {
      id: "artifact-idx",
      sessionId: "ANLZ",
      stepId: "ANLZ.1W",
      content: {
        packets: [],
        analysisTarget: {
          target_session_id: "PRNT",
          target_turn_id: "",
          analysis_goal: "",
          selected_tool_names: [],
          only_failed_tool_calls: false,
          evaluation_criteria: [],
          analyzed_turn_ids: [],
          target_mcp_instructions_part_id: null,
          target_tool_definitions_part_id: null,
          user_request_part_id: null,
          final_answer_part_id: null,
        },
      },
      metadata: { schema_key: SCHEMA_KEY.EVIDENCE_PACKET_INDEX },
      createdAt: ts + 2,
    });
    insertJsonArtifact(app.backendDb.connection, {
      id: "artifact-target",
      sessionId: "ANLZ",
      stepId: "ANLZ.1W",
      content: {
        target_session_id: "PRNT",
        target_turn_id: "",
        analysis_goal: "",
        selected_tool_names: [],
        only_failed_tool_calls: false,
        evaluation_criteria: [],
        analyzed_turn_ids: [],
        target_mcp_instructions_part_id: null,
        target_tool_definitions_part_id: null,
        user_request_part_id: null,
        final_answer_part_id: null,
      },
      metadata: { schema_key: SCHEMA_KEY.ANALYSIS_TARGET },
      createdAt: ts + 2,
    });

    insertStepRecord(
      app.backendDb.connection,
      makeStepRecord({
        id: "ANLZ.3W",
        sessionId: "ANLZ",
        stepTypeKey: stepTypeKey("analysis_tool_call_assessment"),
        childIndex: 3,
        status: "error",
        createdAt: ts + 3,
        completedAt: ts + 3,
      }),
    );
    insertJsonArtifact(app.backendDb.connection, {
      id: "artifact-2",
      sessionId: "ANLZ",
      stepId: "ANLZ.3W",
      content: {
        step_type: "fast_tool_call_assessment",
        error_kind: "schema_validation_error",
        message: "Fast assessment response did not match fast schema",
      },
      metadata: {
        schema_key: SCHEMA_KEY.DIAGNOSTIC,
      },
      createdAt: ts + 4,
    });

    insertTurnRecord(app.backendDb.connection, {
      id: "ANLZ.1",
      sessionId: "ANLZ",
      ownerStepId: "ANLZ.3W",
      turnNumber: 1,
      status: "complete",
      createdAt: ts + 5,
      completedAt: ts + 5,
      outcome: "model-response",
      usage: {
        promptTokens: null,
        completionTokens: null,
        reasoningTokens: null,
        totalTokens: null,
      },
      contextTokensAtTurnEnd: null,
      contextTokensAfterCompaction: null,
      compactionApplied: "strip-reasoning",
      compactionTokensRemoved: null,
    });
    insertPartRecord(
      app.backendDb.connection,
      makePartRecord({
        id: "ANLZ.1.1.1-A",
        sessionId: "ANLZ",
        turnId: "ANLZ.1",
        ordinal: 1,
        partType: "assistant-content",
        roleLabel: "assistant",
        payload: {
          text: '{"bad":"payload"}',
          json: null,
          mimeType: "text/plain",
          summary: null,
        },
        createdAt: ts + 5,
        updatedAt: ts + 5,
      }),
    );

    const lookupRes = await app.inject({
      method: "GET",
      url: "/api/lookup/ANLZ",
    });
    expect(lookupRes.statusCode).toBe(200);
    expect(lookupRes.json()).toMatchObject({
      id: "ANLZ",
      type: "session",
      data: {
        workflow_kind: "fast_session_analysis",
        workflow_label: "Fast Session Analysis",
        latest_error: {
          step_id: "ANLZ.3W",
          error_kind: "schema_validation_error",
          message: "Fast assessment response did not match fast schema",
        },
      },
    });

    const retryRes = await app.inject({
      method: "POST",
      url: "/api/sessions/ANLZ/retry-failed-step",
    });
    expect(retryRes.statusCode).toBe(200);
    const retryBody = retryRes.json() as Record<string, unknown>;
    expect(retryBody.session_id).toBe("ANLZ");
    expect(retryBody.failed_step_id).toBe("ANLZ.3W");
    expect(retryBody.retry_phase).toBe("final_aggregation");

    const retriedSession = getSessionRecord(app.backendDb.connection, "ANLZ");
    const retriedState = retriedSession?.analysisState as
      | Record<string, unknown>
      | undefined;
    expect(retriedState?.phase).toBe("final_aggregation"); // plan-derived: after cascade, final aggregation is next
    expect(retriedState?.retry_failed_step_id).toBe("ANLZ.3W");

    const retriedPart = getPartRecord(app.backendDb.connection, "ANLZ.1.1.1-A");
    expect(retriedPart?.context.state).toBe("excluded");
  });

  it("GET /api/sessions/:sessionId/children returns 404 for unknown session", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    app = await buildBackendApp(config);

    const res = await app.inject({
      method: "GET",
      url: "/api/sessions/XXXX/children",
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /api/sessions/:sessionId cascades to session children", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    app = await buildBackendApp(config);

    const ts = Date.now();
    createSessionRecord(app.backendDb.connection, {
      id: "PRNT",
      title: "Parent",
      status: "ready",
      initStatus: "ready",
      sessionType: "primary",
      parentKind: null,
      parentId: null,
      createdAt: ts,
      updatedAt: ts,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshots: [],
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: "strip-reasoning",
    });
    createSessionRecord(app.backendDb.connection, {
      id: "CHLD",
      title: "Child analysis",
      status: "ready",
      initStatus: "ready",
      sessionType: "session_analysis",
      parentKind: "session",
      parentId: "PRNT",
      createdAt: ts + 1,
      updatedAt: ts + 1,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshots: [],
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: "strip-reasoning",
    });

    const deleteRes = await app.inject({
      method: "DELETE",
      url: "/api/sessions/PRNT",
    });
    expect(deleteRes.statusCode).toBe(204);

    // Child should also be gone
    const childLookup = await app.inject({
      method: "GET",
      url: "/api/lookup/CHLD",
    });
    expect(childLookup.statusCode).toBe(404);
  });

  it("session_type and parent_ref appear in trace payload", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    app = await buildBackendApp(config);

    const ts = Date.now();
    createSessionRecord(app.backendDb.connection, {
      id: "PRNT",
      title: "Parent",
      status: "ready",
      initStatus: "ready",
      sessionType: "primary",
      parentKind: null,
      parentId: null,
      createdAt: ts,
      updatedAt: ts,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshots: [],
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: "strip-reasoning",
    });
    createSessionRecord(app.backendDb.connection, {
      id: "CHLD",
      title: "Child",
      status: "ready",
      initStatus: "ready",
      sessionType: "session_analysis",
      parentKind: "session",
      parentId: "PRNT",
      createdAt: ts + 1,
      updatedAt: ts + 1,
      modelProfileSnapshot: BASE_MODEL_SNAPSHOT,
      mcpProfileSnapshots: [],
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: "strip-reasoning",
    });

    const traceRes = await app.inject({
      method: "GET",
      url: "/api/sessions/CHLD/trace",
    });
    expect(traceRes.statusCode).toBe(200);
    const trace = traceRes.json();
    expect(trace.session.sessionType).toBe("session_analysis");
    expect(trace.session.parentKind).toBe("session");
    expect(trace.session.parentId).toBe("PRNT");
  });
});
