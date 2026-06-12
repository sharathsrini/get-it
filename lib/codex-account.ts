/**
 * Claude/Anthropic account information helpers.
 *
 *   readAccountInfo(): reports connection state — an API key (env/stored) or a
 *     browser OAuth sign-in (a brokered bearer token file). No network call.
 *
 *   readRateLimits(): Anthropic does not expose a rate-limit introspection
 *     endpoint via API key auth; always returns null.
 *
 *   runLogout(): no logout concept for an API key; always returns false.
 *
 * These functions are kept API-compatible with the old Codex versions so
 * callers (the /api/codex/account and /api/codex/logout routes) need no
 * changes.
 */

import { readFileSync } from "node:fs";

export type CodexAccountInfo = {
  email: string | null;
  name: string | null;
  planType: string | null;
  organizations: Array<{ id: string; title: string; role: string }>;
  subscriptionActiveUntil: string | null;
  authMode: string | null;
};

export function readAccountInfo(): CodexAccountInfo | null {
  // API-key mode (web/dev or a stored key).
  if ((process.env.ANTHROPIC_API_KEY || "").trim()) {
    return {
      email: null,
      name: "Anthropic API",
      planType: "api_key",
      organizations: [],
      subscriptionActiveUntil: null,
      authMode: "api_key",
    };
  }
  // OAuth mode (browser sign-in) — the Electron main process brokers a bearer
  // token into this file. Its presence means we're connected.
  const tokenFile = process.env.GETIT_CLAUDE_TOKEN_FILE;
  if (tokenFile) {
    try {
      if (readFileSync(tokenFile, "utf-8").trim()) {
        return {
          email: null,
          name: "Claude (signed in)",
          planType: "oauth",
          organizations: [],
          subscriptionActiveUntil: null,
          authMode: "oauth",
        };
      }
    } catch {
      /* no token yet */
    }
  }
  return null;
}

export type CodexRateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number | null;
};

export type CodexRateLimits = {
  planType: string | null;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  credits: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: string;
  } | null;
  rateLimitReachedType: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function readRateLimits(_timeoutMs = 5000): Promise<CodexRateLimits | null> {
  return null;
}

export function runLogout(): boolean {
  return false;
}
