import { describe, it, expect } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { operationCatalog, operationList } from '../operations/index.js'
import { TOOL_PREFIX, createMcpServer } from './index.js'
import type { OperationContext } from './index.js'

const EXPECTED_OPERATION_IDS = ['list', 'create', 'send', 'status', 'inspect'] as const

// Mock context — never called in these unit tests (no actual execution)
const mockCtx = {} as unknown as OperationContext

describe('MCP server factory', () => {
  it('creates a McpServer instance', () => {
    const server = createMcpServer(mockCtx)
    expect(server).toBeInstanceOf(McpServer)
  })

  it('TOOL_PREFIX is mcpscope_', () => {
    expect(TOOL_PREFIX).toBe('mcpscope_')
  })
})

describe('MCP tool names derived from backend operation IDs', () => {
  for (const op of operationList) {
    it(`${op.id} maps to mcpscope_${op.id}`, () => {
      expect(`${TOOL_PREFIX}${op.id}`).toBe(`mcpscope_${op.id}`)
    })
  }

  it('produces exactly 5 tool names', () => {
    const names = operationList.map(op => `${TOOL_PREFIX}${op.id}`)
    expect(names).toEqual(EXPECTED_OPERATION_IDS.map(id => `mcpscope_${id}`))
  })
})

describe('backend operation catalog — 5 operations with execute', () => {
  it('catalog has all 5 operations', () => {
    expect(Object.keys(operationCatalog)).toEqual([...EXPECTED_OPERATION_IDS])
  })

  it('every backend operation has id, description, schema, outputSchema, and execute', () => {
    for (const op of operationList) {
      expect(typeof op.id).toBe('string')
      expect(typeof op.description).toBe('string')
      expect(op.description.length).toBeGreaterThan(0)
      expect(op.schema).toBeDefined()
      expect(op.outputSchema).toBeDefined()
      expect(typeof op.execute).toBe('function')
    }
  })
})

describe('CLI/MCP parity — backend operation catalog is the source of truth', () => {
  it('backend catalog contains exactly the 5 shipped operations', () => {
    const backendIds = operationList.map(op => op.id)
    expect(backendIds).toEqual(['list', 'create', 'send', 'status', 'inspect'])
  })

  it('each operation has a non-empty description', () => {
    for (const op of operationList) {
      expect(typeof op.description).toBe('string')
      expect(op.description.length).toBeGreaterThan(0)
    }
  })

  it('each operation has an inputSchema and outputSchema', () => {
    for (const op of operationList) {
      expect(op.schema).toBeDefined()
      expect(op.outputSchema).toBeDefined()
    }
  })
})

describe('backend result shape contracts — snake_case throughout', () => {
  it('create result shape has snake_case fields (not camelCase)', () => {
    type CreateResult = Awaited<ReturnType<typeof operationCatalog.create.execute>>
    type Session = CreateResult['session']
    const fields: Array<keyof Session> = [
      'id', 'title', 'status', 'init_status', 'model', 'mcp',
      'compaction_strategy', 'created_at', 'updated_at',
    ]
    expect(fields).toContain('init_status')
    expect(fields).toContain('compaction_strategy')
    expect(fields).not.toContain('initStatus')
    expect(fields).not.toContain('compactionStrategy')
  })

  it('send result shape has session_id (snake_case)', () => {
    type SendResult = Awaited<ReturnType<typeof operationCatalog.send.execute>>
    const fields: Array<keyof SendResult> = ['api_version', 'session_id', 'turn']
    expect(fields).toContain('session_id')
    expect(fields).not.toContain('sessionId')
  })

  it('status result shape has active_turn (snake_case)', () => {
    type StatusResult = Awaited<ReturnType<typeof operationCatalog.status.execute>>
    const fields: Array<keyof StatusResult> = ['api_version', 'session', 'active_turn']
    expect(fields).toContain('active_turn')
    expect(fields).not.toContain('activeTurn')
  })

  it('list result has api_version 1, sessions with snake_case fields', () => {
    type ListResult = Awaited<ReturnType<typeof operationCatalog.list.execute>>
    type Session = ListResult['sessions'][number]
    const sessionFields: Array<keyof Session> = [
      'id', 'title', 'status', 'init_status', 'created_at', 'updated_at',
      'is_context_exhausted', 'loaded_context_length', 'compaction_strategy',
      'model_profile_snapshot', 'mcp_profile_snapshot',
    ]
    expect(sessionFields).toContain('init_status')
    expect(sessionFields).toContain('model_profile_snapshot')
    expect(sessionFields).not.toContain('initStatus')
    expect(sessionFields).not.toContain('modelProfileSnapshot')
  })
})

describe('MCP structured output — outputSchema defined for all operations', () => {
  it('every operation has an outputSchema for structured MCP output', () => {
    for (const op of operationList) {
      expect(op.outputSchema).toBeDefined()
      expect(typeof op.outputSchema).toBe('object')
    }
  })

  it('list outputSchema has api_version and sessions fields', () => {
    expect(operationCatalog.list.outputSchema).toHaveProperty('api_version')
    expect(operationCatalog.list.outputSchema).toHaveProperty('sessions')
  })

  it('create outputSchema has api_version and session fields', () => {
    expect(operationCatalog.create.outputSchema).toHaveProperty('api_version')
    expect(operationCatalog.create.outputSchema).toHaveProperty('session')
  })

  it('send outputSchema has session_id (snake_case)', () => {
    expect(operationCatalog.send.outputSchema).toHaveProperty('session_id')
    expect(operationCatalog.send.outputSchema).not.toHaveProperty('sessionId')
  })

  it('status outputSchema has active_turn (snake_case)', () => {
    expect(operationCatalog.status.outputSchema).toHaveProperty('active_turn')
    expect(operationCatalog.status.outputSchema).not.toHaveProperty('activeTurn')
  })
})

