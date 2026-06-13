import {
  listLmConnectionModels,
  loadLmConnectionModel,
  type LmConnectionModel,
  unloadLmConnectionModel,
} from "../api/backendClient";

// LM Studio 0.4+ native model shape from /api/v1/models
export interface LmStudioNativeModel {
  type: string;
  key: string;
  display_name?: string;
  publisher?: string;
  architecture?: string;
  quantization?: { name?: string; bits_per_weight?: number };
  size_bytes?: number;
  params_string?: string;
  max_context_length?: number;
  format?: string;
  loaded_instances?: {
    id: string;
    config: {
      context_length: number;
      eval_batch_size?: number;
      parallel?: number;
      flash_attention?: boolean;
      offload_kv_cache_to_gpu?: boolean;
    };
    remaining_ttl_seconds?: number;
  }[];
  capabilities?: {
    vision?: boolean;
    trained_for_tool_use?: boolean;
    reasoning?: {
      allowed_options?: string[];
      default?: string;
    };
  };
  variants?: string[];
  selected_variant?: string;
}

export interface LmStudioModel {
  uid: string; // unique per entry: key + ':' + displayName (for {#each})
  key: string; // model key sent to the API (may repeat across cluster nodes)
  displayName: string;
  maxContextLength: number | null; // model's architectural maximum
  loadedContextLength: number | null; // actual context when loaded (may be much smaller)
  isLoaded: boolean;
  supportsReasoning: boolean;
  defaultReasoningOn: boolean;
  raw: LmStudioNativeModel; // full native API response for this model
}

export async function listModels(
  baseUrl: string,
  apiKey?: string,
  providerType?: "lmstudio" | "openrouter" | "ollama",
): Promise<LmStudioModel[]> {
  const response = await listLmConnectionModels(
    baseUrl,
    apiKey ?? null,
    providerType,
  );
  return response.models.map((model: LmConnectionModel) => ({
    uid: model.uid,
    key: model.key,
    displayName: model.displayName,
    maxContextLength: model.maxContextLength,
    loadedContextLength: model.loadedContextLength,
    isLoaded: model.isLoaded,
    supportsReasoning: model.supportsReasoning,
    defaultReasoningOn: model.defaultReasoningOn,
    raw: model.raw as LmStudioNativeModel,
  }));
}

export async function loadModel(
  baseUrl: string,
  modelKey: string,
  apiKey?: string,
  contextSize?: number,
  providerType?: string,
): Promise<void> {
  await loadLmConnectionModel(
    baseUrl,
    modelKey,
    apiKey ?? null,
    contextSize,
    providerType,
  );
}

export async function unloadModel(
  baseUrl: string,
  instanceId: string,
  apiKey?: string,
  providerType?: string,
): Promise<void> {
  await unloadLmConnectionModel(
    baseUrl,
    instanceId,
    apiKey ?? null,
    providerType,
  );
}
