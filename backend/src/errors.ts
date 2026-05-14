export type ApiErrorType = 'validation' | 'not_found' | 'upstream' | 'timeout' | 'internal'

export interface ApiErrorBody {
  error: {
    type: ApiErrorType
    message: string
    code?: string
    details?: unknown
  }
}

export function apiError(
  type: ApiErrorType,
  message: string,
  options?: { code?: string; details?: unknown },
): ApiErrorBody {
  return { error: { type, message, ...options } }
}
