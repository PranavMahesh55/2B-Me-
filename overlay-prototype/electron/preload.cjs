const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  setMode: (mode) => ipcRenderer.invoke("window:set-mode", mode),
  hide: () => ipcRenderer.invoke("window:hide"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  backendUrl: "http://127.0.0.1:8765",
  // Raises the Touch ID prompt via the main process; the renderer never reaches
  // the signer directly. Resolves { ok: true, token } or { ok: false, error }.
  requestGrant: (payload) => ipcRenderer.invoke("intent:grant", payload),
  signerAvailable: true,
  onWindowFocus: (callback) => {
    const listener = (_event, focused) => callback(focused);
    ipcRenderer.on("desktop:window-focus", listener);
    return () => ipcRenderer.removeListener("desktop:window-focus", listener);
  },
});
