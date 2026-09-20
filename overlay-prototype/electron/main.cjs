const { app, BrowserWindow, ipcMain, screen, session } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { CollectorManager } = require("./collector/collectorManager.cjs");

let mainWindow;
let backendProcess;
let collector;
let shutdownStarted = false;
const voiceRequests = new Map();
const projectRoot = path.join(__dirname, "..");
const backendUrl = "http://127.0.0.1:8765";

const ELEVENLABS = {
  apiKey: process.env.ELEVENLABS_API_KEY || "",
  voiceId: process.env.ELEVENLABS_VOICE_ID || "",
  apiBase: process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io",
  transcriptionModel: process.env.ELEVENLABS_TRANSCRIPTION_MODEL || "scribe_v2_realtime",
  speechModel: process.env.ELEVENLABS_SPEECH_MODEL || "eleven_flash_v2_5",
  briefingModel: process.env.ELEVENLABS_BRIEFING_MODEL || "eleven_multilingual_v2",
};

const ELEVENLABS_HOSTS = new Set([
  "api.elevenlabs.io",
  "api.us.elevenlabs.io",
  "api.eu.residency.elevenlabs.io",
  "api.in.residency.elevenlabs.io",
  "api.sg.residency.elevenlabs.io",
]);

function elevenLabsBase() {
  const candidate = new URL(ELEVENLABS.apiBase);
  if (candidate.protocol !== "https:" || !ELEVENLABS_HOSTS.has(candidate.hostname)) {
    throw new Error("ELEVENLABS_API_BASE must be an official ElevenLabs HTTPS endpoint");
  }
  return `${candidate.origin}`;
}

function voiceConfigured() {
  return Boolean(ELEVENLABS.apiKey && ELEVENLABS.voiceId);
}

function isMainFrame(event) {
  return Boolean(mainWindow && event.senderFrame === mainWindow.webContents.mainFrame);
}

function voiceError(code, message) {
  return { ok: false, error: code, message };
}

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
  voice: { width: 588, height: 842 },
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

function configureMediaPermissions() {
  const ownsFrame = (webContents) => Boolean(mainWindow && webContents?.id === mainWindow.webContents.id);
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => (
    permission === "media" && ownsFrame(webContents)
  ));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = details?.mediaTypes || [];
    const audioOnly = mediaTypes.length === 0 || (mediaTypes.includes("audio") && !mediaTypes.includes("video"));
    callback(permission === "media" && ownsFrame(webContents) && audioOnly);
  });
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
        BEHAVIOR_MODEL_PATH: process.env.BEHAVIOR_MODEL_PATH || path.join(projectRoot, "config", "behavior_model_v0.json"),
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

ipcMain.handle("voice:get-status", (event) => {
  if (!isMainFrame(event)) return voiceError("forbidden", "Voice status is available only to 2Bme.");
  return {
    ok: true,
    configured: voiceConfigured(),
    voiceId: ELEVENLABS.voiceId ? `${ELEVENLABS.voiceId.slice(0, 4)}…${ELEVENLABS.voiceId.slice(-4)}` : null,
    transcriptionModel: ELEVENLABS.transcriptionModel,
    speechModel: ELEVENLABS.speechModel,
    briefingModel: ELEVENLABS.briefingModel,
    retentionRequested: "zero",
  };
});

ipcMain.handle("voice:create-transcription-session", async (event) => {
  if (!isMainFrame(event)) return voiceError("forbidden", "Voice sessions are available only to 2Bme.");
  if (!ELEVENLABS.apiKey) {
    return voiceError("voice_not_configured", "Add ELEVENLABS_API_KEY to enable voice input.");
  }
  try {
    const apiBase = elevenLabsBase();
    const response = await fetch(`${apiBase}/v1/single-use-token/realtime_scribe`, {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS.apiKey },
    });
    if (!response.ok) {
      return voiceError(response.status === 401 ? "voice_auth_failed" : "voice_provider_error", `ElevenLabs token request failed (${response.status}).`);
    }
    const body = await response.json();
    if (!body.token) return voiceError("voice_provider_error", "ElevenLabs returned no transcription token.");
    return {
      ok: true,
      token: body.token,
      websocketBase: apiBase.replace(/^https:/, "wss:"),
      model: ELEVENLABS.transcriptionModel,
      expiresInSeconds: 900,
      zeroRetentionRequested: true,
    };
  } catch (error) {
    return voiceError("voice_unavailable", error.message || "Voice transcription is unavailable.");
  }
});

ipcMain.handle("voice:synthesize", async (event, payload) => {
  if (!isMainFrame(event)) return voiceError("forbidden", "Speech is available only to 2Bme.");
  if (!voiceConfigured()) {
    return voiceError("voice_not_configured", "Add ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID to enable speech.");
  }
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
  if (!text || text.length > 4000 || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) {
    return voiceError("invalid_voice_request", "Speech text or request identifier is invalid.");
  }

  const controller = new AbortController();
  voiceRequests.set(requestId, controller);
  try {
    const model = payload.kind === "briefing" ? ELEVENLABS.briefingModel : ELEVENLABS.speechModel;
    const response = await fetch(
      `${elevenLabsBase()}/v1/text-to-speech/${encodeURIComponent(ELEVENLABS.voiceId)}/stream?output_format=mp3_44100_128&enable_logging=false`,
      {
        method: "POST",
        headers: {
          "accept": "audio/mpeg",
          "content-type": "application/json",
          "xi-api-key": ELEVENLABS.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: model,
          voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.18, use_speaker_boost: true },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok || !response.body) {
      const error = response.status === 401 ? "voice_auth_failed" : response.status === 429 ? "voice_quota_exceeded" : "voice_provider_error";
      event.sender.send("voice:audio-chunk", { requestId, error, done: true });
      return voiceError(error, `ElevenLabs speech request failed (${response.status}).`);
    }

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) {
        event.sender.send("voice:audio-chunk", {
          requestId,
          chunk: new Uint8Array(value),
          contentType: response.headers.get("content-type") || "audio/mpeg",
          done: false,
        });
      }
    }
    event.sender.send("voice:audio-chunk", { requestId, done: true });
    return { ok: true, requestId, model };
  } catch (error) {
    const code = error.name === "AbortError" ? "cancelled" : "voice_unavailable";
    event.sender.send("voice:audio-chunk", { requestId, error: code, done: true });
    return voiceError(code, code === "cancelled" ? "Speech was cancelled." : "Speech generation is unavailable.");
  } finally {
    voiceRequests.delete(requestId);
  }
});

ipcMain.handle("voice:cancel", (event, requestId) => {
  if (!isMainFrame(event)) return false;
  const controller = voiceRequests.get(requestId);
  controller?.abort();
  voiceRequests.delete(requestId);
  return Boolean(controller);
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
  configureMediaPermissions();
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
