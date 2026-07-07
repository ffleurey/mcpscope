import { z } from "zod";

export const providerTypeValues = ["lmstudio", "openrouter", "ollama"] as const;

const idPattern = /^[a-zA-Z0-9_-]+$/;

export const providerConnectionSchema = z.object({
  id: z
    .string()
    .regex(
      idPattern,
      "ID must only contain letters, numbers, hyphens, and underscores",
    ),
  name: z.string(),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  providerType: z.enum(providerTypeValues).default("lmstudio"),
  // When enabled (LM Studio only), mcpscope unloads any other model loaded on
  // this instance before serving a request for a different model — so a single
  // VRAM-limited instance can be driven from the CLI/MCP without manual
  // load/unload. No-op for ollama/openrouter, which auto-manage loading.
  autoSwapModel: z.boolean().optional(),
  createdAt: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(() => Date.now()),
  updatedAt: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(() => Date.now()),
});

/** Backward-compatible alias used by persistence layer. */
export const lmStudioConnectionSchema = providerConnectionSchema;

export const modelConfigSchemaBase = z.object({
  id: z
    .string()
    .regex(
      idPattern,
      "ID must only contain letters, numbers, hyphens, and underscores",
    ),
  name: z.string(),
  connectionId: z.string(),
  modelKey: z.string(),
  modelDisplayName: z.string().optional(),
  systemPrompt: z.string().optional().default(""),
  // Optional: when unset the request omits `temperature` entirely, letting the
  // provider use its own default. Mirrors `contextSize`. 0 is a valid value, so
  // "unset" must be represented by absence, never by a falsy number.
  temperature: z.number().min(0).optional(),
  reasoning: z.enum(["on", "off"]).optional(),
  contextSize: z.number().int().positive().optional(),
  createdAt: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(() => Date.now()),
  updatedAt: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(() => Date.now()),
});

/** Parsed model config: fills in modelDisplayName from modelKey when omitted. */
export const modelConfigSchema = modelConfigSchemaBase.transform((data) => ({
  ...data,
  modelDisplayName: data.modelDisplayName ?? data.modelKey,
}));

export const mcpServerProfileSchema = z.object({
  id: z
    .string()
    .regex(
      idPattern,
      "ID must only contain letters, numbers, hyphens, and underscores",
    ),
  name: z.string(),
  url: z.string().url(),
  transport: z.literal("streamable-http").optional().default("streamable-http"),
  authType: z.enum(["none", "bearer", "basic"]).nullable().default(null),
  authValue: z.string().nullable().default(null),
  defaultEnabled: z.boolean().default(false),
  createdAt: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(() => Date.now()),
  updatedAt: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(() => Date.now()),
});

export type ProviderConnection = z.infer<typeof providerConnectionSchema>;
export type LmStudioConnection = ProviderConnection;
export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type McpServerProfile = z.infer<typeof mcpServerProfileSchema>;

/**
 * An MCP profile as surfaced to listing consumers (UI/CLI/MCP), tagged with its
 * origin. Persisted user profiles are `source: "user"`; bundled companion servers
 * are synthesized as `source: "builtin"` and are read-only. `disabledReason`, when
 * non-null, is a human message (e.g. "Set companions.guardian.api_key in the config
 * file") that clients show as a tooltip on a disabled selection control.
 */
export interface ListedMcpServerProfile extends McpServerProfile {
  source: "user" | "builtin";
  disabledReason: string | null;
}
