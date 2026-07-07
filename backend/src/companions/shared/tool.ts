import type {
  McpServer,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape, type ZodObject } from "zod";
import { CompanionError } from "./http.js";

/**
 * Reusable `response_format` enum for companion tools whose results can be large.
 * `concise` (default) returns a compact summary; `detailed` returns the token-heavy
 * full payload — the built-in "flip one parameter, watch the context grow" demo.
 */
export const responseFormatSchema = z
  .enum(["concise", "detailed"])
  .default("concise")
  .describe(
    "concise = compact summary (default); detailed = full, token-heavy payload.",
  );

export type ResponseFormat = "concise" | "detailed";

/**
 * Register one tool that returns its result as pretty-printed JSON text.
 *
 * Wraps the SDK's `registerTool` with the shape mcpscope's own MCP server uses:
 * inputs validated against `inputSchema`, results rendered as a single text
 * channel, and thrown errors returned as `{ error: { message } }` with `isError`.
 * Handlers receive fully-typed, validated arguments.
 */
export function registerJsonTool<Shape extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Shape,
  handler: (args: z.infer<ZodObject<Shape>>) => Promise<unknown>,
): void {
  // The callback is cast to the SDK's ToolCallback because a passthrough generic
  // Shape cannot be proven assignable to registerTool's conditional callback type
  // (a TS limitation). Runtime safety is preserved: we re-validate args with zod.
  const callback = async (args: Record<string, unknown>) => {
    try {
      const parsed = z.object(inputSchema).parse(args) as z.infer<ZodObject<Shape>>;
      const result = await handler(parsed);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err) {
      const message =
        err instanceof CompanionError || err instanceof Error
          ? err.message
          : String(err);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: { message } }, null, 2),
          },
        ],
        isError: true,
      };
    }
  };
  server.registerTool(
    name,
    { description, inputSchema },
    callback as unknown as ToolCallback<Shape>,
  );
}
