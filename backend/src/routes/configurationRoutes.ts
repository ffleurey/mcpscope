import { z } from "zod";
import { apiError } from "../errors.js";
import {
  deleteLmConnection,
  deleteMcpServerProfile,
  deleteModelConfig,
  getSessionCreationDefaults,
  listLmConnections,
  listMcpServerProfiles,
  listModelConfigs,
  upsertLmConnection,
  upsertMcpServerProfile,
  upsertModelConfig,
  upsertSessionCreationDefaults,
} from "../persistence/repository.js";
import {
  lmStudioConnectionSchema,
  mcpServerProfileSchema,
  modelConfigSchema,
} from "../domain/configuration.js";
import {
  initializeMcpSession,
  listMcpTools,
} from "../services/mcp/httpClient.js";
import {
  isModelLoaded,
  listModelsWithStatus,
  loadModel as loadLmModel,
  unloadModel as unloadLmModel,
} from "../services/lmstudio/client.js";
import { ensureModelReady } from "../services/provider/index.js";
import { listModels } from "../services/openai/client.js";
import { listUserModels } from "../services/openrouter/client.js";
import { getOllamaModelDetails } from "../services/ollama/client.js";
import type { RouteDeps } from "./types.js";

function providerLabel(providerType?: string): string {
  switch (providerType) {
    case "openrouter":
      return "OpenRouter";
    case "ollama":
      return "Ollama";
    default:
      return "LM Studio";
  }
}

