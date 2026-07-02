import { z } from "zod";
import { runInTransaction } from "../persistence/connection.js";
import { apiError } from "../errors.js";
import {
  deleteSessionRecord,
  getSessionRecord,
  listAllSessionSummaries,
  listChildSessionSummaries,
  listPartRecordsBySession,
  listStepRecordsBySession,
  listTurnRecordsBySession,
  updatePartRecord,
  updateSessionAnalysisState,
  updateSessionRecord,
} from "../persistence/repository.js";
import {
  createOperation,
  inspectOperation,
  listOperation,
  statusOperation,
  listModelConfigsOperation,
  listMcpProfilesOperation,
} from "../operations/index.js";
import {
  createExplicitOperation,
  launchAnalysisSessionOperation,
  launchPrimarySessionOperation,
} from "../operations/internal.js";
import { renderInspect } from "../inspect/renderInspect.js";
import {
  buildAnalysisSystemPrompt,
  normalizeAnalysisGoal,
} from "../analysis/systemPrompt.js";
import type { RouteDeps } from "./types.js";
import type { ChatCompletionGateway } from "../runtime/modelTurns.js";
import type { McpGateway } from "../runtime/toolTurns.js";
import {
  getAnalysisWorkflowKindFromSteps,
  getLatestAnalysisDiagnosticSummaryForSession,
} from "../analysis/analysisSessionPresentation.js";
import {
  listArtifactsBySession,
  deleteJsonArtifact,
} from "../analysis/artifactRepository.js";
import { rehydrateAnalysisWorkflow } from "../analysis/analysisWorkflowFactory.js";

function buildSessionSummaryPayload(
  deps: Pick<RouteDeps, "database" | "toLifecycleState">,
  summary: {
    id: string;
    title: string;
    status: string;
    initStatus: string;
    sessionType: string;
    parentKind: string | null;
    parentId: string | null;
    createdAt: number;
    updatedAt: number;
    isContextExhausted: boolean;
    loadedContextLength: number | null;
    compactionStrategy: string;
    initError?: { errorKind: string; message: string } | null | undefined;
    modelProfileSnapshot: { name: string };
    mcpProfileSnapshots: { name: string }[];
  },
) {
  const workflowKind =
    summary.sessionType === "session_analysis"
      ? getAnalysisWorkflowKindFromSteps(
          deps.database.connection,
          summary.id,
        )
      : null;
  const workflowPhase =
    summary.sessionType === "session_analysis"
      ? (() => {
          const sessionAnalysis = getSessionRecord(
            deps.database.connection,
            summary.id,
          );
          const analysisState = sessionAnalysis?.analysisState as {
            phase?: string;
            planProgress?: {
              total: number;
              completed: number;
              currentCommandKind: string | null;
              currentCommandId: string | null;
            };
          } | null;
          return analysisState?.phase ?? null;
        })()
      : null;
  const planProgress =
    summary.sessionType === "session_analysis"
      ? (() => {
          const sessionAnalysis = getSessionRecord(
            deps.database.connection,
            summary.id,
          );
          const analysisState = sessionAnalysis?.analysisState as {
            planProgress?: {
              total: number;
              completed: number;
              currentCommandKind: string | null;
              currentCommandId: string | null;
            };
          } | null;
          return analysisState?.planProgress ?? null;
        })()
      : null;
  const latestError =
    deps.toLifecycleState(summary) === "error"
      ? summary.initError
        ? {
            step_id: null,
            error_kind: summary.initError.errorKind,
            message: summary.initError.message,
          }
        : summary.sessionType === "session_analysis"
          ? (getLatestAnalysisDiagnosticSummaryForSession(
              deps.database.connection,
              summary.id,
            ) ?? undefined)
          : undefined
      : undefined;

  return {
    id: summary.id,
    title: summary.title,
    status: deps.toLifecycleState(summary),
    init_status: summary.initStatus,
    session_type: summary.sessionType,
    parent_kind: summary.parentKind,
    parent_id: summary.parentId,
    created_at: summary.createdAt,
    updated_at: summary.updatedAt,
    is_context_exhausted: summary.isContextExhausted,
    loaded_context_length: summary.loadedContextLength,
    compaction_strategy: summary.compactionStrategy,
    ...(workflowKind ? { workflow_kind: workflowKind } : {}),
    ...(workflowPhase ? { workflow_phase: workflowPhase } : {}),
    ...(planProgress ? { plan_progress: planProgress } : {}),
    ...(latestError ? { latest_error: latestError } : {}),
    model_profile_snapshot: { name: summary.modelProfileSnapshot.name },
    mcp_profile_snapshots: summary.mcpProfileSnapshots,
  };
}

