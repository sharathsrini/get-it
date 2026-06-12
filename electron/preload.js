/**
 * Preload — exposes a small, typed bridge so the renderer can ask the
 * main process whether Claude is connected and ask it to (re-)run the API
 * key setup. Nothing else crosses the boundary.
 *
 * `runClaudeSetup` is the current name (used by the health banner);
 * `runCodexSetup` / `getCodexStatus` are kept as aliases so older renderer
 * code keeps working. Both map to the same Claude key flow in main.js.
 */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("getit", {
  platform: process.platform,
  getCodexStatus: () => ipcRenderer.invoke("claude:status"),
  runCodexSetup: () => ipcRenderer.invoke("claude:setup"),
  runClaudeSetup: () => ipcRenderer.invoke("claude:setup"),
  onCodexStatus: (cb) => {
    const wrapped = (_e, status) => {
      try {
        cb(status);
      } catch {
        /* ignore */
      }
    };
    ipcRenderer.on("codex-status", wrapped);
    return () => ipcRenderer.removeListener("codex-status", wrapped);
  },
});

// Tag the <html> element with the host platform so platform-specific
// CSS (custom title-bar padding for the traffic-light / overlay
// regions) can target it. Set as early as possible — on
// `DOMContentLoaded` the document.documentElement is already there
// and styles haven't painted yet.
window.addEventListener("DOMContentLoaded", () => {
  try {
    document.documentElement.setAttribute("data-platform", process.platform);
  } catch {
    /* sandboxed renderer can't reach this, very unlikely */
  }
});