export function registerConfigurationRoutes({ app }: RouteDeps): void {
  app.get("/api/lm-connections", async () => ({
    lmConnections: listLmConnections(),
  }));

  app.put("/api/lm-connections/:connectionId", async (request, reply) => {
    const { connectionId } = z
      .object({ connectionId: z.string() })
      .parse(request.params);
    const record = lmStudioConnectionSchema.parse(request.body);
    if (record.id !== connectionId) {
      reply.code(400);
      return apiError("validation", "Connection ID mismatch");
    }
    upsertLmConnection(record);
    return { lmConnection: record };
  });

  app.delete("/api/lm-connections/:connectionId", async (request, reply) => {
    const { connectionId } = z
      .object({ connectionId: z.string() })
      .parse(request.params);
    const referencedByModelConfig = listModelConfigs().some(
      (modelConfig) => modelConfig.connectionId === connectionId,
    );
    if (referencedByModelConfig) {
      reply.code(409);
      return apiError(
        "validation",
        "Cannot delete this LM connection because one or more model configs still reference it. Delete those model configs first.",
        {
          code: "lm_connection_in_use",
        },
      );
    }
    const deleted = deleteLmConnection(connectionId);
    if (!deleted) {
      reply.code(404);
      return apiError("not_found", "LM connection not found");
    }
    reply.code(204);
    return null;
  });

  app.get("/api/model-configs", async () => {
    const configs = listModelConfigs();
    const connections = listLmConnections();
    return {
      modelConfigs: configs.map((mc) => ({
        ...mc,
        connectionName:
          connections.find((c) => c.id === mc.connectionId)?.name ??
          mc.connectionId,
      })),
    };
  });

  app.put("/api/model-configs/:modelConfigId", async (request, reply) => {
    const { modelConfigId } = z
      .object({ modelConfigId: z.string() })
      .parse(request.params);
    const record = modelConfigSchema.parse(request.body);
    if (record.id !== modelConfigId) {
      reply.code(400);
      return apiError("validation", "Model config ID mismatch");
    }
    upsertModelConfig(record);
    return { modelConfig: record };
  });

  app.delete("/api/model-configs/:modelConfigId", async (request, reply) => {
    const { modelConfigId } = z
      .object({ modelConfigId: z.string() })
      .parse(request.params);
    const defaults = getSessionCreationDefaults();
    if (defaults.defaultModelConfigId === modelConfigId) {
      reply.code(409);
      return apiError(
        "validation",
        "Cannot delete this model config because it is currently set as the default for new sessions. Change or clear the default first.",
        {
          code: "default_model_config_in_use",
        },
      );
    }
    const deleted = deleteModelConfig(modelConfigId);
    if (!deleted) {
      reply.code(404);
      return apiError("not_found", "Model config not found");
    }
    reply.code(204);
    return null;
  });

  app.get("/api/mcp-profiles", async () => ({
    mcpProfiles: listMcpServerProfiles(),
  }));

  app.put("/api/mcp-profiles/:mcpProfileId", async (request, reply) => {
    const { mcpProfileId } = z
      .object({ mcpProfileId: z.string() })
      .parse(request.params);
    const record = mcpServerProfileSchema.parse(request.body);
    if (record.id !== mcpProfileId) {
      reply.code(400);
      return apiError("validation", "MCP profile ID mismatch");
    }
    upsertMcpServerProfile(record);
    return { mcpProfile: record };
  });

  app.delete("/api/mcp-profiles/:mcpProfileId", async (request, reply) => {
    const { mcpProfileId } = z
      .object({ mcpProfileId: z.string() })
      .parse(request.params);
    const deleted = deleteMcpServerProfile(mcpProfileId);
    if (!deleted) {
      reply.code(404);
      return apiError("not_found", "MCP profile not found");
    }
    reply.code(204);
    return null;
  });

  app.get("/api/session-creation-defaults", async () => {
    return {
      sessionCreationDefaults: getSessionCreationDefaults(),
    };
  });

  const sessionCreationDefaultsInputSchema = z.object({
    defaultModelConfigId: z.string().nullable(),
  });

  app.put("/api/session-creation-defaults", async (request, reply) => {
    const { defaultModelConfigId } = sessionCreationDefaultsInputSchema.parse(
      request.body,
    );

    if (
      defaultModelConfigId !== null &&
      !listModelConfigs().some((c) => c.id === defaultModelConfigId)
    ) {
      reply.code(422);
      return apiError(
        "validation",
        `Model config "${defaultModelConfigId}" not found.`,
        { code: "default_model_config_not_found" },
      );
    }

    const updatedDefaults = { defaultModelConfigId, updatedAt: Date.now() };
    upsertSessionCreationDefaults(updatedDefaults);
    return { sessionCreationDefaults: updatedDefaults };
  });

  app.post("/api/lm-connections/test", async (request, reply) => {
    const { baseUrl, apiKey, providerType } = z
      .object({
        baseUrl: z.string().url(),
        apiKey: z.string().nullable().optional(),
        providerType: z.enum(["lmstudio", "openrouter", "ollama"]).optional(),
      })
      .parse(request.body);
    try {
      // OpenRouter's /models endpoint is public, so listing models succeeds
      // even with a wrong API key. Probe the authenticated /key endpoint so
      // "test connection" actually validates the credential.
      if (providerType === "openrouter" && apiKey) {
        const keyUrl = `${baseUrl.replace(/\/$/, "")}/key`;
        const keyResponse = await fetch(keyUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (keyResponse.status === 401 || keyResponse.status === 403) {
          reply.code(401);
          return apiError("upstream", "OpenRouter rejected the API key.", {
            code: "invalid_api_key",
            details: { baseUrl, providerType },
          });
        }
      }
      const result = await listModels(baseUrl, apiKey ?? undefined);
      return {
        models: result.data?.map((m) => m.id ?? "").filter(Boolean) ?? [],
      };
    } catch (e) {
      const label = providerLabel(providerType);
      app.log.warn(
        { baseUrl, err: e instanceof Error ? e.message : String(e) },
        `${label} connection test failed`,
      );
      reply.code(503);
      return apiError(
        "upstream",
        e instanceof Error ? e.message : `${label} unreachable`,
        {
          code: "provider_unreachable",
          details: { baseUrl, providerType },
        },
      );
    }
  });

  app.post("/api/lm-connections/models", async (request, reply) => {
    const { baseUrl, apiKey, providerType } = z
      .object({
        baseUrl: z.string().url(),
        apiKey: z.string().nullable().optional(),
        providerType: z.enum(["lmstudio", "openrouter", "ollama"]).optional(),
      })
      .parse(request.body);
    const label = providerLabel(providerType);
    try {
      const models =
        providerType === "openrouter"
          ? await listUserModels(baseUrl, apiKey ?? undefined)
          : await listModelsWithStatus(baseUrl, apiKey ?? undefined);
      return { models };
    } catch (e) {
      app.log.warn(
        { baseUrl, err: e instanceof Error ? e.message : String(e) },
        `${label} models listing failed`,
      );
      reply.code(503);
      return apiError(
        "upstream",
        e instanceof Error ? e.message : `${label} unreachable`,
        {
          code: "provider_unreachable",
          details: { baseUrl, providerType },
        },
      );
    }
  });

  app.post("/api/lm-connections/models/load", async (request, reply) => {
    const { baseUrl, apiKey, modelKey, contextSize, providerType } = z
      .object({
        baseUrl: z.string().url(),
        apiKey: z.string().nullable().optional(),
        modelKey: z.string().min(1),
        contextSize: z.number().int().positive().optional(),
        providerType: z.enum(["lmstudio", "openrouter", "ollama"]).optional(),
      })
      .parse(request.body);
    if (providerType && providerType !== "lmstudio") {
      const label = providerLabel(providerType);
      reply.code(400);
      return apiError(
        "validation",
        `${label} does not support model load/unload — models are loaded automatically on first request.`,
        {
          code: "model_load_not_supported",
          details: { providerType },
        },
      );
    }
    try {
      // When the connection has auto-swap enabled, unload any other model on
      // this instance first (centralized in ensureModelReady); otherwise just
      // load the requested model.
      const autoSwap = listLmConnections().some(
        (c) => c.baseUrl === baseUrl && c.autoSwapModel === true,
      );
      if (autoSwap) {
        await ensureModelReady({
          baseUrl,
          apiKey: apiKey ?? undefined,
          providerType: "lmstudio",
          modelKey,
          contextSize,
          autoSwap: true,
        });
      } else {
        await loadLmModel(baseUrl, apiKey ?? undefined, modelKey, contextSize);
      }
      return { ok: true };
    } catch (e) {
      app.log.warn(
        { baseUrl, modelKey, err: e instanceof Error ? e.message : String(e) },
        "LM model load failed",
      );
      reply.code(503);
      return apiError(
        "upstream",
        e instanceof Error ? e.message : "LM model load failed",
        {
          code: "lm_model_load_failed",
          details: { baseUrl, modelKey },
        },
      );
    }
  });

  app.post("/api/lm-connections/models/unload", async (request, reply) => {
    const { baseUrl, apiKey, instanceId, providerType } = z
      .object({
        baseUrl: z.string().url(),
        apiKey: z.string().nullable().optional(),
        instanceId: z.string().min(1),
        providerType: z.enum(["lmstudio", "openrouter", "ollama"]).optional(),
      })
      .parse(request.body);
    if (providerType && providerType !== "lmstudio") {
      const label = providerLabel(providerType);
      reply.code(400);
      return apiError(
        "validation",
        `${label} does not support model load/unload — models are loaded automatically on first request.`,
        {
          code: "model_unload_not_supported",
          details: { providerType },
        },
      );
    }
    try {
      await unloadLmModel(baseUrl, apiKey ?? undefined, instanceId);
      return { ok: true };
    } catch (e) {
      app.log.warn(
        {
          baseUrl,
          instanceId,
          err: e instanceof Error ? e.message : String(e),
        },
        "LM model unload failed",
      );
      reply.code(503);
      return apiError(
        "upstream",
        e instanceof Error ? e.message : "LM model unload failed",
        {
          code: "lm_model_unload_failed",
          details: { baseUrl, instanceId },
        },
      );
    }
  });

  app.post("/api/lm-connections/models/details", async (request, reply) => {
    const { baseUrl, modelKey, providerType, apiKey } = z
      .object({
        baseUrl: z.string().url(),
        modelKey: z.string().min(1),
        providerType: z.enum(["lmstudio", "openrouter", "ollama"]).optional(),
        apiKey: z.string().nullable().optional(),
      })
      .parse(request.body);

    if (providerType === "ollama") {
      const details = await getOllamaModelDetails(baseUrl, modelKey);
      if (!details) {
        reply.code(404);
        return apiError("not_found", "Ollama model details not found", {
          code: "model_details_not_found",
        });
      }
      return { details };
    }

    // For LM Studio, return the native model data
    try {
      const models = await listModelsWithStatus(baseUrl, apiKey ?? undefined);
      const model = models.find((m) => m.key === modelKey);
      if (!model) {
        reply.code(404);
        return apiError("not_found", "Model details not found", {
          code: "model_details_not_found",
        });
      }
      return { details: model.raw };
    } catch (e) {
      reply.code(503);
      return apiError(
        "upstream",
        e instanceof Error ? e.message : "Provider unreachable",
        {
          code: "provider_unreachable",
          details: { baseUrl, providerType },
        },
      );
    }
  });

  app.post("/api/mcp-profiles/test", async (request, reply) => {
    const { url, authType, authValue } = z
      .object({
        url: z.string().url(),
        authType: z.enum(["none", "bearer", "basic"]).nullable().optional(),
        authValue: z.string().nullable().optional(),
      })
      .parse(request.body);
    const auth = { type: authType ?? null, value: authValue ?? null };
    try {
      const init = await initializeMcpSession(url, auth);
      const toolsResult = await listMcpTools(url, init.sessionId, auth);
      return {
        serverName: init.serverInfo.name,
        serverVersion: init.serverInfo.version,
        tools: toolsResult.tools.map((t) => t.name),
      };
    } catch (e) {
      app.log.error(
        { url, err: e instanceof Error ? e.message : String(e) },
        "MCP profile test failed",
      );
      reply.code(503);
      return apiError(
        "upstream",
        e instanceof Error ? e.message : "MCP server unreachable",
        { details: { url } },
      );
    }
  });

  app.post("/api/sessions/preflight", async (request, reply) => {
    const {
      lmConnectionSnapshot,
      mcpProfileSnapshots,
      selectedModel,
      providerType,
    } = z
      .object({
        lmConnectionSnapshot: z.object({
          baseUrl: z.string(),
          apiKey: z.string().nullable().optional(),
        }),
        mcpProfileSnapshots: z
          .array(
            z.object({
              url: z.string(),
              authType: z.enum(["none", "bearer", "basic"]).nullable().optional(),
              authValue: z.string().nullable().optional(),
            }),
          )
          .default([]),
        selectedModel: z.object({
          modelKey: z.string().min(1),
          modelDisplayName: z.string().min(1).optional(),
        }),
        providerType: z.enum(["lmstudio", "openrouter", "ollama"]).optional(),
      })
      .parse(request.body);

    const label = providerLabel(providerType);

    let listedByCompatApi: boolean;
    try {
      const modelList = await listModels(
        lmConnectionSnapshot.baseUrl,
        lmConnectionSnapshot.apiKey ?? undefined,
      );
      listedByCompatApi =
        modelList.data?.some((m) => m.id === selectedModel.modelKey) ?? false;
    } catch (e) {
      app.log.warn(
        {
          baseUrl: lmConnectionSnapshot.baseUrl,
          err: e instanceof Error ? e.message : String(e),
        },
        `Preflight: ${label} unreachable`,
      );
      reply.code(503);
      return apiError(
        "upstream",
        `Cannot reach ${label}. Check that it is running and accessible.`,
        {
          code: "provider_unreachable",
          details: { baseUrl: lmConnectionSnapshot.baseUrl, providerType },
        },
      );
    }

    // Auto-swap connections load the model on the first request, so a
    // not-loaded model is not an error — skip the gate and let the harness swap.
    const autoSwap = listLmConnections().some(
      (c) =>
        c.baseUrl === lmConnectionSnapshot.baseUrl && c.autoSwapModel === true,
    );

    // For hosted or auto-load providers (OpenRouter, Ollama) the model is always
    // available — skip the loaded-model check which only applies to LM Studio.
    if (!autoSwap && providerType !== "openrouter" && providerType !== "ollama") {
      const loaded = await isModelLoaded(
        lmConnectionSnapshot.baseUrl,
        lmConnectionSnapshot.apiKey ?? undefined,
        selectedModel.modelKey,
      );
      if (loaded === false || (loaded === null && !listedByCompatApi)) {
        const modelLabel =
          selectedModel.modelDisplayName ?? selectedModel.modelKey;
        reply.code(409);
        return apiError(
          "validation",
          `Selected model "${modelLabel}" is not loaded in ${label}. Load it and try again.`,
          {
            code: "model_not_loaded",
            details: {
              modelKey: selectedModel.modelKey,
              modelDisplayName: selectedModel.modelDisplayName ?? null,
              baseUrl: lmConnectionSnapshot.baseUrl,
              providerType,
            },
          },
        );
      }
    }

    for (const mcpRef of mcpProfileSnapshots) {
      try {
        await initializeMcpSession(mcpRef.url, {
          type: mcpRef.authType ?? null,
          value: mcpRef.authValue ?? null,
        });
      } catch (e) {
        app.log.warn(
          { url: mcpRef.url, err: e instanceof Error ? e.message : String(e) },
          "Preflight: MCP server unreachable",
        );
        reply.code(503);
        return apiError(
          "upstream",
          "Cannot reach MCP server. Check that it is running and accessible.",
          {
            code: "mcp_unreachable",
            details: { url: mcpRef.url },
          },
        );
      }
    }

    return { ok: true };
  });
}
