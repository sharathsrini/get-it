"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wizard", {
  status: () => ipcRenderer.invoke("wizard:status"),
  install: () => ipcRenderer.invoke("wizard:install"),
  login: () => ipcRenderer.invoke("wizard:login"),
  setProvider: (provider) => ipcRenderer.invoke("wizard:set-provider", provider),
  openUrl: (url) => ipcRenderer.invoke("wizard:open-url", url),
  finish: () => ipcRenderer.invoke("wizard:finish"),
  cancel: () => ipcRenderer.invoke("wizard:cancel"),
  onStatus: (cb) => {
    const wrapped = (_e, s) => cb(s);
    ipcRenderer.on("wizard-status", wrapped);
    return () => ipcRenderer.removeListener("wizard-status", wrapped);
  },
});
