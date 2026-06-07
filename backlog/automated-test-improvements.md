# Automated Test Improvements

## Goal

Close the highest-value gaps in the deterministic test suite identified by the audit at
`backlog/automated-test-improvements.md`.

## Scope

Five changes are proposed. Each is independent; they should be done in order of impact-to-effort.

---

### Item 1 — Un-exclude `tokenSanity.test.ts` from `npm test`

**File:** `vitest.config.ts`

Remove `'**/tokenSanity.test.ts'` from the `exclude` list.

**Rationale:** This file is deterministic (mock gateways, no live infrastructure). Its 8 tests
gating token proportionality, context sum consistency, compaction math, and monotonic context
growth are core backend invariants that should block CI on every commit. They were excluded
historically but there is no technical reason to keep them excluded.

**Risk:** Negligible — same pattern as the rest of the deterministic suite.

---

### Item 2 — Add replay fixture: multi-turn with compaction

**File:** `backend/src/testing/replayHarness.test.ts`

Add a third `it()` block inside `describe('session trace replay harness')` that:

1. Calls `captureTraceFixture` with 2 user turns and a tool-using model profile.
2. The 2. completion responses include reasoning that compaction should strip.
3. Calls `expectTraceToReplay(trace)` on the captured trace.

The mock gateways are cloned from the existing tool fixture but extended to 2 turns.
The `probePromptTokensDetailed` handler already has a multi-turn pattern in
`tokenSanity.test.ts` (`makeToolGateway`) — adapt that for the replay harness style.

**What this verifies (replay-harness-level):**
- Turn 2's context remains accurate after Turn 1's compaction strips reasoning.
- `contextTokensAtTurnEnd`, `contextTokensAfterCompaction`, and
  `compactionTokensRemoved` from Turn 1 survive the replay round-trip.
- Stripped reasoning parts have `strippedByCompactionAtTurnId` set to Turn 1
  and survive the replay round-trip.

---

### Item 3 — Add replay fixture: streaming model-only turn

**File:** `backend/src/testing/replayHarness.test.ts`

Add a fourth `it()` block that uses `streamChatCompletion` instead of
`createChatCompletion` on the mock gateway (both current fixtures use the
non-streaming path). Feed the same reasoning-content delta sequence as the
model-only fixture, then replay the captured trace.

**What this verifies:**
- The delta → committed part pipeline produces the same canonical parts as the
  non-streaming path.
- The `rawResponseBody` and `chunks` in the replay match.
- Streamed reasoning and content deltas merge into the same part records.

**Why not a dedicated streaming fixture today:** The replay harness calls
`POST /api/sessions/:id/turns`, which uses `createChatCompletion` internally.
To exercise the streaming path through replay, the harness would need to use
`POST /api/sessions/:id/turns/stream` instead. That requires modifying the
harness or testing the stream endpoint separately. **For now, this test**
**captures a trace via the non-streaming path but verifies the full**
**round-trip. A true streaming replay fixture is deferred.**

*(Clarification: the proposal describes verifying the fixture round-trip using the existing
stream-capable gateway. Since `captureTraceFixture` uses `/turns` (non-streaming), the
streaming path is not exercised during capture — only during the initial backend run.
The fixture will still verify the replay of correctly-formed parts. A separate option
is to exercise the stream endpoint directly in the focused app tests, which already have
streaming coverage in `app.test.ts:1086-1179`.)*

---

### Item 4 — Add MCP execution smoke test

**File:** `backend/src/mcp/mcp.test.ts` (or a new file alongside it)

Send a `tools/list` JSON-RPC request via `app.inject` to the primary `/mcp` endpoint
and verify the response contains the expected tool names (mcpscope_list, mcpscope_create,
mcpscope_send, mcpscope_status, mcpscope_inspect).

The existing analysis endpoint test in `app.test.ts:3963-4010` already does this for the
restricted `/mcp/analysis` endpoint and demonstrates the pattern.

**What this verifies:**
- The primary MCP endpoint responds successfully (not 404/500).
- The tool list matches the backend operation catalog.
- No regression in JSON-RPC request routing.

---

### Item 5 — Add CLI command structural test

**File:** `cli/src/` (a new `*.test.ts` alongside `index.ts` or in a `__tests__/` directory)

Verify that the CLI command tree matches the backend operation catalog:
- Each operation in `backend/src/operations/catalog.ts` maps to a CLI command.
- Command names, required flags, and output format match expectations.

Follow the same `snake_case` contract pattern as `mcp.test.ts`:
- Check command shapes structurally, not via actual execution.

**What this verifies:**
- A new backend operation without a corresponding CLI command is detected.
- CLI flag/argument changes that drift from the catalog are caught.
- The backend remains the source of truth for shared semantics.

---

### Related: Integration test restructuring (not implemented here)

Move integration tests to a `capture-fixtures` model where live runs produce
`.trace.json` files instead of running assertions inline. This is a larger
architectural change and is not part of this task. Document it as future work.

---

## Implementation order

| # | Item | File(s) | Estimated effort |
|---|------|---------|-----------------|
| 1 | Un-exclude tokenSanity.test.ts | vitest.config.ts | 1 line |
| 2 | Multi-turn compaction replay fixture | replayHarness.test.ts | ~120 lines |
| 3 | Streaming model-only replay fixture | replayHarness.test.ts | ~80 lines |
| 4 | MCP execution smoke test | mcp.test.ts | ~40 lines |
| 5 | CLI structural test | New file in cli/src/ | ~60 lines |

## Verification

After each step, run:

```bash
npx vitest run backend/src/mcp/mcp.test.ts   # for item 4
npx vitest run backend/src/testing/replayHarness.test.ts  # for items 2–3
npx vitest run                                    # full suite for item 1
npm run check:cli -- --pretty                      # for item 5
```

The full suite (`npm test`) must remain green throughout.
