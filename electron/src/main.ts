// Electron main process for the mcpscope desktop app.
//
// Strategy: boot the existing Fastify backend *in-process* (the same code path
// as `mcpscope serve`, see cli/src/commands/serve.ts), then point a BrowserWindow
// at it. The backend serves the pre-built Svelte frontend as static files, so the
// window is just a Chromium view onto http://127.0.0.1:<port>. SQLite is Node's
// built-in node:sqlite, which is compiled into Electron's bundled Node — no native
// rebuild / electron-rebuild needed.
import { app, BrowserWindow, dialog, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Minimal shapes for the dynamically-imported backend, kept decoupled from the
// backend's own TS project (same approach as serve.ts).
interface BackendConfigShape {
  host: string;
  port: number;
}
interface FastifyLike {
  listen: (opts: { host: string; port: number }) => Promise<unknown>;
  close: () => Promise<void>;
}

const dirname = path.dirname(fileURLToPath(import.meta.url));
// electron/dist/main.js → the app root (which contains backend/ and frontend/)
// is two levels up, in both the source-checkout and packaged layouts.
const appRoot = path.resolve(dirname, "../..");

let server: FastifyLike | null = null;
let mainWindow: BrowserWindow | null = null;
let appUrl: string | null = null;

async function startBackend(): Promise<string> {
  const staticDir = path.join(appRoot, "frontend/dist");
  // Same data directory as `mcpscope serve` (see cli/src/commands/serve.ts) —
  // README/TUTORIAL promise `~/.mcpscope` and that the desktop app and the npm
  // CLI share one store (one at a time). Deliberately NOT Electron's userData.
  const dataDir =
    process.env.BACKEND_DATA_DIR ?? path.join(os.homedir(), ".mcpscope");
  fs.mkdirSync(dataDir, { recursive: true });

  // Host and port are NOT set here: getBackendConfig() resolves BACKEND_HOST /
  // BACKEND_PORT from the environment, defaulting to 127.0.0.1:3066 — the same
  // fixed address as `mcpscope serve` and Docker, so MCP clients and agents can
  // rely on a stable URL across restarts and deployment modes.
  process.env.BACKEND_STATIC_DIR = staticDir;
  process.env.BACKEND_DATA_DIR = dataDir;
  if (!process.env.BACKEND_SQLITE_PATH) {
    process.env.BACKEND_SQLITE_PATH = path.join(dataDir, "mcpscope.db");
  }
  // Surface the real app version to the backend (config.ts reads APP_VERSION,
  // defaulting to "dev" otherwise).
  if (!process.env.APP_VERSION) {
    process.env.APP_VERSION = app.getVersion();
  }

  const configUrl = pathToFileURL(
    path.join(appRoot, "backend/dist/config.js"),
  ).href;
  const backendUrl = pathToFileURL(
    path.join(appRoot, "backend/dist/app.js"),
  ).href;

  const { getBackendConfig } = (await import(configUrl)) as {
    getBackendConfig: () => BackendConfigShape;
  };
  const { buildBackendApp } = (await import(backendUrl)) as {
    buildBackendApp: (config: BackendConfigShape) => Promise<FastifyLike>;
  };

  const config = getBackendConfig();
  server = await buildBackendApp(config);
  try {
    await server.listen({ host: config.host, port: config.port });
  } catch (error) {
    if ((error as { code?: string }).code === "EADDRINUSE") {
      // A fixed port can collide — most likely with `mcpscope serve` or another
      // mcpscope on the same shared ~/.mcpscope store. Fail with guidance
      // rather than silently moving to a random port (a moving MCP endpoint is
      // exactly what the fixed default exists to prevent).
      throw new Error(
        `Port ${config.port} on ${config.host} is already in use.\n\n` +
          "Another mcpscope is probably running (desktop app or `mcpscope serve`) — " +
          "they share one data store, so use that one instead.\n\n" +
          "To run this app on a different address, set the BACKEND_PORT (and/or BACKEND_HOST) environment variables.",
        { cause: error },
      );
    }
    throw error;
  }

  // The window needs a connectable address: a wildcard bind address is not one.
  const windowHost =
    config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
  return `http://${windowHost}:${config.port}`;
}

function createWindow(url: string): void {
  // X11 reads the window icon from here. (Wayland ignores it and matches the
  // window's app_id to an installed .desktop file instead — so on Wayland the
  // icon comes from the deb/rpm/AppImage desktop integration, not from this.)
  const iconPath = path.join(appRoot, "build/icon.png");

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "mcpscope",
    backgroundColor: "#1e1e1e",
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open external links (target=_blank, http(s) to other origins) in the user's
  // real browser rather than inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: "deny" };
  });

  void mainWindow.loadURL(url);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await server?.close();
  } catch {
    // best-effort; we're exiting anyway
  }
  app.quit();
}

// Set the Linux app_id (Wayland) / WM_CLASS (X11) before "ready" so the desktop
// environment links the window to our installed .desktop file and shows our icon.
// (Also declared as desktopName in package.json; setting it here guards against
// Electron's app_id="electron" fallback on Wayland.)
if (process.platform === "linux") {
  app.setDesktopName("mcpscope.desktop");
}

// Single-instance: a second launch would start a second backend (port/DB churn).
// Focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(
    async () => {
      try {
        appUrl = await startBackend();
        createWindow(appUrl);
      } catch (error) {
        console.error("mcpscope: failed to start backend", error);
        // A double-clicked app must not just flash and exit — show the reason.
        dialog.showErrorBox(
          "mcpscope failed to start",
          error instanceof Error ? error.message : String(error),
        );
        app.quit();
      }

      // macOS: re-create the window when the dock icon is clicked and none are open.
      app.on("activate", () => {
        if (appUrl && BrowserWindow.getAllWindows().length === 0) {
          createWindow(appUrl);
        }
      });
    },
    (error) => {
      console.error("mcpscope: failed to initialize", error);
      app.quit();
    },
  );

  app.on("window-all-closed", () => {
    void shutdown();
  });
}
