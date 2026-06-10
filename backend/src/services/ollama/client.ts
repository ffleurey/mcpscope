/**
 * Thin Ollama client.
 *
 * Ollama is OpenAI API-compatible (since v0.5.0), so the generic OAI functions
 * from the shared client work as-is. This module re-exports them and provides
 * an Ollama-specific model listing function.
 *
 * The main differences from LM Studio:
 *   1. No `reasoning: "on"|"off"` in request body — Ollama handles reasoning
 *      via model-level configuration.
 *   2. No model load/unload lifecycle — models load on first request.
 *   3. Ollama's native /api/tags endpoint lists models with `details` metadata
 *      (not OAI /v1/models format), but we can still use the /v1/models compat
 *      endpoint for basic listing and context length.
 */

import {
  createChatCompletion,
  listModels,
  parseChatCompletionStream,
  probePromptTokens,
  probePromptTokensDetailed,
  streamChatCompletion,
  rootUrl,
  type OaiChatCompletionResponse,
  type OaiChatCompletionUsage,
  type OaiChatCompletionChunk,
  type OaiModelListResponse,
  type OaiStreamedChatCompletionResult,
  type AssistantSegment,
  type StreamDelta,
  type StreamCallbacks,
  type PromptProbeResult,
  type ProbeRawExchange,
} from "../openai/client.js";

export {
  createChatCompletion,
  listModels,
  parseChatCompletionStream,
  probePromptTokens,
  probePromptTokensDetailed,
  streamChatCompletion,
};

export type {
  OaiChatCompletionResponse,
  OaiChatCompletionUsage,
  OaiChatCompletionChunk,
  OaiModelListResponse,
  OaiStreamedChatCompletionResult,
  AssistantSegment,
  StreamDelta,
  StreamCallbacks,
  PromptProbeResult,
  ProbeRawExchange,
};

// ─────────────────────────────────────────────────────────────────────────────
// Ollama-specific: context length via native /api/show endpoint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Queries Ollama's native /api/show endpoint to get the model's context length.
 *
 * Ollama's OAI-compat /v1/models endpoint may not always return context_length
 * for every model. The native /api/show endpoint provides detailed model info
 * including the context window size in model_info.
 */
/**
 * Fetches full model details from Ollama's native /api/show endpoint.
 */
export async function getOllamaModelDetails(
  baseUrl: string,
  modelKey: string,
): Promise<Record<string, unknown> | null> {
  try {
    const apiUrl = `${rootUrl(baseUrl)}/api/show`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelKey }),
    });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function getOllamaContextLength(
  baseUrl: string,
  modelKey: string,
): Promise<number | null> {
  try {
    const apiUrl = `${rootUrl(baseUrl)}/api/show`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelKey }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      model_info?: Record<string, unknown>;
    };
    if (!data.model_info) return null;
    // Search for any model_info key ending with context_length
    for (const [key, value] of Object.entries(data.model_info)) {
      if (key.endsWith("context_length") && typeof value === "number") {
        return value;
      }
    }
    return null;
  } catch {
    return null;
  }
}
