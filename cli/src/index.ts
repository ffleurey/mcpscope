#!/usr/bin/env node
import { resolveBackendUrl } from './config.js'
import { CliError, OperationError, printError } from './errors.js'
import { parseSessionsListArgs, runSessionsList } from './commands/sessions/list.js'
import { parseInspectArgs, runInspect } from './commands/inspect.js'
import { parseCreateArgs, runCreate } from './commands/create.js'
import { parseSendArgs, runSend } from './commands/send.js'
import { parseStatusArgs, runStatus } from './commands/status.js'

function printHelp(): void {
  process.stdout.write(`Usage: mcpscope <command> [options]

  mcpscope list [--json]
  mcpscope create <title> [--id <session-id>] [--compaction strip-reasoning|none] [--json]
  mcpscope send <session-id> <prompt> [--json]
  mcpscope status <session-id> [--json]
  mcpscope inspect <id> [--short] [--json]

Options:
  --json        emit JSON instead of text
  --url <url>   backend URL  (default: http://localhost:3030, or MCPSCOPE_URL)
`)
}

export async function main(argv: string[]): Promise<void> {
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

  if (cmd === 'list') {
    const parsed = parseSessionsListArgs([sub, ...rest].filter(Boolean) as string[])
    if ('help' in parsed) { printHelp(); return }
    if ('error' in parsed) { printError(parsed.error); printError('Run `mcpscope --help` for usage.'); process.exit(2) }
    const { opts } = parsed
    const resolvedUrl = resolveBackendUrl(opts.url || globalUrl)
    await runSessionsList({ ...opts, url: resolvedUrl })
    return
  }

  if (cmd === 'create') {
    const parsed = parseCreateArgs([sub, ...rest].filter(Boolean) as string[])
    if ('help' in parsed) { printHelp(); return }
    if ('error' in parsed) { printError(parsed.error); printError('Run `mcpscope --help` for usage.'); process.exit(2) }
    const { opts } = parsed
    const resolvedUrl = resolveBackendUrl(opts.url || globalUrl)
    await runCreate({ ...opts, url: resolvedUrl })
    return
  }

  if (cmd === 'send') {
    const parsed = await parseSendArgs([sub, ...rest].filter(Boolean) as string[])
    if ('help' in parsed) { printHelp(); return }
    if ('error' in parsed) { printError(parsed.error); printError('Run `mcpscope --help` for usage.'); process.exit(2) }
    const { opts } = parsed
    const resolvedUrl = resolveBackendUrl(opts.url || globalUrl)
    await runSend({ ...opts, url: resolvedUrl })
    return
  }

  if (cmd === 'status') {
    const parsed = parseStatusArgs([sub, ...rest].filter(Boolean) as string[])
    if ('help' in parsed) { printHelp(); return }
    if ('error' in parsed) { printError(parsed.error); printError('Run `mcpscope --help` for usage.'); process.exit(2) }
    const { opts } = parsed
    const resolvedUrl = resolveBackendUrl(opts.url || globalUrl)
    await runStatus({ ...opts, url: resolvedUrl })
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
  if (err instanceof OperationError) {
    printError(err.message)
    process.exit(1)
  }
  printError(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

