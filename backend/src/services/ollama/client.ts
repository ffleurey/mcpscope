/**
 * Thin Ollama client.
 *
 * Ollama is OpenAI API-compatible (since v0.5.0), so the generic OAI functions
 * from the shared openai client work as-is and are imported directly by callers.
 * This module only provides the Ollama-specific native /api/show model details
 * lookup that the OAI-compat endpoints do not expose.
 */

import { rootUrl } from "../openai/client.js";

// ─────────────────────────────────────────────────────────────────────────────
// Ollama-specific: full model details via native /api/show endpoint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches full model details from Ollama's native /api/show endpoint.
 *
 * Ollama's OAI-compat /v1/models endpoint does not return the detailed
 * model_info (including context window size) that /api/show provides.
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
