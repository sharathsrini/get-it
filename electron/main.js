/**
 * Get It. — Electron main process.
 *
 * Responsibilities:
 *  1. Resolve the per-user data directory (Electron's userData) and expose
 *     it to the Next.js child via the GETIT_DATA_DIR env var. The Next
 *     server reads that env var to anchor every on-disk path — same
 *     resolution rules as in pure-Next dev, so the layout is identical
 *     whether you run `npm run dev` or open the packaged app.
 *
 *  2. Run the Codex setup wizard (electron/setup.js) before launching the
 *     main window: detect the Codex CLI binary, prompt to install it if
 *     missing, prompt for `codex login` if the user is not authenticated,
 *     and re-enter this wizard mid-session if Codex ever stops working.
 *
 *  3. Spawn `.next/standalone/server.js` as a child Node process on a
 *     free localhost port, wait for it to respond, then open a
 *     BrowserWindow pointing at that URL. The UI is the exact same Next.js
 *     app you see in the browser — no DOM rewiring.
 *
 *  4. Forward graceful shutdown to the child so we never leave a zombie
 *     server on a port (a real problem on Windows that breaks the next
 *     launch).
 */

"use strict";

// Guard: if ELECTRON_RUN_AS_NODE leaks into the env, Electron loads as
// plain Node and `app` is undefined — manifesting as a confusing
// "Cannot read properties of undefined (reading 'requestSingleInstanceLock')"
// crash. Detect and bail out cleanly with a useful message.
if (process.env.ELECTRON_RUN_AS_NODE === "1") {
  // eslint-disable-next-line no-console
  console.error(
    "[get-it] ELECTRON_RUN_AS_NODE=1 is set — unsetting it so Electron starts in main-process mode.\n" +
      "  If you're seeing this in a real packaged install, please report it.",
  );
  delete process.env.ELECTRON_RUN_AS_NODE;
}

const electronModule = require("electron");
if (typeof electronModule === "string") {
  // We were loaded as a node script, not as the Electron entry point.
  // This is almost always the same env-var problem above; just exit
  // before the API-undefined crash.
  // eslint-disable-next-line no-console
  console.error(
    "[get-it] The Electron API is not available. Did you launch with `npx electron .`?",
  );
  process.exit(1);
}

const { app, BrowserWindow, dialog, shell, ipcMain } = electronModule;

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");
const {
  ensureClaudeReady,
  showClaudeSetup,
  resolveServerAuth,
  refreshClaudeStatus,
  onClaudeStatusChange,
  refreshToken,
  startTokenBroker,
  stopTokenBroker,
  configDir: claudeConfigDir,
  tokenFilePath: claudeTokenFilePath,
} = require("./claude-setup");
const { maybeRunUpdate } = require("./updater");
const analytics = require("./analytics");

// ── Single-instance lock ────────────────────────────────────────────────
// If the user double-clicks the app icon a second time, focus the existing
// window rather than spawning a second Next server (port conflict + KG
// races on the same data dir).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

// ── Data dir resolution ─────────────────────────────────────────────────
// `app.getPath('userData')` defaults to:
//   macOS:  ~/Library/Application Support/<productName>
//   Windows: %APPDATA%/<productName>
//   Linux:  ~/.config/<productName>
// We set productName explicitly so this matches the AGENTS dir used in
// pure-Next dev (lib/paths.ts → defaultUserDataDir).
// We want the on-disk folder to be `get-it` (no space) so it matches the
// pure-Next dev default (lib/paths.ts → defaultUserDataDir). Electron's
// default would be `Application Support/Get It` because productName has
// a space; force the override here BEFORE anyone calls app.getPath().
app.setName("get-it");
const ELECTRON_USER_DATA_PARENT = path.dirname(app.getPath("userData"));
const DATA_DIR = path.join(ELECTRON_USER_DATA_PARENT, "get-it");
app.setPath("userData", DATA_DIR);
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "logs"), { recursive: true });

// ── Resolve the Next.js standalone server entry ─────────────────────────
// In `electron .` dev mode the user runs `npm run dev:hmr` which
// boots `next dev` separately and points us at it via the env var.
// In production the standalone server lives next to this file inside the
// app's resources directory.
const DEV_URL = process.env.ELECTRON_DEV_URL || null;

