const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { CollectorManager } = require("./collector/collectorManager.cjs");

let mainWindow;
let backendProcess;
let collector;
let shutdownStarted = false;
const projectRoot = path.join(__dirname, "..");
const backendUrl = "http://127.0.0.1:8765";

const WINDOW_SIZES = {
  expanded: { width: 588, height: 682 },
  collapsed: { width: 588, height: 96 },
  dashboard: { width: 1220, height: 810 },
};

function positionAtTop(window, size) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  window.setBounds({
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: area.y + 18,
    width: size.width,
    height: size.height,
  }, true);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    ...WINDOW_SIZES.expanded,
    transparent: true,
    frame: false,
    type: process.platform === "darwin" ? "panel" : undefined,
    acceptFirstMouse: true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    minWidth: 440,
    minHeight: 88,
    maxWidth: 1320,
    maxHeight: 900,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Treat this as a system overlay rather than a normal application window.
  // The screen-saver level keeps it above ordinary and full-screen app windows.
  mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setFullScreenable(false);
  mainWindow.setSkipTaskbar(true);
  positionAtTop(mainWindow, WINDOW_SIZES.expanded);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(`${devUrl}/?native=1`);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "client", "index.html"), {
      query: { native: "1" },
    });
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
    mainWindow.showInactive();
  });
  mainWindow.on("focus", () => mainWindow?.webContents.send("desktop:window-focus", true));
  mainWindow.on("blur", () => {
    mainWindow?.setAlwaysOnTop(true, "screen-saver", 1);
    mainWindow?.webContents.send("desktop:window-focus", false);
  });
  mainWindow.on("closed", () => { mainWindow = undefined; });
}

async function backendReady() {
  try {
    const response = await fetch(`${backendUrl}/api/system/status`);
    return response.ok;
  } catch {
    return false;
  }
}

async function startBackend() {
  if (await backendReady()) return;
  const virtualPython = process.platform === "win32"
    ? path.join(projectRoot, ".venv", "Scripts", "python.exe")
    : path.join(projectRoot, ".venv", "bin", "python");
  const python = process.env.BEHAVIOR_PYTHON || (fs.existsSync(virtualPython) ? virtualPython : "python3");
  backendProcess = spawn(
    python,
    ["-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", "8765"],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        BEHAVIOR_DATA_MODE: process.env.BEHAVIOR_DATA_MODE || "synthetic",
        BEHAVIOR_MODEL_PATH: process.env.BEHAVIOR_MODEL_PATH || path.join(projectRoot, "config", "behavior_model_v0.synthetic.json"),
      },
      stdio: process.env.NODE_ENV === "development" ? "inherit" : "ignore",
    },
  );

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await backendReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("2Bme local intelligence service did not become ready");
}

ipcMain.handle("window:set-mode", (_event, mode) => {
  if (!mainWindow || !WINDOW_SIZES[mode]) return false;
  const size = WINDOW_SIZES[mode];
  positionAtTop(mainWindow, size);
  mainWindow.setResizable(mode !== "collapsed");
  return true;
});

ipcMain.handle("window:hide", () => {
  mainWindow?.hide();
  return true;
});

ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
  return true;
});

ipcMain.handle("collector:get-session", () => collector?.session || null);

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    app.setActivationPolicy("accessory");
    app.dock?.hide();
  }
  await startBackend();
  collector = new CollectorManager({ backendUrl, queueDirectory: app.getPath("userData") });
  await collector.start();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on("before-quit", (event) => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  event.preventDefault();
  Promise.resolve(collector?.stop()).finally(() => {
    if (backendProcess && !backendProcess.killed) backendProcess.kill("SIGTERM");
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
