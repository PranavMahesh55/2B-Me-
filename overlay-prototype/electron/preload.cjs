const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  setMode: (mode) => ipcRenderer.invoke("window:set-mode", mode),
  hide: () => ipcRenderer.invoke("window:hide"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  backendUrl: "http://127.0.0.1:8765",
  onWindowFocus: (callback) => {
    const listener = (_event, focused) => callback(focused);
    ipcRenderer.on("desktop:window-focus", listener);
    return () => ipcRenderer.removeListener("desktop:window-focus", listener);
  },
});