function resetFailedAnalysisStepForRetry(
  database: RouteDeps["database"],
  sessionId: string,
) {
  const session = getSessionRecord(database.connection, sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const analysisState = session.analysisState as Record<string, unknown> | null;
  if (
    !analysisState ||
    (analysisState.phase !== "error" && !analysisState.retry_failed_step_id)
  ) {
    throw new Error("Analysis session is not in a failed state");
  }

  const steps = listStepRecordsBySession(database.connection, sessionId);
  const failedStep = [...steps]
    .reverse()
    .find((step) => step.status === "error");
  if (!failedStep) {
    throw new Error("Analysis session has no failed step to retry");
  }

  // Remove artifacts for the failed step and all downstream steps.
  // Downstream = steps with childIndex >= failedStep.childIndex.
  const descendents = steps.filter(
    (s) => s.childIndex >= failedStep.childIndex,
  );
  const affectedStepIds = new Set(descendents.map((s) => s.id));

  const ownedTurnIds = new Set(
    listTurnRecordsBySession(database.connection, sessionId)
      .filter(
        (turn) => turn.ownerStepId && affectedStepIds.has(turn.ownerStepId),
      )
      .map((turn) => turn.id),
  );
  const retryParts = listPartRecordsBySession(
    database.connection,
    sessionId,
  ).filter((part) => part.turnId && ownedTurnIds.has(part.turnId));

  const updatedAnalysisState: Record<string, unknown> = {
    ...analysisState,
    retry_failed_step_id: failedStep.id,
    retry_requested_at: Date.now(),
  };

  const updatedSession = {
    ...session,
    status: "ready" as const,
    updatedAt: Date.now(),
  };

  const tx = () => runInTransaction(database.connection, () => {
    updateSessionAnalysisState(
      database.connection,
      sessionId,
      updatedAnalysisState,
    );
    updateSessionRecord(database.connection, updatedSession);

    // Exclude parts owned by the failed + downstream steps
    for (const part of retryParts) {
      updatePartRecord(database.connection, {
        ...part,
        context: {
          ...part.context,
          state: "excluded",
        },
        updatedAt: updatedSession.updatedAt,
      });
    }

    // Delete artifacts owned by the failed + downstream steps
    const allArtifacts = listArtifactsBySession(database.connection, sessionId);
    for (const artifact of allArtifacts) {
      if (artifact.stepId && affectedStepIds.has(artifact.stepId)) {
        deleteJsonArtifact(database.connection, artifact.id);
      }
    }
  });
  tx();

  // Derive phase from the plan after artifact removal.
  // Rehydrate with null lm/mcp — plan construction only needs the database.
  let retryPhase: string | null = null;
  try {
    const instance = rehydrateAnalysisWorkflow(
      database,
      null as unknown as ChatCompletionGateway,
      null as unknown as McpGateway,
      sessionId,
    );
    if (instance) {
      retryPhase = instance.computeRetryPhase();
      if (retryPhase) {
        const currentState =
          (getSessionRecord(database.connection, sessionId)
            ?.analysisState as Record<string, unknown>) ?? {};
        updateSessionAnalysisState(database.connection, sessionId, {
          ...currentState,
          phase: retryPhase,
        });
      }
    }
  } catch {
    // Plan reconstruction failed — leave phase as error.
  }

  return {
    failedStepId: failedStep.id,
    retryPhase,
    latestError: getLatestAnalysisDiagnosticSummaryForSession(
      database.connection,
      sessionId,
    ),
  };
}

export function registerSessionRoutes(deps: RouteDeps): void {
  const { app, database, scheduler, opCtx, handleOperationError } = deps;

  app.post("/api/sessions", async (request, reply) => {
    try {
      const result = await createExplicitOperation.execute(opCtx, request.body);
      reply.code(201);
      return result;
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.post("/api/sessions/from-defaults", async (request, reply) => {
    const body = z
      .object({
        title: z.string().min(1).max(200),
        sessionId: z.string().optional(),
        compactionStrategy: z.enum(["none", "strip-reasoning"]).optional(),
        modelConfigId: z.string().optional(),
        mcpProfileIds: z.array(z.string()).optional(),
        maxToolRounds: z.number().int().positive().optional(),
      })
      .parse(request.body);
    try {
      const result = await createOperation.execute(opCtx, {
        title: body.title,
        ...(body.sessionId !== undefined ? { id: body.sessionId } : {}),
        ...(body.compactionStrategy !== undefined
          ? { compaction: body.compactionStrategy }
          : {}),
        ...(body.modelConfigId !== undefined
          ? { model_config_id: body.modelConfigId }
          : {}),
        ...(body.mcpProfileIds !== undefined
          ? { mcp_profile_ids: body.mcpProfileIds }
          : {}),
        ...(body.maxToolRounds !== undefined
          ? { max_tool_rounds: body.maxToolRounds }
          : {}),
      });
      reply.code(201);
      return result;
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.post("/api/session-constructors/primary", async (request, reply) => {
    try {
      const result = await launchPrimarySessionOperation.execute(
        opCtx,
        request.body,
      );
      reply.code(201);
      return result;
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.post(
    "/api/session-constructors/session-analysis",
    async (request, reply) => {
      try {
        const result = await launchAnalysisSessionOperation.execute(
          opCtx,
          request.body,
        );
        reply.code(201);
        return result;
      } catch (err) {
        return handleOperationError(err, reply);
      }
    },
  );

  app.get("/api/analysis/system-prompt-default", async (request) => {
    const { analysis_goal, additional_instructions, workflow_kind } = z
      .object({
        analysis_goal: z.string().optional(),
        additional_instructions: z.string().optional(),
        workflow_kind: z.string().optional(),
      })
      .parse(request.query);

    return {
      systemPrompt:
        additional_instructions === undefined
          ? buildAnalysisSystemPrompt({
              analysisGoal: normalizeAnalysisGoal(analysis_goal),
              ...(workflow_kind ? { workflowKind: workflow_kind } : {}),
            })
          : buildAnalysisSystemPrompt({
              analysisGoal: normalizeAnalysisGoal(analysis_goal),
              additionalInstructions: additional_instructions,
              ...(workflow_kind ? { workflowKind: workflow_kind } : {}),
            }),
    };
  });

  app.get("/api/sessions/:sessionId/status", async (request, reply) => {
    const { sessionId } = z
      .object({ sessionId: z.string() })
      .parse(request.params);
    try {
      return await statusOperation.execute(opCtx, { session_id: sessionId });
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.post("/api/sessions/:sessionId/turns/start", async (request, reply) => {
    const { sessionId } = z
      .object({ sessionId: z.string() })
      .parse(request.params);
    const { userContent } = z
      .object({ userContent: z.string().min(1) })
      .parse(request.body);
    try {
      const job = scheduler.enqueueSession(opCtx, sessionId, userContent);
      const reservedTurn = listTurnRecordsBySession(
        database.connection,
        sessionId,
      ).find(
        (t) =>
          (t.status === "draft" || t.status === "streaming") &&
          t.sessionId === sessionId,
      );
      reply.code(202);
      return {
        api_version: 1 as const,
        session_id: sessionId,
        job: { jobId: job.jobId, status: "queued" },
        turn: reservedTurn
          ? { id: reservedTurn.id, status: "running" }
          : undefined,
      };
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.get("/api/lookup/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { mode, format } = z
      .object({
        mode: z.enum(["summary", "full"]).optional(),
        format: z.enum(["text", "json"]).optional(),
      })
      .parse(request.query);
    try {
      const result = await inspectOperation.execute(opCtx, {
        id,
        short: (mode ?? "full") === "summary",
      });
      // `format=text` renders server-side (rendering is a backend domain
      // feature shared by CLI/MCP/UI); JSON stays the default for back-compat.
      if (format === "text") {
        void reply.type("text/plain; charset=utf-8");
        return renderInspect(result, "text");
      }
      return result;
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.get("/api/sessions", async (request) => {
    const { include_children } = z
      .object({ include_children: z.enum(["true", "false"]).optional() })
      .parse(request.query);
    if (include_children === "true") {
      const rows = listAllSessionSummaries(database.connection);
      return {
        api_version: 1,
        sessions: rows.map((s) => buildSessionSummaryPayload(deps, s)),
      };
    }
    return listOperation.execute(opCtx, {});
  });

  // Operation-backed config listings (canonical snake_case shape, consumed by
  // the CLI and MCP). Distinct from the camelCase frontend routes in
  // configurationRoutes.ts (GET /api/model-configs, /api/mcp-profiles).
  app.get("/api/operations/model-configs", async (_request, reply) => {
    try {
      return await listModelConfigsOperation.execute(opCtx, {});
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.get("/api/operations/mcp-profiles", async (_request, reply) => {
    try {
      return await listMcpProfilesOperation.execute(opCtx, {});
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.delete("/api/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = z
      .object({ sessionId: z.string() })
      .parse(request.params);
    const deleted = deleteSessionRecord(database.connection, sessionId);
    if (!deleted) {
      reply.code(404);
      return apiError("not_found", "Session not found");
    }
    reply.code(204);
    return null;
  });

  app.get("/api/sessions/:sessionId/children", async (request, reply) => {
    const { sessionId } = z
      .object({ sessionId: z.string() })
      .parse(request.params);
    const session = getSessionRecord(database.connection, sessionId);
    if (!session) {
      reply.code(404);
      return apiError("not_found", "Session not found");
    }
    const children = listChildSessionSummaries(
      database.connection,
      "session",
      sessionId,
    );
    return {
      api_version: 1,
      parent_session_id: sessionId,
      children: children.map((s) => buildSessionSummaryPayload(deps, s)),
    };
  });

  app.post("/api/sessions/:sessionId/analyze", async (request, reply) => {
    const { sessionId } = z
      .object({ sessionId: z.string() })
      .parse(request.params);
    try {
      const body = z.object({}).passthrough().parse(request.body);
      const result = await launchAnalysisSessionOperation.execute(opCtx, {
        ...body,
        target_session_id: sessionId,
      });
      reply.code(201);
      return result;
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.post("/api/sessions/:sessionId/execute", async (request, reply) => {
    const { sessionId } = z
      .object({ sessionId: z.string() })
      .parse(request.params);
    const { single_step } = z
      .object({ single_step: z.string().optional() })
      .parse(request.query);
    const isSingleStep = single_step === "true" || single_step === "1";

    const session = getSessionRecord(database.connection, sessionId);
    if (!session) {
      reply.code(404);
      return apiError("not_found", "Session not found");
    }
    if (session.sessionType !== "session_analysis") {
      reply.code(400);
      return apiError("validation", "Session is not an analysis session.");
    }

    let job: Awaited<
      ReturnType<typeof scheduler.enqueueSession | typeof scheduler.enqueueStep>
    >;
    try {
      if (isSingleStep) {
        const analysisState = session.analysisState as {
          phase?: string;
        } | null;
        if (
          analysisState?.phase === "complete" ||
          analysisState?.phase === "error"
        ) {
          reply.code(422);
          return apiError(
            "validation",
            `Analysis session is in terminal phase '${analysisState?.phase}'.`,
          );
        }
        job = scheduler.enqueueStep(opCtx, sessionId);
      } else {
        job = scheduler.enqueueSession(opCtx, sessionId);
      }
    } catch (err) {
      return handleOperationError(err, reply);
    }

    await deps.relaySchedulerJobStream(reply, job.jobId, {
      shouldCloseOnExecutionEvent: (event) =>
        event.type === "analysis-complete" || event.type === "analysis-failed",
      failureEvent: (message) => ({ type: "analysis-failed", message }),
    });
  });

  app.post(
    "/api/sessions/:sessionId/retry-failed-step",
    async (request, reply) => {
      const { sessionId } = z
        .object({ sessionId: z.string() })
        .parse(request.params);
      const session = getSessionRecord(database.connection, sessionId);
      if (!session) {
        reply.code(404);
        return apiError("not_found", "Session not found");
      }
      if (session.sessionType !== "session_analysis") {
        reply.code(400);
        return apiError("validation", "Session is not an analysis session.");
      }

      try {
        const result = resetFailedAnalysisStepForRetry(database, sessionId);
        return {
          api_version: 1 as const,
          session_id: sessionId,
          failed_step_id: result.failedStepId,
          retry_phase: result.retryPhase,
          ...(result.latestError ? { latest_error: result.latestError } : {}),
        };
      } catch (err) {
        if (err instanceof Error) {
          reply.code(422);
          return apiError("validation", err.message);
        }
        throw err;
      }
    },
  );

  app.post("/api/sessions/:sessionId/retry-init", async (request, reply) => {
    const { sessionId } = z
      .object({ sessionId: z.string() })
      .parse(request.params);
    const session = getSessionRecord(database.connection, sessionId);
    if (!session) {
      reply.code(404);
      return apiError("not_found", "Session not found");
    }
    if (session.initStatus !== "error") {
      reply.code(422);
      return apiError(
        "validation",
        "Session is not in error state — nothing to retry.",
      );
    }

    session.initStatus = "pending";
    session.updatedAt = Date.now();
    updateSessionRecord(database.connection, session);

    scheduler.enqueueInit(opCtx, sessionId);
    return { ok: true };
  });

  app.patch("/api/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = z
      .object({ sessionId: z.string() })
      .parse(request.params);
    const { title } = z
      .object({ title: z.string().min(1).max(200) })
      .parse(request.body);
    const session = getSessionRecord(database.connection, sessionId);
    if (!session) {
      reply.code(404);
      return apiError("not_found", "Session not found");
    }
    session.title = title.trim();
    session.updatedAt = Date.now();
    updateSessionRecord(database.connection, session);
    return { session };
  });
}
