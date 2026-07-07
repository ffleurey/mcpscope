/**
 * launchAnalysis — backend-owned HTTP operation for creating a session_analysis
 * child session from a target session and completed target turn.
 *
 * This is intentionally not part of the shared CLI/MCP catalog. It exists for
 * backend HTTP routes and frontend flows, while shared CLI/MCP operations stay
 * limited to the published catalog in catalog.ts.
 */
import { z } from "zod";
import { runInTransaction } from "../persistence/connection.js";
import { OperationError } from "./errors.js";
import {
  getSessionCreationDefaults,
  getSessionRecord,
  getTurnRecord,
  listLmConnections,
  listModelConfigs,
  updateSessionAnalysisState,
} from "../persistence/repository.js";
import { createSession } from "../runtime/modelTurns.js";
import { mapSessionIdError } from "./sessionCreationShared.js";
import {
  rubricCriterionSchema,
  sessionRecordSchema,
  type McpProfileSnapshot,
  type ModelProfileSnapshot,
  type SessionRecord,
} from "../domain/model.js";
import type { OperationContext } from "./context.js";
import {
  buildAnalysisSystemPrompt,
  normalizeAnalysisGoal,
} from "../analysis/systemPrompt.js";
import { runSessionInitialization } from "../runtime/sessionInit.js";
import { ANALYSIS_WORKFLOW_KIND } from "../analysis/workflowKinds.js";
import { isKnownWorkflowKind } from "../analysis/analysisWorkflowFactory.js";
import { getAnalysisTitlePrefix } from "../analysis/analysisSessionPresentation.js";
import type { AnalysisSessionState } from "../analysis/schemas.js";

// ─── Input schema ─────────────────────────────────────────────────────────────

export const launchAnalysisInputSchema = z.object({
  /** The turn in the target session at which analysis should stop (inclusive). */
  target_turn_id: z.string().min(1, "target_turn_id must not be empty"),
  /** Optional extra guidance for what the analysis should emphasize. */
  analysis_goal: z.string().optional(),
  /** Model config to use. If omitted the general default model config is used. */
  model_config_id: z.string().optional(),
  /** Optional extra launch-time instructions appended to the built-in analysis prompt. */
  additional_instructions: z.string().optional(),
  /** Optional full system prompt override shown and editable in the launch dialog. */
  system_prompt_override: z.string().optional(),
  /**
   * Optional sampling temperature override. Omit to use the analysis default
   * (0.5); pass null to send no temperature so the provider uses its own default.
   */
  temperature: z.number().nullable().optional(),
  /**
   * Max tool-call rounds per analysis turn before it fails (loop guard). A
   * tool-enabled judge inspects the target over several rounds, so this is
   * typically set higher than a chat session. Defaults to the backend default.
   */
  max_tool_rounds: z.number().int().positive().optional(),
  /** Optional subset of tool names to include in the analysis. */
  selected_tool_names: z.array(z.string().min(1)).optional(),
  /** Limit analysis to tool calls whose tool result is marked as an error. */
  only_failed_tool_calls: z.boolean().optional(),
  /** Optional additional evaluation criteria. */
  evaluation_criteria: z.array(z.string().min(1)).optional(),
  /** Scored rubric for the benchmark_evaluation judge (ignored by other kinds). */
  rubric: z.array(rubricCriterionSchema).optional(),
  /** The analysis workflow to run. */
  workflow_kind: z.string().optional(),
  /**
   * Allow a target turn that is terminal-but-not-complete (`error`/`aborted`) — used by
   * benchmark evaluation to judge a run-session that failed (e.g. hit the tool-round cap
   * with no answer). Still rejects in-flight turns (draft/streaming/awaiting-tools).
   */
  allow_incomplete_target: z.boolean().optional(),
});

export type LaunchAnalysisInput = z.infer<typeof launchAnalysisInputSchema>;

export const launchAnalysisSessionInputSchema =
  launchAnalysisInputSchema.extend({
    target_session_id: z.string().min(1, "target_session_id must not be empty"),
  });

export type LaunchAnalysisSessionInput = z.infer<
  typeof launchAnalysisSessionInputSchema
>;

// ─── Result ───────────────────────────────────────────────────────────────────

export interface LaunchAnalysisResult {
  /** The completed (or errored) analysis child session. */
  session: SessionRecord;
}

export const launchAnalysisOutputSchema = {
  session: sessionRecordSchema,
};

export const launchAnalysisSessionOperation = {
  schema: launchAnalysisSessionInputSchema,
  outputSchema: launchAnalysisOutputSchema,
  async execute(
    ctx: OperationContext,
    rawInput: unknown,
  ): Promise<LaunchAnalysisResult> {
    const input = launchAnalysisSessionInputSchema.parse(rawInput);
    return executeAnalysisLaunch(ctx, input.target_session_id, input);
  },
};

// ─── Execution ────────────────────────────────────────────────────────────────

