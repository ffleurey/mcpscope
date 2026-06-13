/**
 * Provider-aware stream response usage normalizer.
 *
 * Each provider reports token usage differently in streaming responses:
 *
 * - **LM Studio / OpenRouter** (standard OpenAI):
 *   One or more chunks carry a `usage` sub-object with the standard
 *   OpenAI keys (`prompt_tokens`, `completion_tokens`, `total_tokens`,
 *   and `completion_tokens_details.reasoning_tokens`).
 *
 * - **Ollama**:
 *   The final chunk has `"done": true` with top-level `prompt_eval_count`
 *   and `eval_count`. No separate `reasoning_tokens` breakdown is
 *   reported — it must be estimated from the thinking text.
 *
 * This module replaces ad-hoc OpenAI-format assumptions in
 * `tokenAccounting.ts` with a provider-aware entry point.
 */

import { type ProviderType } from "./detection.js";
import type { NormalizedUsage } from "../../domain/tokenAccounting.js";

// ─────────────────────────────────────────────────────────────────────────────
// Internal: SSE payload parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split raw SSE text into individual data payloads, one per blank-line boundary.
 */
function parseSsePayloads(rawText: string): string[] {
  const payloads: string[] = [];
  let currentDataLines: string[] = [];

  for (const rawLine of rawText.split(/\r?\n/)) {
    if (rawLine.length === 0) {
      if (currentDataLines.length > 0) {
        payloads.push(currentDataLines.join("\n"));
        currentDataLines = [];
      }
      continue;
    }
    if (rawLine.startsWith("data:")) {
      currentDataLines.push(rawLine.slice(5).trimStart());
    }
  }

  if (currentDataLines.length > 0) {
    payloads.push(currentDataLines.join("\n"));
  }

  return payloads;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: extract NormalizedUsage from a usage-like object
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse an OAI-compatible `usage` object into `NormalizedUsage`.
 *
 * Handles both top-level `reasoning_tokens` and nested
 * `completion_tokens_details.reasoning_tokens`.
 */
function usageFromObject(
  obj: Record<string, unknown> | undefined | null,
): NormalizedUsage | null {
  if (!obj) return null;

  const promptTokens =
    typeof obj.prompt_tokens === "number"
      ? (obj.prompt_tokens as number)
      : null;
  const completionTokens =
    typeof obj.completion_tokens === "number"
      ? (obj.completion_tokens as number)
      : null;
  const totalTokens =
    typeof obj.total_tokens === "number" ? (obj.total_tokens as number) : null;

  const details = obj.completion_tokens_details as
    | Record<string, unknown>
    | undefined;
  const reasoningTokens =
    typeof obj.reasoning_tokens === "number"
      ? (obj.reasoning_tokens as number)
      : details && typeof details.reasoning_tokens === "number"
        ? (details.reasoning_tokens as number)
        : null;

  return {
    promptTokens,
    completionTokens,
    reasoningTokens,
    totalTokens,
    assistantContentTokens:
      completionTokens != null
        ? Math.max(0, completionTokens - (reasoningTokens ?? 0))
        : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OAI-compatible normalizer (LM Studio, OpenRouter)
// ─────────────────────────────────────────────────────────────────────────────

function normalizeOaiUsage(rawResponseBody: string): NormalizedUsage {
  // Detect whether the response is SSE-formatted (streaming) or plain JSON
  // (non-streaming fallback). SSE detection checks for `data:` lines rather
  // than checking if the body starts with `data:`, because some providers
  // prefix SSE with comment lines (e.g. OpenRouter sends `: OPENROUTER PROCESSING`).
  const isSse =
    rawResponseBody.includes("\ndata:") || rawResponseBody.startsWith("data:");

  if (!isSse) {
    // Plain JSON (non-streaming fallback) — one-shot completion response
    try {
      const parsed = JSON.parse(rawResponseBody) as Record<string, unknown>;
      const result = usageFromObject(
        parsed.usage as Record<string, unknown> | undefined,
      );
      if (result) return result;
    } catch {
      // ignore
    }
    return nullUsage();
  }

  // SSE format — iterate over chunks, last usage wins
  const payloads = parseSsePayloads(rawResponseBody);
  let result: NormalizedUsage | null = null;

  for (const payload of payloads) {
    if (payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload) as Record<string, unknown>;
      const parsed = usageFromObject(
        chunk.usage as Record<string, unknown> | undefined,
      );
      if (parsed) {
        result = parsed;
        // Keep iterating — the last chunk with usage wins (final usage
        // summary appears at the end of the stream).
      }
    } catch {
      continue;
    }
  }

  return result ?? nullUsage();
}

// ─────────────────────────────────────────────────────────────────────────────
// Ollama normalizer
// ─────────────────────────────────────────────────────────────────────────────

function normalizeOllamaUsage(rawResponseBody: string): NormalizedUsage {
  const result = tryOllamaNativeUsage(rawResponseBody);
  if (result) return result;

  // Fallback: Ollama's OAI-compat API may return standard OpenAI-format
  // usage chunks (without "done": true / prompt_eval_count fields).
  const oaiResult = normalizeOaiUsage(rawResponseBody);
  if (oaiResult.completionTokens != null) {
    // Ollama does not report reasoning tokens separately.  The
    // text-length estimation heuristic (4 chars/token) is unreliable
    // for reasoning models — it can dramatically undercount, causing
    // the difference (completion − estimated_reasoning) to inflate
    // other parts' token counts.  We therefore leave reasoningTokens
    // as null and attribute all completion tokens to content.
    // The reasoning parts will still get display estimates from
    // the text-length fallback in buildReasoningPartsFromSegments.
    return {
      ...oaiResult,
      reasoningTokens: null,
      assistantContentTokens: oaiResult.completionTokens,
    };
  }

  return nullUsage();
}

/**
 * Try to extract usage from Ollama's native SSE format
 * ("done": true with prompt_eval_count / eval_count).
 * Handles both SSE-streaming and plain JSON response bodies.
 */
function tryOllamaNativeUsage(rawResponseBody: string): NormalizedUsage | null {
  const payloads = rawResponseBody.startsWith("data:")
    ? parseSsePayloads(rawResponseBody)
    : [rawResponseBody];

  for (const raw of payloads) {
    if (raw === "[DONE]") continue;
    try {
      const chunk = JSON.parse(raw) as Record<string, unknown>;
      if (chunk.done !== true) continue;

      const promptEvalCount =
        typeof chunk.prompt_eval_count === "number"
          ? (chunk.prompt_eval_count as number)
          : null;
      const evalCount =
        typeof chunk.eval_count === "number"
          ? (chunk.eval_count as number)
          : null;

      // Ollama does not report reasoning tokens separately.
      // Leave as null — the text-length heuristic is unreliable and
      // would inflate content token attribution.  Reasoning parts
      // get display estimates via buildReasoningPartsFromSegments.
      return {
        promptTokens: promptEvalCount,
        completionTokens: evalCount,
        reasoningTokens: null,
        totalTokens:
          promptEvalCount != null && evalCount != null
            ? promptEvalCount + evalCount
            : null,
        assistantContentTokens: evalCount,
      };
    } catch {
      continue;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback
// ─────────────────────────────────────────────────────────────────────────────

function nullUsage(): NormalizedUsage {
  return {
    promptTokens: null,
    completionTokens: null,
    reasoningTokens: null,
    totalTokens: null,
    assistantContentTokens: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter normalizer
// ─────────────────────────────────────────────────────────────────────────────

function normalizeOpenRouterUsage(rawResponseBody: string): NormalizedUsage {
  // OpenRouter follows standard OAI streaming format.  The SSE may be
  // prefixed with a comment line (`: OPENROUTER PROCESSING`), so the
  // SSE detection in normalizeOaiUsage checks for `\ndata:` rather than
  // requiring the body to start with `data:`.
  return normalizeOaiUsage(rawResponseBody);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a streaming response body from a specific provider into
 * canonical `NormalizedUsage`.
 *
 * @param rawResponseBody - The raw SSE response text (or plain JSON for
 *                          non-streaming fallback).
 * @param provider        - Provider type (determines which parser to use).
 */
export function normalizeStreamUsage(
  rawResponseBody: string,
  provider: ProviderType,
): NormalizedUsage {
  switch (provider) {
    case "ollama":
      return normalizeOllamaUsage(rawResponseBody);
    case "openrouter":
      return normalizeOpenRouterUsage(rawResponseBody);
    case "lmstudio":
    default:
      return normalizeOaiUsage(rawResponseBody);
  }
}
