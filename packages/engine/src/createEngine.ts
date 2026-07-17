/**
 * createEngine — the standalone, in-process entry point for embedding the
 * mcpscope chat/session engine without the workbench's HTTP app.
 *
 * It assembles the same runtime `buildBackendApp` builds (database, config
 * store, scheduler, default LM/MCP gateways, and an OperationContext) minus
 * Fastify, benchmark, and analysis — and exposes thin methods over the existing
 * operations. The host app owns auth, users, and transport; the engine owns
 * sessions, turns, tool-calling, persistence, and transparency events.
 */
import { openBackendDatabase, type BackendDatabase } from "./persistence/db.js";
import {
  recoverInterruptedState,
  getSessionRecord,
  listStepRecordsBySession,
  listTurnRecordsBySession,
  listRoundRecordsBySession,
  listPartRecordsBySession,
  listRawExchangeRecordsBySession,
} from "./persistence/repository.js";
import { ConfigStore } from "./config/configStore.js";
import { ExecutionScheduler } from "./runtime/scheduler.js";
import type {
  SchedulerEvent,
  SchedulerEventListener,
} from "./runtime/schedulerTypes.js";
import { withAutoModelSwap } from "./runtime/autoModelSwapGateway.js";
import type { ChatCompletionGateway } from "./runtime/modelTurns.js";
import type { McpGateway } from "./runtime/toolTurns.js";
import {
  createChatCompletion,
  streamChatCompletion,
  probePromptTokens,
  probePromptTokensDetailed,
} from "./services/openai/client.js";
import { getLoadedContextLength } from "./services/lmstudio/client.js";
import {
  initializeMcpSession,
  listMcpTools,
  callMcpTool,
} from "./services/mcp/httpClient.js";
import type { OperationContext } from "./operations/context.js";
import { createOperation, type CreateInput, type CreateResult } from "./operations/create.js";
import { sendOperation, type SendInput, type SendResult } from "./operations/send.js";
import { statusOperation, type StatusInput, type StatusResult } from "./operations/status.js";
import { listOperation, type ListResult } from "./operations/list.js";
import { inspectOperation, type InspectInput, type InspectResult } from "./operations/inspect.js";
import { buildSessionTraceBundle, type SessionTraceBundle } from "./domain/trace.js";
import { deriveTranscriptEntries, deriveContextEntries } from "./domain/selectors.js";
import { DEFAULT_MAX_TOOL_ROUNDS } from "./domain/model.js";
import type {
  LmStudioConnection,
  ModelConfig,
  McpServerProfile,
} from "./domain/configuration.js";
import type { SessionCreationDefaults } from "./config/configStore.js";

/** Where the engine persists sessions/transcripts. */
export type EngineStorage = { sqlitePath: string } | { memory: true };

/** Programmatic configuration applied after any `configPath` load. */
export interface EngineConfigSeed {
  lmConnections?: LmStudioConnection[];
  modelConfigs?: ModelConfig[];
  mcpProfiles?: McpServerProfile[];
  sessionCreationDefaults?: SessionCreationDefaults;
}

export interface CreateEngineOptions {
  /** SQLite file path, or `{ memory: true }` for an in-memory database. */
  storage: EngineStorage;
  /**
   * Load configuration from a mcpscope.config.json file. Omit for a purely
   * programmatic engine (config stays in-memory, no file is written).
   */
  configPath?: string;
  /** Programmatic config, applied after `configPath` (if any). */
  config?: EngineConfigSeed;
  /** Max model↔tool rounds per turn. Defaults to the engine's DEFAULT_MAX_TOOL_ROUNDS. */
  maxToolRounds?: number;
  /** Background error logger. */
  logger?: { error: (data: Record<string, unknown>, msg: string) => void };
  /** Override the default LM/MCP gateways (e.g. for tests). */
  dependencies?: {
    chatCompletionGateway?: ChatCompletionGateway;
    mcpGateway?: McpGateway;
  };
}

