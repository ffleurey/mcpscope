#!/usr/bin/env node
import { resolveBackendUrl } from "./config.js";
import { CliError, OperationError, printError } from "./errors.js";
import {
  parseSessionsListArgs,
  runSessionsList,
} from "./commands/sessions/list.js";
import { parseInspectArgs, runInspect } from "./commands/inspect.js";
import { parseServeArgs, runServe } from "./commands/serve.js";
import { parseCreateArgs, runCreate } from "./commands/create.js";
import { parseSendArgs, runSend } from "./commands/send.js";
import { parseStatusArgs, runStatus } from "./commands/status.js";
import {
  parseListModelConfigsArgs,
  runListModelConfigs,
} from "./commands/listModelConfigs.js";
import {
  parseListMcpProfilesArgs,
  runListMcpProfiles,
} from "./commands/listMcpProfiles.js";
import {
  parseBenchmarkCreateArgs,
  runBenchmarkCreate,
  parseBenchmarkListArgs,
  runBenchmarkList,
  parseBenchmarkInspectArgs,
  runBenchmarkInspect,
  parseBenchmarkAddCaseArgs,
  runBenchmarkAddCase,
  parseBenchmarkAddCaseFromSessionArgs,
  runBenchmarkAddCaseFromSession,
  parseBenchmarkUpdateCaseArgs,
  runBenchmarkUpdateCase,
  parseBenchmarkDeleteCaseArgs,
  runBenchmarkDeleteCase,
  parseBenchmarkRunArgs,
  runBenchmarkRun,
  parseBenchmarkRunStatusArgs,
  runBenchmarkRunStatus,
  parseBenchmarkRunReportArgs,
  runBenchmarkRunReport,
  parseBenchmarkRunControlArgs,
  runBenchmarkRunControl,
  parseBenchmarkEvaluateArgs,
  runBenchmarkEvaluate,
  parseBenchmarkRunEvaluationsArgs,
  runBenchmarkRunEvaluations,
  parseBenchmarkEvaluationControlArgs,
  runBenchmarkEvaluationControl,
} from "./commands/benchmark.js";

function printHelp(): void {
  process.stdout.write(`Usage: mcpscope <command> [options]

  mcpscope serve [--port <n>] [--host <host>] [--data-dir <path>] [--no-open]

  mcpscope list [--json]
  mcpscope create <title> [--id <session-id>] [--compaction strip-reasoning|none] [--model-config <id>] [--mcp-profile <id>...] [--max-tool-rounds <n>] [--json]
  mcpscope send <session-id> <prompt> [--json]
  mcpscope status <session-id> [--json]
  mcpscope inspect <id> [--short] [--json]
  mcpscope list_model_configs [--json]
  mcpscope list_mcp_profiles [--json]

  mcpscope benchmark_create <name> [--description <text>] [--json]
  mcpscope benchmark_list [--json]
  mcpscope benchmark_inspect <benchmark_id> [--json]
  mcpscope benchmark_add_case <benchmark_id> <prompt> [--name <text>] [--expect-tool <name>]... [--forbid-tool <name>]... [--json]
  mcpscope benchmark_add_case_from_session <benchmark_id> <session_id> [--name <text>] [--json]
  mcpscope benchmark_update_case <case_id> [--name <text>] [--prompt <text>] [--order <n>] [--expect-tool <name>]... [--forbid-tool <name>]... [--rubric-json <json>] [--json]
  mcpscope benchmark_delete_case <case_id> [--json]
  mcpscope benchmark_run <benchmark_id> [--case <id>]... [--repetitions <n>] [--model-config <id>] [--mcp-profile <id>]... [--max-tool-rounds <n>] [--wait] [--json]
  mcpscope benchmark_run_status <run_id> [--json]
  mcpscope benchmark_run_report <run_id> [--json]
  mcpscope benchmark_run_control <run_id> --action <pause|resume|stop> [--mode <continue|retry>] [--json]
  mcpscope benchmark_evaluate <run_id> --judge-model <model_config_id> [--temperature <n>] [--json]
  mcpscope benchmark_run_evaluations <run_id> [--json]
  mcpscope benchmark_evaluation_control <evaluation_id> --action <pause|resume|stop> [--mode <continue|retry>] [--json]

Options:
  --json        emit JSON instead of text
  --url <url>   backend URL  (default: http://localhost:3030, or MCPSCOPE_URL)
`);
}

