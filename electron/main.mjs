import { app, BrowserWindow, Menu, shell } from "electron";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_PORT = "8797";
const DEV_URL = process.env.MAILBOT_DEV_URL || "http://127.0.0.1:5181";

let mainWindow = null;
let backendServer = null;

async function startPackagedBackend() {
  if (!app.isPackaged) return;

  const appPath = app.getAppPath();
  const port = process.env.PORT || await findAvailablePort(Number(DEFAULT_PORT));
  process.env.PORT = port;
  process.env.APP_ORIGIN = `http://127.0.0.1:${port}`;
  process.env.GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://127.0.0.1:${port}/api/auth/google/callback`;
  process.env.DATA_DIR = process.env.DATA_DIR || findNearbyDataDir(appPath) || app.getPath("userData");
  process.env.STATIC_DIR = process.env.STATIC_DIR || path.join(appPath, "dist");

  const serverEntry = path.join(appPath, "dist-server", "index.js");
  const serverModule = await import(pathToFileURL(serverEntry).href);
  backendServer = serverModule.startServer();
}

async function findAvailablePort(preferredPort) {
  for (let port = preferredPort; port < preferredPort + 20; port += 1) {
    if (await isPortAvailable(port)) return String(port);
  }
  return String(preferredPort);
}

function isPortAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function findNearbyDataDir(appPath) {
  let current = path.dirname(appPath);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(current, ".local");
    if (fs.existsSync(candidate)) return candidate;
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return null;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 720,
    title: "MailBot",
    backgroundColor: "#070c09",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const url = app.isPackaged ? `http://127.0.0.1:${process.env.PORT || DEFAULT_PORT}` : DEV_URL;
  await waitForHttp(url, 20000);
  await mainWindow.loadURL(url);
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "MailBot",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Widok",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    }
  ]));
}

async function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {
      // The local server may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Nie udało się uruchomić MailBot pod adresem ${url}`);
}

app.whenReady().then(async () => {
  installMenu();
  await startPackagedBackend();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  backendServer?.close?.();
});
