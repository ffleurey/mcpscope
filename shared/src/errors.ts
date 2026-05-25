export class OperationError extends Error {
  constructor(
    message: string,
    public readonly code?: string | undefined,
    public readonly active_session?: { id: string; state: string } | undefined,
  ) {
    super(message)
    this.name = 'OperationError'
  }
}
