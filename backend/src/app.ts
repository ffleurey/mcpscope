import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { BackendConfig } from "./config.js";
import { openBackendDatabase } from "./persistence/db.js";
import { recoverInterruptedState } from "./persistence/repository.js";
import { getLoadedContextLength } from "./services/lmstudio/client.js";
import {
  createChatCompletion,
  probePromptTokens,
  probePromptTokensDetailed,
  streamChatCompletion,
} from "./services/openai/client.js";
import {
  callMcpTool,
  initializeMcpSession,
  listMcpTools,
} from "./services/mcp/httpClient.js";
import { apiError } from "./errors.js";
import type { ChatCompletionGateway } from "./runtime/modelTurns.js";
import { withAutoModelSwap } from "./runtime/autoModelSwapGateway.js";
import type { McpGateway } from "./runtime/toolTurns.js";
import { registerMcpTransport } from "./mcp/index.js";
import { registerCompanionServers } from "./companions/index.js";
import {
  OperationError,
  operationErrorResponse,
  operationErrorToHttpStatus,
  type OperationContext,
} from "./operations/index.js";
import { ExecutionScheduler } from "./runtime/scheduler.js";
import { RunControlRegistry } from "./runtime/runControl.js";
import type { SchedulerEvent } from "./runtime/schedulerTypes.js";
import { registerConfigurationRoutes } from "./routes/configurationRoutes.js";
import { registerBenchmarkRoutes } from "./routes/benchmarkRoutes.js";
import { registerSchedulerRoutes } from "./routes/schedulerRoutes.js";
import { registerSessionRoutes } from "./routes/sessionRoutes.js";
import { registerSystemRoutes } from "./routes/systemRoutes.js";
import { registerTraceRoutes } from "./routes/traceRoutes.js";
import { computeLifecycleState } from "./operations/lifecycleState.js";
import {
  initializeConfigStore,
  ConfigFileError,
} from "./config/configStore.js";

interface RuntimeDependencies {
  chatCompletionGateway: ChatCompletionGateway;
  mcpGateway: McpGateway;
}

/**
 * Handle over a built backend: the Fastify HTTP app plus the engine pieces
 * assembled inside it. HTTP-only callers use `app`; embedders reach the
 * runtime directly through `scheduler` and `opCtx`.
 */
export interface BackendHandle {
  app: FastifyInstance;
  scheduler: ExecutionScheduler;
  opCtx: OperationContext;
}

