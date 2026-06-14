import { z } from "zod";
import { OperationError } from "./errors.js";
import {
  getSessionCreationDefaults,
  listLmConnections,
  listMcpServerProfiles,
  listModelConfigs,
} from "../persistence/repository.js";
import type { McpProfileSnapshot } from "../domain/model.js";
import type { OperationContext } from "./context.js";
import { type McpServerProfile } from "../domain/configuration.js";
import {
  createSession,
  SessionIdConflictError,
  SessionIdGenerationError,
  SessionIdInputError,
} from "../runtime/modelTurns.js";

// ─── Canonical contract ───────────────────────────────────────────────────────

export const createInputSchema = z.object({
  title: z.string().min(1).describe("Session title"),
  id: z
    .string()
    .optional()
    .describe("Optional explicit 4-char session ID (A-Z 2-9, no O/I/0/1)"),
  compaction: z
    .enum(["none", "strip-reasoning"])
    .optional()
    .describe(
      "Compaction strategy applied after each turn. Defaults to strip-reasoning.",
    ),
  model_config_id: z
    .string()
    .optional()
    .describe("Optional model config ID to use instead of the default"),
  mcp_profile_ids: z
    .array(z.string())
    .optional()
    .describe(
      "Optional list of MCP profile IDs. When provided, replaces the default-enabled selection.",
    ),
});

export type CreateInput = z.infer<typeof createInputSchema>;

export interface CreateResult {
  api_version: 1;
  session: {
    id: string;
    title: string;
    status: string;
    init_status: string;
    model: { id: string; name: string };
    mcp: { id: string; name: string }[];
    compaction_strategy: string;
    created_at: number;
    updated_at: number;
  };
}

/** Zod output shape for MCP structured output. Mirrors CreateResult. */
export const createOutputSchema = {
  api_version: z.literal(1),
  session: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    init_status: z.string(),
    model: z.object({ id: z.string(), name: z.string() }),
    mcp: z.array(z.object({ id: z.string(), name: z.string() })),
    compaction_strategy: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  }),
};

function buildMcpSnapshot(mcpProfile: McpServerProfile): McpProfileSnapshot {
  return {
    id: mcpProfile.id,
    name: mcpProfile.name,
    url: mcpProfile.url,
    transport: mcpProfile.transport,
    authType: mcpProfile.authType ?? null,
    authValue: mcpProfile.authValue ?? null,
    createdAt: mcpProfile.createdAt,
    updatedAt: mcpProfile.updatedAt,
  };
}

