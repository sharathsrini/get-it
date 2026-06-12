#!/usr/bin/env node
/**
 * scripts/electron-prepare.mjs
 *
 * Post-`next build` step: copy the standalone bundle's adjacent assets
 * (the static chunks and the public folder) INSIDE the standalone tree
 * so a single `node server.js` runs cleanly without us needing to know
 * the project root at runtime. Then optionally fetch the platform-
 * specific Codex binary for a cross-arch build (e.g. building a
 * darwin-x64 .dmg from an arm64 host).
 *
 * Why: `next build --output=standalone` writes server.js and a trimmed
 * node_modules tree, but does NOT copy `.next/static` or `public` into
 * the standalone folder. This is documented Next behaviour. We close
 * that gap here.
 *
 * Flags:
 *   --target=<platform-arch>
 *       darwin-arm64 | darwin-x64 | win32-x64 | win32-arm64 |
 *       linux-x64   | linux-arm64
 *     When passed, we additionally fetch the matching
 *     `@openai/codex-<platform>-<arch>` package tarball from npm and
 *     extract it into node_modules so electron-builder picks it up.
 *     The host's own platform package is already there, so no fetch is
 *     needed when --target matches the host.
 */

import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import https from "node:https";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const STANDALONE = path.join(REPO_ROOT, ".next", "standalone");

const args = process.argv.slice(2);
const target = args.find((a) => a.startsWith("--target="))?.split("=")[1] ?? null;

const REQUIRED_CODEX_VERSION = process.env.CODEX_VERSION || "0.130.0";

// Claude Code ships a single platform-independent Node CLI (cli.js) rather than
// a per-triple native binary, so one staged copy works on every target. We pin
// a version but allow override; staging is best-effort (Claude is opt-in, so a
// fetch failure must not break a Codex-only build).
const CLAUDE_CLI_VERSION = process.env.CLAUDE_CLI_VERSION || "latest";

const PLATFORM_PKG_BY_TARGET = {
  "darwin-arm64": "@openai/codex-darwin-arm64",
  "darwin-x64": "@openai/codex-darwin-x64",
  "win32-x64": "@openai/codex-win32-x64",
  "win32-arm64": "@openai/codex-win32-arm64",
  "linux-x64": "@openai/codex-linux-x64",
  "linux-arm64": "@openai/codex-linux-arm64",
};

async function copyDir(src, dest) {
  if (!fssync.existsSync(src)) return;
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const s = path.join(src, entry.name);
      const d = path.join(dest, entry.name);
      if (entry.isDirectory()) await copyDir(s, d);
      else if (entry.isSymbolicLink()) {
        const link = await fs.readlink(s);
        try {
          await fs.symlink(link, d);
        } catch {
          /* ignore */
        }
      } else {
        await fs.copyFile(s, d);
      }
    }),
  );
}

async function syncStandaloneAssets() {
  if (!fssync.existsSync(path.join(STANDALONE, "server.js"))) {
    throw new Error(
      `Standalone server.js not found at ${STANDALONE}. Run \`next build\` first.`,
    );
  }
  // .next/static is required for hashed JS/CSS chunks
  const srcStatic = path.join(REPO_ROOT, ".next", "static");
  const dstStatic = path.join(STANDALONE, ".next", "static");
  await fs.rm(dstStatic, { recursive: true, force: true });
  await copyDir(srcStatic, dstStatic);

  // public/ — favicons, sample PDFs, pdf worker
  const srcPublic = path.join(REPO_ROOT, "public");
  const dstPublic = path.join(STANDALONE, "public");
  await fs.rm(dstPublic, { recursive: true, force: true });
  await copyDir(srcPublic, dstPublic);

  // Server watchdog — sits next to server.js so the Electron main can
  // spawn it as a single-file entry point and have it boot + monitor
  // the real server.
  const srcWatch = path.join(REPO_ROOT, "scripts", "server-watchdog.cjs");
  const dstWatch = path.join(STANDALONE, "server-watchdog.cjs");
  await fs.copyFile(srcWatch, dstWatch);

  console.log(
    "[electron-prepare] copied .next/static, public, and server-watchdog into standalone.",
  );
}

