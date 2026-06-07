import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const createPrimarySessionMock = vi.fn()
const listSessionsMock = vi.fn()
const preflightSessionMock = vi.fn()
const awaitJobMock = vi.fn()

vi.mock('./api/backendClient', () => ({
  createPrimarySession: createPrimarySessionMock,
  deleteSession: vi.fn(),
  getSessionTrace: vi.fn(),
  importTrace: vi.fn(),
  launchAnalysis: vi.fn(),
  listSessions: listSessionsMock,
  preflightSession: preflightSessionMock,
  retryFailedAnalysisStep: vi.fn(),
}))

vi.mock('./executionStore', () => ({
  awaitJob: awaitJobMock,
}))

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeSessionRecord() {
  return {
    id: 'AB12',
    title: 'Queued Session',
    status: 'draft' as const,
    initStatus: 'initializing' as const,
    sessionType: 'primary' as const,
    parentKind: null,
    parentId: null,
    createdAt: 1,
    updatedAt: 1,
    modelProfileSnapshot: {
      id: 'mc-1',
      name: 'Model Config',
      connectionBaseUrl: 'http://localhost:1234',
      apiKey: null,
      modelKey: 'model-key',
      modelDisplayName: 'Model',
      systemPrompt: 'Prompt',
      temperature: 0,
      reasoning: null,
      createdAt: 1,
      updatedAt: 1,
    },
    mcpProfileSnapshots: [],
    loadedContextLength: null,
    systemPromptTokens: null,
    toolDefinitionsTokens: null,
    isContextExhausted: false,
    compactionStrategy: 'strip-reasoning' as const,
  }
}

describe('sessionStore.startSession', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    const { lmConnections, modelConfigs, mcpProfiles, sessionCreationDefaults } = await import('./connectionStore')
    const { isPrimaryLaunchDialogOpen, activeChatId, activeTrace, chatSessions } = await import('./sessionStore')

    lmConnections.set([{
      id: 'lm-1',
      name: 'Local LM',
      baseUrl: 'http://localhost:1234',
      apiKey: undefined,
      providerType: 'lmstudio',
      createdAt: 1,
      updatedAt: 1,
    }])
    modelConfigs.set([{
      id: 'mc-1',
      name: 'Model Config',
      connectionId: 'lm-1',
      modelKey: 'model-key',
      modelDisplayName: 'Model',
      systemPrompt: 'Prompt',
      temperature: 0,
      createdAt: 1,
      updatedAt: 1,
    }])
    mcpProfiles.set([])
    sessionCreationDefaults.set({
      defaultModelConfigId: 'mc-1',
      updatedAt: 1,
    })
    isPrimaryLaunchDialogOpen.set(true)
    activeChatId.set(null)
    activeTrace.set(null)
    chatSessions.set([])
    preflightSessionMock.mockResolvedValue(undefined)
    listSessionsMock.mockResolvedValue({ sessions: [] })
  })

  it('closes the primary launch dialog immediately after enqueueing init', async () => {
    const waitForInit = deferredPromise<void>()
    awaitJobMock.mockReturnValue(waitForInit.promise)
    createPrimarySessionMock.mockResolvedValue({
      session: makeSessionRecord(),
      initJobId: 'job-1',
    })

    const { startSession, isPrimaryLaunchDialogOpen, isStartingSession, activeChatId } = await import('./sessionStore')

    const startPromise = startSession({
      modelConfigId: 'mc-1',
      mcpProfileIds: [],
      compactionStrategy: 'strip-reasoning',
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(get(activeChatId)).toBe('AB12')
    expect(get(isPrimaryLaunchDialogOpen)).toBe(false)
    expect(get(isStartingSession)).toBe(true)
    await vi.waitFor(() => {
      expect(awaitJobMock).toHaveBeenCalledWith('AB12', 'job-1')
    })

    waitForInit.resolve()
    await startPromise

    expect(get(isStartingSession)).toBe(false)
  })
})