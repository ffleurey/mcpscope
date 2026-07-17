import { describe, expect, it } from "vitest";
import { parseChatCompletionStream } from "./client.js";

function sse(...payloads: string[]): string {
  return payloads.map((p) => `data: ${p}\n\n`).join("") + "data: [DONE]\n\n";
}

describe("parseChatCompletionStream", () => {
  it("assembles content, finish reason, and usage from a chunked stream", () => {
    const raw = sse(
      '{"id":"c1","model":"m","created":1,"choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"}}]}',
      '{"choices":[{"index":0,"delta":{"content":"lo."},"finish_reason":"stop"}]}',
      '{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}',
    );
    const result = parseChatCompletionStream(raw);
    expect(result.completion.choices[0]?.message?.content).toBe("Hello.");
    expect(result.completion.choices[0]?.finish_reason).toBe("stop");
    expect(result.completion.usage?.total_tokens).toBe(13);
  });

  it("skips a malformed chunk without discarding the rest of the stream", () => {
    const raw = sse(
      '{"choices":[{"index":0,"delta":{"content":"keep "}}]}',
      '{"choices":[{"index":0,"delta":{"content":"TRUNCATED', // corrupt payload
      '{"choices":[{"index":0,"delta":{"content":"this"},"finish_reason":"stop"}]}',
    );
    const result = parseChatCompletionStream(raw);
    expect(result.completion.choices[0]?.message?.content).toBe("keep this");
    expect(result.completion.choices[0]?.finish_reason).toBe("stop");
  });

  it("ignores SSE comment lines (OpenRouter keep-alive prefix)", () => {
    const raw =
      ": OPENROUTER PROCESSING\n\n" +
      sse('{"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}');
    const result = parseChatCompletionStream(raw);
    expect(result.completion.choices[0]?.message?.content).toBe("ok");
  });

  it("uses first-wins for tool-call ids repeated across chunks", () => {
    const raw = sse(
      '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"get_","arguments":"{\\"a\\""}}]}}]}',
      '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"time","arguments":":1}"}}]}}]}',
      '{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
    );
    const result = parseChatCompletionStream(raw);
    const toolCall = result.completion.choices[0]?.message?.tool_calls?.[0];
    expect(toolCall?.id).toBe("call-1");
    expect(toolCall?.function?.name).toBe("get_time");
    expect(toolCall?.function?.arguments).toBe('{"a":1}');
  });
});
