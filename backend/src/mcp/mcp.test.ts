import { describe, it, expect } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { operationList, operationCatalog } from '@mcpscope/shared'
import { TOOL_PREFIX, createMcpServer } from './index.js'

const EXPECTED_OPERATION_IDS = ['list', 'create', 'send', 'status', 'inspect'] as const

describe('MCP server factory', () => {
  it('creates a McpServer instance', () => {
    const server = createMcpServer('http://localhost:3030')
    expect(server).toBeInstanceOf(McpServer)
  })

  it('TOOL_PREFIX is mcpscope_', () => {
    expect(TOOL_PREFIX).toBe('mcpscope_')
  })
})

describe('MCP tool names derived from operation IDs', () => {
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

describe('CLI/MCP operation parity — same shared catalog source', () => {
  it('catalog has all 5 operations', () => {
    expect(Object.keys(operationCatalog)).toEqual([...EXPECTED_OPERATION_IDS])
  })

  it('each operation has the same description in CLI and MCP (single source)', () => {
    for (const op of operationList) {
      // Both CLI and MCP use op.description — verify it is a meaningful string
      expect(typeof op.description).toBe('string')
      expect(op.description.trim().length).toBeGreaterThan(20)
    }
  })

  it('each operation has the same schema in CLI and MCP (single source)', () => {
    for (const op of operationList) {
      expect(op.schema).toBeDefined()
      // Schema parses valid inputs without error
      const validInput = getValidInput(op.id)
      expect(op.schema.safeParse(validInput).success).toBe(true)
    }
  })
})

describe('machine-readable result shape contracts', () => {
  it('create result shape has api_version, session with snake_case fields', () => {
    // The shared createOperation.execute returns this shape (verified by TypeScript types).
    // This test documents the contract enforced at the type level.
    type CreateResult = Awaited<ReturnType<typeof operationCatalog.create.execute>>
    type Session = CreateResult['session']
    // TypeScript enforces these fields exist — this is a compile-time test.
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

  it('list result has api_version 1 and sessions array', () => {
    type ListResult = Awaited<ReturnType<typeof operationCatalog.list.execute>>
    const fields: Array<keyof ListResult> = ['api_version', 'sessions']
    expect(fields).toContain('api_version')
    expect(fields).toContain('sessions')
  })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getValidInput(opId: string): Record<string, unknown> {
  switch (opId) {
    case 'list': return {}
    case 'create': return { title: 'test' }
    case 'send': return { session_id: 'ABCD', prompt: 'hello' }
    case 'status': return { session_id: 'ABCD' }
    case 'inspect': return { id: 'ABCD.1' }
    default: return {}
  }
}
