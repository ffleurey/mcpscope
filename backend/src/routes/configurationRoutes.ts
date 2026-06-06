import { z } from 'zod'
import { apiError } from '../errors.js'
import {
  deleteLmConnection,
  deleteMcpServerProfile,
  deleteModelConfig,
  getSessionCreationDefaults,
  listLmConnections,
  listMcpServerProfiles,
  listModelConfigs,
  upsertLmConnection,
  upsertMcpServerProfile,
  upsertModelConfig,
  upsertSessionCreationDefaults,
} from '../persistence/repository.js'
import { lmStudioConnectionSchema, mcpServerProfileSchema, modelConfigSchema } from '../domain/configuration.js'
import {
  initializeMcpSession,
  listMcpTools,
} from '../services/mcp/httpClient.js'
import {
  isModelLoaded,
  listModels,
  listModelsWithStatus,
  loadModel as loadLmModel,
  unloadModel as unloadLmModel,
} from '../services/lmstudio/client.js'
import type { RouteDeps } from './types.js'

export function registerConfigurationRoutes({ app, database }: RouteDeps): void {
  app.get('/api/lm-connections', async () => ({
    lmConnections: listLmConnections(database.connection),
  }))

  app.put('/api/lm-connections/:connectionId', async (request, reply) => {
    const { connectionId } = z.object({ connectionId: z.string() }).parse(request.params)
    const record = lmStudioConnectionSchema.parse(request.body)
    if (record.id !== connectionId) {
      reply.code(400)
      return apiError('validation', 'Connection ID mismatch')
    }
    upsertLmConnection(database.connection, record)
    return { lmConnection: record }
  })

  app.delete('/api/lm-connections/:connectionId', async (request, reply) => {
    const { connectionId } = z.object({ connectionId: z.string() }).parse(request.params)
    const referencedByModelConfig = listModelConfigs(database.connection)
      .some(modelConfig => modelConfig.connectionId === connectionId)
    if (referencedByModelConfig) {
      reply.code(409)
      return apiError('validation', 'Cannot delete this LM connection because one or more model configs still reference it. Delete those model configs first.', {
        code: 'lm_connection_in_use',
      })
    }
    const deleted = deleteLmConnection(database.connection, connectionId)
    if (!deleted) {
      reply.code(404)
      return apiError('not_found', 'LM connection not found')
    }
    reply.code(204)
    return null
  })

  app.get('/api/model-configs', async () => ({
    modelConfigs: listModelConfigs(database.connection),
  }))

  app.put('/api/model-configs/:modelConfigId', async (request, reply) => {
    const { modelConfigId } = z.object({ modelConfigId: z.string() }).parse(request.params)
    const record = modelConfigSchema.parse(request.body)
    if (record.id !== modelConfigId) {
      reply.code(400)
      return apiError('validation', 'Model config ID mismatch')
    }
    upsertModelConfig(database.connection, record)
    return { modelConfig: record }
  })

  app.delete('/api/model-configs/:modelConfigId', async (request, reply) => {
    const { modelConfigId } = z.object({ modelConfigId: z.string() }).parse(request.params)
    const defaults = getSessionCreationDefaults(database.connection)
    if (defaults.defaultModelConfigId === modelConfigId) {
      reply.code(409)
      return apiError('validation', 'Cannot delete this model config because it is currently set as the default for new sessions. Change or clear the default first.', {
        code: 'default_model_config_in_use',
      })
    }
    const deleted = deleteModelConfig(database.connection, modelConfigId)
    if (!deleted) {
      reply.code(404)
      return apiError('not_found', 'Model config not found')
    }
    reply.code(204)
    return null
  })

  app.get('/api/mcp-profiles', async () => ({
    mcpProfiles: listMcpServerProfiles(database.connection),
  }))

  app.put('/api/mcp-profiles/:mcpProfileId', async (request, reply) => {
    const { mcpProfileId } = z.object({ mcpProfileId: z.string() }).parse(request.params)
    const record = mcpServerProfileSchema.parse(request.body)
    if (record.id !== mcpProfileId) {
      reply.code(400)
      return apiError('validation', 'MCP profile ID mismatch')
    }
    upsertMcpServerProfile(database.connection, record)
    return { mcpProfile: record }
  })

  app.delete('/api/mcp-profiles/:mcpProfileId', async (request, reply) => {
    const { mcpProfileId } = z.object({ mcpProfileId: z.string() }).parse(request.params)
    const deleted = deleteMcpServerProfile(database.connection, mcpProfileId)
    if (!deleted) {
      reply.code(404)
      return apiError('not_found', 'MCP profile not found')
    }
    reply.code(204)
    return null
  })

  app.get('/api/session-creation-defaults', async () => {
    return { sessionCreationDefaults: getSessionCreationDefaults(database.connection) }
  })

  const sessionCreationDefaultsInputSchema = z.object({
    defaultModelConfigId: z.string().nullable(),
  })

  app.put('/api/session-creation-defaults', async (request, reply) => {
    const { defaultModelConfigId } = sessionCreationDefaultsInputSchema.parse(request.body)

    if (defaultModelConfigId !== null && !listModelConfigs(database.connection).some(c => c.id === defaultModelConfigId)) {
      reply.code(422)
      return apiError('validation', `Model config "${defaultModelConfigId}" not found.`, { code: 'default_model_config_not_found' })
    }

    const updatedDefaults = { defaultModelConfigId, updatedAt: Date.now() }
    upsertSessionCreationDefaults(database.connection, updatedDefaults)
    return { sessionCreationDefaults: updatedDefaults }
  })

  app.post('/api/lm-connections/test', async (request, reply) => {
    const { baseUrl, apiKey } = z.object({ baseUrl: z.string().url(), apiKey: z.string().nullable().optional() }).parse(request.body)
    try {
      const result = await listModels(baseUrl, apiKey ?? undefined)
      return { models: result.data?.map(m => m.id ?? '').filter(Boolean) ?? [] }
    } catch (e) {
      app.log.warn({ baseUrl, err: e instanceof Error ? e.message : String(e) }, 'LM connection test failed')
      reply.code(503)
      return apiError('upstream', e instanceof Error ? e.message : 'LM Studio unreachable', {
        code: 'lm_studio_unreachable',
        details: { baseUrl },
      })
    }
  })

  app.post('/api/lm-connections/models', async (request, reply) => {
    const { baseUrl, apiKey } = z.object({ baseUrl: z.string().url(), apiKey: z.string().nullable().optional() }).parse(request.body)
    try {
      return { models: await listModelsWithStatus(baseUrl, apiKey ?? undefined) }
    } catch (e) {
      app.log.warn({ baseUrl, err: e instanceof Error ? e.message : String(e) }, 'LM models listing failed')
      reply.code(503)
      return apiError('upstream', e instanceof Error ? e.message : 'LM Studio unreachable', {
        code: 'lm_studio_unreachable',
        details: { baseUrl },
      })
    }
  })

  app.post('/api/lm-connections/models/load', async (request, reply) => {
    const { baseUrl, apiKey, modelKey } = z.object({ baseUrl: z.string().url(), apiKey: z.string().nullable().optional(), modelKey: z.string().min(1) }).parse(request.body)
    try {
      await loadLmModel(baseUrl, apiKey ?? undefined, modelKey)
      return { ok: true }
    } catch (e) {
      app.log.warn({ baseUrl, modelKey, err: e instanceof Error ? e.message : String(e) }, 'LM model load failed')
      reply.code(503)
      return apiError('upstream', e instanceof Error ? e.message : 'LM model load failed', {
        code: 'lm_model_load_failed',
        details: { baseUrl, modelKey },
      })
    }
  })

  app.post('/api/lm-connections/models/unload', async (request, reply) => {
    const { baseUrl, apiKey, instanceId } = z.object({ baseUrl: z.string().url(), apiKey: z.string().nullable().optional(), instanceId: z.string().min(1) }).parse(request.body)
    try {
      await unloadLmModel(baseUrl, apiKey ?? undefined, instanceId)
      return { ok: true }
    } catch (e) {
      app.log.warn({ baseUrl, instanceId, err: e instanceof Error ? e.message : String(e) }, 'LM model unload failed')
      reply.code(503)
      return apiError('upstream', e instanceof Error ? e.message : 'LM model unload failed', {
        code: 'lm_model_unload_failed',
        details: { baseUrl, instanceId },
      })
    }
  })

  app.post('/api/mcp-profiles/test', async (request, reply) => {
    const { url } = z.object({ url: z.string().url() }).parse(request.body)
    try {
      const init = await initializeMcpSession(url)
      const toolsResult = await listMcpTools(url, init.sessionId)
      return {
        serverName: init.serverInfo.name,
        serverVersion: init.serverInfo.version,
        tools: toolsResult.tools.map(t => t.name),
      }
    } catch (e) {
      app.log.error({ url, err: e instanceof Error ? e.message : String(e) }, 'MCP profile test failed')
      reply.code(503)
      return apiError('upstream', e instanceof Error ? e.message : 'MCP server unreachable', { details: { url } })
    }
  })

  app.post('/api/sessions/preflight', async (request, reply) => {
    const { lmConnectionSnapshot, mcpProfileSnapshots, selectedModel } = z.object({
      lmConnectionSnapshot: z.object({ baseUrl: z.string(), apiKey: z.string().nullable().optional() }),
      mcpProfileSnapshots: z.array(z.object({ url: z.string() })).default([]),
      selectedModel: z.object({ modelKey: z.string().min(1), modelDisplayName: z.string().min(1).optional() }),
    }).parse(request.body)

    let listedByCompatApi: boolean
    try {
      const modelList = await listModels(lmConnectionSnapshot.baseUrl, lmConnectionSnapshot.apiKey ?? undefined)
      listedByCompatApi = modelList.data?.some(m => m.id === selectedModel.modelKey) ?? false
    } catch (e) {
      app.log.warn({ baseUrl: lmConnectionSnapshot.baseUrl, err: e instanceof Error ? e.message : String(e) }, 'Preflight: LM Studio unreachable')
      reply.code(503)
      return apiError('upstream', 'Cannot reach LM Studio. Check that it is running and accessible.', {
        code: 'lm_studio_unreachable',
        details: { baseUrl: lmConnectionSnapshot.baseUrl },
      })
    }

    const loaded = await isModelLoaded(lmConnectionSnapshot.baseUrl, lmConnectionSnapshot.apiKey ?? undefined, selectedModel.modelKey)
    if (loaded === false || (loaded === null && !listedByCompatApi)) {
      const label = selectedModel.modelDisplayName ?? selectedModel.modelKey
      reply.code(409)
      return apiError('validation', `Selected model "${label}" is not loaded in LM Studio. Load it and try again.`, {
        code: 'lm_model_not_loaded',
        details: {
          modelKey: selectedModel.modelKey,
          modelDisplayName: selectedModel.modelDisplayName ?? null,
          baseUrl: lmConnectionSnapshot.baseUrl,
        },
      })
    }

    for (const mcpRef of mcpProfileSnapshots) {
      try {
        await initializeMcpSession(mcpRef.url)
      } catch (e) {
        app.log.warn({ url: mcpRef.url, err: e instanceof Error ? e.message : String(e) }, 'Preflight: MCP server unreachable')
        reply.code(503)
        return apiError('upstream', 'Cannot reach MCP server. Check that it is running and accessible.', {
          code: 'mcp_unreachable',
          details: { url: mcpRef.url },
        })
      }
    }

    return { ok: true }
  })
}