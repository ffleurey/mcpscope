/**
 * Provider type resolution.
 *
 * Each LM Connection carries a `providerType` field set by the user
 * (see `providerConnectionSchema` in configuration.ts).  This function
 * returns the authoritative provider type from the connection config,
 * with a default fallback for sessions that predate the field.
 *
 * All provider-specific logic should use this function rather than
 * ad-hoc URL sniffing or hard-coded checks scattered across the codebase.
 */

export type ProviderType = "lmstudio" | "openrouter" | "ollama" | "openai";

/**
 * Resolve the provider type.
 *
 * @param baseUrl              - Kept for ABI compatibility; unused.
 * @param explicitProviderType - The `providerType` from the connection config,
 *                               stored in `modelProfileSnapshot`.
 *                               When null/undefined, defaults to `"lmstudio"`.
 */
export function detectProvider(
  _baseUrl: string,
  explicitProviderType?: string | null,
): ProviderType {
  if (explicitProviderType && isProviderType(explicitProviderType)) {
    return explicitProviderType;
  }
  return "lmstudio";
}

function isProviderType(value: string): value is ProviderType {
  return (["lmstudio", "openrouter", "ollama", "openai"] as string[]).includes(
    value,
  );
}

/**
 * Returns true when the provider supports user-controlled reasoning
 * (i.e. can enable/disable reasoning in the request body).
 */
export function supportsReasoningControl(provider: ProviderType): boolean {
  switch (provider) {
    case "lmstudio":
      return true;
    case "openrouter":
      return true;
    case "ollama":
      return true;
    case "openai":
      return false;
  }
}
