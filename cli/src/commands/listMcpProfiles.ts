import { cliListMcpProfiles } from "../httpClient.js";
import type { ListMcpProfilesResult } from "../types.js";

export interface ListMcpProfilesOptions {
  url: string;
  json: boolean;
}

export async function runListMcpProfiles(
  opts: ListMcpProfilesOptions,
): Promise<void> {
  const result = await cliListMcpProfiles(opts.url);

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  renderListMcpProfilesText(result);
}

function renderListMcpProfilesText(result: ListMcpProfilesResult): void {
  const profiles = result.mcpProfiles;
  if (profiles.length === 0) {
    process.stdout.write("No MCP server profiles configured.\n");
    return;
  }

  for (const p of profiles) {
    const enabled = p.defaultEnabled ? "enabled" : "disabled";
    process.stdout.write(`${p.id}  ${p.name}  ${p.url}  ${enabled}\n`);
  }
}

export function parseListMcpProfilesArgs(
  args: string[],
): { opts: ListMcpProfilesOptions } | { help: true } | { error: string } {
  let url: string | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--url") {
      url = args[++i];
      if (!url) return { error: "--url requires a value" };
    } else if (arg === "--json") {
      json = true;
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  return { opts: { url: url ?? "", json } };
}
