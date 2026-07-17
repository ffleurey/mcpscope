import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Packaging contract: electron (`electron/src/main.ts`) and the CLI
 * (`cli/src/commands/serve.ts`) launch the backend by DYNAMICALLY IMPORTING
 * `backend/dist/<name>.js` via a constructed file-path string. Because those
 * paths are strings, neither `tsc` nor import rewrites catch it when a module
 * moves out of `backend/` — which is exactly how the workspaces split shipped a
 * broken Electron build (config.ts had moved into the engine, so
 * `backend/dist/config.js` no longer existed).
 *
 * This test fails fast if any `backend/dist/*.js` those launchers import no
 * longer has a corresponding `backend/src/*.ts` source — i.e. it must stay in
 * the workbench, not move into `mcpscope-engine`.
 */
const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const backendSrc = path.join(repoRoot, "backend/src");

const LAUNCHERS = [
  "electron/src/main.ts",
  "cli/src/commands/serve.ts",
];

function backendDistImports(launcherRel: string): string[] {
  const text = readFileSync(path.join(repoRoot, launcherRel), "utf8");
  // Match the `backend/dist/<name>.js` segment wherever it appears (in a
  // path.join(...) or a string literal).
  const re = /backend\/dist\/([A-Za-z0-9/_-]+)\.js/g;
  return [...text.matchAll(re)].map((m) => m[1]!);
}

describe("packaging contract: launcher → backend/dist entry points", () => {
  for (const launcher of LAUNCHERS) {
    it(`${launcher} imports only backend/dist entry points that have a backend source`, () => {
      const names = backendDistImports(launcher);
      // Sanity: each launcher should reference at least the app + config entry points.
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        const source = path.join(backendSrc, `${name}.ts`);
        expect(
          existsSync(source),
          `${launcher} imports backend/dist/${name}.js, but ${path.relative(repoRoot, source)} does not exist — ` +
            `it must live in the workbench (backend/src), not move into mcpscope-engine.`,
        ).toBe(true);
      }
    });
  }
});
