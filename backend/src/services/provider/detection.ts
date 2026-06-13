/**
 * Provider type detection from a base URL.
 *
 * This is the single source of truth for identifying which LLM provider
 * a given connection base URL points to. Using URL keyword detection is
 * pragmatic — providers are identified by characteristic URL patterns
 * (e.g. "openrouter" in the hostname, "ollama" in the hostname).
 *
 * All provider-specific request-param logic should use this function
 * rather than ad-hoc URL sniffing scattered across the codebase.
 */

export type ProviderType = "lmstudio" | "openrouter" | "ollama" | "openai";

const URL_PATTERNS: Array<{
  match: (url: string) => boolean;
  provider: ProviderType;
}> = [
  // OpenRouter: characteristic hostname keyword
  { match: (url) => url.includes("openrouter"), provider: "openrouter" },
  // Ollama: hostname keyword or default port 11434
  {
    match: (url) => url.includes("ollama") || url.includes(":11434"),
    provider: "ollama",
  },
  // Default to lmstudio for unknown endpoints since LM Studio
  // is the most common self-hosted provider.
];

/**
 * Detect the provider type from a connection base URL.
 *
 * When an explicit `providerType` is provided (from the connection config),
 * it takes priority over URL-based detection.  This avoids fragile URL
 * sniffing for installations using non-default ports or custom domains.
 */
export function detectProvider(
  baseUrl: string,
  explicitProviderType?: string | null,
): ProviderType {
  // Explicit provider type from the connection config is authoritative.
  if (explicitProviderType && isProviderType(explicitProviderType)) {
    return explicitProviderType;
  }

  // Fall back to URL-based detection for backward compatibility.
  const url = baseUrl.toLowerCase();
  for (const { match, provider } of URL_PATTERNS) {
    if (match(url)) return provider;
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