function resolveStandalonePath() {
  // In packaged mode `app.getAppPath()` resolves to the asar archive
  // (e.g. .../resources/app.asar). Electron's patched `fs` reads through
  // asar transparently so `fs.existsSync` finds server.js inside it — but
  // `child_process.spawn` uses native libuv which has no asar awareness,
  // so passing an asar path as `cwd` makes CreateProcessW (Windows) /
  // posix_spawn (mac) fail and Node surfaces it as `spawn <exe> ENOENT`
  // (the exe is just what libuv puts in the error string; the real cause
  // is the cwd not existing on disk). Always prefer the real on-disk
  // unpacked directory in packaged mode — `.next/standalone/**` is in
  // `asarUnpack` so it's there.
  const candidates = [];
  if (app.isPackaged && process.resourcesPath) {
    candidates.push(
      path.join(process.resourcesPath, "app.asar.unpacked", ".next", "standalone"),
    );
  }
  // Dev / source-tree run: project root.
  candidates.push(path.join(app.getAppPath(), ".next", "standalone"));
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "server.js"))) return c;
  }
  return null;
}

// ── Pick a free localhost port ──────────────────────────────────────────
function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

// ── Wait until the server answers HTTP /200 ─────────────────────────────
function waitForHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http
        .get(url, { timeout: 1500 }, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) {
            resolve();
          } else {
            retry();
          }
        })
        .on("error", retry)
        .on("timeout", () => {
          req.destroy();
          retry();
        });
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error("Server never became ready"));
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

// ── Spawn the embedded Next server ──────────────────────────────────────
let serverChild = null;
let serverUrl = null;

async function startEmbeddedServer() {
  if (DEV_URL) {
    serverUrl = DEV_URL;
    return;
  }
  const standalone = resolveStandalonePath();
  if (!standalone) {
    dialog.showErrorBox(
      "Get It. — internal error",
      "Could not find the embedded server. The packaged app is incomplete.",
    );
    app.quit();
    return;
  }
  const port = await pickFreePort();
  const env = {
    ...process.env,
    GETIT_DATA_DIR: DATA_DIR,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
  };
  // Give the embedded server its Claude credentials. Three modes:
  //   • env      — ANTHROPIC_API_KEY is already inherited; nothing to do.
  //   • api_key  — a stored pasted key; inject it.
  //   • oauth    — browser-login token: strip any API key, point the server at
  //     our OAuth config dir + the brokered token file, and keep that token
  //     fresh on a timer (the server re-reads the file each call).
  stopTokenBroker();
  const auth = resolveServerAuth();
  if (auth && auth.mode === "api_key") {
    env.ANTHROPIC_API_KEY = auth.key;
  } else if (auth && auth.mode === "oauth") {
    delete env.ANTHROPIC_API_KEY;
    refreshToken();
    env.ANTHROPIC_CONFIG_DIR = claudeConfigDir();
    env.GETIT_CLAUDE_TOKEN_FILE = claudeTokenFilePath();
    startTokenBroker();
  }

  const nodeBin = process.execPath; // Electron's own node — works for ES modules
  // Spawn the watchdog wrapper if it was copied next to server.js by
  // electron-prepare; fall back to plain server.js otherwise. The watchdog
  // monitors our pid and tree-kills the server if Electron dies abruptly
  // (Force Quit, kernel SIGKILL, etc.) — the dead-man's switch case.
  const watchdog = path.join(standalone, "server-watchdog.cjs");
  const serverJs = path.join(standalone, "server.js");
  const entry = fs.existsSync(watchdog) ? watchdog : serverJs;

  serverChild = spawn(nodeBin, [entry], {
    cwd: standalone,
    env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group on POSIX so we can SIGTERM the whole subtree —
    // including any `codex exec` children the SDK spawns mid-call.
    // Without this, those grandchildren get orphaned to launchd when we
    // shut down and pile up in the dock as "exec" tiles.
    detached: process.platform !== "win32",
  });

  const logPath = path.join(DATA_DIR, "logs", "server.log");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  serverChild.stdout?.pipe(logStream);
  serverChild.stderr?.pipe(logStream);
  serverChild.once("exit", (code, signal) => {
    logStream.write(`\n[server exited code=${code} signal=${signal} ts=${new Date().toISOString()}]\n`);
  });
  // An unhandled 'error' event on the spawn becomes an uncaught
  // exception that Electron surfaces as a generic "JavaScript error
  // in the main process" dialog — exactly the cryptic crash users hit
  // before this bug was caught. Catch the event, log it, and let
  // waitForHttp time out so the boot handler can show a real message.
  serverChild.on("error", (err) => {
    try {
      logStream.write(`\n[server spawn error ts=${new Date().toISOString()}]: ${err && err.stack ? err.stack : err}\n`);
    } catch {
      /* ignore */
    }
  });

  serverUrl = `http://127.0.0.1:${port}`;
  await waitForHttp(serverUrl, 45000);
}

/**
 * Cross-platform kill of an entire process tree. On POSIX we send the
 * signal to the negative pid (process group) — the server child was
 * spawned `detached: true` so it owns its group, which includes any
 * `codex exec` subprocesses the SDK launches. On Windows `taskkill /T`
 * walks the tree explicitly.
 */
