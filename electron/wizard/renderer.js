"use strict";

const els = {
  stepInstall: document.getElementById("step-install"),
  stepInstallMarker: document.getElementById("step-install-marker"),
  stepLogin: document.getElementById("step-login"),
  stepLoginMarker: document.getElementById("step-login-marker"),
  headerBlurb: document.getElementById("header-blurb"),
  installTitle: document.getElementById("install-title"),
  installDesc: document.getElementById("install-desc"),
  installStatus: document.getElementById("install-status"),
  btnInstall: document.getElementById("btn-install"),
  loginTitle: document.getElementById("login-title"),
  loginDesc: document.getElementById("login-desc"),
  loginStatus: document.getElementById("login-status"),
  btnLogin: document.getElementById("btn-login"),
  btnFinish: document.getElementById("btn-finish"),
  btnCancel: document.getElementById("btn-cancel"),
  platformInfo: document.getElementById("platform-info"),
  authUrlBox: document.getElementById("auth-url-box"),
  authUrl: document.getElementById("auth-url"),
  btnOpenUrl: document.getElementById("btn-open-url"),
  providerChoices: Array.from(document.querySelectorAll(".provider-choice")),
};

// Per-provider copy. Codex ships a per-triple binary that can be missing
// (install step); Claude is a bundled Node CLI that's always present, so its
// "install" step never surfaces and it has no minimum-version gate.
const PROVIDERS = {
  codex: {
    label: "OpenAI Codex",
    cliName: "Codex CLI",
    signInTitle: "Sign in with ChatGPT or OpenAI",
    signInButton: "Sign in with ChatGPT",
    signedIn: "You're signed in to Codex.",
    blurbSignin:
      "Sign in with the ChatGPT account you already use — that's the one Get It.'s agents run against. Your study data never leaves this Mac/PC.",
    blurbInstall:
      "We couldn't find Get It.'s bundled Codex CLI. Install a backup copy and sign in — your study data never leaves this Mac/PC.",
  },
  claude: {
    label: "Anthropic Claude",
    cliName: "Claude CLI",
    signInTitle: "Sign in with Claude",
    signInButton: "Sign in with Claude",
    signedIn: "You're signed in to Claude.",
    blurbSignin:
      "Sign in with the Claude (Pro or Max) account you already use — that's the one Get It.'s agents run against. Your study data never leaves this Mac/PC.",
    blurbInstall:
      "We couldn't find Get It.'s bundled Claude CLI. Reinstall the app — your study data never leaves this Mac/PC.",
  },
};

let lastAuthUrl = null;
let lastPhase = "idle";
let activeProvider = "codex";

