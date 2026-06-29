// Electron main process for the mcpscope desktop app.
//
// Strategy: boot the existing Fastify backend *in-process* (the same code path
// as `mcpscope serve`, see cli/src/commands/serve.ts), then point a BrowserWindow
// at it. The backend serves the pre-built Svelte frontend as static files, so the
// window is just a Chromium view onto http://127.0.0.1:<port>. SQLite is Node's
// built-in node:sqlite, which is compiled into Electron's bundled Node — no native
// rebuild / electron-rebuild needed.
import { app, BrowserWindow, shell } from "electron";
import net from "node:net";
import fs from "node:fs";
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

// Ask the OS for a free port up front. We can't listen on port 0 and read it
// back, because the backend uses config.port internally (the analysis MCP URL),
// so it must know the real port before it starts.
function findFreePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, host, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function startBackend(): Promise<string> {
  const staticDir = path.join(appRoot, "frontend/dist");
  const dataDir = app.getPath("userData");
  fs.mkdirSync(dataDir, { recursive: true });

  const host = "127.0.0.1";
  const port = await findFreePort(host);

  // The backend reads all of this from the environment via getBackendConfig().
  process.env.BACKEND_HOST = host;
  process.env.BACKEND_PORT = String(port);
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
  await server.listen({ host: config.host, port: config.port });

  return `http://${host}:${port}`;
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
