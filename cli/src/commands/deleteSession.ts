import { cliDeleteSession } from "../httpClient.js";

export interface DeleteSessionOptions {
  url: string;
  sessionId: string;
  json: boolean;
}

export async function runDeleteSession(opts: DeleteSessionOptions): Promise<void> {
  await cliDeleteSession(opts.url, opts.sessionId);
  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        { api_version: 1, deleted: true, session_id: opts.sessionId },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stdout.write(`Deleted session ${opts.sessionId}\n`);
  }
}

export function parseDeleteSessionArgs(
  args: string[],
):
  | { opts: DeleteSessionOptions }
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
