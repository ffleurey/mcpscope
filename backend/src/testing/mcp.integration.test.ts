import { describe, expect, it } from 'vitest'
import { initializeMcpSession, listMcpTools } from 'mcpscope-engine/services/mcp/httpClient.js'
import { writeIntegrationArtifact } from './artifacts.js'
import { getIntegrationEnv } from './integrationEnv.js'

describe('MCP integration', () => {
  it('initializes a session and lists available tools', async () => {
    const env = getIntegrationEnv()

    const session = await initializeMcpSession(env.mcpServerUrl)
    writeIntegrationArtifact('mcp-initialize', session)

    expect(session.serverInfo.name.length).toBeGreaterThan(0)

    const toolsList = await listMcpTools(env.mcpServerUrl, session.sessionId)
    writeIntegrationArtifact('mcp-tools-list', toolsList)

    expect(toolsList.tools.length).toBeGreaterThan(0)
    expect(toolsList.tools.every(tool => tool.name.length > 0)).toBe(true)
  }, 60_000)
})
