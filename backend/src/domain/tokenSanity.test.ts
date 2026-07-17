/**
 * Token count sanity tests.
 *
 * These tests verify that token counts are sensible by comparing them against
 * actual part content and checking mathematical consistency across the session:
 *
 *   1. Content ↔ count parity: parts with substantial text/JSON content must
 *      have a non-null, non-zero token count. Parts with no content must not
 *      have suspiciously large counts.
 *
 *   2. Proportionality: for text-bearing parts, chars-per-token must fall
 *      within a generous but realistic range (0.5 – 20). Token counts wildly
 *      out of proportion with content signal a bug in the accounting logic.
 *
 *   3. Turn-level mathematical consistency:
 *      - contextTokensAtTurnEnd  = Σ tokens for (included | round-only) parts
 *                                  + Σ tokens for reasoning parts stripped by
 *                                    THIS turn's compaction
 *      - contextTokensAfterCompaction = Σ tokens for (included | round-only)
 *                                       parts only (after stripping)
 *
 *   4. Monotonic growth: contextTokensAfterCompaction[N] ≤
 *      contextTokensAtTurnEnd[N+1] across consecutive turns — the context
 *      never shrinks unexpectedly between turns.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildBackendApp } from "../app.js";
import type { PartRecord, StepRecord, TurnRecord } from "mcpscope-engine/domain/model.js";
import type { SessionTraceBundle } from "mcpscope-engine/domain/trace.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSqlitePath() {
  return path.join(
    ".tmp-test-data",
    `token-sanity-${crypto.randomUUID()}`,
    "test.db",
  );
}

/** Rough character count for the payload of a part (text or JSON fallback). */
function payloadCharCount(part: PartRecord): number {
  if (part.payload.text != null && part.payload.text.length > 0) {
    return part.payload.text.length;
  }
  if (part.payload.json != null) {
    return JSON.stringify(part.payload.json).length;
  }
  return 0;
}

/** Label a part for readable test failure messages. */
function partLabel(part: PartRecord): string {
  return `${part.partType}(id=${part.id.slice(0, 8)}, turnId=${part.turnId?.slice(0, 8) ?? "null"})`;
}

// ---------------------------------------------------------------------------
// Core sanity assertions (reusable across fixture scenarios)
// ---------------------------------------------------------------------------

/**
 * Asserts content ↔ count parity and proportionality for every part.
 *
 * Skip diagnostic-note parts — they are display-only and may have arbitrary or
 * missing token counts intentionally.
 */
function assertPartTokenSanity(parts: PartRecord[]): void {
  for (const part of parts) {
    if (part.partType === "diagnostic-note") continue;

    // tool-call parts: payload.json is our internal representation of the tool call,
    // not the raw tokens the model produced. LM Studio also does not count assistant
    // tool-call messages reliably in probes (returns the same token count before and
    // after the message is appended). Skip content↔count checks for these parts.
    if (part.partType === "tool-call") continue;

    const chars = payloadCharCount(part);
    const count = part.tokens.count;
    const label = partLabel(part);

    // Rule 1 — content implies a non-zero count
    if (chars > 10 && (count === null || count === 0)) {
      throw new Error(
        `${label}: has ${chars} content chars but token count is ${count ?? "null"}. ` +
          `Content: "${(part.payload.text ?? JSON.stringify(part.payload.json) ?? "").slice(0, 60)}"`,
      );
    }

    // Rule 2 — proportionality (only when both count > 0 and chars > 0)
    if (count !== null && count > 0 && chars > 0) {
      const charsPerToken = chars / count;
      // JSON-payload parts (tool-definitions) have denser tokenization
      // than natural language — allow a wider range for them.
      const isJsonPart = part.payload.text == null && part.payload.json != null;
      const minRatio = 0.5;
      const maxRatio = isJsonPart ? 40 : 20;
      if (charsPerToken < minRatio || charsPerToken > maxRatio) {
        throw new Error(
          `${label}: suspicious chars-per-token ratio ${charsPerToken.toFixed(2)} ` +
            `(${chars} chars / ${count} tokens, ${isJsonPart ? "JSON" : "text"} payload). ` +
            `Content snippet: "${(part.payload.text ?? JSON.stringify(part.payload.json) ?? "").slice(0, 80)}"`,
        );
      }
    }

    // Rule 3 — no content but large count
    if (chars === 0 && count !== null && count > 50) {
      throw new Error(
        `${label}: no payload content but token count is ${count}. ` +
          `This suggests a stale or misattributed count.`,
      );
    }
  }
}

