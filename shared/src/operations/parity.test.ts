import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { operationCatalog, operationList } from './catalog.js'

// ─── Catalog shape ─────────────────────────────────────────────────────────────

describe('operation catalog', () => {
  it('contains exactly the 5 required operations', () => {
    expect(Object.keys(operationCatalog)).toEqual(['list', 'create', 'send', 'status', 'inspect'])
  })

  it('every operation has id, description, schema, and execute', () => {
    for (const op of operationList) {
      expect(typeof op.id).toBe('string')
      expect(typeof op.description).toBe('string')
      expect(op.description.length).toBeGreaterThan(0)
      expect(op.schema).toBeDefined()
      expect(typeof op.execute).toBe('function')
    }
  })

  it('operation IDs in catalog match their id field', () => {
    for (const [key, op] of Object.entries(operationCatalog)) {
      expect(op.id).toBe(key)
    }
  })
})

// ─── Input schema parity ───────────────────────────────────────────────────────

describe('input schema canonical fields', () => {
  it('list has no required fields', () => {
    const { list } = operationCatalog
    const result = list.schema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('create requires title, accepts id and compaction', () => {
    const { create } = operationCatalog
    expect(create.schema.safeParse({ title: 'test' }).success).toBe(true)
    expect(create.schema.safeParse({ title: 'test', id: 'ABCD', compaction: 'none' }).success).toBe(true)
    expect(create.schema.safeParse({}).success).toBe(false)
  })

  it('create compaction is enum none|strip-reasoning', () => {
    const { create } = operationCatalog
    expect(create.schema.safeParse({ title: 'x', compaction: 'none' }).success).toBe(true)
    expect(create.schema.safeParse({ title: 'x', compaction: 'strip-reasoning' }).success).toBe(true)
    expect(create.schema.safeParse({ title: 'x', compaction: 'other' }).success).toBe(false)
  })

  it('send requires session_id and prompt', () => {
    const { send } = operationCatalog
    expect(send.schema.safeParse({ session_id: 'ABCD', prompt: 'hello' }).success).toBe(true)
    expect(send.schema.safeParse({ session_id: 'ABCD' }).success).toBe(false)
    expect(send.schema.safeParse({ prompt: 'hello' }).success).toBe(false)
  })

  it('status requires session_id', () => {
    const { status } = operationCatalog
    expect(status.schema.safeParse({ session_id: 'ABCD' }).success).toBe(true)
    expect(status.schema.safeParse({}).success).toBe(false)
  })

  it('inspect requires id, short is optional boolean', () => {
    const { inspect } = operationCatalog
    expect(inspect.schema.safeParse({ id: 'ABCD.1' }).success).toBe(true)
    expect(inspect.schema.safeParse({ id: 'ABCD.1', short: true }).success).toBe(true)
    expect(inspect.schema.safeParse({}).success).toBe(false)
  })
})

// ─── No adapter-only flags in shared schemas ───────────────────────────────────

describe('adapter-only flags absent from shared schemas', () => {
  const adapterOnlyFields = ['url', 'json', 'help']

  for (const op of operationList) {
    it(`${op.id} schema does not contain adapter-only fields`, () => {
      const shape = (op.schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape
      for (const field of adapterOnlyFields) {
        expect(field in shape).toBe(false)
      }
    })
  }
})

// ─── Canonical field naming ────────────────────────────────────────────────────

describe('canonical field naming', () => {
  it('send uses session_id (snake_case)', () => {
    const { send } = operationCatalog
    const shape = (send.schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape
    expect('session_id' in shape).toBe(true)
    expect('sessionId' in shape).toBe(false)
  })

  it('status uses session_id (snake_case)', () => {
    const { status } = operationCatalog
    const shape = (status.schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape
    expect('session_id' in shape).toBe(true)
    expect('sessionId' in shape).toBe(false)
  })

  it('create uses id and compaction (not sessionId or compactionStrategy)', () => {
    const { create } = operationCatalog
    const shape = (create.schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape
    expect('title' in shape).toBe(true)
    expect('id' in shape).toBe(true)
    expect('compaction' in shape).toBe(true)
    expect('sessionId' in shape).toBe(false)
    expect('compactionStrategy' in shape).toBe(false)
  })

  it('inspect uses id and short (not sessionId)', () => {
    const { inspect } = operationCatalog
    const shape = (inspect.schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape
    expect('id' in shape).toBe(true)
    expect('short' in shape).toBe(true)
  })
})

// ─── Descriptions sourced from shared catalog ──────────────────────────────────

describe('shared descriptions', () => {
  it('all descriptions are non-empty strings from the catalog', () => {
    for (const op of operationList) {
      expect(typeof op.description).toBe('string')
      expect(op.description.trim().length).toBeGreaterThan(20)
    }
  })

  it('each operation description is unique', () => {
    const descriptions = operationList.map(op => op.description)
    const unique = new Set(descriptions)
    expect(unique.size).toBe(descriptions.length)
  })
})
