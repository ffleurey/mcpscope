import { cliRenameSession } from "../httpClient.js";

export interface RenameSessionOptions {
  url: string;
  sessionId: string;
  title: string;
  json: boolean;
}

export async function runRenameSession(opts: RenameSessionOptions): Promise<void> {
  const result = await cliRenameSession(opts.url, opts.sessionId, opts.title);
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(
      `Renamed session ${result.session_id} to "${result.title}"\n`,
    );
  }
}

export function parseRenameSessionArgs(
  args: string[],
):
  | { opts: RenameSessionOptions }
  | { help: true }
  | { error: string } {
  let url: string | undefined;
  let json = false;
  let sessionId: string | undefined;
  let title: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--url") {
      url = args[++i];
      if (!url) return { error: "--url requires a value" };
    } else if (arg === "--json") {
      json = true;
    } else if (!arg.startsWith("-")) {
      if (sessionId === undefined) {
        sessionId = arg;
      } else if (title === undefined) {
        title = arg;
      } else {
        return { error: "Too many arguments" };
      }
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  if (!sessionId)
    return { error: "Missing required argument: <session-id>" };
  if (!title) return { error: "Missing required argument: <title>" };

  return { opts: { url: url ?? "", json, sessionId, title } };
}
