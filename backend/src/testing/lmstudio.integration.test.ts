import { describe, expect, it } from 'vitest'
import { createChatCompletion, listModels } from 'mcpscope-engine/services/openai/client.js'
import { writeIntegrationArtifact } from './artifacts.js'
import { getIntegrationEnv } from './integrationEnv.js'

describe('LM Studio integration', () => {
  it('lists the configured model and returns usage for a simple completion', async () => {
    const env = getIntegrationEnv()

    const models = await listModels(env.lmStudioBaseUrl, env.lmStudioApiKey)
    writeIntegrationArtifact('lmstudio-models', models)

    const modelIds = (models.data ?? []).map(model => model.id).filter(Boolean)
    expect(modelIds).toContain(env.lmStudioModel)

    const completion = await createChatCompletion(env.lmStudioBaseUrl, env.lmStudioApiKey, {
      model: env.lmStudioModel,
      temperature: 0,
      stream: false,
      messages: [
        { role: 'system', content: 'Reply with the exact text OK.' },
        { role: 'user', content: 'Return only OK.' },
      ],
    })

    writeIntegrationArtifact('lmstudio-simple-completion', completion)

    expect(completion.model).toBe(env.lmStudioModel)
    expect(completion.choices.length).toBeGreaterThan(0)
    expect(completion.choices[0]?.finish_reason).toBe('stop')
    expect(completion.usage?.prompt_tokens).toBeTypeOf('number')
    expect(completion.usage?.completion_tokens).toBeTypeOf('number')
    expect(completion.usage?.total_tokens).toBeTypeOf('number')
    expect(completion.usage?.total_tokens).toBe(
      (completion.usage?.prompt_tokens ?? 0) + (completion.usage?.completion_tokens ?? 0)
    )
    expect((completion.choices[0]?.message?.content ?? '').trim().length).toBeGreaterThan(0)
  }, 60_000)
})
