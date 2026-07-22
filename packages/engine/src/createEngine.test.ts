import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEngine, type Engine, type SchedulerEvent } from './index.js'
import type { ChatCompletionGateway } from './runtime/modelTurns.js'
import { providerConnectionSchema, modelConfigSchema } from './domain/configuration.js'

/**
 * A scripted chat gateway: no network. Returns a fixed system-prompt probe and
 * a single "stop" completion, enough to drive one model-only turn (no tools).
 */
function makeScriptedGateway(): ChatCompletionGateway {
  return {
    async probePromptTokens() {
      return 8
    },
    async probePromptTokensDetailed(_baseUrl, _apiKey, body) {
      return {
        promptTokens: 8,
        completion: {
          id: 'probe',
          model: 'model-key',
          created: 1,
          choices: [],
          usage: { prompt_tokens: 8, completion_tokens: 0, total_tokens: 8 },
        },
        rawExchange: {
          requestUrl: 'https://example.test/v1/chat/completions',
          requestMethod: 'POST',
          requestHeadersJson: { 'Content-Type': 'application/json' },
          requestBody: JSON.stringify(body),
          responseStatus: 200,
          responseHeadersJson: { 'content-type': 'application/json' },
          responseBody: JSON.stringify({ usage: { prompt_tokens: 8 } }),
        },
      }
    },
    async getLoadedContextLength() {
      return null
    },
    async createChatCompletion() {
      return {
        id: 'cmpl-1',
        model: 'model-key',
        created: 2,
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'PONG' },
          },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 2,
          total_tokens: 10,
        },
      }
    },
  }
}