/** In-process engine handle. */
export interface Engine {
  /** The assembled operation context (advanced use / custom operations). */
  readonly opCtx: OperationContext;
  /** The execution scheduler owning turn ordering and events. */
  readonly scheduler: ExecutionScheduler;
  /** The instance-owned configuration store. */
  readonly config: ConfigStore;

  createSession(input: CreateInput): Promise<CreateResult>;
  send(input: SendInput): Promise<SendResult>;
  status(input: StatusInput): Promise<StatusResult>;
  listSessions(): Promise<ListResult>;
  inspect(input: InspectInput): Promise<InspectResult>;
  /** Full trace bundle (transcript + context views + per-part tokens) for a session. */
  getTrace(sessionId: string): SessionTraceBundle | null;
  /** Subscribe to scheduler/turn events. Returns an unsubscribe function. */
  onEvent(listener: SchedulerEventListener): () => void;
  /** Abort the active job, if any. */
  abortActive(): boolean;
  /** Close the database connection. */
  close(): void;
}

function resolveSqlitePath(storage: EngineStorage): string {
  return "memory" in storage ? ":memory:" : storage.sqlitePath;
}

/**
 * Assemble an in-process engine. Registers no HTTP surface and imports no
 * benchmark/analysis code; the `primary` session executor is registered by the
 * scheduler-dispatch module on import.
 */
export async function createEngine(options: CreateEngineOptions): Promise<Engine> {
  const database: BackendDatabase = openBackendDatabase(resolveSqlitePath(options.storage));
  recoverInterruptedState(database.connection);

  // Config store: file-backed when configPath is given, else purely in-memory.
  const configStore = new ConfigStore(options.configPath ?? ":memory:");
  configStore.load();
  if (options.config) {
    for (const c of options.config.lmConnections ?? []) configStore.upsertLmConnection(c);
    for (const m of options.config.modelConfigs ?? []) configStore.upsertModelConfig(m);
    for (const p of options.config.mcpProfiles ?? []) configStore.upsertMcpServerProfile(p);
    if (options.config.sessionCreationDefaults) {
      configStore.upsertSessionCreationDefaults(options.config.sessionCreationDefaults);
    }
  }

  const scheduler = new ExecutionScheduler();

  const chatCompletionGateway =
    options.dependencies?.chatCompletionGateway ??
    withAutoModelSwap(
      {
        createChatCompletion,
        streamChatCompletion,
        probePromptTokens,
        probePromptTokensDetailed,
        getLoadedContextLength,
      },
      { listConnections: () => configStore.listLmConnections() },
    );
  const mcpGateway: McpGateway = options.dependencies?.mcpGateway ?? {
    initializeSession: initializeMcpSession,
    listTools: listMcpTools,
    callTool: callMcpTool,
  };

  const opCtx: OperationContext = {
    db: database,
    configStore,
    chatCompletionGateway,
    mcpGateway,
    maxToolRounds: options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS,
    scheduler,
    ...(options.logger ? { logger: options.logger } : {}),
  };

  return {
    opCtx,
    scheduler,
    config: configStore,
    createSession: (input) => createOperation.execute(opCtx, input),
    send: (input) => sendOperation.execute(opCtx, input),
    status: (input) => statusOperation.execute(opCtx, input),
    listSessions: () => listOperation.execute(opCtx, {}),
    inspect: (input) => inspectOperation.execute(opCtx, input),
    getTrace: (sessionId) => {
      const session = getSessionRecord(database.connection, sessionId);
      if (!session) return null;
      const parts = listPartRecordsBySession(database.connection, sessionId);
      return buildSessionTraceBundle({
        session,
        steps: listStepRecordsBySession(database.connection, sessionId),
        turns: listTurnRecordsBySession(database.connection, sessionId),
        rounds: listRoundRecordsBySession(database.connection, sessionId),
        parts,
        rawExchanges: listRawExchangeRecordsBySession(database.connection, sessionId),
        transcript: deriveTranscriptEntries(parts),
        context: deriveContextEntries(parts),
      });
    },
    onEvent: (listener) => scheduler.subscribe(listener),
    abortActive: () => scheduler.abortActive(),
    close: () => database.connection.close(),
  };
}

export type { SchedulerEvent };
