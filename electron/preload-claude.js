"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("claudeKey", {
  status: () => ipcRenderer.invoke("claude-key:status"),
  save: (key) => ipcRenderer.invoke("claude-key:save", key),
  cancel: () => ipcRenderer.invoke("claude-key:cancel"),
  openUrl: (url) => ipcRenderer.invoke("claude-key:open-url", url),
});
