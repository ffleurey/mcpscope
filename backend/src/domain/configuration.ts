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
  temperature: z.number().optional().default(0.7),
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