export async function executeAnalysisLaunch(
  ctx: OperationContext,
  targetSessionId: string,
  rawInput: unknown,
): Promise<LaunchAnalysisResult> {
  const { db } = ctx;
  const input = launchAnalysisInputSchema.parse(rawInput);
  const analysisGoal = normalizeAnalysisGoal(input.analysis_goal);
  const additionalInstructions = input.additional_instructions?.trim() ?? "";
  const systemPromptOverride = input.system_prompt_override?.trim() ?? "";
  // undefined => keep the analysis default (0.5); explicit null => provider
  // default (snapshot omits temperature). A number is used as-is (0 is valid).
  const temperature = input.temperature === undefined ? 0.5 : input.temperature;
  const selectedToolNames = [
    ...new Set(
      (input.selected_tool_names ?? [])
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
  const onlyFailedToolCalls = input.only_failed_tool_calls === true;
  const evaluationCriteria = [
    ...new Set(
      (input.evaluation_criteria ?? [])
        .map((criterion) => criterion.trim())
        .filter(Boolean),
    ),
  ];
  // Reject unknown kinds instead of silently falling back to the (multi-step,
  // expensive) full-session workflow — a typo'd kind must be an input error.
  if (input.workflow_kind && !isKnownWorkflowKind(input.workflow_kind)) {
    throw new OperationError(
      `Unknown workflow_kind "${input.workflow_kind}".`,
      "analysis_unknown_workflow_kind",
    );
  }
  const workflowKind = input.workflow_kind ?? ANALYSIS_WORKFLOW_KIND.FULL_SESSION;

  type TxResult =
    | { kind: "target_not_found" }
    | { kind: "target_not_eligible"; reason: string }
    | { kind: "target_turn_not_found" }
    | { kind: "target_turn_not_complete" }
    | { kind: "default_model_not_configured" }
    | { kind: "default_model_config_not_found"; modelConfigId: string }
    | { kind: "model_config_not_found"; modelConfigId: string }
    | { kind: "lm_connection_not_found"; connectionId: string }
    | { kind: "id_error"; error: OperationError }
    | { kind: "created"; session: SessionRecord };

  const requestedModelConfigId = input.model_config_id;

  const result: TxResult = runInTransaction(db.connection, (): TxResult => {
    // Validate target session
    const target = getSessionRecord(db.connection, targetSessionId);
    if (!target) return { kind: "target_not_found" };

    if (target.initStatus !== "ready" && target.initStatus !== "error") {
      return {
        kind: "target_not_eligible",
        reason: `Target session is not yet initialized (initStatus = '${target.initStatus}'). Wait for initialization to complete before running analysis.`,
      };
    }

    // Validate target turn. Normally it must be `complete`; with
    // allow_incomplete_target, a terminal-but-failed turn (`error`/`aborted`) is also
    // accepted (benchmark evaluation judges failed run-sessions). In-flight turns
    // (draft/streaming/awaiting-tools) are never valid targets.
    const targetTurn = getTurnRecord(db.connection, input.target_turn_id);
    // A turn from an unrelated session must be rejected at launch, not die at
    // the first workflow step ("target turn not found in session").
    if (!targetTurn || targetTurn.sessionId !== targetSessionId) {
      return { kind: "target_turn_not_found" };
    }
    const targetTurnOk =
      targetTurn.status === "complete" ||
      (input.allow_incomplete_target === true &&
        (targetTurn.status === "error" || targetTurn.status === "aborted"));
    if (!targetTurnOk) return { kind: "target_turn_not_complete" };

    // Resolve model config and LM connection
    const modelConfigs = listModelConfigs();
    let resolvedModelConfigId = requestedModelConfigId;
    if (!resolvedModelConfigId) {
      const defaults = getSessionCreationDefaults();
      if (!defaults.defaultModelConfigId) {
        return { kind: "default_model_not_configured" };
      }
      resolvedModelConfigId = defaults.defaultModelConfigId;
      if (!modelConfigs.some((c) => c.id === resolvedModelConfigId)) {
        return {
          kind: "default_model_config_not_found",
          modelConfigId: resolvedModelConfigId,
        };
      }
    }

    const modelConfig = modelConfigs.find(
      (c) => c.id === resolvedModelConfigId,
    );
    if (!modelConfig) {
      return {
        kind: "model_config_not_found",
        modelConfigId: resolvedModelConfigId,
      };
    }

    const lmConnections = listLmConnections();
    const lmConnection = lmConnections.find(
      (c) => c.id === modelConfig.connectionId,
    );
    if (!lmConnection) {
      return {
        kind: "lm_connection_not_found",
        connectionId: modelConfig.connectionId,
      };
    }

    // Build model profile snapshot
    const modelProfileSnapshot: ModelProfileSnapshot = {
      id: modelConfig.id,
      name: modelConfig.name,
      connectionBaseUrl: lmConnection.baseUrl,
      apiKey: lmConnection.apiKey ?? null,
      modelKey: modelConfig.modelKey,
      modelDisplayName: modelConfig.modelDisplayName,
      systemPrompt:
        systemPromptOverride.length > 0
          ? systemPromptOverride
          : buildAnalysisSystemPrompt({
              analysisGoal,
              additionalInstructions,
              workflowKind,
            }),
      temperature,
      reasoning: modelConfig.reasoning ?? null,
      // Without providerType, buildReasoningParams falls back to the LM Studio
      // format (reasoning: "on"), which OpenRouter/Ollama reject — analysis and
      // judge sessions on those providers would fail init. Carry it through like
      // sessionCreationShared does for regular sessions.
      providerType: lmConnection.providerType ?? null,
      // Carry the configured context window, exactly like regular sessions
      // (sessionCreationShared). Dropping it made analysis/judge sessions load
      // their model at LM Studio's small JIT default (~8k) instead of the
      // configured size — starving the judge (which reads large traces) into
      // tool-call loops, and forcing an unload+reload every time the same model
      // is used as both a task model and a judge at different context sizes.
      contextSize: modelConfig.contextSize ?? null,
      createdAt: modelConfig.createdAt,
      updatedAt: modelConfig.updatedAt,
    };

    const title = `${getAnalysisTitlePrefix(workflowKind)}: ${target.title}`;

    try {
      // Build a synthetic MCP profile snapshot pointing to the restricted analysis
      // endpoint (/mcp/analysis), which exposes mcpscope_inspect and mcpscope_status.
      // The analysis LLM can call these tools during assessment turns if it needs detail,
      // and the bootstrap step calls inspect deterministically to load the trace.
      const ts = Date.now();
      const analysisMcpSnapshot: McpProfileSnapshot | null = ctx.analysisMcpUrl
        ? {
            id: "analysis-mcp-built-in",
            name: "mcpscope-analysis",
            url: ctx.analysisMcpUrl,
            transport: "streamable-http",
            authType: null,
            authValue: null,
            createdAt: ts,
            updatedAt: ts,
          }
        : null;

      const session = createSession(db, {
        title,
        modelProfileSnapshot,
        mcpProfileSnapshots: analysisMcpSnapshot ? [analysisMcpSnapshot] : [],
        compactionStrategy: "strip-reasoning",
        maxToolRounds: input.max_tool_rounds ?? ctx.maxToolRounds,
        sessionType: "session_analysis",
        parentKind: "session",
        parentId: targetSessionId,
      });

      const wk = workflowKind; // validated above
      const initialAnalysisState: AnalysisSessionState = {
        phase: "bootstrap",
        analysisSessionId: session.id,
        targetSessionId,
        targetTurnId: input.target_turn_id,
        analysisGoal,
        selectedToolNames,
        onlyFailedToolCalls,
        evaluationCriteria,
        rubric: input.rubric ?? [],
        allowIncompleteTarget: input.allow_incomplete_target === true,
        workflow_kind: wk,
      };
      updateSessionAnalysisState(
        db.connection,
        session.id,
        initialAnalysisState as unknown as Record<string, unknown>,
      );

      // Leave initStatus as 'pending' — runSessionInitialization (called below, outside
      // the transaction) will initialize the MCP context (writing mcp-instructions +
      // tool-definitions for the analysis tools) and probe token counts, then set
      // initStatus = 'ready'.
      return { kind: "created", session };
    } catch (error) {
      const mapped = mapSessionIdError(error);
      if (mapped) return { kind: "id_error", error: mapped };
      throw error;
    }
  });

  switch (result.kind) {
    case "target_not_found":
      throw new OperationError("Target session not found.", "not_found");
    case "target_not_eligible":
      throw new OperationError(result.reason, "target_session_not_eligible");
    case "target_turn_not_found":
      throw new OperationError(
        `Target turn "${input.target_turn_id}" not found.`,
        "target_turn_not_found",
      );
    case "target_turn_not_complete":
      throw new OperationError(
        `Target turn "${input.target_turn_id}" is not yet complete.`,
        "target_turn_not_complete",
      );
    case "default_model_not_configured":
      throw new OperationError(
        "No model config was supplied and no default model config is configured for new sessions.",
        "default_model_not_configured",
      );
    case "default_model_config_not_found":
      throw new OperationError(
        `Default model config "${result.modelConfigId}" no longer exists.`,
        "default_model_config_not_found",
      );
    case "model_config_not_found":
      throw new OperationError(
        `Model config "${result.modelConfigId}" not found.`,
        "analysis_model_config_not_found",
      );
    case "lm_connection_not_found":
      throw new OperationError(
        `LM connection "${result.connectionId}" referenced by the model config no longer exists.`,
        "analysis_lm_connection_not_found",
      );
    case "id_error":
      throw result.error;
    case "created": {
      const { session } = result;
      // Full session initialization: initializes the analysis MCP context
      // (writes mcp-instructions + tool-definitions for mcpscope_inspect and
      // mcpscope_status), probes token counts, and sets initStatus = 'ready'.
      await runSessionInitialization(
        db,
        ctx.chatCompletionGateway,
        ctx.mcpGateway,
        session.id,
        () => {
          /* no streaming during launch */
        },
      );
      return { session };
    }
  }
}
