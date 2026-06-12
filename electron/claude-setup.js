/**
 * Get It. — Claude authentication module (browser OAuth + API-key fallback).
 *
 * The app talks to Claude via the Anthropic SDK. Two ways to authenticate:
 *
 *   1. Browser OAuth (primary) — we drive the bundled `ant` CLI's
 *      `ant auth login`, which opens the system browser and stores an OAuth
 *      profile under a config dir we own (<userData>/anthropic-config). The
 *      embedded Next server can't run `ant`, so this module acts as a token
 *      broker: it mints a short-lived bearer token with
 *      `ant auth print-credentials --access-token` (which refreshes when
 *      needed), writes it to a token file, and refreshes it on a timer. The
 *      server reads that file and sends the token as a Bearer credential
 *      (see lib/codex.ts).
 *
 *   2. API key (fallback) — a pasted `ANTHROPIC_API_KEY`, stored locally
 *      (encrypted via safeStorage when available). Also honoured if the key
 *      is already exported in our environment (dev convenience).
 *
 * Public surface mirrors the old setup.js so main.js wiring stays small.
 */

"use strict";

const { BrowserWindow, ipcMain, shell, app, safeStorage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");

const CONSOLE_URL = "https://console.anthropic.com/settings/keys";

// ── Paths ─────────────────────────────────────────────────────────────────
function configDir() {
  const dir = path.join(app.getPath("userData"), "anthropic-config");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function tokenFilePath() {
  return path.join(app.getPath("userData"), "claude-token");
}
function keyFilePath() {
  return path.join(app.getPath("userData"), "claude-key.dat");
}

// ── `ant` binary resolution ─────────────────────────────────────────────
// Bundled by scripts/electron-prepare.mjs at electron/ant-bin/<platform-arch>/
// ant(.exe); falls back to an `ant` already on PATH (dev convenience).
function targetDir() {
  return `${process.platform}-${process.arch}`;
}
function antExe() {
  return process.platform === "win32" ? "ant.exe" : "ant";
}
function bundledAntCandidates() {
  const out = [];
  const dir = targetDir();
  const exe = antExe();
  if (process.resourcesPath) {
    out.push(
      path.join(process.resourcesPath, "app.asar.unpacked", "electron", "ant-bin", dir, exe),
      path.join(process.resourcesPath, "electron", "ant-bin", dir, exe),
    );
  }
  out.push(path.join(app.getAppPath(), "electron", "ant-bin", dir, exe));
  return out;
}
let _antPathCache; // undefined = not probed, string|null after
function resolveAnt() {
  if (_antPathCache !== undefined) return _antPathCache;
  for (const candidate of bundledAntCandidates()) {
    if (fs.existsSync(candidate)) {
      if (process.platform !== "win32") {
        try {
          fs.chmodSync(candidate, 0o755);
        } catch {
          /* ignore */
        }
      }
      _antPathCache = candidate;
      return candidate;
    }
  }
  // PATH fallback — only if `ant --version` actually runs.
  try {
    const r = spawnSync("ant", ["--version"], { encoding: "utf8", timeout: 5000 });
    if (r.status === 0) {
      _antPathCache = "ant";
      return "ant";
    }
  } catch {
    /* not on PATH */
  }
  _antPathCache = null;
  return null;
}

// ── `ant` invocation ──────────────────────────────────────────────────────
// Profiles are only consulted when no API key is set, so we strip
// ANTHROPIC_API_KEY from the child env and pin our own config dir.
function antEnv() {
  const env = { ...process.env, ANTHROPIC_CONFIG_DIR: configDir() };
  delete env.ANTHROPIC_API_KEY;
  return env;
}
function runAnt(args, timeout = 8000) {
  const bin = resolveAnt();
  if (!bin) return { ok: false, status: null, stdout: "", stderr: "ant not available" };
  try {
    const r = spawnSync(bin, args, { encoding: "utf8", timeout, env: antEnv(), windowsHide: true });
    return { ok: r.status === 0, status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
  } catch (err) {
    return { ok: false, status: null, stdout: "", stderr: String(err && err.message ? err.message : err) };
  }
}

// ── OAuth: login / logout / token minting ──────────────────────────────────
function looksLikeToken(s) {
  return typeof s === "string" && /^sk-ant-/.test(s.trim());
}

/** Mint (and implicitly refresh) a bearer token. Returns the token or null. */
function mintToken() {
  const r = runAnt(["auth", "print-credentials", "--access-token"], 15000);
  const token = r.stdout.trim();
  return r.ok && looksLikeToken(token) ? token : null;
}

function isLoggedIn() {
  return mintToken() !== null;
}

/** Mint a fresh token and write it to the broker file. Returns true on success. */
function refreshToken() {
  const token = mintToken();
  if (!token) return false;
  try {
    fs.writeFileSync(tokenFilePath(), token, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

let _brokerTimer = null;
function startTokenBroker() {
  stopTokenBroker();
  refreshToken();
  // print-credentials refreshes only when near expiry, so polling is cheap.
  _brokerTimer = setInterval(refreshToken, 5 * 60 * 1000);
  if (_brokerTimer.unref) _brokerTimer.unref();
}
function stopTokenBroker() {
  if (_brokerTimer) {
    clearInterval(_brokerTimer);
    _brokerTimer = null;
  }
}

/**
 * Run `ant auth login` — opens the system browser and resolves once the OAuth
 * flow completes. `onLine` receives stdout lines so the window can surface the
 * authorize URL if the browser didn't open on its own.
 */
function runLogin(onLine) {
  return new Promise((resolve) => {
    const bin = resolveAnt();
    if (!bin) {
      resolve(false);
      return;
    }
    const child = spawn(bin, ["auth", "login"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: antEnv(),
      windowsHide: true,
    });
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    // Generous ceiling — the user may take a while in the browser.
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      done(isLoggedIn());
    }, 5 * 60 * 1000);
    const onChunk = (buf) => {
      for (const line of buf.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) onLine?.(line);
      }
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.once("error", () => done(false));
    child.once("exit", (code) => done(code === 0 || isLoggedIn()));
  });
}

function logout() {
  runAnt(["auth", "logout", "--all"], 8000);
  try {
    fs.rmSync(tokenFilePath(), { force: true });
  } catch {
    /* ignore */
  }
  clearStoredKey();
  refreshClaudeStatus();
}

// ── API-key fallback storage ────────────────────────────────────────────
function storeKey(key) {
  const trimmed = (key || "").trim();
  if (!trimmed) return false;
  try {
    const body = safeStorage.isEncryptionAvailable()
      ? "enc\n" + safeStorage.encryptString(trimmed).toString("base64")
      : "raw\n" + trimmed;
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
    if (tag === "raw") return payload.trim() || null;
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

// ── Auth resolution for the embedded server ────────────────────────────────
/**
 * What the embedded server should authenticate with, in priority order:
 *   1. ANTHROPIC_API_KEY already in our environment (dev convenience)
 *   2. an OAuth login (browser flow) → brokered bearer token
 *   3. a locally-stored API key (pasted fallback)
 * Returns null when none are available.
 */
function resolveServerAuth() {
  if ((process.env.ANTHROPIC_API_KEY || "").trim()) return { mode: "env" };
  if (isLoggedIn()) return { mode: "oauth" };
  const stored = readStoredKey();
  if (stored) return { mode: "api_key", key: stored };
  return null;
}

// ── Status snapshot + subscribers ───────────────────────────────────────
const statusSubscribers = new Set();
function refreshClaudeStatus() {
  const auth = resolveServerAuth();
  const status = { connected: !!auth, mode: auth ? auth.mode : null, antAvailable: !!resolveAnt() };
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

  ipcMain.handle("claude-auth:status", () => refreshClaudeStatus());
  ipcMain.handle("claude-auth:login", async () => {
    const ok = await runLogin((line) => {
      const m = /(https?:\/\/[^\s]+)/i.exec(line);
      if (m && setupWindow && !setupWindow.isDestroyed()) {
        setupWindow.webContents.send("claude-auth-progress", { authUrl: m[1] });
      }
    });
    if (ok && isLoggedIn()) {
      refreshClaudeStatus();
      closeSetupWindow(true);
      return { ok: true };
    }
    return { ok: false };
  });
  ipcMain.handle("claude-auth:save-key", (_e, key) => {
    const ok = storeKey(typeof key === "string" ? key : "");
    if (ok) {
      refreshClaudeStatus();
      closeSetupWindow(true);
    }
    return { ok };
  });
  ipcMain.handle("claude-auth:cancel", () => closeSetupWindow(false));
  ipcMain.handle("claude-auth:open-url", async (_e, url) => {
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
    height: 600,
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
    query: { reason: opts.reason || "first-run", ant: resolveAnt() ? "1" : "0" },
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
  if (resolveServerAuth()) return true;
  const ok = await showClaudeSetup({ reason: "first-run" });
  return ok && !!resolveServerAuth();
}

module.exports = {
  ensureClaudeReady,
  showClaudeSetup,
  resolveServerAuth,
  refreshClaudeStatus,
  onClaudeStatusChange,
  refreshToken,
  startTokenBroker,
  stopTokenBroker,
  logout,
  configDir,
  tokenFilePath,
};
