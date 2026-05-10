# Refactoring Plan

## Why this work comes first

The current runtime logic is too hard to trust in the areas that matter most:

- token attribution
- reasoning / thinking retention vs. context inclusion
- reconstruction of model-visible history
- multi-round tool execution
- persistence of evolving turn state

The goal of this refactor is not cosmetic cleanup. It is to make the token and context model **correct, inspectable, testable, and extensible**.

## Refactoring goals

1. Make one canonical data model the source of truth for:
   - what is displayed in chat
   - what is included in model context
   - what is historical but no longer in context
   - what token counts exist, how they were obtained, and how trustworthy they are
2. Keep thinking / reasoning history instead of discarding it, while explicitly marking whether each reasoning block is:
   - shown in chat
   - included in the next model call
   - historical only
3. Replace the current mixed runtime flow in `sendMessage()` with small modules that each own one concern.
4. Make all token and context calculations pure and independently testable.
5. Treat derived UI views such as the context bar as read models built from the canonical state, not as parallel authoritative state.

## Architectural direction

### 1. Introduce a canonical turn/part model

Keep the persisted session/message history, but move the detailed token/context state next to the content it describes.

Recommended shape:

- `ChatSession`
  - session metadata
  - current runtime state
  - optional session-level prompt/tool definition blocks
- `ChatTurn`
  - one user prompt and the assistant work that follows
  - status, timestamps, summary usage
  - list of `TurnRound`
  - list of `TurnPart`
- `TurnRound`
  - one LLM call within the turn
  - prompt/completion/reasoning usage from the backend
  - tool call ids created in that round
  - timing and finish reason
- `TurnPart`
  - a single logical content block such as:
    - system prompt
    - MCP instructions
    - tool definitions
    - user message
    - assistant thinking
    - assistant content
    - tool call
    - tool result
  - the actual payload or text
  - token metadata stored on that block
  - context metadata stored on that block

Each `TurnPart` should carry its own metadata, for example:

- `display`: visible in chat, hidden, or diagnostic-only
- `context`: included in current context, excluded, stripped, or historical-only
- `tokens`:
  - amount
  - source (`api`, `derived-from-delta`, `estimated`, `manual-correction`)
  - confidence (`exact`, `corrected`, `estimated`, `unknown`)
  - optional formula / provenance note

This keeps the content, the context policy, and the statistics connected.

### 2. Stop using a side-car context model as the authority

`ContextSegment[]` should no longer be the thing that knows the truth.

Instead:

- the canonical state should live on session / turn / part objects
- the context bar should be derived from those parts
- exports should be derived from those parts
- API payload reconstruction should be derived from those parts

If `ContextSegment[]` remains, it should be a transient derived view only.

### 3. Preserve full reasoning history

Reasoning should be kept for study and debugging even when it is not forwarded into later API calls.

For every reasoning block, store:

- raw reasoning text
- where it came from
- which round produced it
- whether it was included in the next round
- whether it is part of later historical context
- token count and provenance

This allows the product to answer three different questions from the same state:

1. What did the user see?
2. What did the model see?
3. What did we measure?

### 4. Split `sendMessage()` into a turn pipeline

The current function mixes persistence, streaming, tool execution, token attribution, context reconstruction, and UI updates.

Target modules:

1. `createTurn()`  
   Creates the new turn and initial parts.
2. `buildRequestPayload()`  
   Builds the exact API payload for a round from canonical state.
3. `streamAssistantRound()`  
   Collects streaming deltas into round output.
4. `finalizeRoundUsage()`  
   Applies backend usage and attaches token provenance.
5. `executeRoundToolCalls()`  
   Parses, executes, and records tool calls/results.
6. `advanceTurnState()`  
   Decides whether another round is needed.
7. `finalizeTurn()`  
   Settles statuses, timestamps, and session updates.
8. `deriveContextView()`  
   Produces the context bar model from canonical parts.

The orchestration function should remain thin and mostly describe flow.

### 5. Push calculation into pure functions

Anything involving token math or context inclusion should be a pure function with fixtures.

Priority pure functions:

1. building historical context payload
2. applying reasoning stripping policy
3. computing user-token attribution from backend deltas
4. attributing tool-call and tool-result token cost
5. deriving current in-context parts
6. deriving context-bar segments

### 6. Normalize status transitions

Turn and part status should have explicit state transitions rather than ad-hoc patching.

Important transitions:

- draft -> streaming -> complete
- draft -> streaming -> aborted
- draft -> streaming -> error
- tool pending -> running -> done/error
- context included -> stripped -> historical-only

This should reduce bugs caused by partial updates during streaming and tool rounds.

## Migration strategy

### Phase 1: Define the target model

- document the new types
- map current fields to the future model
- identify fields that can be removed after migration

### Phase 2: Build selectors before cutting over UI

- write pure selectors to derive:
  - visible transcript
  - in-context payload
  - context bar segments
  - diagnostics export
- keep current UI running while validating selectors against fixtures

### Phase 3: Extract the turn pipeline

- move streaming/tool/persistence logic out of `sendMessage()`
- keep behavior stable while changing structure
- introduce explicit round results and transition functions

### Phase 4: Remove duplicate logic

After the new model is working:

- remove duplicated payload reconstruction logic
- remove duplicate token formulas spread across the store
- reduce direct mutation of partially-built message objects

## Refactoring acceptance criteria

The refactor is successful when:

1. every displayed content block can be traced to a canonical stored object
2. every token value has provenance stored next to the content it describes
3. reasoning is preserved even when excluded from later context
4. the exact model-visible payload can be rebuilt from canonical state
5. the context bar is purely derived from canonical state
6. `sendMessage()` becomes orchestration rather than a monolith
7. the new behavior is covered by automated tests before further feature work resumes

## Scope guardrails

- do not add new product features during this refactor
- do not redesign the UI first
- do not optimize for multiple backends yet
- do not keep old parallel data paths longer than needed

The first objective is trustworthiness, not breadth.
