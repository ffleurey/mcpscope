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
] as const;

describe("CLI command catalog matches backend operations", () => {
  it("CLI command IDs match backend operation catalog", () => {
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
