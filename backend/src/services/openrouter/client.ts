/**
 * Thin OpenRouter client.
 *
 * OpenRouter is fully OpenAI API-compatible, so the generic OAI functions from
 * the LM Studio client work as-is. This module re-exports them and provides an
 * OpenRouter-specific model listing fallback.
 *
 * The main differences from LM Studio:
 *   1. No `reasoning: "on"|"off"` in request body (OpenRouter handles reasoning
 *      via model-level configuration or provider headers).
 *   2. No model load/unload lifecycle — all models are always available.
 *   3. No native model metadata API (max context length, etc.).
 */

import {
  createChatCompletion,
  listModels,
  parseChatCompletionStream,
  probePromptTokens,
  probePromptTokensDetailed,
  streamChatCompletion,
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
} from '../lmstudio/client.js'

export {
  createChatCompletion,
  listModels,
  parseChatCompletionStream,
  probePromptTokens,
  probePromptTokensDetailed,
  streamChatCompletion,
}

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
}
