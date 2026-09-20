const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

let mainWindow;
let backendProcess;
const projectRoot = path.join(__dirname, "..");
const backendUrl = "http://127.0.0.1:8765";

// The renderer never talks to the signer.
//
// Packaged, the renderer is a file:// document (see loadFile below), so its
// fetches carry `Origin: null` -- which is also what any HTML file the user
// double-clicks sends, so allowlisting it would reopen exactly the hole
// techspecsigner.md §1 closes. The main process is a Node context, so it can
// send an `app://` Origin that no browser document can ever produce, plus the
// launch secret from a 0600 file no web page can read. It also keeps the grant
// token out of renderer JavaScript.
const SIGNER = {
  host: "127.0.0.1",
  port: Number(process.env.GRANT_SIGNER_PORT || 8787),
  origin: process.env.GRANT_SIGNER_ORIGIN || "app://2bme-overlay",
  secretPath: process.env.GRANT_LAUNCH_SECRET_PATH || path.join(projectRoot, ".runtime", "launch-secret"),
};

function launchSecret() {
  try {
    return fs.readFileSync(SIGNER.secretPath, "utf8").trim() || null;
  } catch {
    return null;
  }
}

function requestGrant(payload) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(payload));
    const headers = {
      "content-type": "application/json",
      "content-length": body.length,
      origin: SIGNER.origin,
    };
    const secret = launchSecret();
    if (secret) headers["x-2bme-launch-secret"] = secret;

    // node:http, not Electron's net module: net routes through Chromium's
    // stack, which would rewrite or strip the Origin header we are relying on.
    const request = http.request(
      { host: SIGNER.host, port: SIGNER.port, path: "/grant", method: "POST", headers },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return resolve({ ok: false, error: "signer_unavailable" });
          }
          if (response.statusCode === 200 && parsed.token) return resolve({ ok: true, token: parsed.token });
          resolve({ ok: false, error: parsed.error || "signer_unavailable", message: parsed.message });
        });
      },
    );
    // A backstop only: the signer times its own prompt out at 60s and answers
    // presence_cancelled. Reaching this means the signer itself is wedged, and
    // presence_failed would be a lie -- it says "Touch ID didn't recognise you"
    // when nothing was ever attempted.
    request.setTimeout(180000, () => {
      request.destroy();
      resolve({ ok: false, error: "signer_unavailable", message: "the signer did not respond" });
    });
    request.on("error", () => resolve({ ok: false, error: "signer_unavailable" }));
    request.end(body);
  });
}

const WINDOW_SIZES = {
  expanded: { width: 588, height: 682 },
  // The consent card adds ~280px; without its own size the Touch ID button is
  // clipped at the window edge.
  authorizing: { width: 588, height: 860 },
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
  mainWindow.on("focus", () => mainWindow?.webContents.send("desktop:window-focus", true));
  mainWindow.on("blur", () => mainWindow?.webContents.send("desktop:window-focus", false));
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

ipcMain.handle("intent:grant", async (event, payload) => {
  // Only the overlay's own top frame may ask for a grant.
  if (event.senderFrame !== mainWindow?.webContents.mainFrame) {
    return { ok: false, error: "signer_unavailable" };
  }
  if (!payload || typeof payload !== "object" || !payload.plan || !payload.risk) {
    return { ok: false, error: "malformed_request" };
  }
  return requestGrant({ plan: payload.plan, risk: payload.risk });
});

ipcMain.handle("window:hide", () => {
  mainWindow?.hide();
  return true;
});

ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
  return true;
});

app.whenReady().then(async () => {
  await startBackend();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on("before-quit", () => {
  if (backendProcess && !backendProcess.killed) backendProcess.kill("SIGTERM");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
