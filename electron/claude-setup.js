/**
 * Get It. — Claude API key setup module.
 *
 * Replaces the old Codex CLI setup flow. The app now talks to Claude via the
 * Anthropic SDK, which authenticates with an `ANTHROPIC_API_KEY`. There is no
 * binary to bundle and no OAuth dance — we just need a key, which we:
 *
 *   • read from the environment (`ANTHROPIC_API_KEY`) when present — handy for
 *     developers who export it in their shell, and
 *   • otherwise persist locally (encrypted with Electron's `safeStorage` when
 *     the OS keychain is available, plaintext fallback otherwise) so the user
 *     only enters it once.
 *
 * The key is injected into the embedded Next server's environment at spawn
 * time (see main.js → startEmbeddedServer), which is where every agent call
 * reads it via `new Anthropic()`.
 *
 * Public surface mirrors the old setup.js so main.js wiring stays small:
 *   ensureClaudeReady(), showClaudeSetup(), resolveApiKey(),
 *   refreshClaudeStatus(), onClaudeStatusChange().
 */

"use strict";

const { BrowserWindow, ipcMain, shell, app, safeStorage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const CONSOLE_URL = "https://console.anthropic.com/settings/keys";

function keyFilePath() {
  return path.join(app.getPath("userData"), "claude-key.dat");
}

// ── Key storage ─────────────────────────────────────────────────────────
// File format: a one-line tag ("enc" | "raw") followed by the payload, so we
// can tell an OS-encrypted blob from a plaintext fallback when reading back.

function storeKey(key) {
  const trimmed = (key || "").trim();
  if (!trimmed) return false;
  try {
    let body;
    if (safeStorage.isEncryptionAvailable()) {
      body = "enc\n" + safeStorage.encryptString(trimmed).toString("base64");
    } else {
      body = "raw\n" + trimmed;
    }
    fs.writeFileSync(keyFilePath(), body, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function readStoredKey() {
  let raw;
  try {
    raw = fs.readFileSync(keyFilePath(), "utf8");
  } catch {
    return null;
  }
  const nl = raw.indexOf("\n");
  if (nl < 0) return null;
  const tag = raw.slice(0, nl);
  const payload = raw.slice(nl + 1);
  try {
    if (tag === "enc") {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(Buffer.from(payload, "base64")).trim() || null;
    }
    if (tag === "raw") {
      return payload.trim() || null;
    }
  } catch {
    return null;
  }
  return null;
}

function clearStoredKey() {
  try {
    fs.rmSync(keyFilePath(), { force: true });
  } catch {
    /* ignore */
  }
}

/**
 * The key the embedded server should use, in priority order:
 *   1. an explicit `ANTHROPIC_API_KEY` in our own environment (dev convenience)
 *   2. the locally-stored key the user entered in the setup window
 * Returns null when neither is present.
 */
function resolveApiKey() {
  const fromEnv = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  return readStoredKey();
}

// ── Status snapshot + subscribers ───────────────────────────────────────
const statusSubscribers = new Set();

function refreshClaudeStatus() {
  const fromEnv = (process.env.ANTHROPIC_API_KEY || "").trim();
  const stored = fromEnv ? null : readStoredKey();
  const status = {
    hasKey: !!(fromEnv || stored),
    source: fromEnv ? "env" : stored ? "stored" : null,
  };
  for (const cb of statusSubscribers) {
    try {
      cb(status);
    } catch {
      /* ignore */
    }
  }
  return status;
}

function onClaudeStatusChange(cb) {
  statusSubscribers.add(cb);
  return () => statusSubscribers.delete(cb);
}

// ── Setup window ──────────────────────────────────────────────────────────
let setupWindow = null;
let setupResolvers = [];

function ensureIpcHandlers() {
  if (ensureIpcHandlers._wired) return;
  ensureIpcHandlers._wired = true;

  ipcMain.handle("claude-key:status", () => refreshClaudeStatus());
  ipcMain.handle("claude-key:save", (_e, key) => {
    const ok = storeKey(typeof key === "string" ? key : "");
    if (ok) {
      refreshClaudeStatus();
      closeSetupWindow(true);
    }
    return { ok };
  });
  ipcMain.handle("claude-key:cancel", () => {
    closeSetupWindow(false);
  });
  ipcMain.handle("claude-key:open-url", async (_e, url) => {
    const target = typeof url === "string" && /^https?:\/\//.test(url) ? url : CONSOLE_URL;
    await shell.openExternal(target).catch(() => {});
  });
}

function closeSetupWindow(resolved) {
  const w = setupWindow;
  setupWindow = null;
  for (const r of setupResolvers) r.resolve(!!resolved);
  setupResolvers = [];
  if (w && !w.isDestroyed()) w.close();
}

function showClaudeSetup(opts = {}) {
  ensureIpcHandlers();
  if (setupWindow) {
    setupWindow.focus();
    return new Promise((resolve) => setupResolvers.push({ resolve }));
  }
  setupWindow = new BrowserWindow({
    width: 560,
    height: 560,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "Get It. — Connect Claude",
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload-claude.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  setupWindow.removeMenu?.();
  setupWindow.loadFile(path.join(__dirname, "claude-setup", "index.html"), {
    query: { reason: opts.reason || "first-run" },
  });
  setupWindow.once("ready-to-show", () => setupWindow?.show());
  setupWindow.on("closed", () => {
    setupWindow = null;
    for (const r of setupResolvers) r.resolve(false);
    setupResolvers = [];
  });
  return new Promise((resolve) => setupResolvers.push({ resolve }));
}

// ── Public: run before the main window opens ──────────────────────────────
async function ensureClaudeReady() {
  ensureIpcHandlers();
  if (resolveApiKey()) return true;
  const ok = await showClaudeSetup({ reason: "first-run" });
  return ok && !!resolveApiKey();
}

module.exports = {
  ensureClaudeReady,
  showClaudeSetup,
  resolveApiKey,
  refreshClaudeStatus,
  onClaudeStatusChange,
  clearStoredKey,
};
