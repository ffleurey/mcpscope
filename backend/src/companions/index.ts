import type { FastifyInstance } from "fastify";
import { registerStreamableHttpMcp } from "../mcp/streamableHttp.js";
import type { CompanionsConfig, ConfigStore } from "mcpscope-engine/config/configStore.js";
import type { ListedMcpServerProfile } from "mcpscope-engine/domain/configuration.js";
import { COMPANIONS, type CompanionDefinition } from "./registry.js";

/** Resolve a companion's upstream API key from config (null when keyless or unset). */
function resolveApiKey(
  configStore: ConfigStore,
  companion: CompanionDefinition,
): string | null {
  if (!companion.requiresKey) return null;
  const config = configStore.getCompanionsConfig();
  const section = config[companion.requiresKey as keyof CompanionsConfig];
  return section?.api_key ?? null;
}

/**
 * Mount every bundled companion MCP server on the mcpscope app and register the
 * built-in profile provider so companions appear in the selectable MCP-server
 * list with no configuration. Called from app.ts right after registerMcpTransport.
 *
 * Companions run in-process on the same Fastify app, so they launch with mcpscope,
 * run whenever it runs, and are reachable by external MCP clients at
 * `http://<host>:<port>/companions/<name>/mcp`.
 */
export function registerCompanionServers(
  app: FastifyInstance,
  opts: { host: string; port: number; configStore: ConfigStore },
): void {
  const { configStore } = opts;
  for (const companion of COMPANIONS) {
    registerStreamableHttpMcp(app, `/companions/${companion.name}/mcp`, () =>
      // Read the key from the config store on each request rather than baking it
      // into the mount closure. (The store itself is loaded at startup, so editing
      // the config file still needs a restart to take effect.)
      companion.createServer({ apiKey: resolveApiKey(configStore, companion) }),
    );
  }
  configStore.setCompanionProfileProvider(() =>
    companionProfiles(configStore, opts.host, opts.port),
  );
}

/** Format a bind host for a URL, bracketing IPv6 literals (e.g. `::1` → `[::1]`). */
function hostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

/**
 * Synthesize one read-only built-in `McpServerProfile` per companion. These are
 * never written to the user's config file; their URL tracks the current host/port.
 * Key-gated companions carry a `disabledReason` naming the config key to set.
 *
 * Invoked by the profile provider on every `listMcpServerProfiles()` call (not once
 * at registration), so `disabledReason` reflects the current config each listing.
 */
export function companionProfiles(
  configStore: ConfigStore,
  host: string,
  port: number,
): ListedMcpServerProfile[] {
  const urlHost = hostForUrl(host);
  return COMPANIONS.map((companion) => {
    // Keyless companions are always enabled. A key-gated companion whose key is not
    // configured is still listed but carries a tooltip naming the config key to set;
    // the frontend greys it out and CLI/MCP surface the same reason.
    const missingKey =
      companion.requiresKey !== null &&
      resolveApiKey(configStore, companion) === null;
    return {
      id: `builtin-${companion.name}`,
      name: companion.title,
      url: `http://${urlHost}:${port}/companions/${companion.name}/mcp`,
      transport: "streamable-http" as const,
      authType: "none" as const,
      authValue: null,
      defaultEnabled: false,
      createdAt: 0,
      updatedAt: 0,
      source: "builtin" as const,
      disabledReason: missingKey
        ? `Set companions.${companion.requiresKey}.api_key in the mcpscope config file to enable this server.`
        : null,
    };
  });
}
