const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  setMode: (mode) => ipcRenderer.invoke("window:set-mode", mode),
  hide: () => ipcRenderer.invoke("window:hide"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
});
