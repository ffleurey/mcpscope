import { cliSend } from '../httpClient.js'

export interface SendOptions {
  url: string
  sessionId: string
  prompt: string
  json: boolean
  wait: boolean
}

export async function runSend(opts: SendOptions): Promise<void> {
  const result = await cliSend(opts.url, {
    session_id: opts.sessionId,
    prompt: opts.prompt,
    ...(opts.wait ? { wait: true } : {}),
  })

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }

  process.stdout.write(`${result.session_id}  turn ${result.turn.id}  ${result.turn.status}\n`)
  if (opts.wait) {
    process.stdout.write(`\nRun 'mcpscope inspect ${result.turn.id}' to see the trace.\n`)
  } else {
    process.stdout.write(`\nRun 'mcpscope status ${result.session_id}' to poll for completion.\n`)
  }
}

export async function parseSendArgs(
  args: string[],
): Promise<{ opts: SendOptions } | { help: true } | { error: string }> {
  let url: string | undefined
  let json = false
  let wait = false
  const positional: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '-h' || arg === '--help') return { help: true }
    if (arg === '--url') {
      url = args[++i]
      if (!url) return { error: '--url requires a value' }
    } else if (arg === '--json') {
      json = true
    } else if (arg === '--wait') {
      wait = true
    } else if (!arg.startsWith('-')) {
      positional.push(arg)
    } else {
      return { error: `Unknown option: ${arg}` }
    }
  }

  const sessionId = positional[0]
  if (!sessionId) return { error: 'Missing required argument: <session-id>' }

  let prompt = positional.slice(1).join(' ')

  if (!prompt) {
    // Try reading from stdin when piped
    const isStdinPiped = !process.stdin.isTTY
    if (!isStdinPiped) {
      return { error: 'Missing required argument: <prompt> (or pipe via stdin)' }
    }
    prompt = await readStdin()
    prompt = prompt.trim()
    if (!prompt) {
      return { error: 'Empty prompt: stdin was empty or contained only whitespace' }
    }
  }

  return { opts: { url: url ?? '', json, wait, sessionId, prompt } }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}
