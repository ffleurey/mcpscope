import { z } from 'zod'
import {
  lmStudioConnectionSchema,
  mcpServerProfileSchema,
  modelConfigSchema,
} from './configuration.js'
import { sessionRecordSchema } from './model.js'

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

export const createSessionResponseSchema = z.object({
  session: sessionRecordSchema,
})

export const listSessionsResponseSchema = z.object({
  sessions: z.array(sessionRecordSchema),
})

export const listLmConnectionsResponseSchema = z.object({
  lmConnections: z.array(lmStudioConnectionSchema),
})

export const listModelConfigsResponseSchema = z.object({
  modelConfigs: z.array(modelConfigSchema),
})

export const listMcpProfilesResponseSchema = z.object({
  mcpProfiles: z.array(mcpServerProfileSchema),
})