function killProcessTree(pid, signal = "SIGTERM") {
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(pid), "/f", "/t"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* ignore */
    }
  }
}

function stopEmbeddedServer() {
  // Stop refreshing the OAuth token regardless of server state.
  stopTokenBroker();
  if (!serverChild || serverChild.killed) return;
  const pid = serverChild.pid;
  serverChild = null;
  if (typeof pid !== "number") return;
  // Stage 1: SIGTERM the whole group — server + codex descendants get a
  // chance to finish their synchronous writeFileSync calls.
  killProcessTree(pid, "SIGTERM");
  // Stage 2: SIGKILL anything that didn't respect SIGTERM. We deliberately
  // do NOT .unref() this timer — when Electron is racing through its own
  // shutdown (e.g. on Ctrl+C through the terminal chain) an unrefed timer
  // can be skipped before it fires, leaving the server child orphaned.
  setTimeout(() => killProcessTree(pid, "SIGKILL"), 120);
}

/**
 * Stop and re-spawn the embedded server, then point the window at the new
 * URL. Used after the user supplies/changes the Claude API key at runtime —
 * the key is injected into the server's environment at spawn time, so a
 * running server has to be replaced for a new key to take effect. No-op in
 * dev (DEV_URL), where the server isn't ours to restart.
 */
async function restartEmbeddedServer() {
  if (DEV_URL) return;
  stopEmbeddedServer();
  // Give the SIGTERM/SIGKILL sequence a moment to release the old port.
  await new Promise((r) => setTimeout(r, 300));
  await startEmbeddedServer();
  if (mainWindow && !mainWindow.isDestroyed() && serverUrl) {
    mainWindow.loadURL(serverUrl);
  }
}

// ── Main window ─────────────────────────────────────────────────────────
let mainWindow = null;

function createMainWindow() {
  const isMac = process.platform === "darwin";
  const isWin = process.platform === "win32";
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: "Get It.",
    backgroundColor: "#ffffff",
    show: false,
    // Modern integrated title bar: the app's top tab-bar becomes the
    // drag region, and platform-native window controls are inset into
    // its leading (macOS) or trailing (Windows) edge.
    //   • macOS: "hiddenInset" hides the native title strip but keeps
    //     the traffic-light buttons floating over our chrome. We nudge
    //     them down a couple of pixels so they vertically center with
    //     the tab-bar's chips.
    //   • Windows: "hidden" + titleBarOverlay draws minimise/maximise/
    //     close as system controls inside a 36-px strip we leave clear
    //     on the right side of the tab-bar.
    //   • Linux: leave the system frame on — GTK/KDE compositors don't
    //     support titleBarOverlay yet and a custom-button fallback
    //     would feel out of place next to native windows. The tab-bar
    //     still sits at the very top, the OS just paints its own
    //     decoration above it.
    titleBarStyle: isMac ? "hiddenInset" : isWin ? "hidden" : "default",
    titleBarOverlay: isWin
      ? { color: "#ffffff", symbolColor: "#111113", height: 36 }
      : undefined,
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Force any new-window request (e.g. shell.openExternal) into the OS
  // browser. The packaged app never opens secondary windows itself.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (!serverUrl) {
    dialog.showErrorBox(
      "Get It. — internal error",
      "The embedded server did not start.",
    );
    app.quit();
    return;
  }
  mainWindow.loadURL(serverUrl);
}

// ── IPC: expose Claude connection status / setup to the renderer ────────
// The claude-setup module is the source of truth for key state. The
// renderer queries it through these IPC channels; updates push as
// `codex-status` events. After the user enters a key at runtime we restart
// the embedded server so it spawns with the new ANTHROPIC_API_KEY in its
// environment, then reload the window onto the fresh server.
async function handleClaudeSetup() {
  const ok = await showClaudeSetup({ reason: "manual" });
  if (ok) await restartEmbeddedServer();
  return refreshClaudeStatus();
}

// `claude:setup` is the new channel; `codex:setup` is kept as an alias so the
// existing preload bridge keeps working without a renderer rebuild.
ipcMain.handle("claude:status", () => refreshClaudeStatus());
ipcMain.handle("claude:setup", handleClaudeSetup);
ipcMain.handle("codex:status", () => refreshClaudeStatus());
ipcMain.handle("codex:setup", handleClaudeSetup);

onClaudeStatusChange((status) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("codex-status", status);
  }
});

// ── Lifecycle ───────────────────────────────────────────────────────────

