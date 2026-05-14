export type AppErrorType = 'validation' | 'not_found' | 'upstream' | 'timeout' | 'internal' | 'network'

export class AppError extends Error {
  readonly errorType: AppErrorType
  readonly statusCode: number
  readonly code?: string
  readonly details?: unknown

  constructor(
    message: string,
    errorType: AppErrorType,
    statusCode: number,
    options?: { code?: string; details?: unknown },
  ) {
    super(message)
    this.name = 'AppError'
    this.errorType = errorType
    this.statusCode = statusCode
    this.code = options?.code
    this.details = options?.details
  }
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e
  if (e instanceof Error) return new AppError(e.message, 'internal', 0)
  return new AppError(String(e), 'internal', 0)
}
