#!/usr/bin/env node
import { resolveBackendUrl } from './config.js'
import { CliError, printError } from './errors.js'
import { parseSessionsListArgs, runSessionsList } from './commands/sessions/list.js'
import { parseInspectArgs, runInspect } from './commands/inspect.js'

function printHelp(): void {
  process.stdout.write(`Usage: mcpscope <command> [--url <url>]

  sessions list [--json]
    list all sessions

  inspect <id> [--short] [--json]
    inspect session / turn / round / part by hierarchical ID
    <id>      QGWA  /  QGWA.1  /  QGWA.1.2  /  QGWA.1.2.3-U
    --short   omit part content (token counts only)
    --json    emit JSON instead of text

Full mode includes content for user_prompt and assistant_answer.
tool_definitions always shows tool names; use a part ID for full schemas.

--url <url>  or  MCPSCOPE_URL  (default: http://localhost:3030)
`)
}

async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2)

  // Extract global --url before dispatching (may be overridden per-command too)
  let globalUrl: string | undefined
  const filteredArgs: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '--url') {
      globalUrl = args[++i]
    } else {
      filteredArgs.push(arg)
    }
  }

  const [cmd, sub, ...rest] = filteredArgs

  if (!cmd || cmd === '-h' || cmd === '--help') {
    printHelp()
    return
  }

  if (cmd === '--version') {
    process.stdout.write('mcpscope\n')
    return
  }

  if (cmd === 'sessions') {
    if (!sub || sub === '-h' || sub === '--help') {
      printHelp()
      return
    }

    if (sub === 'list') {
      const parsed = parseSessionsListArgs(rest)

      if ('help' in parsed) {
        printHelp()
        return
      }
      if ('error' in parsed) {
        printError(parsed.error)
        printError('Run `mcpscope --help` for usage.')
        process.exit(2)
      }

      const { opts } = parsed
      // Global --url wins only if the command did not specify its own
      const resolvedUrl = resolveBackendUrl(opts.url || globalUrl)
      await runSessionsList({ ...opts, url: resolvedUrl })
      return
    }

    printError(`Unknown subcommand: sessions ${sub}`)
    printError('Run `mcpscope --help` for usage.')
    process.exit(2)
  }

  if (cmd === 'inspect') {
    const parsed = parseInspectArgs([sub, ...rest].filter(Boolean) as string[])

    if ('help' in parsed) {
      printHelp()
      return
    }
    if ('error' in parsed) {
      printError(parsed.error)
      printError('Run `mcpscope --help` for usage.')
      process.exit(2)
    }

    const { opts } = parsed
    const resolvedUrl = resolveBackendUrl(opts.url || globalUrl)
    await runInspect({ ...opts, url: resolvedUrl })
    return
  }

  printError(`Unknown command: ${cmd}`)
  printError('Run `mcpscope --help` for usage.')
  process.exit(2)
}

main(process.argv).catch((err: unknown) => {
  if (err instanceof CliError) {
    printError(err.message)
    process.exit(err.exitCode)
  }
  printError(err instanceof Error ? err.message : String(err))
  process.exit(1)
})


