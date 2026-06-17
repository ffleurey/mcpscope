import { cliListModelConfigs } from "../httpClient.js";
import type { ListModelConfigsResult } from "../types.js";

export interface ListModelConfigsOptions {
  url: string;
  json: boolean;
}

export async function runListModelConfigs(
  opts: ListModelConfigsOptions,
): Promise<void> {
  const result = await cliListModelConfigs(opts.url);

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  renderListModelConfigsText(result);
}

function renderListModelConfigsText(result: ListModelConfigsResult): void {
  const configs = result.model_configs;
  if (!configs || configs.length === 0) {
    process.stdout.write("No model configs configured.\n");
    return;
  }

  for (const mc of configs) {
    process.stdout.write(
      `${mc.id}  ${mc.name}  ${mc.connection_name}  ${mc.model_key}  ${mc.provider_type ?? ""}\n`,
    );
  }
}

export function parseListModelConfigsArgs(
  args: string[],
): { opts: ListModelConfigsOptions } | { help: true } | { error: string } {
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