export const createOperation = {
  id: "create" as const,
  description:
    "Create a new session using backend-owned defaults (model config, LM connection, MCP profile). " +
    "Returns immediately; session may still be initializing. " +
    "Poll with status to wait for state=ready before sending a prompt.",
  schema: createInputSchema,
  outputSchema: createOutputSchema,
  async execute(
    ctx: OperationContext,
    input: CreateInput,
  ): Promise<CreateResult> {
    const { db, logger } = ctx;
    let mcpSnapshotsRef: McpProfileSnapshot[] = [];

    type TransactionResult =
      | { kind: "validation_error"; message: string; code: string }
      | { kind: "model_config_not_found"; modelConfigId: string }
      | { kind: "lm_connection_not_found"; connectionId: string }
      | { kind: "mcp_profile_not_found"; mcpProfileIds: string[] }
      | { kind: "id_input_error"; error: Error }
      | { kind: "id_conflict_error"; error: Error }
      | { kind: "id_generation_error"; error: Error }
      | {
          kind: "created";
          session: ReturnType<typeof createSession>;
          modelConfigId: string;
          modelConfigName: string;
        };

    const result: TransactionResult = db.connection.transaction(
      (): TransactionResult => {
        // Resolve model config: explicit ID or default
        const defaults = getSessionCreationDefaults();
        const resolvedModelConfigId =
          input.model_config_id ?? defaults.defaultModelConfigId;

        if (!resolvedModelConfigId) {
          return {
            kind: "validation_error",
            message: "No default model config is configured for new sessions.",
            code: "default_model_not_configured",
          };
        }

        const modelConfigs = listModelConfigs();
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

        // Resolve MCP profiles: explicit list or default-enabled
        const allProfiles = listMcpServerProfiles();
        const resolvedMcpIds =
          input.mcp_profile_ids ??
          allProfiles.filter((p) => p.defaultEnabled).map((p) => p.id);

        const mcpProfileSnapshots: McpProfileSnapshot[] = [];
        const notFoundIds: string[] = [];
        for (const profileId of resolvedMcpIds) {
          const mcpProfile = allProfiles.find((p) => p.id === profileId);
          if (!mcpProfile) {
            notFoundIds.push(profileId);
          } else {
            mcpProfileSnapshots.push(buildMcpSnapshot(mcpProfile));
          }
        }
        if (notFoundIds.length > 0) {
          return {
            kind: "mcp_profile_not_found",
            mcpProfileIds: notFoundIds,
          };
        }

        const modelProfileSnapshot = {
          id: modelConfig.id,
          name: modelConfig.name,
          connectionBaseUrl: lmConnection.baseUrl,
          apiKey: lmConnection.apiKey ?? null,
          modelKey: modelConfig.modelKey,
          modelDisplayName: modelConfig.modelDisplayName,
          systemPrompt: modelConfig.systemPrompt,
          temperature: modelConfig.temperature,
          reasoning: modelConfig.reasoning ?? null,
          contextSize: modelConfig.contextSize ?? null,
          providerType: lmConnection.providerType ?? null,
          createdAt: modelConfig.createdAt,
          updatedAt: modelConfig.updatedAt,
        };

        try {
          const session = createSession(db, {
            sessionId: input.id,
            title: input.title,
            modelProfileSnapshot,
            mcpProfileSnapshots,
            compactionStrategy: input.compaction ?? "strip-reasoning",
          });
          mcpSnapshotsRef = mcpProfileSnapshots;
          return {
            kind: "created",
            session,
            modelConfigId: modelConfig.id,
            modelConfigName: modelConfig.name,
          };
        } catch (error) {
          if (error instanceof SessionIdInputError)
            return { kind: "id_input_error", error };
          if (error instanceof SessionIdConflictError)
            return { kind: "id_conflict_error", error };
          if (error instanceof SessionIdGenerationError)
            return { kind: "id_generation_error", error };
          throw error;
        }
      },
    )();

    if (result.kind === "validation_error") {
      throw new OperationError(result.message, result.code);
    }
    if (result.kind === "model_config_not_found") {
      throw new OperationError(
        `Model config "${result.modelConfigId}" not found.`,
        "model_config_not_found",
      );
    }
    if (result.kind === "lm_connection_not_found") {
      throw new OperationError(
        `LM connection "${result.connectionId}" referenced by the selected model config no longer exists.`,
        "lm_connection_not_found",
      );
    }
    if (result.kind === "mcp_profile_not_found") {
      throw new OperationError(
        `MCP profile(s) not found: ${result.mcpProfileIds.join(", ")}`,
        "mcp_profile_not_found",
      );
    }
    if (result.kind === "id_input_error") {
      throw new OperationError(result.error.message, "invalid_session_id");
    }
    if (result.kind === "id_conflict_error") {
      throw new OperationError(result.error.message, "duplicate_session_id");
    }
    if (result.kind === "id_generation_error") {
      throw new OperationError(
        result.error.message,
        "session_id_generation_failed",
      );
    }

    const { session, modelConfigId, modelConfigName } = result;

    if (ctx.scheduler) {
      try {
        ctx.scheduler.enqueueInit(ctx, session.id);
      } catch (err: unknown) {
        logger?.error(
          {
            sessionId: session.id,
            err: err instanceof Error ? err.message : String(err),
          },
          "Scheduler init enqueue failed (non-fatal — session will initialize on first turn)",
        );
      }
    }

    return {
      api_version: 1,
      session: {
        id: session.id,
        title: session.title,
        status: session.status,
        init_status: session.initStatus,
        model: { id: modelConfigId, name: modelConfigName },
        mcp: mcpSnapshotsRef.map((s) => ({ id: s.id, name: s.name })),
        compaction_strategy: session.compactionStrategy,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      },
    };
  },
};
