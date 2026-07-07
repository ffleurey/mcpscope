import { describe, expect, it } from 'vitest'
import { isInspectId, collectInspectIds, linkify } from './inspectIds'

describe('isInspectId', () => {
  it('accepts session, hierarchical, and benchmark-family ids', () => {
    for (const id of [
      'QGWA',
      '9LJM',
      '9LJM.S',
      '9LJM.1T',
      '9LJM.2C',
      '9LJM.1T.3',
      '9LJM.1T.3.2-T',
      '9LJM.S.2-TD',
      'B-GUDP',
      'B-GUDP.1',
      'R-RZNP',
      'E-FE7K',
    ]) {
      expect(isInspectId(id), id).toBe(true)
    }
  })

  it('rejects config ids and arbitrary strings', () => {
    for (const v of [
      'ce0c471c-088b-4b36-b104-c57e78d93e19', // model_config_id uuid
      'ha-replay', // mcp profile slug
      'kimi-k25', // judge model slug
      'HA Replay',
      'hello',
      'lower', // lowercase, would-be 5 chars
      '0I1O', // excluded charset
    ]) {
      expect(isInspectId(v), v).toBe(false)
    }
  })
})

describe('collectInspectIds', () => {
  it('gathers navigable ids and skips config ids', () => {
    const payload = {
      run: {
        id: 'R-RZNP',
        benchmark_id: 'B-GUDP',
        model_config_id: 'ce0c471c-1',
        mcp_profile_ids: ['ha-replay'],
      },
      evaluations: [{ id: 'E-FE7K' }],
      sessions: [{ session_id: '9LJM', analysis_session_id: '9LJM.1T.3.2-T' }],
    }
    const ids = collectInspectIds(payload)
    expect(ids).toEqual(new Set(['R-RZNP', 'B-GUDP', 'E-FE7K', '9LJM', '9LJM.1T.3.2-T']))
  })
})

describe('linkify', () => {
  it('links ids longest-first without partial matches inside larger ids', () => {
    const ids = new Set(['9LJM', '9LJM.1T'])
    const segs = linkify('see 9LJM.1T and 9LJM here', ids)
    const linked = segs.filter((s) => s.id).map((s) => s.id)
    expect(linked).toEqual(['9LJM.1T', '9LJM'])
    // Reconstructing the segments returns the original string.
    expect(segs.map((s) => s.text).join('')).toBe('see 9LJM.1T and 9LJM here')
  })

  it('does not link an id embedded inside a larger token', () => {
    const segs = linkify('x9LJMx and 9LJM.1T.3', new Set(['9LJM']))
    expect(segs.some((s) => s.id)).toBe(false)
  })

  it('returns a single text segment when there are no ids', () => {
    expect(linkify('nothing here', new Set())).toEqual([{ text: 'nothing here' }])
  })
})