function downloadBuffer(url, redirectsLeft = 4) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          res.resume();
          downloadBuffer(res.headers.location, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

function extractTar(buf, destRoot, stripPackagePrefix = true) {
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) {
      offset += 512;
      continue;
    }
    let name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeStr = header.subarray(124, 124 + 12).toString("utf8").replace(/\0.*$/, "").trim();
    const size = parseInt(sizeStr || "0", 8);
    const typeFlag = String.fromCharCode(header[156] || 0);
    const prefix = header.subarray(345, 345 + 155).toString("utf8").replace(/\0.*$/, "");
    if (prefix) name = `${prefix}/${name}`;
    if (stripPackagePrefix) name = name.replace(/^package\//, "");
    const start = offset + 512;
    const end = start + size;
    if (typeFlag === "0" || typeFlag === "" || typeFlag === "\0") {
      const outPath = path.join(destRoot, name);
      fssync.mkdirSync(path.dirname(outPath), { recursive: true });
      fssync.writeFileSync(outPath, buf.subarray(start, end));
    } else if (typeFlag === "5") {
      fssync.mkdirSync(path.join(destRoot, name), { recursive: true });
    }
    offset = end + (512 - (size % 512)) % 512;
  }
}

function tripleDirFor(targetTriple) {
  switch (targetTriple) {
    case "darwin-arm64":
      return "aarch64-apple-darwin";
    case "darwin-x64":
      return "x86_64-apple-darwin";
    case "linux-arm64":
      return "aarch64-unknown-linux-musl";
    case "linux-x64":
      return "x86_64-unknown-linux-musl";
    case "win32-x64":
      return "x86_64-pc-windows-msvc";
    case "win32-arm64":
      return "aarch64-pc-windows-msvc";
    default:
      return null;
  }
}

/**
 * Ensure the target's @openai/codex-<platform>-<arch> package is in
 * node_modules (download from npm if missing — the host might be the
 * wrong arch for a cross-build), then copy ONLY the binary tree into
 * `electron/codex-bin/<triple>/codex/...`. The Electron app bundles
 * that directory via extraResources, so the runtime ships exactly one
 * codex binary per platform target.
 */
async function fetchPlatformPackage(targetTriple) {
  const pkg = PLATFORM_PKG_BY_TARGET[targetTriple];
  const triple = tripleDirFor(targetTriple);
  if (!pkg || !triple) {
    console.warn(`[electron-prepare] unknown target ${targetTriple}, skipping codex fetch.`);
    return;
  }
  const nmDest = path.join(REPO_ROOT, "node_modules", pkg);
  const haveLocally =
    fssync.existsSync(path.join(nmDest, "package.json")) &&
    fssync.existsSync(path.join(nmDest, "vendor"));
  if (!haveLocally) {
    const url = `https://registry.npmjs.org/@openai/codex/-/codex-${REQUIRED_CODEX_VERSION}-${targetTriple}.tgz`;
    console.log(`[electron-prepare] fetching ${url}…`);
    const gz = await downloadBuffer(url);
    const tar = zlib.gunzipSync(gz);
    await fs.rm(nmDest, { recursive: true, force: true });
    await fs.mkdir(nmDest, { recursive: true });
    extractTar(tar, nmDest, true);
    console.log(`[electron-prepare] installed ${pkg} for ${targetTriple}.`);
  } else {
    console.log(`[electron-prepare] ${pkg} already present.`);
  }
  // Copy into electron/codex-bin so the Electron build picks it up.
  const exeName = targetTriple.startsWith("win32-") ? "codex.exe" : "codex";
  const srcVendor = path.join(nmDest, "vendor", triple);
  const codexBinRoot = path.join(REPO_ROOT, "electron", "codex-bin");
  // Drop any previously-staged triples so this build doesn't end up
  // shipping a Codex binary for a different platform (running a
  // mac-arm64 build right after a win-x64 build leaves the 247 MB
  // win32-x64 codex.exe sitting next to the 192 MB aarch64-apple-darwin
  // codex and electron-builder happily packages both).
  if (fssync.existsSync(codexBinRoot)) {
    for (const entry of fssync.readdirSync(codexBinRoot)) {
      if (entry !== triple) {
        fssync.rmSync(path.join(codexBinRoot, entry), { recursive: true, force: true });
      }
    }
  }
  const destVendor = path.join(codexBinRoot, triple);
  await fs.rm(destVendor, { recursive: true, force: true });
  await fs.mkdir(destVendor, { recursive: true });
  await copyDir(srcVendor, destVendor);
  if (!targetTriple.startsWith("win32-")) {
    try {
      fssync.chmodSync(path.join(destVendor, "codex", exeName), 0o755);
    } catch {
      /* ignore */
    }
  }
  console.log(`[electron-prepare] staged codex binary at electron/codex-bin/${triple}/codex/${exeName}`);
}

