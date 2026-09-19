const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("node:path");

let mainWindow;

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
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
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

  mainWindow.setAlwaysOnTop(true, "floating");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  positionAtTop(mainWindow, WINDOW_SIZES.expanded);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(`${devUrl}/?native=1`);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "client", "index.html"), {
      query: { native: "1" },
    });
  }

  mainWindow.once("ready-to-show", () => mainWindow.showInactive());
  mainWindow.on("closed", () => { mainWindow = undefined; });
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

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
