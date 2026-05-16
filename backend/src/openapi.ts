import fs from 'node:fs'
import path from 'node:path'
import { OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  createSessionInputSchema,
  createSessionResponseSchema,
  healthResponseSchema,
  listSessionsResponseSchema,
} from './domain/apiSchemas.js'
import {
  compactionStrategySchema,
  contextStateSchema,
  partTypeSchema,
  roundFinishReasonSchema,
  roundStatusSchema,
  sessionInitStatusSchema,
  sessionStatusSchema,
  turnStatusSchema,
  usageSummarySchema,
} from './domain/model.js'
import { sessionTraceBundleSchema } from './domain/trace.js'

type LookupAuditEntry = {
  label: string
  method: 'GET' | 'POST'
  url: string
  statusCode: number
  requestPayload?: unknown
  responsePayload: unknown
}

const lookupPartKindSchema = z.enum(['setup', 'user_prompt', 'reasoning', 'tool_call', 'assistant_answer'])

const apiErrorSchema = z.object({
  error: z.object({
    type: z.enum(['validation', 'not_found', 'upstream', 'timeout', 'internal']),
    message: z.string(),
    code: z.string().optional(),
    details: z.unknown().optional(),
  }),
})

const lookupContextEntrySchema = z.object({
  id: z.string(),
  kind: lookupPartKindSchema,
  label: partTypeSchema,
  tokenCount: z.number().int().nonnegative().nullable(),
  state: contextStateSchema,
  preview: z.string().nullable(),
})

const lookupPartContextSchema = z.object({
  state: contextStateSchema,
  note: z.string().nullable(),
})

const lookupRoundSchema = z.object({
  id: z.string(),
  roundIndex: z.number().int().nonnegative(),
  status: roundStatusSchema,
  finishReason: roundFinishReasonSchema.nullable(),
  usage: usageSummarySchema,
})

const lookupRoundSummaryPartSchema = z.object({
  id: z.string(),
  kind: lookupPartKindSchema,
  label: partTypeSchema,
  toolName: z.string().nullable(),
  tokenCount: z.number().int().nonnegative().nullable(),
  preview: z.string().nullable(),
})

const lookupPartSummarySchema = z.union([
  z.object({
    id: z.string(),
    kind: z.literal('setup'),
    label: partTypeSchema,
    toolName: z.null(),
    tokenCount: z.number().int().nonnegative().nullable(),
    preview: z.string().nullable(),
    setupType: partTypeSchema,
    toolCount: z.number().int().nonnegative().nullable(),
    toolNames: z.array(z.string()).nullable(),
  }),
  z.object({
    id: z.string(),
    kind: z.enum(['user_prompt', 'reasoning', 'tool_call', 'assistant_answer']),
    label: partTypeSchema,
    toolName: z.string().nullable(),
    tokenCount: z.number().int().nonnegative().nullable(),
    preview: z.string().nullable(),
  }),
])

const lookupToolResponsePayloadSchema = z.object({
  id: z.string(),
  text: z.string().nullable(),
  json: z.unknown().nullable(),
  mimeType: z.string().nullable(),
})

const lookupToolCallPartFullSchema = z.object({
  id: z.string(),
  kind: z.literal('tool_call'),
  type: partTypeSchema,
  tokenCount: z.number().int().nonnegative().nullable(),
  toolName: z.string(),
  context: lookupPartContextSchema,
  toolCallPayload: z.unknown().nullable(),
  toolResponsePayload: z.array(lookupToolResponsePayloadSchema),
})

const lookupSetupPartFullSchema = z.object({
  id: z.string(),
  kind: z.literal('setup'),
  type: partTypeSchema,
  tokenCount: z.number().int().nonnegative().nullable(),
  preview: z.string().nullable().optional(),
  context: lookupPartContextSchema,
  setupType: partTypeSchema,
  summary: z.string().nullable(),
  toolCount: z.number().int().nonnegative().nullable(),
  toolNames: z.array(z.string()).nullable(),
})

const lookupContentPartFullSchema = z.object({
  id: z.string(),
  kind: z.enum(['user_prompt', 'reasoning', 'assistant_answer']),
  type: partTypeSchema,
  tokenCount: z.number().int().nonnegative().nullable(),
  context: lookupPartContextSchema,
  content: z.object({
    text: z.string().nullable(),
    json: z.unknown().nullable(),
    mimeType: z.string().nullable(),
    summary: z.string().nullable(),
  }),
})

const lookupPartFullSchema = z.union([
  lookupToolCallPartFullSchema,
  lookupSetupPartFullSchema,
  lookupContentPartFullSchema,
])