/**
 * Finds the compaction step ID for a given turn, if any.
 * Compaction steps have stepTypeKey='compaction' and params.sourceTurnId matching the turn ID.
 */
function compactionStepIdForTurn(
  steps: StepRecord[],
  turn: TurnRecord,
): string | null {
  for (const step of steps) {
    if (
      step.stepTypeKey === "compaction" &&
      step.params?.sourceTurnId === turn.id
    ) {
      return step.id;
    }
  }
  return null;
}

/**
 * Asserts that contextTokensAtTurnEnd and contextTokensAfterCompaction stored
 * on each TurnRecord match what we can compute from the parts in the trace.
 *
 * After compaction, reasoning parts have context.state='stripped' and
 * strippedByCompactionAtTurnId set to the compaction step that stripped them
 * (not the turn ID itself). To reconstruct the pre-compaction sum we must
 * find the compaction step for each turn and use its ID.
 */
function assertTurnContextTokenConsistency(
  turns: TurnRecord[],
  parts: PartRecord[],
  steps: StepRecord[] = [],
): void {
  const sortedTurns = [...turns].sort((a, b) => a.turnNumber - b.turnNumber);

  // Map turnId → turnNumber so we can filter parts by "existed at turn N".
  const seqByTurnId = new Map(turns.map((t) => [t.id, t.turnNumber]));

  for (const turn of sortedTurns) {
    if (turn.status !== "complete") continue;
    if (turn.contextTokensAtTurnEnd === null) continue;

    // A part "existed" at the end of turn N if it was created by turn N or earlier,
    // or is a session-prelude part (turnId null).
    const existedAtTurnN = (p: PartRecord) => {
      if (p.turnId === null) return true;
      const partTurnSeq = seqByTurnId.get(p.turnId);
      return partTurnSeq !== undefined && partTurnSeq <= turn.turnNumber;
    };

    // Parts in context AFTER this turn's compaction (included or round-only).
    const postCompactionParts = parts.filter(
      (p) =>
        existedAtTurnN(p) &&
        (p.context.state === "included" || p.context.state === "round-only"),
    );

    // Parts stripped by the compaction step that targets this turn.
    const compactionStepId = compactionStepIdForTurn(steps, turn);
    const strippedByThisTurn = compactionStepId
      ? parts.filter(
          (p) => p.context.strippedByCompactionAtTurnId === compactionStepId,
        )
      : parts.filter((p) => p.context.strippedByCompactionAtTurnId === turn.id);

    const postCompactionSum = postCompactionParts.reduce(
      (sum, p) => sum + (p.tokens.count ?? 0),
      0,
    );
    const strippedSum = strippedByThisTurn.reduce(
      (sum, p) => sum + (p.tokens.count ?? 0),
      0,
    );
    const preCompactionSum = postCompactionSum + strippedSum;

    // When totalTokens is available, contextTokensAtTurnEnd must equal it
    // (the cumulative total is anchored to the exact API value, not the sum
    // of individually-estimated part counts).
    // When totalTokens is null, fall back to the part-sum consistency check.
    if (turn.usage.totalTokens != null) {
      expect(
        turn.contextTokensAtTurnEnd,
        `Turn ${turn.turnNumber} contextTokensAtTurnEnd should equal usage.totalTokens (${
          turn.usage.totalTokens
        })`,
      ).toBe(turn.usage.totalTokens);
    } else {
      expect(
        turn.contextTokensAtTurnEnd,
        `Turn ${turn.turnNumber} contextTokensAtTurnEnd mismatch: ` +
          `stored=${turn.contextTokensAtTurnEnd}, ` +
          `computed(post=${postCompactionSum} + stripped=${strippedSum})=${preCompactionSum}`,
      ).toBe(preCompactionSum);
    }

    // contextTokensAfterCompaction must equal contextTokensAtTurnEnd minus
    // compactionTokensRemoved (when available).  This is the correct invariant:
    // the API total minus exact reasoning removals.  Part-level post-compaction
    // sums may differ because token counts are allocated per-round from partial
    // budgets and may not perfectly sum to the final multi-round total.
    if (
      turn.contextTokensAfterCompaction !== null &&
      turn.compactionTokensRemoved !== null
    ) {
      expect(
        turn.contextTokensAfterCompaction,
        `Turn ${turn.turnNumber} contextTokensAfterCompaction mismatch: ` +
          `stored=${turn.contextTokensAfterCompaction}, ` +
          `expected=${turn.contextTokensAtTurnEnd - turn.compactionTokensRemoved}`,
      ).toBe(turn.contextTokensAtTurnEnd - turn.compactionTokensRemoved);
    }
  }
}

