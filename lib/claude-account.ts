/**
 * Claude account introspection + logout — the Anthropic analogue of
 * lib/codex-account.ts, shaped to return the SAME structures so the existing
 * /api/codex/account route and the AccountButton UI render unchanged.
 *
 *   readClaudeAccountInfo(): read Claude Code's local config
 *     (~/.claude.json → `oauthAccount`) and surface email / plan / org. No
 *     network call — just a local file read. Claude Code stores the
 *     subscription OAuth identity here after `claude` login.
 *
 *   readClaudeRateLimits(): Claude Code does not expose a machine-readable
 *     rate-limit endpoint the way `codex app-server` does, so this returns
 *     null and the UI renders its "usage limits unavailable" pill.
 *
 *   runClaudeLogout(): best-effort `claude logout`, falling back to removing
 *     the local credentials file. Reversible by signing in again.
 *
 * Every path swallows its own errors and returns null/false so the UI degrades
 * to a "no data" pill instead of crashing.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveClaudeBinary, claudeHomeDir } from "./claude";
import type {
  CodexAccountInfo,
  CodexRateLimits,
} from "./codex-account";

function readClaudeConfig(): Record<string, unknown> | null {
  // The CLI's primary config lives at ~/.claude.json (a single JSON blob);
  // when CLAUDE_CONFIG_DIR is set it moves under that dir.
  const candidates = [
    path.join(claudeHomeDir(), ".claude.json"),
    path.join(claudeHomeDir(), "config.json"),
  ];
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Mirrors CodexAccountInfo so the shared route + UI work without changes. */
export function readClaudeAccountInfo(): CodexAccountInfo | null {
  const cfg = readClaudeConfig();
  if (!cfg) return null;
  const oauth = cfg.oauthAccount as Record<string, unknown> | undefined;
  if (!oauth) return null;

  const email =
    typeof oauth.emailAddress === "string" ? (oauth.emailAddress as string) : null;
  const orgName =
    typeof oauth.organizationName === "string"
      ? (oauth.organizationName as string)
      : null;
  const orgRole =
    typeof oauth.organizationRole === "string"
      ? (oauth.organizationRole as string)
      : "";
  const orgId =
    typeof oauth.organizationUuid === "string"
      ? (oauth.organizationUuid as string)
      : "";

  // Plan type: the CLI records the subscription tier under a few possible
  // keys depending on version; probe them in order.
  const planType =
    (typeof cfg.subscriptionType === "string" && (cfg.subscriptionType as string)) ||
    (typeof oauth.subscriptionType === "string" && (oauth.subscriptionType as string)) ||
    (typeof cfg.userType === "string" && (cfg.userType as string)) ||
    null;

  return {
    email,
    name: typeof oauth.displayName === "string" ? (oauth.displayName as string) : null,
    planType,
    organizations: orgName
      ? [{ id: orgId, title: orgName, role: orgRole }]
      : [],
    subscriptionActiveUntil: null,
    authMode: "oauth",
  };
}

/** Claude Code exposes no machine-readable rate-limit feed; return null. */
export async function readClaudeRateLimits(): Promise<CodexRateLimits | null> {
  return null;
}

/**
 * Sign out of Claude Code. Tries the CLI's own logout first; if that isn't
 * available, removes the local credentials file so a fresh login is required.
 */
export function runClaudeLogout(): boolean {
  const resolved = resolveClaudeBinary();
  if (resolved) {
    try {
      const r = spawnSync(resolved.command, [...resolved.prefixArgs, "logout"], {
        encoding: "utf-8",
        timeout: 8000,
        windowsHide: true,
      });
      if (r.status === 0) return true;
    } catch {
      /* fall through to file removal */
    }
  }
  // Fallback: remove the local credentials file (macOS may also keep a copy
  // in the Keychain, which a subsequent login overwrites).
  let removed = false;
  for (const file of [
    path.join(claudeHomeDir(), ".credentials.json"),
    path.join(claudeHomeDir(), "credentials.json"),
  ]) {
    try {
      if (fs.existsSync(file)) {
        fs.rmSync(file);
        removed = true;
      }
    } catch {
      /* ignore */
    }
  }
  return removed;
}
