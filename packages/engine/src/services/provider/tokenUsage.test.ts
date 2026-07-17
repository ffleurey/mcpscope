import { describe, expect, it } from "vitest";
import { normalizeStreamUsage } from "./tokenUsage.js";

describe("normalizeStreamUsage", () => {
  it("extracts final usage from an LM Studio SSE stream, reasoning tokens included", () => {
    const raw =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":10,"total_tokens":30,"completion_tokens_details":{"reasoning_tokens":4}}}\n\n' +
      "data: [DONE]\n\n";
    const usage = normalizeStreamUsage(raw, "lmstudio");
    expect(usage.promptTokens).toBe(20);
    expect(usage.completionTokens).toBe(10);
    expect(usage.totalTokens).toBe(30);
    expect(usage.reasoningTokens).toBe(4);
  });

  it("handles the OpenRouter comment-prefixed SSE stream", () => {
    const raw =
      ": OPENROUTER PROCESSING\n\n" +
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}\n\n' +
      "data: [DONE]\n\n";
    const usage = normalizeStreamUsage(raw, "openrouter");
    expect(usage.promptTokens).toBe(7);
    expect(usage.totalTokens).toBe(9);
  });

  it("skips malformed chunks and keeps the last valid usage", () => {
    const raw =
      'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n' +
      "data: {corrupt!!!\n\n" +
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":5,"total_tokens":10}}\n\n';
    const usage = normalizeStreamUsage(raw, "lmstudio");
    expect(usage.totalTokens).toBe(10);
  });

  it("maps Ollama native done-chunk fields", () => {
    const raw =
      'data: {"done":false,"message":{"content":"hi"}}\n\n' +
      'data: {"done":true,"prompt_eval_count":15,"eval_count":6}\n\n';
    const usage = normalizeStreamUsage(raw, "ollama");
    expect(usage.promptTokens).toBe(15);
    expect(usage.completionTokens).toBe(6);
    expect(usage.totalTokens).toBe(21);
    expect(usage.reasoningTokens).toBeNull();
  });

  it("parses a plain JSON (non-streaming) body", () => {
    const raw = '{"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}';
    const usage = normalizeStreamUsage(raw, "lmstudio");
    expect(usage.totalTokens).toBe(7);
  });

  it("returns null usage when nothing parseable is present", () => {
    const usage = normalizeStreamUsage("data: garbage\n\n", "lmstudio");
    expect(usage.promptTokens).toBeNull();
    expect(usage.totalTokens).toBeNull();
  });
});
