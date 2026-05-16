import { z } from 'zod'

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('mcpscope-backend'),
  version: z.string(),
  sqlitePath: z.string(),
})

export const modelProfileSnapshotInputSchema = z.object({
  id: z.string(),
  name: z.string(),
  connectionBaseUrl: z.string().url(),
  apiKey: z.string().nullable().default(null),
  modelKey: z.string(),
  modelDisplayName: z.string(),
  systemPrompt: z.string(),
  temperature: z.number(),
  reasoning: z.enum(['on', 'off']).nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const mcpProfileSnapshotInputSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  transport: z.literal('streamable-http'),
  authType: z.enum(['none', 'bearer', 'basic']).nullable().default(null),
  authValue: z.string().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const createSessionInputSchema = z.object({
  sessionId: z.string().optional(),
  title: z.string().optional(),
  modelProfileSnapshot: modelProfileSnapshotInputSchema,
  mcpProfileSnapshot: mcpProfileSnapshotInputSchema.nullable().optional(),
  compactionStrategy: z.enum(['none', 'strip-reasoning']).optional(),
})

export const createTurnInputSchema = z.object({
  userContent: z.string().min(1),
})
