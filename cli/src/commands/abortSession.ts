import { cliAbortSession } from "../httpClient.js";

export interface AbortSessionOptions {
  url: string;
  sessionId: string;
  json: boolean;
}

export async function runAbortSession(opts: AbortSessionOptions): Promise<void> {
  const result = await cliAbortSession(opts.url, opts.sessionId);
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    const label =
      result.outcome === "aborted"
        ? "Aborted active turn in session"
        : result.outcome === "dequeued"
          ? "Dequeued pending job for session"
          : "No job was running for session";
    process.stdout.write(`${label} ${result.session_id}\n`);
  }
}

export function parseAbortSessionArgs(
  args: string[],
):
  | { opts: AbortSessionOptions }
  | { help: true }
  | { error: string } {
  let url: string | undefined;
  let json = false;
  let sessionId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--url") {
      url = args[++i];
      if (!url) return { error: "--url requires a value" };
    } else if (arg === "--json") {
      json = true;
    } else if (!arg.startsWith("-")) {
      if (sessionId !== undefined)
        return { error: "Too many arguments: only one session ID is allowed" };
      sessionId = arg;
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  if (!sessionId)
    return { error: "Missing required argument: <session-id>" };

  return { opts: { url: url ?? "", json, sessionId } };
}