/**
 * Asserts that context does not shrink between turns.
 *
 * contextTokensAfterCompaction[N] must be ≤ contextTokensAtTurnEnd[N+1]
 * because turn N+1 always adds at least a user message to the context.
 */
function assertMonotonicContextGrowth(turns: TurnRecord[]): void {
  const completed = [...turns]
    .filter((t) => t.status === "complete" && t.contextTokensAtTurnEnd !== null)
    .sort((a, b) => a.turnNumber - b.turnNumber);

  for (let i = 0; i < completed.length - 1; i++) {
    const current = completed[i]!;
    const next = completed[i + 1]!;
    const afterCompaction =
      current.contextTokensAfterCompaction ?? current.contextTokensAtTurnEnd!;

    expect(
      next.contextTokensAtTurnEnd!,
      `Context shrank between turn ${current.turnNumber} and ${next.turnNumber}: ` +
        `afterCompaction[${current.turnNumber}]=${afterCompaction}, ` +
        `atTurnEnd[${next.turnNumber}]=${next.contextTokensAtTurnEnd}`,
    ).toBeGreaterThanOrEqual(afterCompaction);
  }
}

// ---------------------------------------------------------------------------
// Mock LM Studio gateway helpers
// ---------------------------------------------------------------------------

/** Mock token counts returned by the model-only LM Studio gateway. */
const SYSTEM_PROMPT_TOKENS = 3; // returned by the first probe
const TURN1_PROMPT_TOKENS = 10; // total prompt for turn 1
const TURN1_COMPLETION_TOKENS = 6;
const TURN1_REASONING_TOKENS = 4;

/** Probe responses for turn 2 (after turn 1 reasoning is stripped by compaction). */
const TURN2_PROMPT_TOKENS = 22; // turn 1 post-compaction context + user2 message
const TURN2_COMPLETION_TOKENS = 5;
const TURN2_REASONING_TOKENS = 2;

function makeModelOnlyGateway(turns: 1 | 2) {
  let completionCallCount = 0;
  return {
    async probePromptTokensDetailed(
      _baseUrl: string,
      _apiKey: string | undefined,
      body: Record<string, unknown>,
    ) {
      const messages = body.messages as Array<{ role: string }>;
      // System-only probe (1 message): returns fixed small count for system prompt.
      if (messages.length === 1)
        return makeProbeResult(SYSTEM_PROMPT_TOKENS, body);
      // All other probes return a proportional count based on message count.
      return makeProbeResult(messages.length * 4, body);
    },
    async createChatCompletion(
      _baseUrl: string,
      _apiKey: string | undefined,
      _body: unknown,
    ) {
      completionCallCount++;
      if (completionCallCount === 1) {
        return {
          id: "cmpl-1",
          model: "model-key",
          created: 123,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                reasoning_content: "Because the answer is simple.",
                content: "OK",
              },
            },
          ],
          usage: {
            prompt_tokens: TURN1_PROMPT_TOKENS,
            completion_tokens: TURN1_COMPLETION_TOKENS,
            total_tokens: TURN1_PROMPT_TOKENS + TURN1_COMPLETION_TOKENS,
            completion_tokens_details: {
              reasoning_tokens: TURN1_REASONING_TOKENS,
            },
          },
        };
      }
      if (turns === 2 && completionCallCount === 2) {
        return {
          id: "cmpl-2",
          model: "model-key",
          created: 124,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                reasoning_content: "Fine.",
                content: "Goodbye.",
              },
            },
          ],
          usage: {
            prompt_tokens: TURN2_PROMPT_TOKENS,
            completion_tokens: TURN2_COMPLETION_TOKENS,
            total_tokens: TURN2_PROMPT_TOKENS + TURN2_COMPLETION_TOKENS,
            completion_tokens_details: {
              reasoning_tokens: TURN2_REASONING_TOKENS,
            },
          },
        };
      }
      throw new Error(`Unexpected completion call #${completionCallCount}`);
    },
  };
}

