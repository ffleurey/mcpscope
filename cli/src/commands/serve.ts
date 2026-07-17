import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { getPackageVersion } from "../version.js";

// `serve` is a local launcher, not a catalog operation: it boots the bundled
// backend in-process, points it at the bundled frontend, and opens the browser.
// This is the `npm i -g mcpscope && mcpscope serve` path.

export interface ServeOptions {
  port: number;
  host: string;
  open: boolean;
  dataDir?: string;
}

// Minimal shapes for the dynamically-imported backend (kept out of the CLI's
// TypeScript project, so the CLI build stays decoupled from the backend build).
interface BackendConfigShape {
  host: string;
  port: number;
}
interface FastifyLike {
  listen: (opts: { host: string; port: number }) => Promise<unknown>;
  close: () => Promise<void>;
}

export function parseServeArgs(
  args: string[],
): { opts: ServeOptions } | { help: true } | { error: string } {
  const opts: ServeOptions = { port: 3066, host: "127.0.0.1", open: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") return { help: true };
    if (a === "--no-open") opts.open = false;
    else if (a === "--port") {
      const v = Number(args[++i]);
      if (!Number.isInteger(v) || v <= 0) return { error: `Invalid --port: ${args[i] ?? ""}` };
      opts.port = v;
    } else if (a === "--host") {
      const v = args[++i];
      if (!v) return { error: "--host requires a value" };
      opts.host = v;
    } else if (a === "--data-dir") {
      const v = args[++i];
      if (!v) return { error: "--data-dir requires a value" };
      opts.dataDir = v;
    } else {
      return { error: `Unknown option: ${a ?? ""}` };
    }
  }
  return { opts };
}

// cli/{src,dist}/commands/serve → package root is three levels up in both layouts.
function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Best-effort; serving still works if the browser can't be opened.
  }
}

export async function runServe(opts: ServeOptions): Promise<void> {
  const root = packageRoot();
  const appPath = path.join(root, "backend/dist/app.js");
  const configPath = path.join(root, "backend/dist/config.js");
  const staticDir = path.join(root, "frontend/dist");

  if (!fs.existsSync(appPath) || !fs.existsSync(path.join(staticDir, "index.html"))) {
    process.stderr.write(
      "mcpscope: build artifacts not found.\n" +
        `  expected: ${appPath}\n` +
        `            ${path.join(staticDir, "index.html")}\n` +
        "If running from a source checkout, build first:\n" +
        "  npm run build && npm run build:backend\n" +
        "(for development use `npm run dev` instead).\n",
    );
    process.exit(1);
  }

  const dataDir =
    opts.dataDir ?? process.env.BACKEND_DATA_DIR ?? path.join(os.homedir(), ".mcpscope");
  fs.mkdirSync(dataDir, { recursive: true });

  // The backend reads all of this from the environment via getBackendConfig().
  if (!process.env.APP_VERSION) {
    process.env.APP_VERSION = getPackageVersion();
  }
  process.env.BACKEND_HOST = opts.host;
  process.env.BACKEND_PORT = String(opts.port);
  process.env.BACKEND_STATIC_DIR = staticDir;
  process.env.BACKEND_DATA_DIR = dataDir;
  if (!process.env.BACKEND_SQLITE_PATH) {
    process.env.BACKEND_SQLITE_PATH = path.join(dataDir, "mcpscope.db");
  }

  const { getBackendConfig } = (await import(pathToFileURL(configPath).href)) as {
    getBackendConfig: () => BackendConfigShape;
  };
  const { buildBackendApp } = (await import(pathToFileURL(appPath).href)) as {
    // Minimal structural view of the backend's BackendHandle — only the fields
    // used here, to avoid importing backend types.
    buildBackendApp: (config: BackendConfigShape) => Promise<{ app: FastifyLike }>;
  };

  const config = getBackendConfig();
  const { app } = await buildBackendApp(config);
  await app.listen({ host: config.host, port: config.port });

  const displayHost =
    opts.host === "0.0.0.0" || opts.host === "127.0.0.1" ? "localhost" : opts.host;
  const url = `http://${displayHost}:${opts.port}`;
  process.stdout.write(
    `\nmcpscope is running at ${url}\n  data: ${dataDir}\n  press Ctrl-C to stop\n\n`,
  );
  if (opts.open) openBrowser(url);

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write("\nshutting down…\n");
    void app
      .close()
      .catch(() => {})
      .finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
