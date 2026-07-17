import { describe, it, expect } from 'vitest'
import { mcpAuthHeaders } from './httpClient.js'

describe('mcpAuthHeaders', () => {
  it('sends no Authorization header when auth is absent or "none"', () => {
    expect(mcpAuthHeaders(undefined)).toEqual({})
    expect(mcpAuthHeaders(null)).toEqual({})
    expect(mcpAuthHeaders({ type: 'none', value: null })).toEqual({})
    expect(mcpAuthHeaders({ type: null, value: 'ignored' })).toEqual({})
    // A configured type with no value cannot form a header.
    expect(mcpAuthHeaders({ type: 'bearer', value: null })).toEqual({})
    expect(mcpAuthHeaders({ type: 'bearer', value: '' })).toEqual({})
  })

  it('sends a Bearer token verbatim', () => {
    expect(mcpAuthHeaders({ type: 'bearer', value: 'abc123' })).toEqual({
      Authorization: 'Bearer abc123',
    })
  })

  it('base64-encodes basic credentials (user:pass) per RFC 7617', () => {
    expect(mcpAuthHeaders({ type: 'basic', value: 'user:pass' })).toEqual({
      Authorization: `Basic ${Buffer.from('user:pass', 'utf-8').toString('base64')}`,
    })
  })
})