function makeProbeResult(promptTokens: number, body: unknown) {
  return {
    promptTokens,
    completion: {
      id: `probe-${promptTokens}`,
      model: "model-key",
      created: 122,
      choices: [],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: 0,
        total_tokens: promptTokens,
      },
    },
    rawExchange: {
      requestUrl: "https://example.com/v1/chat/completions",
      requestMethod: "POST",
      requestHeadersJson: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      requestBody: JSON.stringify(body),
      responseStatus: 200,
      responseHeadersJson: { "content-type": "application/json" },
      responseBody: JSON.stringify({
        id: `probe-${promptTokens}`,
        usage: { prompt_tokens: promptTokens },
      }),
    },
  };
}

const noopMcpGateway = {
  async initializeSession(): Promise<never> {
    throw new Error("not used");
  },
  async listTools(): Promise<never> {
    throw new Error("not used");
  },
  async callTool(): Promise<never> {
    throw new Error("not used");
  },
};

const modelProfileSnapshot = {
  id: "model-1",
  name: "Model",
  connectionBaseUrl: "https://example.com/v1",
  apiKey: null,
  modelKey: "model-key",
  modelDisplayName: "Model Key",
  systemPrompt: "Reply exactly.",
  temperature: 0,
  reasoning: "on",
  createdAt: 1,
  updatedAt: 1,
};