export async function buildBackendApp(
  config: BackendConfig,
  dependencies: RuntimeDependencies = {
    chatCompletionGateway: withAutoModelSwap({
      createChatCompletion,
      streamChatCompletion,
      probePromptTokens,
      probePromptTokensDetailed,
      getLoadedContextLength,
    }),
    mcpGateway: {
      initializeSession: initializeMcpSession,
      listTools: listMcpTools,
      callTool: callMcpTool,
    },
  },
): Promise<BackendHandle> {
  const app = Fastify({
    logger: true,
    bodyLimit: 50 * 1024 * 1024, // 50MB — large trace files can be several MB
  });

  /** Map an OperationError to the correct HTTP status + error body. Re-throws non-operation errors. */
  function handleOperationError(
    err: unknown,
    reply: { code(n: number): void },
  ): { error: Record<string, unknown> } {
    if (err instanceof OperationError) {
      reply.code(operationErrorToHttpStatus(err.code));
      return operationErrorResponse(err);
    }
    throw err;
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      reply.code(400).send(
        apiError("validation", "Invalid request body", {
          details: error.issues,
        }),
      );
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    app.log.error({ err: message }, "Unhandled route error");
    // Raw Error.message is deliberately returned (no stack): mcpscope is a
    // local-first tool, so the API caller is the operator debugging their own
    // instance — a generic "internal error" would only slow them down.
    reply
      .code(500)
      .send(apiError("internal", message || "Unexpected server error"));
  });

  await app.register(cors, {
    origin: config.corsOrigin,
  });

  // Serve pre-built frontend when BACKEND_STATIC_DIR is set (production/Docker mode)
  if (config.staticDir != null && fs.existsSync(config.staticDir)) {
    await app.register(staticFiles, {
      root: path.resolve(config.staticDir),
      prefix: "/",
      // SPA fallback: non-API routes that don't match a file return index.html
      wildcard: false,
    });
    app.setNotFoundHandler(async (request, reply) => {
      if (!request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      return reply.status(404).send(apiError("not_found", "Not found"));
    });
  }

  const database = openBackendDatabase(config.sqlitePath);
  app.decorate("backendDb", database);

  // On an unclean shutdown (crash, kill, server restart mid-turn) turns and sessions
  // can be left in in-progress states. Recover them before serving any requests so
  // findActiveSession never sees stale 'running' entries that would permanently block
  // new session creation.
  recoverInterruptedState(database.connection);

  // Register MCP Streamable HTTP transport. Routes: POST/GET/DELETE /mcp
  // Operations execute directly against the backend (no loopback HTTP).
  // Build the analysis MCP URL from the backend's own host/port.
  // Analysis sessions use /mcp/analysis which exposes only inspect + status.
  const analysisMcpUrl = `http://${config.host}:${config.port}/mcp/analysis`;

  // Backend-owned execution scheduler — created once per app instance.
  const scheduler = new ExecutionScheduler();
  // Control plane for long-running coordinators (benchmark/evaluation runs).
  const runControl = new RunControlRegistry(scheduler);

  // Initialize the JSON-backed config store.
  // Default path: {dataDir}/mcpscope.config.json, override via MCPSCOPE_CONFIG_PATH.
  const configPath =
    process.env.MCPSCOPE_CONFIG_PATH ??
    path.join(config.dataDir, "mcpscope.config.json");
  if (fs.existsSync(configPath)) {
    app.log.info({ configPath }, "Loading config from file");
  } else {
    app.log.info(
      { configPath },
      "No config file found. Starting with empty configuration. Use the Settings UI to configure LM connections, model configs, and MCP server profiles.",
    );
  }
  try {
    initializeConfigStore(configPath);
  } catch (err) {
    if (err instanceof ConfigFileError) {
      app.log.error({ configPath, err: err.message }, "Failed to load config");
      throw err;
    }
    throw err;
  }

  const opCtx: OperationContext = {
    db: database,
    chatCompletionGateway: dependencies.chatCompletionGateway,
    mcpGateway: dependencies.mcpGateway,
    maxToolRounds: config.maxToolRounds,
    analysisMcpUrl,
    logger: app.log,
    scheduler,
    runControl,
  };
  registerMcpTransport(app, opCtx);

  // Bundled companion MCP servers: mounted in-process at /companions/<name>/mcp
  // and surfaced as read-only built-in profiles selectable with no configuration.
  registerCompanionServers(app, { host: config.host, port: config.port });

  type SchedulerExecutionPayload = Extract<
    SchedulerEvent,
    { type: "scheduler-execution-event" }
  >["event"];
  type SsePayload = { type: string; [key: string]: unknown };

  // Periodic SSE comment interval so idle streams stay alive (proxies/browsers
  // drop silent connections). Matches the scheduler-events endpoint.
  const SSE_HEARTBEAT_MS = 20000;

  async function relaySchedulerJobStream(
    reply: FastifyReply,
    jobId: string,
    options: {
      shouldCloseOnExecutionEvent: (
        event: SchedulerExecutionPayload,
      ) => boolean;
      failureEvent: (message: string) => SsePayload;
    },
  ): Promise<void> {
    reply.hijack();
    reply.raw.statusCode = 200;
    reply.raw.setHeader("content-type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("cache-control", "no-cache, no-transform");
    reply.raw.setHeader("connection", "keep-alive");

    let closed = false;
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const emitSseEvent = (event: SsePayload) => {
      if (closed || reply.raw.writableEnded) return;
      try {
        reply.raw.write(`event: ${event.type}\n`);
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // Client disconnected mid-write; the close/error handler cleans up.
      }
    };

    const emitFailure = (message: string) => {
      emitSseEvent(options.failureEvent(message));
    };

    const cleanup = () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      unsubscribe?.();
      unsubscribe = null;
    };

    const finish = () => {
      if (closed) return;
      closed = true;
      cleanup();
      reply.raw.end();
    };

    // Without an 'error' listener an EPIPE on the raw socket (client vanished
    // mid-stream) throws as an unhandled event and crashes the process.
    reply.raw.on("error", () => {
      closed = true;
      cleanup();
    });
    reply.raw.on("close", () => {
      closed = true;
      cleanup();
    });

    heartbeat = setInterval(() => {
      if (closed || reply.raw.writableEnded) return;
      try {
        reply.raw.write(": ping\n\n");
      } catch {
        // Connection closing; handlers clean up.
      }
    }, SSE_HEARTBEAT_MS);
    heartbeat.unref?.();

    unsubscribe = scheduler.subscribe((schedulerEvent: SchedulerEvent) => {
      if (
        schedulerEvent.type === "scheduler-execution-event" &&
        schedulerEvent.jobId === jobId
      ) {
        emitSseEvent(schedulerEvent.event as SsePayload);
        if (options.shouldCloseOnExecutionEvent(schedulerEvent.event)) {
          finish();
        }
        return;
      }

      if (
        schedulerEvent.type === "scheduler-job-failed" &&
        schedulerEvent.job.jobId === jobId
      ) {
        emitFailure(schedulerEvent.job.error ?? "Job failed");
        finish();
        return;
      }

      if (
        schedulerEvent.type === "scheduler-job-completed" &&
        schedulerEvent.job.jobId === jobId
      ) {
        finish();
        return;
      }

      if (
        schedulerEvent.type === "scheduler-job-removed" &&
        schedulerEvent.jobId === jobId
      ) {
        finish();
      }
    });

    const snapshot = scheduler.getSnapshot();
    const stillPresent =
      snapshot.activeJob?.jobId === jobId ||
      snapshot.pendingJobs.some((job) => job.jobId === jobId);
    if (!stillPresent && snapshot.lastTerminalJob?.jobId === jobId) {
      if (snapshot.lastTerminalJob.outcome === "failed") {
        emitFailure(snapshot.lastTerminalJob.error ?? "Job failed");
      }
      finish();
    }
  }

  const toLifecycleState = (summary: {
    id: string;
    status: string;
    initStatus: string;
    sessionType?: string;
  }): "initializing" | "ready" | "running" | "error" =>
    computeLifecycleState(database.connection, {
      ...summary,
      sessionType:
        summary.sessionType === "session_analysis"
          ? "session_analysis"
          : "primary",
    });

  const routeDeps = {
    app,
    config,
    database,
    scheduler,
    opCtx,
    handleOperationError,
    toLifecycleState,
    relaySchedulerJobStream,
  };

  registerSystemRoutes(routeDeps);
  registerConfigurationRoutes(routeDeps);
  registerSessionRoutes(routeDeps);
  registerTraceRoutes(routeDeps);
  registerSchedulerRoutes(routeDeps);
  registerBenchmarkRoutes(routeDeps);

  app.addHook("onClose", async () => {
    database.connection.close();
  });

  return { app, scheduler, opCtx };
}

declare module "fastify" {
  interface FastifyInstance {
    backendDb: ReturnType<typeof openBackendDatabase>;
  }
}