describe('createEngine', () => {
  let engine: Engine | undefined

  afterEach(() => {
    engine?.close()
    engine = undefined
  })

  it('assembles an in-memory engine with no disk writes', async () => {
    const configPath = '.tmp-test-data/should-not-be-written.json'
    fs.rmSync(configPath, { force: true })

    engine = await createEngine({
      storage: { memory: true },
      // No configPath → purely in-memory config; upserts must not touch disk.
      config: {
        lmConnections: [
          {
            id: 'lm-1',
            name: 'Local',
            baseUrl: 'http://127.0.0.1:1234/v1',
            apiKey: null,
            providerType: 'lmstudio',
          } as never,
        ],
      },
    })

    expect(engine.opCtx.db).toBeDefined()
    expect(engine.opCtx.maxToolRounds).toBeGreaterThan(0)
    // Seeded config is visible through the store.
    expect(engine.config.listLmConnections().map((c) => c.id)).toEqual(['lm-1'])
    // In-memory mode wrote no config file.
    expect(fs.existsSync(configPath)).toBe(false)
  })

  it('exposes engine operations over the assembled context', async () => {
    engine = await createEngine({ storage: { memory: true }, maxToolRounds: 3 })

    // A fresh in-memory engine has no sessions.
    const sessions = await engine.listSessions()
    expect(sessions).toEqual({
      api_version: 1,
      sessions: [],
      total: 0,
      limit: 50,
      offset: 0,
      has_more: false,
    })

    // Trace of an unknown session is null (not a throw).
    expect(engine.getTrace('NOPE')).toBeNull()

    // Event subscription hands back a working unsubscribe.
    const unsubscribe = engine.onEvent(() => {})
    expect(typeof unsubscribe).toBe('function')
    unsubscribe()

    // maxToolRounds override is threaded into the context.
    expect(engine.opCtx.maxToolRounds).toBe(3)
  })

  it('runs a full model-only turn end-to-end with no workbench wiring', async () => {
    // A valid connection + model config, built through the real schemas.
    const connection = providerConnectionSchema.parse({
      id: 'lm-1',
      name: 'Scripted',
      baseUrl: 'http://127.0.0.1:1234/v1',
      providerType: 'lmstudio',
    })
    const modelConfig = modelConfigSchema.parse({
      id: 'm-1',
      name: 'Scripted model',
      connectionId: 'lm-1',
      modelKey: 'model-key',
      systemPrompt: 'You are a test.',
    })

    engine = await createEngine({
      storage: { memory: true },
      config: {
        lmConnections: [connection],
        modelConfigs: [modelConfig],
        sessionCreationDefaults: { defaultModelConfigId: 'm-1', updatedAt: 1 },
      },
      dependencies: { chatCompletionGateway: makeScriptedGateway() },
    })

    // Capture the turn-committed execution event as it flows through the scheduler.
    const events: SchedulerEvent[] = []
    const unsubscribe = engine.onEvent((e) => events.push(e))

    // Create the session and wait for initialization to finish.
    const created = await engine.createSession({
      title: 'Turn test',
      model_config_id: 'm-1',
      wait: true,
    })
    expect(created.session.init_status).toBe('ready')

    // Send a prompt and wait for the turn to reach a terminal state.
    const sent = await engine.send({
      session_id: created.session.id,
      prompt: 'ping',
      wait: true,
    })
    expect(sent.turn.status).toBe('complete')

    // The assistant's committed content is in the persisted trace.
    const trace = engine.getTrace(created.session.id)
    expect(trace).not.toBeNull()
    expect(JSON.stringify(trace)).toContain('PONG')

    // A turn-committed event was relayed through the scheduler — proving the
    // pure engine's agent loop ran with zero workbench registrations.
    const committed = events.some(
      (e) => e.type === 'scheduler-execution-event' && e.event.type === 'turn-committed',
    )
    expect(committed).toBe(true)

    unsubscribe()
  })

  it('manages sessions through the facade: rename, abort, delete', async () => {
    engine = await makeConfiguredEngine()

    // Untitled sessions start with the default title.
    const created = await engine.createSession({ model_config_id: 'm-1', wait: true })
    expect(created.session.title).toBe('New session')

    // Rename trims and returns the canonical result.
    const renamed = await engine.renameSession({
      session_id: created.session.id,
      title: '  Renamed  ',
    })
    expect(renamed).toEqual({
      api_version: 1,
      session_id: created.session.id,
      title: 'Renamed',
    })
    const listed = await engine.listSessions()
    expect(listed.sessions.map((s) => s.title)).toEqual(['Renamed'])

    // Abort with nothing active or queued reports not-running.
    const aborted = await engine.abortSession({ session_id: created.session.id })
    expect(aborted.outcome).toBe('not-running')

    // Delete removes the session; a second delete is idempotent (deleted=false).
    const deleted = await engine.deleteSession({ session_id: created.session.id })
    expect(deleted).toEqual({
      api_version: 1,
      deleted: true,
      session_id: created.session.id,
    })
    expect(engine.getTrace(created.session.id)).toBeNull()
    const deletedAgain = await engine.deleteSession({ session_id: created.session.id })
    expect(deletedAgain).toEqual({
      api_version: 1,
      deleted: false,
      session_id: created.session.id,
    })
    // An id that never existed is likewise a no-op, not an error.
    const deletedUnknown = await engine.deleteSession({ session_id: 'ZZZZ' })
    expect(deletedUnknown).toEqual({ api_version: 1, deleted: false, session_id: 'ZZZZ' })
  })

  it('auto-titles an untitled session from the first prompt and emits session-title-changed', async () => {
    engine = await makeConfiguredEngine()

    const events: SchedulerEvent[] = []
    const unsubscribe = engine.onEvent((e) => events.push(e))

    const created = await engine.createSession({ model_config_id: 'm-1', wait: true })
    await engine.send({ session_id: created.session.id, prompt: 'ping', wait: true })

    const titleEvent = events.find(
      (e) => e.type === 'scheduler-execution-event' && e.event.type === 'session-title-changed',
    )
    expect(titleEvent).toBeDefined()
    if (titleEvent?.type === 'scheduler-execution-event' && titleEvent.event.type === 'session-title-changed') {
      expect(titleEvent.event.sessionId).toBe(created.session.id)
      expect(titleEvent.event.title).toBe('ping')
    }

    const listed = await engine.listSessions()
    expect(listed.sessions.map((s) => s.title)).toEqual(['ping'])

    unsubscribe()
  })

  it("reports state 'queued' with a queue position for a turn waiting behind an active job", async () => {
    const gated = makeGatedGateway()
    engine = await makeConfiguredEngine(gated.gateway)

    const a = await engine.createSession({ model_config_id: 'm-1', wait: true })
    const b = await engine.createSession({ model_config_id: 'm-1', wait: true })

    // Start A's turn (do not wait) and hold it active in the model call.
    await engine.send({ session_id: a.session.id, prompt: 'ping', wait: false })
    await gated.callStarted

    // B's turn is accepted but must wait behind A's active job.
    await engine.send({ session_id: b.session.id, prompt: 'ping', wait: false })

    const statusB = await engine.status({ session_id: b.session.id })
    expect(statusB.session.state).toBe('queued')
    expect(statusB.queue_position).toBe(1)

    // A is actively executing — 'running', never 'queued', no queue position.
    const statusA = await engine.status({ session_id: a.session.id })
    expect(statusA.session.state).toBe('running')
    expect(statusA.queue_position).toBeUndefined()

    // Let both jobs drain so close() doesn't race an in-flight call.
    gated.release()
    await vi.waitFor(async () => {
      const [sa, sb] = await Promise.all([
        engine!.status({ session_id: a.session.id }),
        engine!.status({ session_id: b.session.id }),
      ])
      if (sa.session.state !== 'ready' || sb.session.state !== 'ready') {
        throw new Error('jobs not drained yet')
      }
    })
  })

  it("marks a job failed with errorType 'aborted' on abort", async () => {
    const gated = makeGatedGateway()
    engine = await makeConfiguredEngine(gated.gateway)

    const failed: Extract<SchedulerEvent, { type: 'scheduler-job-failed' }>[] = []
    const unsubscribe = engine.onEvent((e) => {
      if (e.type === 'scheduler-job-failed') failed.push(e)
    })

    const created = await engine.createSession({ model_config_id: 'm-1', wait: true })
    await engine.send({ session_id: created.session.id, prompt: 'ping', wait: false })
    await gated.callStarted

    const aborted = await engine.abortSession({ session_id: created.session.id })
    expect(aborted.outcome).toBe('aborted')

    // Wait for the turn job to settle as failed.
    const turnFailed = await vi.waitFor(() => {
      const evt = failed.find((e) => e.job.target.kind === 'session')
      if (!evt) throw new Error('no failed job yet')
      return evt
    })
    expect(turnFailed.job.outcome).toBe('failed')
    expect(turnFailed.job.errorType).toBe('aborted')

    unsubscribe()
    gated.release()
  })

  it("marks a job failed with errorType 'internal' on an unclassified model failure", async () => {
    engine = await makeConfiguredEngine(makeThrowingGateway())

    const failed: Extract<SchedulerEvent, { type: 'scheduler-job-failed' }>[] = []
    const unsubscribe = engine.onEvent((e) => {
      if (e.type === 'scheduler-job-failed') failed.push(e)
    })

    const created = await engine.createSession({ model_config_id: 'm-1', wait: true })
    const sent = await engine.send({
      session_id: created.session.id,
      prompt: 'ping',
      wait: true,
    })
    expect(sent.turn.status).toBe('error')

    const turnFailed = failed.find((e) => e.job.target.kind === 'session')
    expect(turnFailed).toBeDefined()
    expect(turnFailed!.job.outcome).toBe('failed')
    expect(turnFailed!.job.errorType).toBe('internal')
    expect(turnFailed!.job.error).toContain('LM Studio connection lost')

    unsubscribe()
  })
})

