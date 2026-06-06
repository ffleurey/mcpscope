import { z } from 'zod'

export const lmStudioConnectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const modelConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  connectionId: z.string(),
  modelKey: z.string(),
  modelDisplayName: z.string(),
  systemPrompt: z.string(),
  temperature: z.number(),
  reasoning: z.enum(['on', 'off']).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const mcpServerProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  transport: z.literal('streamable-http'),
  authType: z.enum(['none', 'bearer', 'basic']).nullable().default(null),
  authValue: z.string().nullable().default(null),
  defaultEnabled: z.boolean().default(false),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export type LmStudioConnection = z.infer<typeof lmStudioConnectionSchema>
export type ModelConfig = z.infer<typeof modelConfigSchema>
export type McpServerProfile = z.infer<typeof mcpServerProfileSchema>
