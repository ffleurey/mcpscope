import { z } from "zod";
import {
  listLmConnections,
  listModelConfigs,
  listMcpServerProfiles,
  getSessionCreationDefaults,
} from "../persistence/repository.js";
import type { OperationContext } from "./context.js";

// ─── Model Configs ────────────────────────────────────────────────────────────

export const listModelConfigsInputSchema = z.object({});

export type ListModelConfigsInput = z.infer<typeof listModelConfigsInputSchema>;

export interface ModelConfigSummary {
  id: string;
  name: string;
  connection_name: string;
  model_key: string;
  provider_type: string | null;
  is_default: boolean;
}

export interface ListModelConfigsResult {
  model_configs: ModelConfigSummary[];
}

export const listModelConfigsOutputSchema = {
  model_configs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      connection_name: z.string(),
      model_key: z.string(),
      provider_type: z.string().nullable(),
      is_default: z.boolean(),
    }),
  ),
};

export const listModelConfigsOperation = {
  id: "list_model_configs" as const,
  description:
    "List all model configs with their ID, name, connection, model key, and provider type. "
    + "is_default marks the config used when create/benchmark_run omit a model.",
  schema: listModelConfigsInputSchema,
  outputSchema: listModelConfigsOutputSchema,
  async execute(
    _ctx: OperationContext,
    _input: ListModelConfigsInput,
  ): Promise<ListModelConfigsResult> {
    const configs = listModelConfigs();
    const connections = listLmConnections();
    const defaultId = getSessionCreationDefaults().defaultModelConfigId;

    return {
      model_configs: configs.map((mc) => {
        const conn = connections.find((c) => c.id === mc.connectionId);
        return {
          id: mc.id,
          name: mc.name,
          connection_name: conn?.name ?? mc.connectionId,
          model_key: mc.modelKey,
          provider_type: conn?.providerType ?? null,
          is_default: mc.id === defaultId,
        };
      }),
    };
  },
};

// ─── MCP Profiles ─────────────────────────────────────────────────────────────

export const listMcpProfilesInputSchema = z.object({});

export type ListMcpProfilesInput = z.infer<typeof listMcpProfilesInputSchema>;

export interface McpProfileSummary {
  id: string;
  name: string;
  url: string;
  default_enabled: boolean;
  /** "builtin" = bundled companion server (read-only); "user" = your own profile. */
  source: "builtin" | "user";
  /**
   * Non-null when the profile is currently unavailable — e.g. a key-gated companion
   * whose API key is not configured. The string names the config key to set. A
   * profile with a disabled_reason is rejected at session creation.
   */
  disabled_reason: string | null;
}

export interface ListMcpProfilesResult {
  mcp_profiles: McpProfileSummary[];
}

export const listMcpProfilesOutputSchema = {
  mcp_profiles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      url: z.string(),
      default_enabled: z.boolean(),
      source: z.enum(["builtin", "user"]),
      disabled_reason: z.string().nullable(),
    }),
  ),
};

export const listMcpProfilesOperation = {
  id: "list_mcp_profiles" as const,
  description:
    "List all MCP server profiles. Each carries its ID, name, URL, default-enabled " +
    "status, `source` ('builtin' for a bundled companion server, which is read-only, " +
    "vs 'user'), and `disabled_reason` (non-null when the profile is unavailable, e.g. " +
    "a key-gated companion whose API key is not configured — the string names the " +
    "config key to set; such a profile cannot be used to create a session).",
  schema: listMcpProfilesInputSchema,
  outputSchema: listMcpProfilesOutputSchema,
  async execute(
    _ctx: OperationContext,
    _input: ListMcpProfilesInput,
  ): Promise<ListMcpProfilesResult> {
    const profiles = listMcpServerProfiles();

    return {
      mcp_profiles: profiles.map((p) => ({
        id: p.id,
        name: p.name,
        url: p.url,
        default_enabled: p.defaultEnabled,
        source: p.source,
        disabled_reason: p.disabledReason,
      })),
    };
  },
};
