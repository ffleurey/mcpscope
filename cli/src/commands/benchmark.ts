import {
  cliBenchmarkCreate,
  cliBenchmarkList,
  cliBenchmarkInspect,
  cliBenchmarkAddCase,
  cliBenchmarkAddCaseFromSession,
  cliBenchmarkRun,
  cliBenchmarkRunStatus,
  cliBenchmarkRunReport,
  cliBenchmarkEvaluate,
  cliBenchmarkRunEvaluations,
} from "../httpClient.js";
import { bold } from "../colors.js";
import type {
  BenchmarkCreateResult,
  BenchmarkListResult,
  BenchmarkInspectResult,
  BenchmarkAddCaseResult,
  BenchmarkRunStatusResult,
  BenchmarkRunReportResult,
  BenchmarkEvaluateResult,
  BenchmarkRunEvaluationsResult,
  NumberStats,
  CaseReport,
} from "../types.js";

// ─── Shared helpers ──────────────────────────────────────────────────────────

type ParseResult<T> = { opts: T } | { help: true } | { error: string };

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 16).replace("T", " ");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function formatStats(stats: NumberStats | null): string {
  if (stats === null) return "n/a";
  const round = (n: number): string =>
    Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `min ${round(stats.min)}  mean ${round(stats.mean)}  median ${round(stats.median)}  max ${round(stats.max)}`;
}

