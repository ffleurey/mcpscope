import {
  cliBenchmarkCreate,
  cliBenchmarkList,
  cliBenchmarkShow,
  cliBenchmarkAddCase,
  cliBenchmarkAddCaseFromSession,
  cliBenchmarkRun,
  cliBenchmarkReport,
} from "../httpClient.js";
import { bold } from "../colors.js";
import type {
  BenchmarkCreateResult,
  BenchmarkListResult,
  BenchmarkDetailResult,
  BenchmarkAddCaseResult,
  BenchmarkRunReportResult,
  NumberStats,
  CaseReport,
} from "../types.js";

// ─── Shared helpers ──────────────────────────────────────────────────────────

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

type ParseResult<T> = { opts: T } | { help: true } | { error: string };

// ─── create ──────────────────────────────────────────────────────────────────

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
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
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
    `\nRun 'mcpscope benchmark add-case ${benchmark.id} <prompt>' to add cases.\n`,
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

// ─── list ──────────────────────────────────────────────────────────────────

export interface BenchmarkListOptions {
  url: string;
  json: boolean;
}

export async function runBenchmarkList(
  opts: BenchmarkListOptions,
): Promise<void> {
  const result = await cliBenchmarkList(opts.url);

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
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
      `${truncate(b.id, 16).padEnd(16)}  ${truncate(b.name, 36).padEnd(36)}  ${String(b.caseCount).padStart(5)}  ${String(b.runCount).padStart(5)}\n`,
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

// ─── show ──────────────────────────────────────────────────────────────────

export interface BenchmarkShowOptions {
  url: string;
  json: boolean;
  benchmarkId: string;
}

export async function runBenchmarkShow(
  opts: BenchmarkShowOptions,
): Promise<void> {
  const result = await cliBenchmarkShow(opts.url, opts.benchmarkId);

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  renderBenchmarkShow(result);
}

function renderBenchmarkShow(result: BenchmarkDetailResult): void {
  const { benchmark, cases, runs } = result;
  process.stdout.write(`${bold(benchmark.id)}  ${benchmark.name}\n`);
  if (benchmark.description) {
    process.stdout.write(`  description  ${benchmark.description}\n`);
  }
  process.stdout.write(`  created      ${formatDate(benchmark.createdAt)}\n`);
  process.stdout.write(`  updated      ${formatDate(benchmark.updatedAt)}\n`);

  process.stdout.write(`\n${bold("Cases")} (${cases.length})\n`);
  if (cases.length === 0) {
    process.stdout.write("  (none)\n");
  } else {
    for (const c of cases) {
      process.stdout.write(
        `  ${c.id}  #${c.orderIndex + 1}  ${truncate(c.prompt, 60)}\n`,
      );
      if (c.expectedToolsCalled.length > 0) {
        process.stdout.write(
          `      expect-tool   ${c.expectedToolsCalled.join(", ")}\n`,
        );
      }
      if (c.expectedToolsNotCalled.length > 0) {
        process.stdout.write(
          `      forbid-tool   ${c.expectedToolsNotCalled.join(", ")}\n`,
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
        `  ${r.id}  ${r.status.padEnd(9)}  reps ${r.repetitions}  cases ${r.cases.length}  ${formatDate(r.createdAt)}\n`,
      );
    }
  }
}

export function parseBenchmarkShowArgs(
  args: string[],
): ParseResult<BenchmarkShowOptions> {
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
    return { error: "Missing required argument: <benchmarkId>" };
  }

  return { opts: { url: url ?? "", json, benchmarkId } };
}

// ─── add-case ──────────────────────────────────────────────────────────────

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
  const result = await cliBenchmarkAddCase(opts.url, opts.benchmarkId, {
    prompt: opts.prompt,
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    ...(opts.expectedToolsCalled !== undefined
      ? { expectedToolsCalled: opts.expectedToolsCalled }
      : {}),
    ...(opts.expectedToolsNotCalled !== undefined
      ? { expectedToolsNotCalled: opts.expectedToolsNotCalled }
      : {}),
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  renderBenchmarkAddCase(result);
}

function renderBenchmarkAddCase(result: BenchmarkAddCaseResult): void {
  const { case: c } = result;
  process.stdout.write(`${c.id}  #${c.orderIndex + 1}  ${truncate(c.prompt, 60)}\n`);
  if (c.name) {
    process.stdout.write(`  name          ${c.name}\n`);
  }
  if (c.sourceSessionId) {
    process.stdout.write(`  from-session  ${c.sourceSessionId}\n`);
  }
  if (c.expectedToolsCalled.length > 0) {
    process.stdout.write(
      `  expect-tool   ${c.expectedToolsCalled.join(", ")}\n`,
    );
  }
  if (c.expectedToolsNotCalled.length > 0) {
    process.stdout.write(
      `  forbid-tool   ${c.expectedToolsNotCalled.join(", ")}\n`,
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
    return { error: "Missing required argument: <benchmarkId>" };
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

// ─── from-session ────────────────────────────────────────────────────────────

export interface BenchmarkFromSessionOptions {
  url: string;
  json: boolean;
  benchmarkId: string;
  sessionId: string;
  name?: string | undefined;
}

export async function runBenchmarkFromSession(
  opts: BenchmarkFromSessionOptions,
): Promise<void> {
  const result = await cliBenchmarkAddCaseFromSession(
    opts.url,
    opts.benchmarkId,
    {
      sessionId: opts.sessionId,
      ...(opts.name !== undefined ? { name: opts.name } : {}),
    },
  );

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  renderBenchmarkAddCase(result);
}

export function parseBenchmarkFromSessionArgs(
  args: string[],
): ParseResult<BenchmarkFromSessionOptions> {
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
    return { error: "Missing required argument: <benchmarkId>" };
  }
  if (!sessionId) {
    return { error: "Missing required argument: <sessionId>" };
  }

  const opts: BenchmarkFromSessionOptions = {
    url: url ?? "",
    json,
    benchmarkId,
    sessionId,
  };
  if (name !== undefined) opts.name = name;
  return { opts };
}

// ─── run ──────────────────────────────────────────────────────────────────

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

const POLL_INTERVAL_MS = 500;
const POLL_MAX_MS = 5 * 60 * 1000;

export async function runBenchmarkRun(opts: BenchmarkRunOptions): Promise<void> {
  const launch = await cliBenchmarkRun(opts.url, opts.benchmarkId, {
    ...(opts.caseIds !== undefined ? { caseIds: opts.caseIds } : {}),
    ...(opts.repetitions !== undefined
      ? { repetitions: opts.repetitions }
      : {}),
    ...(opts.modelConfigId !== undefined
      ? { modelConfigId: opts.modelConfigId }
      : {}),
    ...(opts.mcpProfileIds !== undefined
      ? { mcpProfileIds: opts.mcpProfileIds }
      : {}),
  });

  const runId = launch.run.id;

  if (!opts.wait) {
    if (opts.json) {
      process.stdout.write(JSON.stringify(launch, null, 2) + "\n");
      return;
    }
    process.stdout.write(`${runId}  ${launch.run.status}\n`);
    process.stdout.write(
      `\nRun 'mcpscope benchmark report ${runId}' to view results.\n`,
    );
    return;
  }

  // Poll until the run reaches a terminal state.
  const deadline = Date.now() + POLL_MAX_MS;
  let report = await cliBenchmarkReport(opts.url, runId);
  while (
    report.run.status !== "complete" &&
    report.run.status !== "error" &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    report = await cliBenchmarkReport(opts.url, runId);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }

  renderBenchmarkReport(report);
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
    return { error: "Missing required argument: <benchmarkId>" };
  }

  const opts: BenchmarkRunOptions = { url: url ?? "", json, benchmarkId, wait };
  if (repetitions !== undefined) opts.repetitions = repetitions;
  if (modelConfigId !== undefined) opts.modelConfigId = modelConfigId;
  if (mcpProfileIds !== undefined) opts.mcpProfileIds = mcpProfileIds;
  if (caseIds !== undefined) opts.caseIds = caseIds;
  return { opts };
}

// ─── report ──────────────────────────────────────────────────────────────────

export interface BenchmarkReportOptions {
  url: string;
  json: boolean;
  runId: string;
}

export async function runBenchmarkReport(
  opts: BenchmarkReportOptions,
): Promise<void> {
  const result = await cliBenchmarkReport(opts.url, opts.runId);

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  renderBenchmarkReport(result);
}

function renderCaseLine(c: CaseReport): void {
  process.stdout.write(
    `  ${bold(c.caseId)}  ${truncate(c.prompt, 56)}\n`,
  );
  if (c.hasChecks) {
    const rate =
      c.successRate !== null ? `${(c.successRate * 100).toFixed(0)}%` : "n/a";
    process.stdout.write(
      `      success ${rate}  pass@k ${c.passAtK ? "yes" : "no"}  pass^k ${c.passHatK ? "yes" : "no"}  (${c.passCount ?? 0}/${c.sessionCount})\n`,
    );
  } else {
    process.stdout.write("      (no checks — metrics only)\n");
  }
  process.stdout.write(
    `      completed ${c.completedCount}/${c.sessionCount}  tool errors ${c.toolErrorCount}\n`,
  );
  process.stdout.write(`      tool calls    ${formatStats(c.toolCallStats)}\n`);
  process.stdout.write(`      total tokens  ${formatStats(c.totalTokenStats)}\n`);
}

function renderBenchmarkReport(result: BenchmarkRunReportResult): void {
  const { report } = result;

  process.stdout.write(`${bold(report.runId)}  ${report.status}\n`);
  process.stdout.write(
    `  benchmark ${report.benchmarkId}  reps ${report.repetitions}  cases ${report.caseCount}  sessions ${report.sessionCount}\n`,
  );
  if (result.run.error) {
    process.stdout.write(`  error      ${result.run.error}\n`);
  }

  // Headline: per-tool rollup.
  const toolNames = Object.keys(report.perTool).sort();
  process.stdout.write(`\n${bold("Per-tool rollup")}\n`);
  if (toolNames.length === 0) {
    process.stdout.write("  (no tool calls)\n");
  } else {
    const header = `  ${"TOOL".padEnd(28)}  ${"CALLS".padStart(6)}  ${"ERRORS".padStart(6)}  ${"ERR%".padStart(6)}  ${"CASES".padStart(5)}`;
    process.stdout.write(header + "\n");
    process.stdout.write("  " + "-".repeat(header.length - 2) + "\n");
    for (const name of toolNames) {
      const t = report.perTool[name]!;
      const errPct = `${(t.errorRate * 100).toFixed(0)}%`;
      process.stdout.write(
        `  ${truncate(name, 28).padEnd(28)}  ${String(t.calls).padStart(6)}  ${String(t.errors).padStart(6)}  ${errPct.padStart(6)}  ${String(t.casesUsedIn).padStart(5)}\n`,
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

export function parseBenchmarkReportArgs(
  args: string[],
): ParseResult<BenchmarkReportOptions> {
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

  if (!runId) return { error: "Missing required argument: <runId>" };

  return { opts: { url: url ?? "", json, runId } };
}