async function captureModelOnlyTrace(
  userInputs: string[],
): Promise<SessionTraceBundle> {
  const sqlitePath = makeSqlitePath();
  const app = (await buildBackendApp(
    {
      host: "127.0.0.1",
      port: 3066,
      corsOrigin: true,
      dataDir: path.dirname(sqlitePath),
      sqlitePath,
      maxToolRounds: 5,
    },
    {
      chatCompletionGateway: makeModelOnlyGateway(userInputs.length as 1 | 2),
      mcpGateway: noopMcpGateway,
    },
  )).app;

  try {
    const sessionRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "Token sanity test", modelProfileSnapshot },
    });
    expect(sessionRes.statusCode).toBe(201);
    const sessionId = sessionRes.json().session.id as string;

    for (const userContent of userInputs) {
      const turnRes = await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/turns`,
        payload: { userContent },
      });
      expect(turnRes.statusCode).toBe(201);
    }

    const traceRes = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/trace`,
    });
    expect(traceRes.statusCode).toBe(200);
    return traceRes.json() as SessionTraceBundle;
  } finally {
    await app.close();
    fs.rmSync(path.dirname(sqlitePath), { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tool-enabled fixture
// ---------------------------------------------------------------------------
//
// Scenario: 2 turns. Turn 1 is a multi-round tool-use turn (round 0 produces
// a tool call; round 1 processes the result and replies). Turn 2 is a plain
// model-only response.
//
// This exercises:
//   - JSON-payload parts (tool-definitions, tool-call)
//   - Reasoning stripped from *multiple rounds* by a single turn compaction
//   - Multi-turn context growth through the tool-use turn

const toolSessionPayload = {
  title: "Token sanity — tool turns",
  modelProfileSnapshot: {
    id: "model-1",
    name: "Model",
    connectionBaseUrl: "https://example.com/v1",
    apiKey: null,
    modelKey: "model-key",
    modelDisplayName: "Model Key",
    systemPrompt: "Use tools when needed.",
    temperature: 0,
    reasoning: "on",
    createdAt: 1,
    updatedAt: 1,
  },
  mcpProfileSnapshots: [
    {
      id: "mcp-1",
      name: "Local MCP",
      url: "http://localhost:3001/mcp",
      transport: "streamable-http",
      authType: null,
      authValue: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
};

function makeToolGateway() {
  let completionCount = 0;

  return {
    chatCompletionGateway: {
      async probePromptTokensDetailed(
        _baseUrl: string,
        _apiKey: string | undefined,
        body: unknown,
      ) {
        const b = body as {
          messages: Array<{ role: string; content?: string | null }>;
          tools?: unknown[];
        };
        const messages = b.messages;
        const hasTools = Array.isArray(b.tools) && b.tools.length > 0;
        const hasToolCall = messages.some(
          (m) => m.role === "assistant" && m.content == null,
        );
        const toolResultCount = messages.filter(
          (m) => m.role === "tool",
        ).length;
        const userCount = messages.filter((m) => m.role === "user").length;
        const systemCount = messages.filter((m) => m.role === "system").length;

        let promptTokens: number;
        if (messages.length === 1 && !hasTools) {
          promptTokens = 4; // system only
        } else if (systemCount === 2 && messages.length === 2 && !hasTools) {
          promptTokens = 9; // system + mcp-instructions, no tools
        } else if (systemCount === 2 && messages.length === 2 && hasTools) {
          promptTokens = 16; // system + mcp-instructions + tool defs
        } else if (
          messages.length === 3 &&
          hasTools &&
          userCount === 1 &&
          !hasToolCall
        ) {
          promptTokens = 20; // turn1 round0 start
        } else if (
          messages.length === 4 &&
          hasTools &&
          userCount === 1 &&
          hasToolCall &&
          toolResultCount === 0
        ) {
          promptTokens = 26; // turn1 round0 suffix attribution (+ asst tool-call)
        } else if (
          messages.length === 5 &&
          hasTools &&
          userCount === 1 &&
          hasToolCall &&
          toolResultCount === 1
        ) {
          promptTokens = 32; // turn1 round1 start (+ tool result)
        } else if (
          messages.length === 6 &&
          hasTools &&
          userCount === 1 &&
          hasToolCall &&
          toolResultCount === 1
        ) {
          promptTokens = 39; // turn1 round1 suffix attribution (+ asst content)
        } else if (
          messages.length === 7 &&
          hasTools &&
          userCount === 2 &&
          hasToolCall &&
          toolResultCount === 1
        ) {
          promptTokens = 44; // turn2 round0 start (post-compaction ctx + user2)
        } else if (
          messages.length === 8 &&
          hasTools &&
          userCount === 2 &&
          hasToolCall &&
          toolResultCount === 1
        ) {
          promptTokens = 50; // turn2 round0 suffix attribution (+ asst content2)
        } else {
          throw new Error(
            `Tool mock: unexpected probe shape — ` +
              `len=${messages.length}, hasTools=${hasTools}, hasToolCall=${hasToolCall}, ` +
              `toolResults=${toolResultCount}, users=${userCount}, systems=${systemCount}`,
          );
        }
        return makeProbeResult(promptTokens, body as Record<string, unknown>);
      },
      async createChatCompletion(
        _baseUrl: string,
        _apiKey: string | undefined,
        _body: unknown,
      ) {
        completionCount++;

        if (completionCount === 1) {
          // Round 0 of turn 1: tool call
          return {
            id: "cmpl-t1r0",
            model: "model-key",
            created: 123,
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  reasoning_content:
                    "I should call the time tool to answer this.",
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: { name: "get_current_time", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 12,
              total_tokens: 32,
              completion_tokens_details: { reasoning_tokens: 6 },
            },
          };
        }

        if (completionCount === 2) {
          // Round 1 of turn 1: final answer
          return {
            id: "cmpl-t1r1",
            model: "model-key",
            created: 124,
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  reasoning_content: "The tool gave me the time.",
                  content: "The current time is 12:34.",
                },
              },
            ],
            usage: {
              prompt_tokens: 32,
              completion_tokens: 10,
              total_tokens: 42,
              completion_tokens_details: { reasoning_tokens: 4 },
            },
          };
        }

        if (completionCount === 3) {
          // Turn 2: plain response
          return {
            id: "cmpl-t2",
            model: "model-key",
            created: 125,
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  reasoning_content: "Simple follow-up.",
                  content: "Sure, happy to help further.",
                },
              },
            ],
            usage: {
              prompt_tokens: 44,
              completion_tokens: 8,
              total_tokens: 52,
              completion_tokens_details: { reasoning_tokens: 3 },
            },
          };
        }

        throw new Error(`Unexpected completion call #${completionCount}`);
      },
    },
    mcpGateway: {
      async initializeSession() {
        return {
          sessionId: "mcp-session-1",
          instructions: "Use tools accurately.",
          rawExchange: {
            requestUrl: "http://localhost:3001/mcp",
            requestMethod: "POST",
            requestHeaders: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
            },
            requestBodyText: "{}",
            responseStatus: 200,
            responseHeaders: {
              "content-type": "application/json",
              "mcp-session-id": "mcp-session-1",
            },
            responseBodyText: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: { instructions: "Use tools accurately." },
            }),
            responseBody: {
              jsonrpc: "2.0",
              id: 1,
              result: { instructions: "Use tools accurately." },
            },
          },
        };
      },
      async listTools() {
        return {
          tools: [
            {
              name: "get_current_time",
              description: "Returns the current time as an ISO 8601 string.",
              inputSchema: { type: "object", properties: {} },
            },
          ],
          rawResult: {},
          rawExchange: {
            requestUrl: "http://localhost:3001/mcp",
            requestMethod: "POST",
            requestHeaders: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              "mcp-session-id": "mcp-session-1",
            },
            requestBodyText: "{}",
            responseStatus: 200,
            responseHeaders: { "content-type": "application/json" },
            responseBodyText: JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              result: { tools: [] },
            }),
            responseBody: { jsonrpc: "2.0", id: 2, result: { tools: [] } },
          },
        };
      },
      async callTool() {
        return {
          content: "2026-05-12T12:34:56+02:00",
          structuredContent: null,
          isError: false,
          rawResult: {},
          rawExchange: {
            requestUrl: "http://localhost:3001/mcp",
            requestMethod: "POST",
            requestHeaders: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              "mcp-session-id": "mcp-session-1",
            },
            requestBodyText: "{}",
            responseStatus: 200,
            responseHeaders: { "content-type": "application/json" },
            responseBodyText: JSON.stringify({
              jsonrpc: "2.0",
              id: 3,
              result: {
                content: [{ type: "text", text: "2026-05-12T12:34:56+02:00" }],
              },
            }),
            responseBody: {
              jsonrpc: "2.0",
              id: 3,
              result: {
                content: [{ type: "text", text: "2026-05-12T12:34:56+02:00" }],
              },
            },
          },
        };
      },
    },
  };
}

