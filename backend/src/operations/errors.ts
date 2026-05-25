/**
 * OperationError — thrown by backend operation execute() functions when a
 * recoverable business-logic failure occurs. HTTP routes and MCP both catch
 * this type and map it to the appropriate transport-level error response.
 */
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

/**
 * Build an HTTP-compatible error body from an OperationError.
 * Preserves the active_session field so the CLI can extract the blocking session.
 */
export function operationErrorResponse(err: OperationError): { error: Record<string, unknown> } {
  const body: Record<string, unknown> = { type: 'validation', message: err.message }
  if (err.code !== undefined) body.code = err.code
  if (err.active_session !== undefined) body.active_session = err.active_session
  return { error: body }
}

/** Map a canonical error code to an HTTP status code. */
export function operationErrorToHttpStatus(code: string | undefined): number {
  switch (code) {
    case 'session_not_found':
    case 'hierarchical_id_not_found':
      return 404
    case 'invalid_session_id':
    case 'invalid_hierarchical_id':
      return 400
    case 'another_session_active':
    case 'turn_in_progress':
    case 'session_not_initialized':
    case 'duplicate_session_id':
    case 'session_id_generation_failed':
      return 409
    case 'default_model_not_configured':
    case 'default_model_config_not_found':
    case 'default_lm_connection_not_found':
    case 'default_mcp_profile_not_found':
      return 422
    default:
      return 500
  }
}
