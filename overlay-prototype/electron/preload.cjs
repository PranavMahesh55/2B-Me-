const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  setMode: (mode) => ipcRenderer.invoke("window:set-mode", mode),
  hide: () => ipcRenderer.invoke("window:hide"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  getSession: () => ipcRenderer.invoke("collector:get-session"),
  backendUrl: "http://127.0.0.1:8765",
  // Raises the Touch ID prompt via the main process; the renderer never reaches
  // the signer directly. Resolves { ok: true, token } or { ok: false, error }.
  requestGrant: (payload) => ipcRenderer.invoke("intent:grant", payload),
  signerAvailable: true,
  voice: {
    getStatus: () => ipcRenderer.invoke("voice:get-status"),
    createTranscriptionSession: () => ipcRenderer.invoke("voice:create-transcription-session"),
    synthesize: (payload) => ipcRenderer.invoke("voice:synthesize", payload),
    cancel: (requestId) => ipcRenderer.invoke("voice:cancel", requestId),
    onAudioChunk: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("voice:audio-chunk", listener);
      return () => ipcRenderer.removeListener("voice:audio-chunk", listener);
    },
  },
  onWindowFocus: (callback) => {
    const listener = (_event, focused) => callback(focused);
    ipcRenderer.on("desktop:window-focus", listener);
    return () => ipcRenderer.removeListener("desktop:window-focus", listener);
  },
});