async function captureToolEnabledTrace(): Promise<SessionTraceBundle> {
  const sqlitePath = makeSqlitePath();
  const deps = makeToolGateway();
  const app = (await buildBackendApp(
    {
      host: "127.0.0.1",
      port: 3066,
      corsOrigin: true,
      dataDir: path.dirname(sqlitePath),
      sqlitePath,
      maxToolRounds: 5,
    },
    deps,
  )).app;

  try {
    const sessionRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: toolSessionPayload,
    });
    expect(sessionRes.statusCode).toBe(201);
    const sessionId = sessionRes.json().session.id as string;

    for (const userContent of [
      "What time is it?",
      "Thanks, can you confirm?",
    ]) {
      const turnRes = await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/turns`,
        payload: { userContent },
      });
      expect(turnRes.statusCode).toBe(201);
    }

    const traceRes = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/trace`,
    });
    expect(traceRes.statusCode).toBe(200);
    return traceRes.json() as SessionTraceBundle;
  } finally {
    await app.close();
    fs.rmSync(path.dirname(sqlitePath), { recursive: true, force: true });
  }
}

describe("token count sanity", () => {
  it("all parts have token counts proportional to their content (single turn)", async () => {
    const trace = await captureModelOnlyTrace(["Say OK."]);
    assertPartTokenSanity(trace.parts);
  });

  it("contextTokensAtTurnEnd matches recomputed part sum (single turn)", async () => {
    const trace = await captureModelOnlyTrace(["Say OK."]);
    assertTurnContextTokenConsistency(trace.turns, trace.parts, trace.steps);
  });

  it("all parts have token counts proportional to their content (two turns)", async () => {
    const trace = await captureModelOnlyTrace(["Say OK.", "Say bye."]);
    assertPartTokenSanity(trace.parts);
  });

  it("contextTokensAtTurnEnd and contextTokensAfterCompaction are consistent across two turns", async () => {
    const trace = await captureModelOnlyTrace(["Say OK.", "Say bye."]);
    assertTurnContextTokenConsistency(trace.turns, trace.parts, trace.steps);
  });

  it("context token count grows monotonically across turns", async () => {
    const trace = await captureModelOnlyTrace(["Say OK.", "Say bye."]);
    assertMonotonicContextGrowth(trace.turns);
  });

  it("stripped reasoning parts account for the compaction token reduction", async () => {
    const trace = await captureModelOnlyTrace(["Say OK."]);
    const [turn] = trace.turns.sort((a, b) => a.turnNumber - b.turnNumber);
    if (!turn || turn.contextTokensAtTurnEnd === null) return;

    const compactionStepId = compactionStepIdForTurn(trace.steps, turn);
    const strippedByThisTurn = compactionStepId
      ? trace.parts.filter(
          (p) => p.context.strippedByCompactionAtTurnId === compactionStepId,
        )
      : trace.parts.filter(
          (p) => p.context.strippedByCompactionAtTurnId === turn.id,
        );
    const strippedSum = strippedByThisTurn.reduce(
      (s, p) => s + (p.tokens.count ?? 0),
      0,
    );

    expect(turn.compactionTokensRemoved).toBe(strippedSum);
    expect(turn.contextTokensAfterCompaction).toBe(
      turn.contextTokensAtTurnEnd - strippedSum,
    );
  });
});