const sessionLookupSummarySchema = z.object({
  id: z.string(),
  type: z.literal('session'),
  mode: z.literal('summary'),
  data: z.object({
    session: z.object({
      id: z.string(),
      title: z.string(),
      status: sessionStatusSchema,
      initStatus: sessionInitStatusSchema,
      isContextExhausted: z.boolean(),
    }),
    turns: z.array(z.object({
      id: z.string(),
      sequenceNumber: z.number().int().nonnegative(),
      status: turnStatusSchema,
    })),
  }),
})

const sessionLookupFullSchema = z.object({
  id: z.string(),
  type: z.literal('session'),
  mode: z.literal('full'),
  data: z.object({
    session: z.object({
      id: z.string(),
      title: z.string(),
      status: sessionStatusSchema,
      initStatus: sessionInitStatusSchema,
      isContextExhausted: z.boolean(),
      modelProfileName: z.string(),
      modelKey: z.string(),
      mcpProfileName: z.string().nullable(),
      compactionStrategy: compactionStrategySchema,
    }),
    context: z.array(lookupContextEntrySchema),
    turns: z.array(z.object({
      id: z.string(),
      sequenceNumber: z.number().int().nonnegative(),
      status: turnStatusSchema,
      outcome: z.string().nullable(),
      usage: usageSummarySchema,
    })),
  }),
})

const turnLookupSummarySchema = z.object({
  id: z.string(),
  type: z.literal('turn'),
  mode: z.literal('summary'),
  data: z.object({
    turn: z.object({
      id: z.string(),
      sequenceNumber: z.number().int().nonnegative(),
      status: turnStatusSchema,
      outcome: z.string().nullable(),
    }),
    rounds: z.array(z.object({
      id: z.string(),
      roundIndex: z.number().int().nonnegative(),
      status: roundStatusSchema,
      finishReason: roundFinishReasonSchema.nullable(),
    })),
  }),
})

const turnLookupFullSchema = z.object({
  id: z.string(),
  type: z.literal('turn'),
  mode: z.literal('full'),
  data: z.object({
    turn: z.object({
      id: z.string(),
      sequenceNumber: z.number().int().nonnegative(),
      status: turnStatusSchema,
      outcome: z.string().nullable(),
      usage: usageSummarySchema,
      compactionApplied: compactionStrategySchema.nullable(),
    }),
    context: z.array(lookupContextEntrySchema),
    rounds: z.array(lookupRoundSchema),
    session: z.object({
      id: z.string(),
      title: z.string(),
    }),
  }),
})

const roundLookupSummarySchema = z.object({
  id: z.string(),
  type: z.literal('round'),
  mode: z.literal('summary'),
  data: z.object({
    round: lookupRoundSchema,
    parts: z.array(lookupRoundSummaryPartSchema),
  }),
})

const roundLookupFullSchema = z.object({
  id: z.string(),
  type: z.literal('round'),
  mode: z.literal('full'),
  data: z.object({
    round: lookupRoundSchema,
    context: z.array(lookupContextEntrySchema),
    parts: z.array(lookupPartFullSchema),
  }),
})

const partLookupSummarySchema = z.object({
  id: z.string(),
  type: z.literal('part'),
  mode: z.literal('summary'),
  data: z.object({
    part: lookupPartSummarySchema,
  }),
})

const partLookupFullSchema = z.object({
  id: z.string(),
  type: z.literal('part'),
  mode: z.literal('full'),
  data: z.object({
    part: lookupPartFullSchema,
  }),
})

const hierarchicalLookupResponseSchema = z.union([
  sessionLookupSummarySchema,
  sessionLookupFullSchema,
  turnLookupSummarySchema,
  turnLookupFullSchema,
  roundLookupSummarySchema,
  roundLookupFullSchema,
  partLookupSummarySchema,
  partLookupFullSchema,
])

function getLookupAuditFilePath() {
  return path.resolve('test-results', 'lookup-api-payload-audit.json')
}