/** An engine wired to a chat gateway (scripted by default) with one connection + model config. */
async function makeConfiguredEngine(
  gateway: ChatCompletionGateway = makeScriptedGateway(),
): Promise<Engine> {
  const connection = providerConnectionSchema.parse({
    id: 'lm-1',
    name: 'Scripted',
    baseUrl: 'http://127.0.0.1:1234/v1',
    providerType: 'lmstudio',
  })
  const modelConfig = modelConfigSchema.parse({
    id: 'm-1',
    name: 'Scripted model',
    connectionId: 'lm-1',
    modelKey: 'model-key',
    systemPrompt: 'You are a test.',
  })

  return createEngine({
    storage: { memory: true },
    config: {
      lmConnections: [connection],
      modelConfigs: [modelConfig],
      sessionCreationDefaults: { defaultModelConfigId: 'm-1', updatedAt: 1 },
    },
    dependencies: { chatCompletionGateway: gateway },
  })
}

/**
 * A chat gateway whose model call blocks until released, or rejects with an
 * AbortError if the job's abort signal fires first. Lets a test hold one job
 * active (so another session's turn queues behind it) and exercise abort.
 */
function makeGatedGateway(): {
  gateway: ChatCompletionGateway
  release: () => void
  callStarted: Promise<void>
} {
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let markCallStarted!: () => void
  const callStarted = new Promise<void>((resolve) => {
    markCallStarted = resolve
  })
  const base = makeScriptedGateway()
  const gateway: ChatCompletionGateway = {
    ...base,
    async createChatCompletion(baseUrl, apiKey, body, signal) {
      markCallStarted()
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException('The operation was aborted', 'AbortError'))
          return
        }
        const onAbort = () =>
          reject(new DOMException('The operation was aborted', 'AbortError'))
        signal?.addEventListener('abort', onAbort, { once: true })
        void released.then(() => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        })
      })
      return base.createChatCompletion(baseUrl, apiKey, body, signal)
    },
  }
  return { gateway, release, callStarted }
}

/** A chat gateway whose model call always throws — an unclassified internal failure. */
function makeThrowingGateway(): ChatCompletionGateway {
  return {
    ...makeScriptedGateway(),
    async createChatCompletion() {
      throw new Error('LM Studio connection lost')
    },
  }
}
