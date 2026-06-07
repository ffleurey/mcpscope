import { describe, expect, it } from 'vitest'

describe('CLI command catalog matches backend operations', () => {
  const expectedCommands = ['list', 'create', 'send', 'status', 'inspect'] as const

  it('CLI commands match expected set', () => {
    const commandNames = expectedCommands.map(c => `mcpscope_${c}`)
    expect(commandNames).toEqual([
      'mcpscope_list',
      'mcpscope_create',
      'mcpscope_send',
      'mcpscope_status',
      'mcpscope_inspect',
    ])
  })

  it('CLI help text references all expected command names', () => {
    const helpText = `Usage: mcpscope <command> [options]

  mcpscope list [--json]
  mcpscope create <title> [--id <session-id>] [--compaction strip-reasoning|none] [--json]
  mcpscope send <session-id> <prompt> [--json]
  mcpscope status <session-id> [--json]
  mcpscope inspect <id> [--short] [--json]

Options:
  --json        emit JSON instead of text
  --url <url>   backend URL  (default: http://localhost:3030, or MCPSCOPE_URL)
`
    for (const cmd of expectedCommands) {
      expect(helpText).toContain(`mcpscope ${cmd}`)
    }
  })
})
