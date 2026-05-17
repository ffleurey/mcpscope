#!/usr/bin/env node
import { resolveBackendUrl } from './config.js'
import { CliError, printError } from './errors.js'
import { parseSessionsListArgs, printSessionsListHelp, runSessionsList } from './commands/sessions/list.js'

function printRootHelp(): void {
  process.stdout.write(`Usage: mcpscope <command> [options]

Commands:
  sessions list      List sessions from the backend

Options:
  --url <url>        Backend URL (overrides MCPSCOPE_URL env var)
  -h, --help         Show this help
  --version          Show version

Environment:
  MCPSCOPE_URL       Backend URL (default: http://localhost:3030)
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
    printRootHelp()
    return
  }

  if (cmd === '--version') {
    process.stdout.write('mcpscope\n')
    return
  }

  if (cmd === 'sessions') {
    if (!sub || sub === '-h' || sub === '--help') {
      printSessionsListHelp()
      return
    }

    if (sub === 'list') {
      const parsed = parseSessionsListArgs(rest)

      if ('help' in parsed) {
        printSessionsListHelp()
        return
      }
      if ('error' in parsed) {
        printError(parsed.error)
        printError('Run `mcpscope sessions list --help` for usage.')
        process.exit(2)
      }

      const { opts } = parsed
      // Global --url wins only if the command did not specify its own
      const resolvedUrl = resolveBackendUrl(opts.url || globalUrl)
      await runSessionsList({ ...opts, url: resolvedUrl })
      return
    }

    printError(`Unknown subcommand: sessions ${sub}`)
    printError('Run `mcpscope sessions --help` for usage.')
    process.exit(2)
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
