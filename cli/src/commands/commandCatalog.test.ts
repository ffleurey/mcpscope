import { describe, expect, it, vi } from "vitest";
import { operationList } from "../../../backend/src/operations/index.ts";

const expectedCommandIds = [
  "list",
  "create",
  "send",
  "status",
  "inspect",
  "list_model_configs",
  "list_mcp_profiles",
  "benchmark_create",
  "benchmark_list",
  "benchmark_inspect",
  "benchmark_add_case",
  "benchmark_add_case_from_session",
  "benchmark_update_case",
  "benchmark_delete_case",
  "benchmark_run",
  "benchmark_run_status",
  "benchmark_run_report",
  "benchmark_run_control",
  "benchmark_evaluate",
  "benchmark_run_evaluations",
  "benchmark_evaluation_control",
] as const;

describe("CLI command catalog matches backend operations", () => {
  it("CLI command IDs match backend operation catalog exactly", () => {
    const backendIds = operationList.map((op) => op.id).sort();
    expect(backendIds).toEqual([...expectedCommandIds].sort());
  });

  it("CLI help text references all expected command names", async () => {
    let stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation(
      (chunk: string | Uint8Array) => {
        stdout += String(chunk);
        return true;
      },
    );

    const { main } = await import("../index.ts");
    await main(["node", "mcpscope", "--help"]);

    for (const cmd of expectedCommandIds) {
      expect(stdout).toContain(`mcpscope ${cmd}`);
    }

    vi.restoreAllMocks();
  });
});
