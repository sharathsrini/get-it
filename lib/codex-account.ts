/**
 * Claude/Anthropic account information helpers.
 *
 *   readAccountInfo(): checks whether ANTHROPIC_API_KEY is set and returns
 *     a minimal info object. No network call.
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

export type CodexAccountInfo = {
  email: string | null;
  name: string | null;
  planType: string | null;
  organizations: Array<{ id: string; title: string; role: string }>;
  subscriptionActiveUntil: string | null;
  authMode: string | null;
};

export function readAccountInfo(): CodexAccountInfo | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return {
    email: null,
    name: "Anthropic API",
    planType: "api_key",
    organizations: [],
    subscriptionActiveUntil: null,
    authMode: "api_key",
  };
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