function emitJson(result: unknown): void {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

// ─── benchmark_create ──────────────────────────────────────────────────────

export interface BenchmarkCreateOptions {
  url: string;
  json: boolean;
  name: string;
  description?: string | undefined;
}

export async function runBenchmarkCreate(
  opts: BenchmarkCreateOptions,
): Promise<void> {
  const result = await cliBenchmarkCreate(opts.url, {
    name: opts.name,
    ...(opts.description !== undefined
      ? { description: opts.description }
      : {}),
  });

  if (opts.json) {
    emitJson(result);
    return;
  }

  renderBenchmarkCreate(result);
}

function renderBenchmarkCreate(result: BenchmarkCreateResult): void {
  const { benchmark } = result;
  process.stdout.write(`${benchmark.id}  ${benchmark.name}\n`);
  if (benchmark.description) {
    process.stdout.write(`  description  ${benchmark.description}\n`);
  }
  process.stdout.write(
    `\nRun 'mcpscope benchmark_add_case ${benchmark.id} <prompt>' to add cases.\n`,
  );
}

export function parseBenchmarkCreateArgs(
  args: string[],
): ParseResult<BenchmarkCreateOptions> {
  let url: string | undefined;
  let json = false;
  let description: string | undefined;
  let name: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--url") {
      url = args[++i];
      if (!url) return { error: "--url requires a value" };
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--description") {
      const val = args[++i];
      if (val === undefined) return { error: "--description requires a value" };
      description = val;
    } else if (!arg.startsWith("-")) {
      if (name !== undefined) {
        return {
          error: "Too many arguments: name must be a single quoted string",
        };
      }
      name = arg;
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  if (!name) return { error: "Missing required argument: <name>" };

  const opts: BenchmarkCreateOptions = { url: url ?? "", json, name };
  if (description !== undefined) opts.description = description;
  return { opts };
}

// ─── benchmark_list ──────────────────────────────────────────────────────────

export interface BenchmarkListOptions {
  url: string;
  json: boolean;
}

export async function runBenchmarkList(
  opts: BenchmarkListOptions,
): Promise<void> {
  const result = await cliBenchmarkList(opts.url);

  if (opts.json) {
    emitJson(result);
    return;
  }

  renderBenchmarkList(result);
}

function renderBenchmarkList(result: BenchmarkListResult): void {
  const { benchmarks } = result;
  if (benchmarks.length === 0) {
    process.stdout.write("No benchmarks found.\n");
    return;
  }

  const header = `${"ID".padEnd(16)}  ${"NAME".padEnd(36)}  ${"CASES".padStart(5)}  ${"RUNS".padStart(5)}`;
  const separator = "-".repeat(header.length);
  process.stdout.write(header + "\n");
  process.stdout.write(separator + "\n");

  for (const b of benchmarks) {
    process.stdout.write(
      `${truncate(b.id, 16).padEnd(16)}  ${truncate(b.name, 36).padEnd(36)}  ${String(b.case_count).padStart(5)}  ${String(b.run_count).padStart(5)}\n`,
    );
  }
}

export function parseBenchmarkListArgs(
  args: string[],
): ParseResult<BenchmarkListOptions> {
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

// ─── benchmark_inspect ─────────────────────────────────────────────────────

export interface BenchmarkInspectOptions {
  url: string;
  json: boolean;
  benchmarkId: string;
}

export async function runBenchmarkInspect(
  opts: BenchmarkInspectOptions,
): Promise<void> {
  const result = await cliBenchmarkInspect(opts.url, opts.benchmarkId);

  if (opts.json) {
    emitJson(result);
    return;
  }

  renderBenchmarkInspect(result);
}

function renderBenchmarkInspect(result: BenchmarkInspectResult): void {
  const { benchmark, cases, runs } = result;
  process.stdout.write(`${bold(benchmark.id)}  ${benchmark.name}\n`);
  if (benchmark.description) {
    process.stdout.write(`  description  ${benchmark.description}\n`);
  }
  process.stdout.write(`  created      ${formatDate(benchmark.created_at)}\n`);
  process.stdout.write(`  updated      ${formatDate(benchmark.updated_at)}\n`);

  process.stdout.write(`\n${bold("Cases")} (${cases.length})\n`);
  if (cases.length === 0) {
    process.stdout.write("  (none)\n");
  } else {
    for (const c of cases) {
      process.stdout.write(
        `  ${c.id}  #${c.order_index + 1}  ${truncate(c.prompt, 60)}\n`,
      );
      if (c.expected_tools_called.length > 0) {
        process.stdout.write(
          `      expect-tool   ${c.expected_tools_called.join(", ")}\n`,
        );
      }
      if (c.expected_tools_not_called.length > 0) {
        process.stdout.write(
          `      forbid-tool   ${c.expected_tools_not_called.join(", ")}\n`,
        );
      }
      if (c.rubric.length > 0) {
        const pts = c.rubric.reduce((sum, r) => sum + r.points, 0);
        process.stdout.write(
          `      rubric        ${c.rubric.length} criteria (${pts} pts)\n`,
        );
      }
    }
  }

  process.stdout.write(`\n${bold("Runs")} (${runs.length})\n`);
  if (runs.length === 0) {
    process.stdout.write("  (none)\n");
  } else {
    for (const r of runs) {
      process.stdout.write(
        `  ${r.id}  ${r.status.padEnd(9)}  reps ${r.repetitions}  cases ${r.cases.length}  ${formatDate(r.created_at)}\n`,
      );
    }
  }
}

export function parseBenchmarkInspectArgs(
  args: string[],
): ParseResult<BenchmarkInspectOptions> {
  let url: string | undefined;
  let json = false;
  let benchmarkId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--url") {
      url = args[++i];
      if (!url) return { error: "--url requires a value" };
    } else if (arg === "--json") {
      json = true;
    } else if (!arg.startsWith("-")) {
      if (benchmarkId !== undefined) {
        return { error: "Too many arguments" };
      }
      benchmarkId = arg;
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  if (!benchmarkId) {
    return { error: "Missing required argument: <benchmark_id>" };
  }

  return { opts: { url: url ?? "", json, benchmarkId } };
}

// ─── benchmark_add_case ──────────────────────────────────────────────────────

export interface BenchmarkAddCaseOptions {
  url: string;
  json: boolean;
  benchmarkId: string;
  prompt: string;
  name?: string | undefined;
  expectedToolsCalled?: string[] | undefined;
  expectedToolsNotCalled?: string[] | undefined;
}

export async function runBenchmarkAddCase(
  opts: BenchmarkAddCaseOptions,
): Promise<void> {
  const result = await cliBenchmarkAddCase(opts.url, {
    benchmark_id: opts.benchmarkId,
    prompt: opts.prompt,
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    ...(opts.expectedToolsCalled !== undefined
      ? { expected_tools_called: opts.expectedToolsCalled }
      : {}),
    ...(opts.expectedToolsNotCalled !== undefined
      ? { expected_tools_not_called: opts.expectedToolsNotCalled }
      : {}),
  });

  if (opts.json) {
    emitJson(result);
    return;
  }

  renderBenchmarkAddCase(result);
}

function renderBenchmarkAddCase(result: BenchmarkAddCaseResult): void {
  const { case: c } = result;
  process.stdout.write(
    `${c.id}  #${c.order_index + 1}  ${truncate(c.prompt, 60)}\n`,
  );
  if (c.name) {
    process.stdout.write(`  name          ${c.name}\n`);
  }
  if (c.source_session_id) {
    process.stdout.write(`  from-session  ${c.source_session_id}\n`);
  }
  if (c.expected_tools_called.length > 0) {
    process.stdout.write(
      `  expect-tool   ${c.expected_tools_called.join(", ")}\n`,
    );
  }
  if (c.expected_tools_not_called.length > 0) {
    process.stdout.write(
      `  forbid-tool   ${c.expected_tools_not_called.join(", ")}\n`,
    );
  }
  if (c.rubric.length > 0) {
    const pts = c.rubric.reduce((sum, r) => sum + r.points, 0);
    process.stdout.write(
      `  rubric        ${c.rubric.length} criteria (${pts} pts)\n`,
    );
  }
}

export function parseBenchmarkAddCaseArgs(
  args: string[],
): ParseResult<BenchmarkAddCaseOptions> {
  let url: string | undefined;
  let json = false;
  let benchmarkId: string | undefined;
  let prompt: string | undefined;
  let name: string | undefined;
  let expectedToolsCalled: string[] | undefined;
  let expectedToolsNotCalled: string[] | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--url") {
      url = args[++i];
      if (!url) return { error: "--url requires a value" };
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--name") {
      const val = args[++i];
      if (val === undefined) return { error: "--name requires a value" };
      name = val;
    } else if (arg === "--expect-tool") {
      const val = args[++i];
      if (!val) return { error: "--expect-tool requires a value" };
      if (!expectedToolsCalled) expectedToolsCalled = [];
      expectedToolsCalled.push(val);
    } else if (arg === "--forbid-tool") {
      const val = args[++i];
      if (!val) return { error: "--forbid-tool requires a value" };
      if (!expectedToolsNotCalled) expectedToolsNotCalled = [];
      expectedToolsNotCalled.push(val);
    } else if (!arg.startsWith("-")) {
      if (benchmarkId === undefined) {
        benchmarkId = arg;
      } else if (prompt === undefined) {
        prompt = arg;
      } else {
        return {
          error: "Too many arguments: prompt must be a single quoted string",
        };
      }
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  if (!benchmarkId) {
    return { error: "Missing required argument: <benchmark_id>" };
  }
  if (!prompt) return { error: "Missing required argument: <prompt>" };

  const opts: BenchmarkAddCaseOptions = {
    url: url ?? "",
    json,
    benchmarkId,
    prompt,
  };
  if (name !== undefined) opts.name = name;
  if (expectedToolsCalled !== undefined) {
    opts.expectedToolsCalled = expectedToolsCalled;
  }
  if (expectedToolsNotCalled !== undefined) {
    opts.expectedToolsNotCalled = expectedToolsNotCalled;
  }
  return { opts };
}

// ─── benchmark_add_case_from_session ─────────────────────────────────────────

export interface BenchmarkAddCaseFromSessionOptions {
  url: string;
  json: boolean;
  benchmarkId: string;
  sessionId: string;
  name?: string | undefined;
}

export async function runBenchmarkAddCaseFromSession(
  opts: BenchmarkAddCaseFromSessionOptions,
): Promise<void> {
  const result = await cliBenchmarkAddCaseFromSession(opts.url, {
    benchmark_id: opts.benchmarkId,
    session_id: opts.sessionId,
    ...(opts.name !== undefined ? { name: opts.name } : {}),
  });

  if (opts.json) {
    emitJson(result);
    return;
  }

  renderBenchmarkAddCase(result);
}

export function parseBenchmarkAddCaseFromSessionArgs(
  args: string[],
): ParseResult<BenchmarkAddCaseFromSessionOptions> {
  let url: string | undefined;
  let json = false;
  let benchmarkId: string | undefined;
  let sessionId: string | undefined;
  let name: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--url") {
      url = args[++i];
      if (!url) return { error: "--url requires a value" };
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--name") {
      const val = args[++i];
      if (val === undefined) return { error: "--name requires a value" };
      name = val;
    } else if (!arg.startsWith("-")) {
      if (benchmarkId === undefined) {
        benchmarkId = arg;
      } else if (sessionId === undefined) {
        sessionId = arg;
      } else {
        return { error: "Too many arguments" };
      }
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  if (!benchmarkId) {
    return { error: "Missing required argument: <benchmark_id>" };
  }
  if (!sessionId) {
    return { error: "Missing required argument: <session_id>" };
  }

  const opts: BenchmarkAddCaseFromSessionOptions = {
    url: url ?? "",
    json,
    benchmarkId,
    sessionId,
  };
  if (name !== undefined) opts.name = name;
  return { opts };
}

// ─── benchmark_run ───────────────────────────────────────────────────────────

export interface BenchmarkRunOptions {
  url: string;
  json: boolean;
  benchmarkId: string;
  repetitions?: number | undefined;
  modelConfigId?: string | undefined;
  mcpProfileIds?: string[] | undefined;
  caseIds?: string[] | undefined;
  wait: boolean;
}

const POLL_INTERVAL_MS = 700;
const POLL_MAX_MS = 5 * 60 * 1000;

export async function runBenchmarkRun(opts: BenchmarkRunOptions): Promise<void> {
  const launch = await cliBenchmarkRun(opts.url, {
    benchmark_id: opts.benchmarkId,
    ...(opts.caseIds !== undefined ? { case_ids: opts.caseIds } : {}),
    ...(opts.repetitions !== undefined
      ? { repetitions: opts.repetitions }
      : {}),
    ...(opts.modelConfigId !== undefined
      ? { model_config_id: opts.modelConfigId }
      : {}),
    ...(opts.mcpProfileIds !== undefined
      ? { mcp_profile_ids: opts.mcpProfileIds }
      : {}),
  });

  const runId = launch.run.id;

  if (!opts.wait) {
    if (opts.json) {
      emitJson(launch);
      return;
    }
    process.stdout.write(`${runId}  ${launch.run.status}\n`);
    process.stdout.write(
      `\nRun 'mcpscope benchmark_run_status ${runId}' to poll progress,` +
        ` or 'mcpscope benchmark_run_report ${runId}' for full metrics.\n`,
    );
    return;
  }

  // Poll status until the run reaches a terminal state.
  const deadline = Date.now() + POLL_MAX_MS;
  let status = await cliBenchmarkRunStatus(opts.url, runId);
  while (
    status.status !== "complete" &&
    status.status !== "error" &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    status = await cliBenchmarkRunStatus(opts.url, runId);
  }

  if (opts.json) {
    emitJson(status);
    return;
  }

  renderBenchmarkRunStatus(status);
  process.stdout.write(
    `\nRun 'mcpscope benchmark_run_report ${runId}' for full metrics.\n`,
  );
}

export function parseBenchmarkRunArgs(
  args: string[],
): ParseResult<BenchmarkRunOptions> {
  let url: string | undefined;
  let json = false;
  let benchmarkId: string | undefined;
  let repetitions: number | undefined;
  let modelConfigId: string | undefined;
  let mcpProfileIds: string[] | undefined;
  let caseIds: string[] | undefined;
  let wait = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--url") {
      url = args[++i];
      if (!url) return { error: "--url requires a value" };
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--wait") {
      wait = true;
    } else if (arg === "--repetitions") {
      const val = args[++i];
      if (!val) return { error: "--repetitions requires a value" };
      const n = Number(val);
      if (!Number.isInteger(n) || n < 1) {
        return { error: "--repetitions must be a positive integer" };
      }
      repetitions = n;
    } else if (arg === "--model-config") {
      const val = args[++i];
      if (!val) return { error: "--model-config requires a value" };
      modelConfigId = val;
    } else if (arg === "--mcp-profile") {
      const val = args[++i];
      if (!val) return { error: "--mcp-profile requires a value" };
      if (!mcpProfileIds) mcpProfileIds = [];
      mcpProfileIds.push(val);
    } else if (arg === "--case") {
      const val = args[++i];
      if (!val) return { error: "--case requires a value" };
      if (!caseIds) caseIds = [];
      caseIds.push(val);
    } else if (!arg.startsWith("-")) {
      if (benchmarkId !== undefined) {
        return { error: "Too many arguments" };
      }
      benchmarkId = arg;
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  if (!benchmarkId) {
    return { error: "Missing required argument: <benchmark_id>" };
  }

  const opts: BenchmarkRunOptions = { url: url ?? "", json, benchmarkId, wait };
  if (repetitions !== undefined) opts.repetitions = repetitions;
  if (modelConfigId !== undefined) opts.modelConfigId = modelConfigId;
  if (mcpProfileIds !== undefined) opts.mcpProfileIds = mcpProfileIds;
  if (caseIds !== undefined) opts.caseIds = caseIds;
  return { opts };
}

// ─── benchmark_run_status ────────────────────────────────────────────────────

export interface BenchmarkRunStatusOptions {
  url: string;
  json: boolean;
  runId: string;
}

export async function runBenchmarkRunStatus(
  opts: BenchmarkRunStatusOptions,
): Promise<void> {
  const result = await cliBenchmarkRunStatus(opts.url, opts.runId);

  if (opts.json) {
    emitJson(result);
    return;
  }

  renderBenchmarkRunStatus(result);
}

function renderBenchmarkRunStatus(status: BenchmarkRunStatusResult): void {
  process.stdout.write(`${bold(status.run_id)}  ${status.status}\n`);
  process.stdout.write(
    `  benchmark ${status.benchmark_id}  reps ${status.repetitions}  cases ${status.total_cases}\n`,
  );
  process.stdout.write(
    `  sessions  ${status.completed_sessions}/${status.total_sessions} complete  (${status.failed_sessions} failed)\n`,
  );
  if (status.current_session_id) {
    process.stdout.write(`  current   ${status.current_session_id}\n`);
  }
  if (status.error) {
    process.stdout.write(`  error     ${status.error}\n`);
  }

  process.stdout.write(`\n${bold("Per-case")} (${status.per_case.length})\n`);
  if (status.per_case.length === 0) {
    process.stdout.write("  (none)\n");
  } else {
    for (const c of status.per_case) {
      const label = c.name ?? c.source_case_id;
      process.stdout.write(
        `  ${truncate(label, 40).padEnd(40)}  ${c.completed}/${c.total}\n`,
      );
    }
  }
}

export function parseBenchmarkRunStatusArgs(
  args: string[],
): ParseResult<BenchmarkRunStatusOptions> {
  let url: string | undefined;
  let json = false;
  let runId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--url") {
      url = args[++i];
      if (!url) return { error: "--url requires a value" };
    } else if (arg === "--json") {
      json = true;
    } else if (!arg.startsWith("-")) {
      if (runId !== undefined) {
        return { error: "Too many arguments" };
      }
      runId = arg;
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  if (!runId) return { error: "Missing required argument: <run_id>" };

  return { opts: { url: url ?? "", json, runId } };
}

// ─── benchmark_evaluate ───────────────────────────────────────────────────────

export interface BenchmarkEvaluateOptions {
  url: string;
  json: boolean;
  runId: string;
  judgeModelConfigId: string;
}

export async function runBenchmarkEvaluate(
  opts: BenchmarkEvaluateOptions,
): Promise<void> {
  const result = await cliBenchmarkEvaluate(opts.url, {
    run_id: opts.runId,
    judge_model_config_id: opts.judgeModelConfigId,
  });

  if (opts.json) {
    emitJson(result);
    return;
  }

  renderBenchmarkEvaluate(result);
}

function renderBenchmarkEvaluate(result: BenchmarkEvaluateResult): void {
  const { evaluation: e } = result;
  process.stdout.write(`${bold(e.id)}  ${e.status}\n`);
  process.stdout.write(`  run    ${e.run_id}\n`);
  process.stdout.write(`  judge  ${e.judge_model_config_id}\n`);
  process.stdout.write(
    `\nRun 'mcpscope benchmark_run_evaluations ${e.run_id}' for scores.\n`,
  );
}

export function parseBenchmarkEvaluateArgs(
  args: string[],
): ParseResult<BenchmarkEvaluateOptions> {
  let url: string | undefined;
  let json = false;
  let runId: string | undefined;
  let judgeModelConfigId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--url") {
      url = args[++i];
      if (!url) return { error: "--url requires a value" };
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--judge-model") {
      const val = args[++i];
      if (!val) return { error: "--judge-model requires a value" };
      judgeModelConfigId = val;
    } else if (!arg.startsWith("-")) {
      if (runId !== undefined) {
        return { error: "Too many arguments" };
      }
      runId = arg;
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  if (!runId) return { error: "Missing required argument: <run_id>" };
  if (!judgeModelConfigId) {
    return { error: "Missing required option: --judge-model <model_config_id>" };
  }

  return { opts: { url: url ?? "", json, runId, judgeModelConfigId } };
}

// ─── benchmark_run_evaluations ────────────────────────────────────────────────

export interface BenchmarkRunEvaluationsOptions {
  url: string;
  json: boolean;
  runId: string;
}

export async function runBenchmarkRunEvaluations(
  opts: BenchmarkRunEvaluationsOptions,
): Promise<void> {
  const result = await cliBenchmarkRunEvaluations(opts.url, opts.runId);

  if (opts.json) {
    emitJson(result);
    return;
  }

  renderBenchmarkRunEvaluations(result);
}

function formatPct(pct: number | null): string {
  return pct === null ? "n/a" : `${(pct * 100).toFixed(0)}%`;
}

function renderBenchmarkRunEvaluations(
  result: BenchmarkRunEvaluationsResult,
): void {
  const { evaluations } = result;
  if (evaluations.length === 0) {
    process.stdout.write("No evaluations for this run yet.\n");
    return;
  }

  for (const e of evaluations) {
    process.stdout.write(
      `${bold(e.id)}  ${e.status}  judge ${e.judge_model_config_id}  overall ${formatPct(e.score.overall_pct)}\n`,
    );
    if (e.error) {
      process.stdout.write(`  error  ${e.error}\n`);
    }
    for (const c of e.score.cases) {
      const label = c.name ?? c.source_case_id;
      const stats =
        c.pct_stats === null
          ? "n/a"
          : `min ${formatPct(c.pct_stats.min)}  mean ${formatPct(c.pct_stats.mean)}  max ${formatPct(c.pct_stats.max)}`;
      process.stdout.write(`  ${truncate(label, 40).padEnd(40)}  ${stats}\n`);
    }
    process.stdout.write("\n");
  }
}

export function parseBenchmarkRunEvaluationsArgs(
  args: string[],
): ParseResult<BenchmarkRunEvaluationsOptions> {
  let url: string | undefined;
  let json = false;
  let runId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--url") {
      url = args[++i];
      if (!url) return { error: "--url requires a value" };
    } else if (arg === "--json") {
      json = true;
    } else if (!arg.startsWith("-")) {
      if (runId !== undefined) {
        return { error: "Too many arguments" };
      }
      runId = arg;
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  if (!runId) return { error: "Missing required argument: <run_id>" };

  return { opts: { url: url ?? "", json, runId } };
}

// ─── benchmark_run_report ────────────────────────────────────────────────────

export interface BenchmarkRunReportOptions {
  url: string;
  json: boolean;
  runId: string;
}

export async function runBenchmarkRunReport(
  opts: BenchmarkRunReportOptions,
): Promise<void> {
  const result = await cliBenchmarkRunReport(opts.url, opts.runId);

  if (opts.json) {
    emitJson(result);
    return;
  }

  renderBenchmarkRunReport(result);
}

function renderCaseLine(c: CaseReport): void {
  process.stdout.write(`  ${bold(c.case_id)}  ${truncate(c.prompt, 56)}\n`);
  if (c.has_checks) {
    const rate =
      c.success_rate !== null ? `${(c.success_rate * 100).toFixed(0)}%` : "n/a";
    process.stdout.write(
      `      success ${rate}  pass@k ${c.pass_at_k ? "yes" : "no"}  pass^k ${c.pass_hat_k ? "yes" : "no"}  (${c.pass_count ?? 0}/${c.session_count})\n`,
    );
  } else {
    process.stdout.write("      (no checks — metrics only)\n");
  }
  process.stdout.write(
    `      completed ${c.completed_count}/${c.session_count}  tool errors ${c.tool_error_count}\n`,
  );
  process.stdout.write(`      tool calls    ${formatStats(c.tool_call_stats)}\n`);
  process.stdout.write(
    `      total tokens  ${formatStats(c.total_token_stats)}\n`,
  );
}

function renderBenchmarkRunReport(result: BenchmarkRunReportResult): void {
  const { report } = result;

  process.stdout.write(`${bold(report.run_id)}  ${report.status}\n`);
  process.stdout.write(
    `  benchmark ${report.benchmark_id}  reps ${report.repetitions}  cases ${report.case_count}  sessions ${report.session_count}\n`,
  );
  if (result.run.error) {
    process.stdout.write(`  error      ${result.run.error}\n`);
  }

  // Headline: per-tool rollup.
  const toolNames = Object.keys(report.per_tool).sort();
  process.stdout.write(`\n${bold("Per-tool rollup")}\n`);
  if (toolNames.length === 0) {
    process.stdout.write("  (no tool calls)\n");
  } else {
    const header = `  ${"TOOL".padEnd(28)}  ${"CALLS".padStart(6)}  ${"ERRORS".padStart(6)}  ${"ERR%".padStart(6)}  ${"CASES".padStart(5)}`;
    process.stdout.write(header + "\n");
    process.stdout.write("  " + "-".repeat(header.length - 2) + "\n");
    for (const name of toolNames) {
      const t = report.per_tool[name]!;
      const errPct = `${(t.error_rate * 100).toFixed(0)}%`;
      process.stdout.write(
        `  ${truncate(name, 28).padEnd(28)}  ${String(t.calls).padStart(6)}  ${String(t.errors).padStart(6)}  ${errPct.padStart(6)}  ${String(t.cases_used_in).padStart(5)}\n`,
      );
    }
  }

  // Per-case detail.
  process.stdout.write(`\n${bold("Cases")} (${report.cases.length})\n`);
  if (report.cases.length === 0) {
    process.stdout.write("  (none)\n");
  } else {
    for (const c of report.cases) renderCaseLine(c);
  }
}

export function parseBenchmarkRunReportArgs(
  args: string[],
): ParseResult<BenchmarkRunReportOptions> {
  let url: string | undefined;
  let json = false;
  let runId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--url") {
      url = args[++i];
      if (!url) return { error: "--url requires a value" };
    } else if (arg === "--json") {
      json = true;
    } else if (!arg.startsWith("-")) {
      if (runId !== undefined) {
        return { error: "Too many arguments" };
      }
      runId = arg;
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  if (!runId) return { error: "Missing required argument: <run_id>" };

  return { opts: { url: url ?? "", json, runId } };
}
