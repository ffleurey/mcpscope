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
export function operationErrorResponse(err: OperationError): {
  error: Record<string, unknown>
} {
  // Derive the coarse error type from the same code→status mapping the HTTP
  // layer uses, so a 404 code doesn't ship a body claiming type "validation".
  const status = operationErrorToHttpStatus(err.code)
  const type =
    status === 404
      ? 'not_found'
      : status === 409
        ? 'conflict'
        : status === 503
          ? 'unavailable'
          : status === 400
            ? 'validation'
            : 'error'
  const body: Record<string, unknown> = {
    type,
    message: err.message,
  }
  if (err.code !== undefined) body.code = err.code
  if (err.active_session !== undefined) body.active_session = err.active_session
  return { error: body }
}

/** Map a canonical error code to an HTTP status code. */
export function operationErrorToHttpStatus(code: string | undefined): number {
  switch (code) {
    case 'session_not_found':
    case 'hierarchical_id_not_found':
    case 'not_found':
    case 'step_not_found':
    case 'benchmark_not_found':
    case 'benchmark_case_not_found':
    case 'benchmark_run_not_found':
    case 'benchmark_evaluation_not_found':
      return 404
    case 'invalid_session_id':
    case 'invalid_hierarchical_id':
    case 'invalid_title':
    case 'benchmark_empty':
    case 'benchmark_invalid_input':
      return 400
    case 'scheduler_unavailable':
      return 503
    case 'another_session_active':
    case 'turn_in_progress':
    case 'session_not_initialized':
    case 'session_already_queued':
    case 'step_not_ready':
    case 'duplicate_session_id':
    case 'session_id_generation_failed':
    case 'benchmark_id_generation_failed':
    case 'benchmark_run_active':
    case 'benchmark_evaluation_active':
      return 409
    case 'default_model_not_configured':
    case 'default_model_config_not_found':
    case 'default_lm_connection_not_found':
    case 'default_mcp_profile_not_found':
    case 'model_config_not_found':
    case 'lm_connection_not_found':
    case 'mcp_profile_not_found':
    case 'mcp_profile_disabled':
    case 'target_session_not_eligible':
    case 'target_turn_not_found':
    case 'target_turn_not_complete':
    case 'analysis_model_config_not_found':
    case 'analysis_lm_connection_not_found':
    case 'benchmark_no_rubric':
    case 'benchmark_run_not_finished':
      return 422
    default:
      return 500
  }
}
