import { describe, expect, it, vi } from 'vitest'
import { withAutoModelSwap } from './autoModelSwapGateway.js'
import type { ProviderConnection } from '../domain/configuration.js'
import type { ChatCompletionGateway } from './modelTurns.js'

function conn(overrides: Partial<ProviderConnection>): ProviderConnection {
  return {
    id: 'c1',
    name: 'Local',
    baseUrl: 'http://localhost:1234',
    providerType: 'lmstudio',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function makeInner() {
  return {
    createChatCompletion: vi
      .fn()
      .mockResolvedValue({ id: 'x' } as never),
    streamChatCompletion: vi.fn().mockResolvedValue({} as never),
    probePromptTokens: vi.fn().mockResolvedValue(7),
  } satisfies ChatCompletionGateway
}

describe('withAutoModelSwap', () => {
  it('swaps before delegating when the connection has auto-swap enabled', async () => {
    const order: string[] = []
    const ensureReady = vi.fn().mockImplementation(async () => {
      order.push('swap')
    })
    const inner = makeInner()
    inner.createChatCompletion.mockImplementation(async () => {
      order.push('request')
      return { id: 'x' } as never
    })

    const gw = withAutoModelSwap(inner, {
      listConnections: () => [conn({ autoSwapModel: true })],
      ensureReady,
    })

    await gw.createChatCompletion('http://localhost:1234', undefined, {
      model: 'model-b',
      num_ctx: 4096,
    })

    expect(order).toEqual(['swap', 'request'])
    expect(ensureReady).toHaveBeenCalledExactlyOnceWith({
      baseUrl: 'http://localhost:1234',
      apiKey: undefined,
      providerType: 'lmstudio',
      modelKey: 'model-b',
      contextSize: 4096,
      autoSwap: true,
    })
  })

  it('does not swap when no connection for the baseUrl has auto-swap on', async () => {
    const ensureReady = vi.fn()
    const inner = makeInner()
    const gw = withAutoModelSwap(inner, {
      listConnections: () => [conn({ autoSwapModel: false })],
      ensureReady,
    })

    await gw.createChatCompletion('http://localhost:1234', undefined, {
      model: 'model-b',
    })

    expect(ensureReady).not.toHaveBeenCalled()
    expect(inner.createChatCompletion).toHaveBeenCalledOnce()
  })

  it('does not swap when no connection matches the request baseUrl', async () => {
    const ensureReady = vi.fn()
    const inner = makeInner()
    const gw = withAutoModelSwap(inner, {
      listConnections: () => [
        conn({ baseUrl: 'http://other:9999', autoSwapModel: true }),
      ],
      ensureReady,
    })

    await gw.createChatCompletion('http://localhost:1234', undefined, {
      model: 'model-b',
    })

    expect(ensureReady).not.toHaveBeenCalled()
  })

  it('applies the swap on the stream and probe paths too', async () => {
    const ensureReady = vi.fn()
    const inner = makeInner()
    const gw = withAutoModelSwap(inner, {
      listConnections: () => [conn({ autoSwapModel: true })],
      ensureReady,
    })

    await gw.streamChatCompletion!('http://localhost:1234', undefined, {
      model: 'm',
    })
    await gw.probePromptTokens!('http://localhost:1234', undefined, {
      model: 'm',
    })

    expect(ensureReady).toHaveBeenCalledTimes(2)
    expect(inner.streamChatCompletion).toHaveBeenCalledOnce()
    expect(inner.probePromptTokens).toHaveBeenCalledOnce()
  })

  it('omits optional methods that the inner gateway does not provide', () => {
    const gw = withAutoModelSwap({
      createChatCompletion: vi.fn(),
    })
    expect(gw.streamChatCompletion).toBeUndefined()
    expect(gw.probePromptTokens).toBeUndefined()
    expect(gw.getLoadedContextLength).toBeUndefined()
  })
})