/**
 * Second-instance: another launch attempt while we're already running.
 * The single-instance lock at the top of this file rejected that launch;
 * here we receive a heads-up and surface the existing window. Cross-
 * platform: on macOS clicking the dock icon doesn't trigger this — that's
 * `activate` — but launching the .app a second time from Finder does.
 * On Windows / Linux double-clicking the shortcut a second time is the
 * common case.
 */
app.on("second-instance", () => {
  focusMainWindow();
});

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

// ── Bootstrap guard ─────────────────────────────────────────────────────
// We open transient windows BEFORE the main window: the update modal and
// the codex setup wizard. When the user dismisses one of those (e.g. clicks
// "Later" on the update prompt), it briefly becomes the last open window,
// which would normally trip `window-all-closed` and quit the app — making
// it look like nothing happens after the modal closes. While we're still
// booting, the explicit code path (this whenReady handler) decides when to
// quit; the auto-quit on last-window-close only kicks in once the main
// window has actually opened.
let bootstrapping = true;

app.whenReady().then(async () => {
  try {
    // Update check runs BEFORE anything else — the wizard, the embedded
    // server, the main window. If the user accepts the update, we quit
    // here (the new installer takes over). Otherwise we proceed with
    // the normal boot sequence.
    const userKickedOffUpdate = await maybeRunUpdate();
    if (userKickedOffUpdate) {
      // updater.js calls app.quit() on its own; just bail out. The "update"
      // analytics event is fired from the updater itself, so we don't also
      // count this launch as an "open" — it's an update, not a session.
      return;
    }

    // Anonymous "the app launched" ping (fire-and-forget). Counts a real
    // session: only fired once we've decided NOT to update and are booting
    // the app for use. Powers Total/Daily/Weekly/Monthly users.
    analytics.trackOpen();

    // Make sure we have a Claude API key before starting the Next server —
    // the agents fail on the first request without one. Captured here so the
    // key is in the server's environment when it spawns.
    const ok = await ensureClaudeReady();
    if (!ok) {
      app.quit();
      return;
    }
    await startEmbeddedServer();
    createMainWindow();
    bootstrapping = false;
  } catch (err) {
    bootstrapping = false;
    dialog.showErrorBox(
      "Get It. — failed to start",
      String(err && err.message ? err.message : err),
    );
    app.quit();
  }
});

/**
 * Closing the window = quitting the app. On macOS this overrides the
 * platform convention (where the X just hides the window) because that's
 * what the user explicitly asked for: one click on the red X and Get It.
 * is fully gone.
 *
 * While bootstrapping is true the auto-quit is suppressed — the boot
 * handler above is the source of truth for whether we should stop. Once
 * the main window opens, this becomes the normal quit-on-close behaviour.
 *
 * All persistence is synchronous (work-context, KG, tags, settings use
 * fs.writeFileSync) and the renderer's debounced state flushes through
 * `fetch(..., { keepalive: true })` so any save in flight at close time
 * still lands on disk before we kill the server.
 */
app.on("window-all-closed", () => {
  if (bootstrapping) return;
  app.quit();
});

/**
 * Before-quit: give in-flight keepalive fetches a brief window to land
 * before we tear down the embedded server. 350ms is enough for a localhost
 * round-trip + synchronous writeFileSync without being noticeable to the
 * user. We use app.exit() instead of letting the event loop drain because
 * Electron occasionally hangs on its own GPU-process teardown otherwise.
 */
let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) return; // re-entry from our own exit() — let it through
  event.preventDefault();
  quitting = true;
  setTimeout(() => {
    stopEmbeddedServer();
    app.exit(0);
  }, 350);
});

/**
 * Native signals: when the user kills `electron .` from a terminal
 * (Ctrl+C, `kill <pid>`, etc.), Electron doesn't always fire before-quit
 * before terminating — and our server child + its codex subprocesses
 * would be reparented to launchd and pile up. Catch the signals here,
 * tree-kill the children, then exit.
 *
 * The two setTimeouts below are intentionally NOT .unref()'d. We need
 * Node's event loop to wait for them — without that, an unref'd timer
 * can be dropped when Electron tears down before the timer fires and
 * the server child gets reparented to launchd. Total shutdown time
 * after Ctrl+C is ~220 ms, all of it spent making sure the tree dies.
 */
function signalShutdown(signal) {
  if (quitting) return;
  quitting = true;
  try {
    stopEmbeddedServer();
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      app.exit(signal === "SIGINT" ? 130 : 143);
    } catch {
      process.exit(signal === "SIGINT" ? 130 : 143);
    }
  }, 200);
}
process.on("SIGINT", () => signalShutdown("SIGINT"));
process.on("SIGTERM", () => signalShutdown("SIGTERM"));
process.on("SIGHUP", () => signalShutdown("SIGHUP"));