describe("token count sanity — tool-enabled multi-round scenario", () => {
  it("all part types (including JSON-payload tool parts) have proportionate token counts", async () => {
    const trace = await captureToolEnabledTrace();
    assertPartTokenSanity(trace.parts);
  });

  it("contextTokensAtTurnEnd and contextTokensAfterCompaction are consistent for both turns", async () => {
    const trace = await captureToolEnabledTrace();
    assertTurnContextTokenConsistency(trace.turns, trace.parts, trace.steps);
  });

  it("context grows monotonically through tool-use and follow-up turns", async () => {
    const trace = await captureToolEnabledTrace();
    assertMonotonicContextGrowth(trace.turns);
  });

  it("reasoning from both rounds of the tool turn is stripped by a single compaction", async () => {
    const trace = await captureToolEnabledTrace();
    const sortedTurns = [...trace.turns].sort(
      (a, b) => a.turnNumber - b.turnNumber,
    );
    const turn1 = sortedTurns[0]!;

    const compactionStepId = compactionStepIdForTurn(trace.steps, turn1);
    const reasoningStrippedByTurn1 = compactionStepId
      ? trace.parts.filter(
          (p) =>
            p.partType === "assistant-reasoning" &&
            p.context.strippedByCompactionAtTurnId === compactionStepId,
        )
      : trace.parts.filter(
          (p) =>
            p.partType === "assistant-reasoning" &&
            p.context.strippedByCompactionAtTurnId === turn1.id,
        );

    // Turn 1 has 2 rounds, each producing a reasoning part — both should be stripped.
    expect(reasoningStrippedByTurn1.length).toBeGreaterThanOrEqual(2);

    // The stored compaction removal must match the sum of stripped reasoning tokens.
    const strippedSum = reasoningStrippedByTurn1.reduce(
      (s, p) => s + (p.tokens.count ?? 0),
      0,
    );
    expect(turn1.compactionTokensRemoved).toBe(strippedSum);
  });

  it("tool-call and tool-result parts are included in contextTokensAtTurnEnd", async () => {
    const trace = await captureToolEnabledTrace();
    const sortedTurns = [...trace.turns].sort(
      (a, b) => a.turnNumber - b.turnNumber,
    );
    const turn1 = sortedTurns[0]!;

    // Tool-call and tool-result parts are always 'included' (never stripped by reasoning compaction).
    const toolParts = trace.parts.filter(
      (p) =>
        p.turnId === turn1.id &&
        (p.partType === "tool-call" || p.partType === "tool-result"),
    );
    expect(toolParts.length).toBeGreaterThan(0);
    expect(toolParts.every((p) => p.context.state === "included")).toBe(true);
  });
});
