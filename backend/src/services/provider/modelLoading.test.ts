import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lmstudio/client.js', () => ({
  listModelsWithStatus: vi.fn(),
  loadModel: vi.fn(),
  unloadModel: vi.fn(),
}))

import {
  listModelsWithStatus,
  loadModel,
  unloadModel,
} from '../lmstudio/client.js'
import { ensureModelReady } from './modelLoading.js'

const mockList = vi.mocked(listModelsWithStatus)
const mockLoad = vi.mocked(loadModel)
const mockUnload = vi.mocked(unloadModel)

/** Build the subset of LmStudioModelStatus that ensureModelReady reads. */
function status(
  key: string,
  isLoaded: boolean,
  loadedContextLength: number | null = null,
) {
  return { key, isLoaded, loadedContextLength } as Awaited<
    ReturnType<typeof listModelsWithStatus>
  >[number]
}

// Each test uses a distinct baseUrl so the per-instance lock chains never
// collide across tests.
const base = (n: string) => `http://localhost:${n}`

describe('ensureModelReady', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is a no-op when auto-swap is disabled', async () => {
    await ensureModelReady({
      baseUrl: base('1'),
      apiKey: undefined,
      providerType: 'lmstudio',
      modelKey: 'model-a',
      autoSwap: false,
    })
    expect(mockList).not.toHaveBeenCalled()
    expect(mockLoad).not.toHaveBeenCalled()
    expect(mockUnload).not.toHaveBeenCalled()
  })

  it('is a no-op for non-LM-Studio providers even when auto-swap is on', async () => {
    for (const providerType of ['ollama', 'openrouter'] as const) {
      await ensureModelReady({
        baseUrl: base('2'),
        apiKey: undefined,
        providerType,
        modelKey: 'model-a',
        autoSwap: true,
      })
    }
    expect(mockList).not.toHaveBeenCalled()
    expect(mockLoad).not.toHaveBeenCalled()
    expect(mockUnload).not.toHaveBeenCalled()
  })

  it('does nothing when the requested model is already the only one loaded', async () => {
    mockList.mockResolvedValue([status('model-a', true), status('model-b', false)])
    await ensureModelReady({
      baseUrl: base('3'),
      apiKey: undefined,
      providerType: 'lmstudio',
      modelKey: 'model-a',
      autoSwap: true,
    })
    expect(mockUnload).not.toHaveBeenCalled()
    expect(mockLoad).not.toHaveBeenCalled()
  })

  it('reloads the target when it is loaded at a different context size', async () => {
    mockList.mockResolvedValue([status('model-a', true, 8192)])
    await ensureModelReady({
      baseUrl: base('3b'),
      apiKey: 'key',
      providerType: 'lmstudio',
      modelKey: 'model-a',
      contextSize: 32768,
      autoSwap: true,
    })
    expect(mockUnload).toHaveBeenCalledExactlyOnceWith(base('3b'), 'key', 'model-a')
    expect(mockLoad).toHaveBeenCalledExactlyOnceWith(
      base('3b'),
      'key',
      'model-a',
      32768,
    )
  })

  it('does not reload when the target is loaded at the requested context size', async () => {
    mockList.mockResolvedValue([status('model-a', true, 32768)])
    await ensureModelReady({
      baseUrl: base('3c'),
      apiKey: undefined,
      providerType: 'lmstudio',
      modelKey: 'model-a',
      contextSize: 32768,
      autoSwap: true,
    })
    expect(mockUnload).not.toHaveBeenCalled()
    expect(mockLoad).not.toHaveBeenCalled()
  })

  it('does not reload when the loaded context size is unknown', async () => {
    mockList.mockResolvedValue([status('model-a', true, null)])
    await ensureModelReady({
      baseUrl: base('3d'),
      apiKey: undefined,
      providerType: 'lmstudio',
      modelKey: 'model-a',
      contextSize: 32768,
      autoSwap: true,
    })
    expect(mockUnload).not.toHaveBeenCalled()
    expect(mockLoad).not.toHaveBeenCalled()
  })

  it('unloads the other loaded model, then loads the requested one', async () => {
    mockList.mockResolvedValue([status('model-a', true), status('model-b', false)])
    await ensureModelReady({
      baseUrl: base('4'),
      apiKey: 'key',
      providerType: 'lmstudio',
      modelKey: 'model-b',
      contextSize: 8192,
      autoSwap: true,
    })
    expect(mockUnload).toHaveBeenCalledExactlyOnceWith(base('4'), 'key', 'model-a')
    expect(mockLoad).toHaveBeenCalledExactlyOnceWith(
      base('4'),
      'key',
      'model-b',
      8192,
    )
  })

  it('unloads every other loaded model before loading the target', async () => {
    mockList.mockResolvedValue([
      status('model-a', true),
      status('model-b', true),
      status('model-c', false),
    ])
    await ensureModelReady({
      baseUrl: base('5'),
      apiKey: undefined,
      providerType: 'lmstudio',
      modelKey: 'model-c',
      autoSwap: true,
    })
    expect(mockUnload).toHaveBeenCalledTimes(2)
    expect(mockUnload).toHaveBeenCalledWith(base('5'), undefined, 'model-a')
    expect(mockUnload).toHaveBeenCalledWith(base('5'), undefined, 'model-b')
    expect(mockLoad).toHaveBeenCalledExactlyOnceWith(
      base('5'),
      undefined,
      'model-c',
      undefined,
    )
  })

  it('unloads others but skips the load when the target is already loaded alongside them', async () => {
    mockList.mockResolvedValue([status('model-a', true), status('model-b', true)])
    await ensureModelReady({
      baseUrl: base('6'),
      apiKey: undefined,
      providerType: 'lmstudio',
      modelKey: 'model-a',
      autoSwap: true,
    })
    expect(mockUnload).toHaveBeenCalledExactlyOnceWith(base('6'), undefined, 'model-b')
    expect(mockLoad).not.toHaveBeenCalled()
  })

  it('serializes concurrent swaps to the same instance', async () => {
    const events: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    // First call's list blocks on `gate`; second call must not start its own
    // list until the first swap completes.
    mockList.mockImplementationOnce(async () => {
      events.push('list-1-start')
      await gate
      events.push('list-1-end')
      return [status('model-a', true)]
    })
    mockList.mockImplementationOnce(async () => {
      events.push('list-2-start')
      return [status('model-a', true)]
    })

    const first = ensureModelReady({
      baseUrl: base('7'),
      apiKey: undefined,
      providerType: 'lmstudio',
      modelKey: 'model-b',
      autoSwap: true,
    })
    const second = ensureModelReady({
      baseUrl: base('7'),
      apiKey: undefined,
      providerType: 'lmstudio',
      modelKey: 'model-a',
      autoSwap: true,
    })

    // Let microtasks flush; the second must still be queued behind the lock.
    await Promise.resolve()
    expect(events).toEqual(['list-1-start'])

    release()
    await Promise.all([first, second])
    expect(events).toEqual([
      'list-1-start',
      'list-1-end',
      'list-2-start',
    ])
  })
})
