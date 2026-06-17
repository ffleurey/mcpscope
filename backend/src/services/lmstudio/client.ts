/**
 * LM Studio-specific client.
 *
 * The shared OpenAI-compatible chat/probe functions live in `../openai/client.js`
 * and are imported directly by callers. This module only holds LM Studio-specific
 * functions (native model listing, load/unload, loaded-context lookup) that depend
 * on LM Studio's proprietary /api/v1/models endpoints.
 */

// ─────────────────────────────────────────────────────────────────────────────
// LM Studio-specific types
// ─────────────────────────────────────────────────────────────────────────────

export interface LmStudioNativeModel {
  type?: string;
  key?: string;
  display_name?: string;
  max_context_length?: number;
  quantization?: { name?: string; bits_per_weight?: number };
  capabilities?: {
    reasoning?: {
      allowed_options?: string[];
      default?: string;
    };
  };
  loaded_instances?: Array<{
    id?: string;
    config?: {
      context_length?: number;
    };
  }>;
}

export interface LmStudioModelStatus {
  uid: string;
  key: string;
  displayName: string;
  maxContextLength: number | null;
  loadedContextLength: number | null;
  isLoaded: boolean;
  supportsReasoning: boolean;
  defaultReasoningOn: boolean;
  raw: LmStudioNativeModel;
}

// ─────────────────────────────────────────────────────────────────────────────
// LM Studio-specific internal helpers
// ─────────────────────────────────────────────────────────────────────────────

import { rootUrl, authHeaders, listModels } from "../openai/client.js";

async function listNativeLlmModels(
  baseUrl: string,
  apiKey?: string,
): Promise<LmStudioNativeModel[] | null> {
  try {
    const url = `${rootUrl(baseUrl)}/api/v1/models`;
    const response = await fetch(url, {
      headers: { Accept: "application/json", ...authHeaders(apiKey) },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { models?: LmStudioNativeModel[] };
    return (data.models ?? []).filter(
      (m) => m.type === "llm" && typeof m.key === "string",
    );
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LM Studio-specific API functions
// ─────────────────────────────────────────────────────────────────────────────

export async function listModelsWithStatus(
  baseUrl: string,
  apiKey?: string,
): Promise<LmStudioModelStatus[]> {
  const nativeModels = await listNativeLlmModels(baseUrl, apiKey);
  if (nativeModels && nativeModels.length > 0) {
    const models = nativeModels.map((m) => {
      const displayName = m.display_name ?? m.key ?? "";
      const qName = m.quantization?.name;
      const qualifiedName = qName ? `${displayName} (${qName})` : displayName;
      const loadedInstance = m.loaded_instances?.[0];
      const reasoningOptions = m.capabilities?.reasoning?.allowed_options ?? [];
      const supportsReasoning =
        reasoningOptions.includes("on") && reasoningOptions.includes("off");
      return {
        uid: `${m.key}:${qualifiedName}`,
        key: m.key ?? "",
        displayName: qualifiedName,
        maxContextLength: m.max_context_length ?? null,
        loadedContextLength: loadedInstance?.config?.context_length ?? null,
        isLoaded: (m.loaded_instances?.length ?? 0) > 0,
        supportsReasoning,
        defaultReasoningOn: m.capabilities?.reasoning?.default === "on",
        raw: m,
      };
    });
    // Ensure unique uids — LM Studio may return the same model key twice with
    // different quantization, context config, or loaded instance state.
    const uidCounts = new Map<string, number>();
    return models.map((m) => {
      const count = (uidCounts.get(m.uid) ?? 0) + 1;
      uidCounts.set(m.uid, count);
      if (count > 1) {
        return { ...m, uid: `${m.uid}:#${count}` };
      }
      return m;
    });
  }

  const compat = await listModels(baseUrl, apiKey);
  const rawModels = compat.data?.filter((m) => m.id) ?? [];
  const models = rawModels.map((m) => {
    const id = m.id ?? "";
    const supportsReasoning =
      m.supported_parameters?.includes("reasoning") ?? false;
    return {
      uid: id,
      key: id,
      displayName: id,
      maxContextLength: m.context_length ?? null,
      loadedContextLength: null,
      isLoaded: false,
      supportsReasoning,
      defaultReasoningOn: supportsReasoning,
      raw: {
        type: "llm",
        key: id,
        context_length: m.context_length,
        supported_parameters: m.supported_parameters,
        object: m.object,
        owned_by: m.owned_by,
      } as LmStudioNativeModel,
    };
  });
  // Same unique-uid treatment for compat-fallback models.
  const uidCounts = new Map<string, number>();
  return models.map((m) => {
    const count = (uidCounts.get(m.uid) ?? 0) + 1;
    uidCounts.set(m.uid, count);
    if (count > 1) {
      return { ...m, uid: `${m.uid}:#${count}` };
    }
    return m;
  });
}

/**
 * Returns whether `modelKey` currently has at least one loaded instance.
 * Returns null if the native model endpoint cannot be queried.
 */
export async function isModelLoaded(
  baseUrl: string,
  apiKey: string | undefined,
  modelKey: string,
): Promise<boolean | null> {
  const models = await listNativeLlmModels(baseUrl, apiKey);
  if (!models) return null;
  const model = models.find((m) => m.key === modelKey);
  if (!model) return false;
  return (model.loaded_instances?.length ?? 0) > 0;
}

/**
 * Returns the loaded context window size for the currently-loaded instance of
 * `modelKey`, or null if the native API is unavailable or the model is not loaded.
 *
 * Uses the LM Studio native /api/v1/models endpoint (not the OpenAI-compat one).
 */
export async function getLoadedContextLength(
  baseUrl: string,
  apiKey: string | undefined,
  modelKey: string,
): Promise<number | null> {
  const models = await listNativeLlmModels(baseUrl, apiKey);
  if (!models) return null;
  const model = models.find((m) => m.key === modelKey);
  return model?.loaded_instances?.[0]?.config?.context_length ?? null;
}

export async function loadModel(
  baseUrl: string,
  apiKey: string | undefined,
  modelKey: string,
  contextSize?: number,
): Promise<void> {
  const url = `${rootUrl(baseUrl)}/api/v1/models/load`;
  const body: Record<string, unknown> = { model: modelKey };
  if (contextSize !== undefined) {
    body.context_length = contextSize;
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...authHeaders(apiKey),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `LM Studio load model failed: ${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
    );
  }
}

export async function unloadModel(
  baseUrl: string,
  apiKey: string | undefined,
  instanceId: string,
): Promise<void> {
  const url = `${rootUrl(baseUrl)}/api/v1/models/unload`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...authHeaders(apiKey),
    },
    body: JSON.stringify({ instance_id: instanceId }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `LM Studio unload model failed: ${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
    );
  }
}
