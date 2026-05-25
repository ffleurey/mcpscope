export { OperationError } from '@mcpscope/shared'

export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 1,
  ) {
    super(message)
    this.name = 'CliError'
  }
}

export function printError(message: string): void {
  process.stderr.write(`error: ${message}\n`)
}

export function printWarning(message: string): void {
  process.stderr.write(`warning: ${message}\n`)
}
