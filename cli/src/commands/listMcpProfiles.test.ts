import { afterEach, describe, expect, it, vi } from "vitest";
import { renderListMcpProfilesText } from "./listMcpProfiles.js";
import type { ListMcpProfilesResult } from "../types.js";

function capture(result: ListMcpProfilesResult): string {
  let out = "";
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      out += String(chunk);
      return true;
    });
  try {
    renderListMcpProfilesText(result);
  } finally {
    spy.mockRestore();
  }
  return out;
}

afterEach(() => vi.restoreAllMocks());

describe("renderListMcpProfilesText", () => {
  it("tags built-in and default profiles and shows the unavailable reason", () => {
    const out = capture({
      mcp_profiles: [
        {
          id: "home-assistant",
          name: "Home Assistant",
          url: "http://host:8123/mcp",
          default_enabled: true,
          source: "user",
          disabled_reason: null,
        },
        {
          id: "builtin-open-meteo",
          name: "Open-Meteo Weather (built-in)",
          url: "http://localhost:3030/companions/open-meteo/mcp",
          default_enabled: false,
          source: "builtin",
          disabled_reason: null,
        },
        {
          id: "builtin-guardian",
          name: "The Guardian News (built-in)",
          url: "http://localhost:3030/companions/guardian/mcp",
          default_enabled: false,
          source: "builtin",
          disabled_reason:
            "Set companions.guardian.api_key in the mcpscope config file to enable this server.",
        },
      ],
    });
    const lines = out.trimEnd().split("\n");

    // A user profile that is a default: [default], no [built-in], no unavailable line.
    expect(lines[0]).toContain("home-assistant");
    expect(lines[0]).toContain("[default]");
    expect(lines[0]).not.toContain("[built-in]");

    // A keyless built-in: [built-in], no unavailable line.
    expect(lines[1]).toContain("[built-in]");
    expect(lines[1]).not.toContain("[default]");

    // A key-gated built-in with no key: [built-in] + an indented unavailable reason line.
    expect(lines[2]).toContain("builtin-guardian");
    expect(lines[2]).toContain("[built-in]");
    expect(lines[3]).toBe(
      "    unavailable: Set companions.guardian.api_key in the mcpscope config file to enable this server.",
    );
  });

  it("prints a friendly message when there are no profiles", () => {
    const out = capture({ mcp_profiles: [] });
    expect(out).toContain("No MCP server profiles configured.");
  });
});