/**
 * Stage the Claude Code CLI into electron/claude-bin so the packaged app can
 * spawn it via Electron's Node. Unlike Codex there's no per-triple binary —
 * cli.js is platform-independent — so a single staged copy covers all targets.
 * Best-effort: prefers a node_modules copy, otherwise fetches the npm tarball;
 * any failure is logged and skipped so Codex-only builds still succeed.
 */
async function stageClaudeCli() {
  const claudeBinRoot = path.join(REPO_ROOT, "electron", "claude-bin");
  const pkgDir = path.join(REPO_ROOT, "node_modules", "@anthropic-ai", "claude-code");
  try {
    if (fssync.existsSync(path.join(pkgDir, "cli.js"))) {
      await fs.rm(claudeBinRoot, { recursive: true, force: true });
      await fs.mkdir(claudeBinRoot, { recursive: true });
      await copyDir(pkgDir, claudeBinRoot);
      console.log("[electron-prepare] staged Claude CLI from node_modules into electron/claude-bin.");
      return;
    }
    const url = `https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-${CLAUDE_CLI_VERSION}.tgz`;
    // "latest" isn't a real tarball filename — resolve via the registry doc.
    let tgzUrl = url;
    if (CLAUDE_CLI_VERSION === "latest") {
      const meta = JSON.parse(
        (await downloadBuffer("https://registry.npmjs.org/@anthropic-ai/claude-code")).toString("utf8"),
      );
      const latest = meta["dist-tags"]?.latest;
      tgzUrl = meta.versions?.[latest]?.dist?.tarball;
      if (!tgzUrl) throw new Error("could not resolve Claude CLI latest tarball");
    }
    console.log(`[electron-prepare] fetching Claude CLI ${tgzUrl}…`);
    const gz = await downloadBuffer(tgzUrl);
    const tar = zlib.gunzipSync(gz);
    await fs.rm(claudeBinRoot, { recursive: true, force: true });
    await fs.mkdir(claudeBinRoot, { recursive: true });
    extractTar(tar, claudeBinRoot, true);
    console.log("[electron-prepare] staged Claude CLI into electron/claude-bin.");
  } catch (err) {
    console.warn(
      `[electron-prepare] skipped Claude CLI staging (Codex-only build still OK): ${err && err.message ? err.message : err}`,
    );
  }
}

function hostTarget() {
  const { platform, arch } = process;
  if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  if (platform === "linux") return arch === "arm64" ? "linux-arm64" : "linux-x64";
  if (platform === "win32") return arch === "arm64" ? "win32-arm64" : "win32-x64";
  return null;
}

async function main() {
  await syncStandaloneAssets();
  // If no explicit --target, stage the host binary so a plain
  // `npm run electron:prepare && electron .` smoke from the source tree
  // works without further setup.
  const effective = target || hostTarget();
  if (effective) {
    await fetchPlatformPackage(effective);
  }
  // Claude is platform-independent and opt-in; stage it on every build.
  await stageClaudeCli();
}

main().catch((err) => {
  console.error("[electron-prepare] failed:", err);
  process.exit(1);
});
