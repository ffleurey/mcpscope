import type { BackendDatabase } from "../persistence/db.js";
import { insertRawExchangeRecord } from "../persistence/repository.js";
import type { ApiMessage } from "../domain/selectors.js";
import type { RawExchangeRecord, SessionRecord } from "../domain/model.js";
import {
  probePromptTokens,
  type PromptProbeResult,
} from "../services/lmstudio/client.js";
import { buildReasoningParams } from "../services/provider/index.js";
import type { ChatCompletionGateway } from "./modelTurns.js";

export type LmToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

interface ProbeTraceContext {
  database: BackendDatabase;
  sessionId: string;
  turnId: string | null;
  roundId: string | null;
}

function buildProbeBody(
  session: SessionRecord,
  messages: ApiMessage[],
  tools?: LmToolDefinition[],
): Record<string, unknown> {
  return {
    model: session.modelProfileSnapshot.modelKey,
    temperature: session.modelProfileSnapshot.temperature,
    messages,
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...buildReasoningParams(
      session.modelProfileSnapshot.reasoning,
      session.modelProfileSnapshot.connectionBaseUrl,
    ),
  };
}

function createUuid(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

function makeProbeRawExchangeRecords(
  trace: ProbeTraceContext,
  result: PromptProbeResult,
): RawExchangeRecord[] {
  const createdAt = now();
  return [
    {
      id: createUuid(),
      sessionId: trace.sessionId,
      turnId: trace.turnId,
      roundId: trace.roundId,
      kind: "lmstudio-probe-request",
      requestUrl: result.rawExchange.requestUrl,
      requestMethod: result.rawExchange.requestMethod,
      requestHeadersJson: result.rawExchange.requestHeadersJson,
      requestBody: result.rawExchange.requestBody,
      responseStatus: null,
      responseHeadersJson: null,
      responseBody: null,
      createdAt,
    },
    {
      id: createUuid(),
      sessionId: trace.sessionId,
      turnId: trace.turnId,
      roundId: trace.roundId,
      kind: "lmstudio-probe-response",
      requestUrl: result.rawExchange.requestUrl,
      requestMethod: result.rawExchange.requestMethod,
      requestHeadersJson: null,
      requestBody: null,
      responseStatus: result.rawExchange.responseStatus,
      responseHeadersJson: result.rawExchange.responseHeadersJson,
      responseBody: result.rawExchange.responseBody,
      createdAt,
    },
  ];
}

export async function probeRequestPromptTokens(
  chatCompletionGateway: ChatCompletionGateway,
  session: SessionRecord,
  messages: ApiMessage[],
  tools?: LmToolDefinition[],
  trace?: ProbeTraceContext,
): Promise<number | null> {
  if (messages.length === 0) {
    return null;
  }

  const body = buildProbeBody(session, messages, tools);
  if (chatCompletionGateway.probePromptTokensDetailed) {
    const result = await chatCompletionGateway.probePromptTokensDetailed(
      session.modelProfileSnapshot.connectionBaseUrl,
      session.modelProfileSnapshot.apiKey ?? undefined,
      body,
    );
    if (trace) {
      const records = makeProbeRawExchangeRecords(trace, result);
      const tx = trace.database.connection.transaction(() => {
        records.forEach((record) =>
          insertRawExchangeRecord(trace.database.connection, record),
        );
      });
      tx();
    }
    return result.promptTokens;
  }

  return chatCompletionGateway.probePromptTokens
    ? chatCompletionGateway.probePromptTokens(
        session.modelProfileSnapshot.connectionBaseUrl,
        session.modelProfileSnapshot.apiKey ?? undefined,
        body,
      )
    : probePromptTokens(
        session.modelProfileSnapshot.connectionBaseUrl,
        session.modelProfileSnapshot.apiKey ?? undefined,
        body,
      );
}
