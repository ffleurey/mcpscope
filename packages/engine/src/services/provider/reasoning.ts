/**
 * Provider-specific reasoning request body builder.
 *
 * This consolidates all provider-specific reasoning parameter logic
 * into a single module. Each provider has different conventions:
 *
 * - **LM Studio**: uses `reasoning: "on"|"off"` as a direct string param
 * - **OpenRouter**: uses `reasoning: {}` and `include_reasoning: true`
 * - **Ollama**: uses `think: true` (boolean; some models accept "low"|"medium"|"high")
 *
 * The shared extraction logic (looking up reasoning content from streaming
 * deltas and response messages) lives in openai/client.ts via
 * `extractReasoningContent()`, which checks all known field names
 * (reasoning_content, reasoning, thinking) dynamically.
 */

/**
 * Estimate token count from text using a 4-characters-per-token heuristic.
 *
 * This is a rough estimate used when the API does not report token counts
 * (e.g. fallback for providers whose responses lack usage info).
 */
export function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.round(text.length / 4))
}

/**
 * Build provider-specific reasoning request body params.
 *
 * @param reasoning - The user's reasoning preference ("on", "off", or null)
 * @param baseUrl  - The connection base URL
 * @param providerType - Optional explicit provider type (avoids URL sniffing)
 * @returns A record of params to spread into the request body, or `{}` when
 *          no reasoning params are needed.
 *
 * Semantics:
 * - `null` → no preference, return empty (provider default behavior)
 * - `"off"` → for LM Studio, sends `reasoning: "off"` (disables reasoning).
 *              For other providers, returns empty (they don't support
 *              disabling reasoning in the request body).
 * - `"on"`  → provider-specific enable-reasoning params.
 */
export function buildReasoningParams(
  reasoning: string | null,
  _baseUrl: string,
  providerType?: string | null,
): Record<string, unknown> {
  // No preference → let the provider use its default
  if (reasoning === null) return {}

  const provider =
    providerType === 'openrouter' || providerType === 'ollama' ? providerType : 'lmstudio'

  // LM Studio always uses explicit reasoning: "on"|"off" in request body
  if (provider === 'lmstudio') {
    return { reasoning }
  }

  // For non-LM-Studio providers, only send params when reasoning is on
  if (reasoning !== 'on') return {}

  switch (provider) {
    case 'openrouter':
      return { reasoning: {}, include_reasoning: true }
    case 'ollama':
      return { think: true }
    default:
      return {}
  }
}
