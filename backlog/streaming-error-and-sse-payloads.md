# Streaming error and SSE payload parity

Most normal backend routes now use the shared structured error contract, but the streaming paths still lag behind.

## Goal

Make streaming startup failures and SSE runtime failures expose the same useful fields as normal API errors so the frontend can report them consistently.

## Current gaps

- `frontend/src/lib/api/backendClient.ts`
  - `streamTurn()` still treats non-OK HTTP responses as legacy string-only errors
  - `streamPreludeInit()` still treats non-OK HTTP responses as legacy string-only errors
- SSE failure events are only partially standardized
  - `turn-failed`
  - `prelude-failed`
- runtime failure payloads still do not fully match the normal backend error contract
  - `message` is present
  - `errorType` is sometimes present
  - `code` and `details` are not consistently present

## Scope

- parse non-OK streaming HTTP responses with the same frontend error normalization used for normal requests
- standardize `turn-failed` and `prelude-failed` payloads around the shared backend error fields
- preserve structured upstream details when they exist
- make sure `sessionStore.ts` receives the same `AppError` information regardless of whether a failure came from:
  - a normal request
  - stream initialization
  - a later SSE failure event

## Expected backend shape

Streaming failures should carry the same logical fields already used elsewhere:

```ts
{
  type: 'validation' | 'not_found' | 'upstream' | 'timeout' | 'internal'
  message: string
  code?: string
  details?: unknown
}
```

For SSE events, keep the event-specific wrapper if needed, but include the same error fields inside it.

## Validation

- add backend coverage for `turn-failed` / `prelude-failed` payload shape
- add frontend coverage for non-OK stream startup responses
- confirm structured details survive end-to-end into frontend error state

## Out of scope

- dialog styling or visual error presentation polish
- model load/unload recovery UX
- broader retry logic changes
