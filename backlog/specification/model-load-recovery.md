When a session is started or a chat is loaded, the required model may not be currently loaded in LM Studio. Today this produces a hard failure with no clear recovery path.

## Goal

Make model availability failures a recoverable user choice rather than a dead-end error.

## When to check

- **Session start**: before creating the session, check which model is currently loaded for the selected connection.
- **Chat load**: when the user opens an existing session, check whether the session's model is currently loaded. This check runs at load time (when the chat becomes active in the UI). In the future this could be made configurable to also check at the start of each turn.

Both situations use the same strategy and the same UI.

## Behaviour

When the required model is not loaded:

- show a dialog with:
  - the model the session requires
  - the model currently loaded (if any)
  - the action needed (load, or unload-then-load)
- offer the user:
  - **Cancel**: return to the previous screen without any changes
  - **Load model**: trigger a load (and unload the current model first if LM Studio requires it)
- if load succeeds, continue with the original action (start session or open chat)
- if load fails, surface the error and keep the user on the same screen

## What to show

The model config screens should already make it clear which model is loaded for each connection. A "loaded" indicator on the connection or model card is sufficient — no need for a separate status screen.

## Scope

- handle the not-loaded case at session start and chat load
- use LM Studio's existing load/unload API (already partially wired in `ModelConfigs.svelte`)
- no complex retry orchestration — one attempt, clear feedback
- do not attempt to handle the case where LM Studio itself is unreachable (that is covered by the general error handling feature)

## Notes

- the loaded model state is already fetched in `ModelConfigs.svelte` via `listModels()` / `loadModel()` / `unloadModel()`
- the same model status fetch logic needs to be available at session start and chat load time
- this feature depends on the general error handling consolidation being in place first
