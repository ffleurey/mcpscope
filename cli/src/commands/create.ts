import { cliCreate } from "../httpClient.js";
import type { CreateResult } from "../types.js";

export interface CreateOptions {
  url: string;
  title: string;
  id?: string | undefined;
  compaction?: "none" | "strip-reasoning" | undefined;
  modelConfigId?: string | undefined;
  mcpProfileIds?: string[] | undefined;
  json: boolean;
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 16).replace("T", " ");
}

export async function runCreate(opts: CreateOptions): Promise<void> {
  const result = await cliCreate(opts.url, {
    title: opts.title,
    ...(opts.id !== undefined ? { id: opts.id } : {}),
    ...(opts.compaction !== undefined ? { compaction: opts.compaction } : {}),
    ...(opts.modelConfigId !== undefined
      ? { model_config_id: opts.modelConfigId }
      : {}),
    ...(opts.mcpProfileIds !== undefined
      ? { mcp_profile_ids: opts.mcpProfileIds }
      : {}),
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  renderCreateText(result);
}

function renderCreateText(result: CreateResult): void {
  const { session } = result;
  process.stdout.write(`${session.id}  ${session.title}\n`);
  process.stdout.write(`  status      ${session.status}\n`);
  process.stdout.write(`  init        ${session.init_status}\n`);
  process.stdout.write(
    `  model       ${session.model.name}  (${session.model.id})\n`,
  );
  if (session.mcp.length > 0) {
    const mcpNames = session.mcp.map((m) => `${m.name}  (${m.id})`).join(", ");
    process.stdout.write(`  mcp         ${mcpNames}\n`);
  }
  process.stdout.write(`  compaction  ${session.compaction_strategy}\n`);
  process.stdout.write(`  created     ${formatDate(session.created_at)}\n`);
  process.stdout.write(
    `\nRun 'mcpscope status ${session.id}' to check initialization progress.\n`,
  );
}

export function parseCreateArgs(
  args: string[],
): { opts: CreateOptions } | { help: true } | { error: string } {
  let url: string | undefined;
  let json = false;
  let id: string | undefined;
  let compaction: "none" | "strip-reasoning" | undefined;
  let modelConfigId: string | undefined;
  let mcpProfileIds: string[] | undefined;
  let title: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--url") {
      url = args[++i];
      if (!url) return { error: "--url requires a value" };
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--id") {
      id = args[++i];
      if (!id) return { error: "--id requires a value" };
    } else if (arg === "--compaction") {
      const val = args[++i];
      if (!val) return { error: "--compaction requires a value" };
      if (val !== "none" && val !== "strip-reasoning") {
        return { error: `--compaction must be 'none' or 'strip-reasoning'` };
      }
      compaction = val;
    } else if (arg === "--model-config") {
      const val = args[++i];
      if (!val) return { error: "--model-config requires a value" };
      modelConfigId = val;
    } else if (arg === "--mcp-profile") {
      const val = args[++i];
      if (!val) return { error: "--mcp-profile requires a value" };
      if (!mcpProfileIds) mcpProfileIds = [];
      mcpProfileIds.push(val);
    } else if (!arg.startsWith("-")) {
      if (title !== undefined)
        return {
          error: "Too many arguments: title must be a single quoted string",
        };
      title = arg;
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  if (!title) return { error: "Missing required argument: <title>" };

  const opts: CreateOptions = { url: url ?? "", json, title };
  if (id !== undefined) opts.id = id;
  if (compaction !== undefined) opts.compaction = compaction;
  if (modelConfigId !== undefined) opts.modelConfigId = modelConfigId;
  if (mcpProfileIds !== undefined) opts.mcpProfileIds = mcpProfileIds;
  return { opts };
}