function render(s) {
  if (!s) return;
  activeProvider = s.provider === "claude" ? "claude" : "codex";
  const copy = PROVIDERS[activeProvider];

  for (const btn of els.providerChoices) {
    const on = btn.dataset.provider === activeProvider;
    btn.setAttribute("aria-checked", on ? "true" : "false");
    // Don't let the user switch providers mid-login.
    btn.disabled = s.phase === "logging-in" || s.phase === "installing";
  }

  els.platformInfo.textContent =
    activeProvider === "codex" && s.targetTriple
      ? `Platform: ${s.targetTriple}  ·  Required: ≥ ${s.requiredVersion}`
      : "";

  // The bundled binary ships inside the .app / installer for every user. The
  // install step only surfaces on the rare path where the bundled copy is
  // genuinely missing. The common path is one step: sign in.
  const cliReady = s.binaryFound && s.versionOk;
  const showInstallStep = !cliReady;

  els.stepInstall.hidden = !showInstallStep;
  els.stepInstallMarker.textContent = "1";
  els.stepLoginMarker.textContent = showInstallStep ? "2" : "1";
  els.headerBlurb.textContent = showInstallStep
    ? copy.blurbInstall
    : copy.blurbSignin;

  // ── Step 1: install / version (only visible when bundled copy missing)
  if (showInstallStep) {
    els.installTitle.textContent = copy.cliName;
    els.stepInstall.classList.toggle("done", false);
    els.stepInstall.classList.toggle(
      "active",
      (s.phase ?? "idle") !== "logging-in",
    );
    els.stepInstall.classList.toggle("error", s.phase === "error");
    if (!s.binaryFound) {
      els.installDesc.textContent =
        activeProvider === "claude"
          ? `Get It.'s bundled ${copy.cliName} is missing on this machine. Reinstalling the app restores it.`
          : `Get It.'s bundled ${copy.cliName} is missing on this machine.`;
      els.btnInstall.disabled = false;
      els.btnInstall.textContent = `Install ${copy.cliName}`;
      // Claude ships bundled with no per-triple download, so there's nothing
      // to install — hide the button entirely rather than show a dead control.
      els.btnInstall.hidden = activeProvider === "claude";
    } else {
      // binary present but version too old — only reachable for the
      // node_modules / userdata sources, since the bundled copy's
      // version is pinned at build time.
      els.installDesc.textContent = `The ${copy.cliName} on this machine is ${s.version ?? "an unknown version"}; Get It. needs ≥ ${s.requiredVersion}. Update?`;
      els.btnInstall.disabled = false;
      els.btnInstall.textContent = `Update ${copy.cliName}`;
      els.btnInstall.hidden = activeProvider === "claude";
    }
    if (s.phase === "installing") {
      els.installStatus.innerHTML = `<span class="spinner"></span>${escapeHtml(s.message || "Installing…")}`;
      els.btnInstall.disabled = true;
    } else if (s.phase === "error") {
      els.installStatus.innerHTML = `<span class="err">${escapeHtml(s.message || "Failed.")}</span>`;
    } else {
      els.installStatus.innerHTML = "";
    }
  }

  // ── Sign-in step (always visible)
  els.loginTitle.textContent = copy.signInTitle;
  els.stepLogin.classList.toggle("done", s.loggedIn);
  els.stepLogin.classList.toggle("active", cliReady && !s.loggedIn);
  els.stepLogin.classList.toggle(
    "error",
    s.phase === "error" && cliReady && !s.loggedIn,
  );
  if (!cliReady) {
    els.loginDesc.textContent = `Install ${copy.cliName} first.`;
    els.btnLogin.disabled = true;
    els.loginStatus.innerHTML = "";
  } else if (s.loggedIn) {
    els.loginDesc.textContent = copy.signedIn;
    els.btnLogin.disabled = true;
    els.btnLogin.textContent = "Signed in";
    els.loginStatus.innerHTML = `<span class="ok">✓ Connected</span>`;
  } else {
    els.loginDesc.textContent =
      "A browser window will open. After you finish signing in there, this dialog continues automatically.";
    els.btnLogin.disabled = s.phase === "logging-in";
    els.btnLogin.textContent = copy.signInButton;
    if (s.phase === "logging-in") {
      els.loginStatus.innerHTML = `<span class="spinner"></span>${escapeHtml(s.message || "Waiting for browser…")}`;
    } else if (s.phase === "error") {
      els.loginStatus.innerHTML = `<span class="err">${escapeHtml(s.message || "Login failed.")}</span>`;
    } else {
      els.loginStatus.innerHTML = "";
    }
  }

  // Auth-url fallback
  if (s.authUrl && s.phase === "logging-in") {
    lastAuthUrl = s.authUrl;
    els.authUrlBox.hidden = false;
    els.authUrl.textContent = s.authUrl;
  } else if (s.phase !== "logging-in") {
    els.authUrlBox.hidden = true;
    lastAuthUrl = null;
  }

  // ── Finish button — only enabled when everything green
  els.btnFinish.disabled = !(cliReady && s.loggedIn);

  lastPhase = s.phase ?? "idle";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// ── Wire buttons ────────────────────────────────────────────────────────
for (const btn of els.providerChoices) {
  btn.addEventListener("click", async () => {
    const next = btn.dataset.provider;
    if (next === activeProvider) return;
    await window.wizard.setProvider(next);
  });
}
els.btnInstall.addEventListener("click", async () => {
  els.btnInstall.disabled = true;
  await window.wizard.install();
});
els.btnLogin.addEventListener("click", async () => {
  els.btnLogin.disabled = true;
  await window.wizard.login();
});
els.btnFinish.addEventListener("click", async () => {
  await window.wizard.finish();
});
els.btnCancel.addEventListener("click", async () => {
  await window.wizard.cancel();
});
els.btnOpenUrl.addEventListener("click", async () => {
  if (lastAuthUrl) await window.wizard.openUrl(lastAuthUrl);
});

// ── Live status pushes from main ────────────────────────────────────────
window.wizard.onStatus(render);
window.wizard.status().then(render);