export async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);

  // Extract global --url before dispatching (may be overridden per-command too)
  let globalUrl: string | undefined;
  const filteredArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--url") {
      globalUrl = args[++i];
    } else {
      filteredArgs.push(arg);
    }
  }

  const [cmd, sub, ...rest] = filteredArgs;

  if (!cmd || cmd === "-h" || cmd === "--help") {
    printHelp();
    return;
  }

  if (cmd === "--version") {
    process.stdout.write("mcpscope\n");
    return;
  }

  // Local launcher (not a catalog operation): boots the bundled backend + frontend.
  if (cmd === "serve") {
    const parsed = parseServeArgs([sub, ...rest].filter(Boolean) as string[]);
    if ("help" in parsed) {
      printHelp();
      return;
    }
    if ("error" in parsed) {
      printError(parsed.error);
      printError("Run `mcpscope --help` for usage.");
      process.exit(2);
    }
    await runServe(parsed.opts);
    return;
  }

  if (cmd === "list") {
    const parsed = parseSessionsListArgs(
      [sub, ...rest].filter(Boolean) as string[],
    );
    if ("help" in parsed) {
      printHelp();
      return;
    }
    if ("error" in parsed) {
      printError(parsed.error);
      printError("Run `mcpscope --help` for usage.");
      process.exit(2);
    }
    const { opts } = parsed;
    const resolvedUrl = resolveBackendUrl(opts.url || globalUrl);
    await runSessionsList({ ...opts, url: resolvedUrl });
    return;
  }

  if (cmd === "create") {
    const parsed = parseCreateArgs([sub, ...rest].filter(Boolean) as string[]);
    if ("help" in parsed) {
      printHelp();
      return;
    }
    if ("error" in parsed) {
      printError(parsed.error);
      printError("Run `mcpscope --help` for usage.");
      process.exit(2);
    }
    const { opts } = parsed;
    const resolvedUrl = resolveBackendUrl(opts.url || globalUrl);
    await runCreate({ ...opts, url: resolvedUrl });
    return;
  }

  if (cmd === "send") {
    const parsed = await parseSendArgs(
      [sub, ...rest].filter(Boolean) as string[],
    );
    if ("help" in parsed) {
      printHelp();
      return;
    }
    if ("error" in parsed) {
      printError(parsed.error);
      printError("Run `mcpscope --help` for usage.");
      process.exit(2);
    }
    const { opts } = parsed;
    const resolvedUrl = resolveBackendUrl(opts.url || globalUrl);
    await runSend({ ...opts, url: resolvedUrl });
    return;
  }

  if (cmd === "status") {
    const parsed = parseStatusArgs([sub, ...rest].filter(Boolean) as string[]);
    if ("help" in parsed) {
      printHelp();
      return;
    }
    if ("error" in parsed) {
      printError(parsed.error);
      printError("Run `mcpscope --help` for usage.");
      process.exit(2);
    }
    const { opts } = parsed;
    const resolvedUrl = resolveBackendUrl(opts.url || globalUrl);
    await runStatus({ ...opts, url: resolvedUrl });
    return;
  }

  if (cmd === "sessions") {
    if (!sub || sub === "-h" || sub === "--help") {
      printHelp();
      return;
    }

    if (sub === "list") {
      const parsed = parseSessionsListArgs(rest);

      if ("help" in parsed) {
        printHelp();
        return;
      }
      if ("error" in parsed) {
        printError(parsed.error);
        printError("Run `mcpscope --help` for usage.");
        process.exit(2);
      }

      const { opts } = parsed;
      const resolvedUrl = resolveBackendUrl(opts.url || globalUrl);
      await runSessionsList({ ...opts, url: resolvedUrl });
      return;
    }

    printError(`Unknown subcommand: sessions ${sub}`);
    printError("Run `mcpscope --help` for usage.");
    process.exit(2);
  }

  const dispatchFlat = async <T extends { url: string }>(
    parsed: { opts: T } | { help: true } | { error: string },
    run: (opts: T) => Promise<void>,
  ): Promise<void> => {
    if ("help" in parsed) {
      printHelp();
      return;
    }
    if ("error" in parsed) {
      printError(parsed.error);
      printError("Run `mcpscope --help` for usage.");
      process.exit(2);
    }
    const { opts } = parsed;
    const resolvedUrl = resolveBackendUrl(opts.url || globalUrl);
    await run({ ...opts, url: resolvedUrl });
  };

  const benchmarkArgs = [sub, ...rest].filter(Boolean) as string[];

  if (cmd === "benchmark_create") {
    await dispatchFlat(parseBenchmarkCreateArgs(benchmarkArgs), runBenchmarkCreate);
    return;
  }

  if (cmd === "benchmark_list") {
    await dispatchFlat(parseBenchmarkListArgs(benchmarkArgs), runBenchmarkList);
    return;
  }

  if (cmd === "benchmark_inspect") {
    await dispatchFlat(
      parseBenchmarkInspectArgs(benchmarkArgs),
      runBenchmarkInspect,
    );
    return;
  }

  if (cmd === "benchmark_add_case") {
    await dispatchFlat(
      parseBenchmarkAddCaseArgs(benchmarkArgs),
      runBenchmarkAddCase,
    );
    return;
  }

  if (cmd === "benchmark_add_case_from_session") {
    await dispatchFlat(
      parseBenchmarkAddCaseFromSessionArgs(benchmarkArgs),
      runBenchmarkAddCaseFromSession,
    );
    return;
  }

  if (cmd === "benchmark_update_case") {
    await dispatchFlat(
      parseBenchmarkUpdateCaseArgs(benchmarkArgs),
      runBenchmarkUpdateCase,
    );
    return;
  }

  if (cmd === "benchmark_delete_case") {
    await dispatchFlat(
      parseBenchmarkDeleteCaseArgs(benchmarkArgs),
      runBenchmarkDeleteCase,
    );
    return;
  }

  if (cmd === "benchmark_run") {
    await dispatchFlat(parseBenchmarkRunArgs(benchmarkArgs), runBenchmarkRun);
    return;
  }

  if (cmd === "benchmark_run_status") {
    await dispatchFlat(
      parseBenchmarkRunStatusArgs(benchmarkArgs),
      runBenchmarkRunStatus,
    );
    return;
  }

  if (cmd === "benchmark_run_report") {
    await dispatchFlat(
      parseBenchmarkRunReportArgs(benchmarkArgs),
      runBenchmarkRunReport,
    );
    return;
  }

  if (cmd === "benchmark_run_control") {
    await dispatchFlat(
      parseBenchmarkRunControlArgs(benchmarkArgs),
      runBenchmarkRunControl,
    );
    return;
  }

  if (cmd === "benchmark_evaluate") {
    await dispatchFlat(
      parseBenchmarkEvaluateArgs(benchmarkArgs),
      runBenchmarkEvaluate,
    );
    return;
  }

  if (cmd === "benchmark_run_evaluations") {
    await dispatchFlat(
      parseBenchmarkRunEvaluationsArgs(benchmarkArgs),
      runBenchmarkRunEvaluations,
    );
    return;
  }

  if (cmd === "benchmark_evaluation_control") {
    await dispatchFlat(
      parseBenchmarkEvaluationControlArgs(benchmarkArgs),
      runBenchmarkEvaluationControl,
    );
    return;
  }

  if (cmd === "inspect") {
    const parsed = parseInspectArgs([sub, ...rest].filter(Boolean) as string[]);

    if ("help" in parsed) {
      printHelp();
      return;
    }
    if ("error" in parsed) {
      printError(parsed.error);
      printError("Run `mcpscope --help` for usage.");
      process.exit(2);
    }

    const { opts } = parsed;
    const resolvedUrl = resolveBackendUrl(opts.url || globalUrl);
    await runInspect({ ...opts, url: resolvedUrl });
    return;
  }

  if (cmd === "list_model_configs") {
    const parsed = parseListModelConfigsArgs(
      [sub, ...rest].filter(Boolean) as string[],
    );
    if ("help" in parsed) {
      printHelp();
      return;
    }
    if ("error" in parsed) {
      printError(parsed.error);
      printError("Run `mcpscope --help` for usage.");
      process.exit(2);
    }
    const { opts } = parsed;
    const resolvedUrl = resolveBackendUrl(opts.url || globalUrl);
    await runListModelConfigs({ ...opts, url: resolvedUrl });
    return;
  }

  if (cmd === "list_mcp_profiles") {
    const parsed = parseListMcpProfilesArgs(
      [sub, ...rest].filter(Boolean) as string[],
    );
    if ("help" in parsed) {
      printHelp();
      return;
    }
    if ("error" in parsed) {
      printError(parsed.error);
      printError("Run `mcpscope --help` for usage.");
      process.exit(2);
    }
    const { opts } = parsed;
    const resolvedUrl = resolveBackendUrl(opts.url || globalUrl);
    await runListMcpProfiles({ ...opts, url: resolvedUrl });
    return;
  }

  printError(`Unknown command: ${cmd}`);
  printError("Run `mcpscope --help` for usage.");
  process.exit(2);
}

main(process.argv).catch((err: unknown) => {
  if (err instanceof CliError) {
    printError(err.message);
    process.exit(err.exitCode);
  }
  if (err instanceof OperationError) {
    printError(err.message);
    process.exit(1);
  }
  printError(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
