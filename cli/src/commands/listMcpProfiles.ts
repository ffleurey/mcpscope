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

export function renderListMcpProfilesText(result: ListMcpProfilesResult): void {
  const profiles = result.mcp_profiles;
  if (profiles.length === 0) {
    process.stdout.write("No MCP server profiles configured.\n");
    return;
  }

  for (const p of profiles) {
    const tags: string[] = [];
    if (p.source === "builtin") tags.push("built-in");
    if (p.default_enabled) tags.push("default");
    const suffix = tags.length > 0 ? `  ${tags.map((t) => `[${t}]`).join(" ")}` : "";
    process.stdout.write(`${p.id}  ${p.name}  ${p.url}${suffix}\n`);
    // Surface the config requirement for an unavailable (key-gated, unset) profile.
    if (p.disabled_reason) {
      process.stdout.write(`    unavailable: ${p.disabled_reason}\n`);
    }
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
