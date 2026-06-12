"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("claudeAuth", {
  status: () => ipcRenderer.invoke("claude-auth:status"),
  login: () => ipcRenderer.invoke("claude-auth:login"),
  saveKey: (key) => ipcRenderer.invoke("claude-auth:save-key", key),
  cancel: () => ipcRenderer.invoke("claude-auth:cancel"),
  openUrl: (url) => ipcRenderer.invoke("claude-auth:open-url", url),
  onProgress: (cb) => {
    const wrapped = (_e, p) => cb(p);
    ipcRenderer.on("claude-auth-progress", wrapped);
    return () => ipcRenderer.removeListener("claude-auth-progress", wrapped);
  },
});