function loadLookupAuditEntries(): LookupAuditEntry[] {
  const auditPath = getLookupAuditFilePath()
  if (!fs.existsSync(auditPath)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(auditPath, 'utf8')) as { entries?: LookupAuditEntry[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function loadTraceFixture() {
  const fixturePath = path.resolve('exports', 'test-with-multiple-turns-and-tools.trace.json')
  if (!fs.existsSync(fixturePath)) return undefined
  try {
    return JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  } catch {
    return undefined
  }
}

function findAuditEntry(entries: LookupAuditEntry[], label: string) {
  return entries.find(entry => entry.label === label)
}

function createOpenApiExamples(entries: LookupAuditEntry[], labels: string[]) {
  return Object.fromEntries(
    labels.flatMap((label) => {
      const entry = findAuditEntry(entries, label)
      if (!entry) return []
      return [[label, { summary: label.replaceAll('-', ' '), value: entry.responsePayload }]]
    }),
  )
}

export function buildOpenApiDocument(appVersion: string) {
  const registry = new OpenAPIRegistry()
  const lookupAuditEntries = loadLookupAuditEntries()
  const traceFixture = loadTraceFixture()

  const sessionIdParamSchema = z.object({
    sessionId: z.string(),
  })

  const lookupIdParamSchema = z.object({
    id: z.string(),
  })

  const lookupQuerySchema = z.object({
    mode: z.enum(['summary', 'full']).optional(),
  })

  registry.registerPath({
    method: 'get',
    path: '/api/health',
    tags: ['System'],
    summary: 'Health check',
    responses: {
      200: {
        description: 'Backend health status',
        content: {
          'application/json': {
            schema: healthResponseSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/sessions',
    tags: ['Sessions'],
    summary: 'List sessions',
    responses: {
      200: {
        description: 'Persisted sessions',
        content: {
          'application/json': {
            schema: listSessionsResponseSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/sessions',
    tags: ['Sessions'],
    summary: 'Create session',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: createSessionInputSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Created session',
        content: {
          'application/json': {
            schema: createSessionResponseSchema,
          },
        },
      },
      400: {
        description: 'Invalid session input',
        content: {
          'application/json': {
            schema: apiErrorSchema,
          },
        },
      },
      409: {
        description: 'Session ID conflict or generation failure',
        content: {
          'application/json': {
            schema: apiErrorSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/lookup/{id}',
    tags: ['Lookup'],
    summary: 'Resolve a hierarchical ID',
    description: 'Returns the structured session, turn, round, or part identified by the canonical hierarchical ID.',
    request: {
      params: lookupIdParamSchema,
      query: lookupQuerySchema,
    },
    responses: {
      200: {
        description: 'Lookup payload',
        content: {
          'application/json': {
            schema: hierarchicalLookupResponseSchema,
            examples: createOpenApiExamples(lookupAuditEntries, [
              'session-summary',
              'session-full',
              'turn-summary',
              'turn-full',
              'round-summary',
              'round-full',
              'tool-call-part-summary',
              'tool-call-part-full',
              'user-prompt-part-summary',
              'setup-part-summary',
              'setup-part-full',
            ]),
          },
        },
      },
      400: {
        description: 'Invalid hierarchical ID',
        content: {
          'application/json': {
            schema: apiErrorSchema,
            example: findAuditEntry(lookupAuditEntries, 'invalid-id-summary')?.responsePayload,
          },
        },
      },
      404: {
        description: 'Hierarchical ID not found',
        content: {
          'application/json': {
            schema: apiErrorSchema,
            example: {
              error: {
                type: 'not_found',
                message: 'Part not found: YL4B.999.0.0',
                code: 'hierarchical_id_not_found',
              },
            },
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/sessions/{sessionId}/trace',
    tags: ['Trace'],
    summary: 'Export full session trace',
    request: {
      params: sessionIdParamSchema,
    },
    responses: {
      200: {
        description: 'Full persisted trace bundle',
        content: {
          'application/json': {
            schema: sessionTraceBundleSchema,
            example: traceFixture,
          },
        },
      },
      404: {
        description: 'Session not found',
        content: {
          'application/json': {
            schema: apiErrorSchema,
            example: {
              error: {
                type: 'not_found',
                message: 'Session not found',
              },
            },
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/traces/import',
    tags: ['Trace'],
    summary: 'Import a captured trace bundle',
    description: 'Imports a trace bundle as a normal persisted session.',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: sessionTraceBundleSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Imported session',
        content: {
          'application/json': {
            schema: createSessionResponseSchema,
            example: findAuditEntry(lookupAuditEntries, 'import-trace')?.responsePayload,
          },
        },
      },
      400: {
        description: 'Invalid trace payload',
        content: {
          'application/json': {
            schema: apiErrorSchema,
          },
        },
      },
    },
  })

  const generator = new OpenApiGeneratorV31(registry.definitions)
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'mcpscope API',
      version: appVersion,
      description: 'Structured backend API reference for mcpscope. Lookup examples are sourced from the latest regression artifact in `test-results/lookup-api-payload-audit.json` when available.',
    },
    servers: [{ url: '/' }],
    tags: [
      { name: 'System', description: 'Service metadata and liveness' },
      { name: 'Sessions', description: 'Session creation and listing' },
      { name: 'Lookup', description: 'Hierarchical ID resolution for session, turn, round, and part inspection' },
      { name: 'Trace', description: 'Importing and exporting captured trace bundles' },
    ],
  })
}
