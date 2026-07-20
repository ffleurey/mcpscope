/**
 * Provider-aware context length resolution.
 *
 * Different providers expose model context window size through different
 * endpoints. This module provides a single entry point that dispatches
 * to the right mechanism per provider.
 *
 * - **Ollama**: native `/api/show` endpoint, with multiple model-key formats
 *   as fallback; then OAI `/v1/models`; then user-configured `contextSize`.
 * - **OpenRouter / OpenAI**: OAI `/v1/models` endpoint.
 * - **LM Studio**: handled by the gateway's `getLoadedContextLength()` call
 *   (native `/api/v1/models`); this module serves as the fallback.
 */

import type { ProviderType } from './index.js'
import { rootUrl, listModels } from '../openai/client.js'

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the model's context window size.
 *
 * The user-configured `contextSize` always takes priority because it's what
 * gets sent as `num_ctx` / `context_length` in every chat request — that
 * is the actual context window the model is loaded with. The native API
 * value (e.g. Ollama `/api/show`) is the model's *maximum* capability,
 * which may not match what was configured.
 *
 * Resolution order:
 *   1. User-configured `contextSize` from the model config
 *   2. Native provider API (e.g. Ollama `/api/show`)
 *   3. OAI `/v1/models` endpoint (OpenRouter, OpenAI, etc.)
 *
 * Returns `null` when none of the above succeed.
 */
export async function getProviderContextLength(
  baseUrl: string,
  apiKey: string | undefined,
  modelKey: string,
  provider: ProviderType,
  configuredContextSize?: number | null,
): Promise<number | null> {
  // User-configured contextSize is authoritative — it's sent as num_ctx.
  if (configuredContextSize != null) return configuredContextSize

  // No explicit config: try native provider API for the model's default.
  if (provider === 'ollama') {
    const native = await getOllamaNativeContextLength(baseUrl, modelKey)
    if (native != null) return native
  }

  // Fall back to OAI /v1/models endpoint.
  return getOaiContextLengthFromModels(baseUrl, apiKey, modelKey)
}

// ─────────────────────────────────────────────────────────────────────────────
// Ollama: /api/show endpoint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Try to fetch model info from Ollama's /api/show endpoint.
 *
 * Ollama's model-info keys use the pattern `{family}.context_length` where
 * the family varies by model (e.g. `qwen2.context_length`, `llama.context_length`).
 *
 * We try several model-key formats because Ollama's /api/show can be
 * sensitive to tag and version suffixes:
 *   1. Exact model key as provided (e.g. `qwen3.5:9b`)
 *   2. Model name without tag (e.g. `qwen3.5`)
 *   3. Model name with `:latest` tag (e.g. `qwen3.5:latest`)
 */
async function getOllamaNativeContextLength(
  baseUrl: string,
  modelKey: string,
): Promise<number | null> {
  const apiUrl = `${rootUrl(baseUrl)}/api/show`
  const modelKeyVariants = buildOllamaModelKeyVariants(modelKey)

  for (const variant of modelKeyVariants) {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: variant }),
      })
      if (!response.ok) continue

      const rawText = await response.text()
      let data: Record<string, unknown>
      try {
        data = JSON.parse(rawText) as Record<string, unknown>
      } catch {
        continue
      }

      // Check model_info sub-object first, then top-level fields.
      const modelInfo = data.model_info as Record<string, unknown> | undefined
      let length = modelInfo != null ? extractContextLengthFromModelInfo(modelInfo) : null
      if (length == null) {
        length = extractContextLengthFromModelInfo(data)
      }
      if (length != null) return length
    } catch {
      continue
    }
  }

  return null
}

/**
 * Extract context_length from Ollama model_info.
 *
 * Handles these key patterns:
 * - `{family}.context_length` (e.g. `qwen2.context_length`)
 * - `context_length` (bare key, less common)
 *
 * Accepts both number and string values (parses numeric strings).
 */
function extractContextLengthFromModelInfo(modelInfo: Record<string, unknown>): number | null {
  for (const [key, value] of Object.entries(modelInfo)) {
    if (!key.endsWith('context_length')) continue

    if (typeof value === 'number') {
      return value
    }
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10)
      if (!isNaN(parsed) && parsed > 0) return parsed
    }
  }
  return null
}

/**
 * Build model key variants to try with Ollama /api/show.
 * Ollama can be sensitive to tag suffixes, so we try multiple formats.
 */
function buildOllamaModelKeyVariants(modelKey: string): string[] {
  const variants: string[] = []

  // 1. Exact key as provided
  variants.push(modelKey)

  // 2. If the key has a tag (e.g. "qwen3.5:9b"), try without it
  if (modelKey.includes(':')) {
    const name = modelKey.split(':')[0]
    if (name && name.length > 0) {
      variants.push(name)
      variants.push(`${name}:latest`)
    }
  }

  // Deliberately NO bare-"latest" catch-all: querying /api/show for "latest"
  // asks about a key unrelated to the requested model and could silently
  // attribute another model's context_length to it.

  return variants
}

// ─────────────────────────────────────────────────────────────────────────────
// OAI /v1/models endpoint (OpenRouter, OpenAI, LM Studio compat, etc.)
// ─────────────────────────────────────────────────────────────────────────────

async function getOaiContextLengthFromModels(
  baseUrl: string,
  apiKey: string | undefined,
  modelKey: string,
): Promise<number | null> {
  try {
    const modelList = await listModels(baseUrl, apiKey)
    const match = modelList.data?.find((m) => m.id === modelKey)
    return match?.context_length ?? null
  } catch {
    return null
  }
}
