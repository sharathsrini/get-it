/**
 * Provider-neutral AI health mailbox.
 *
 * Process-local snapshot of the most recent AI error, shared across BOTH the
 * Codex and Claude providers so the existing in-app banner (a countdown +
 * reconnect button, polled via /api/codex/health) works identically whichever
 * backend is active. It also lets a provider short-circuit calls while a
 * rate-limit window is still open — no point hammering the API.
 *
 * This was previously baked into lib/codex.ts; it was lifted out here so the
 * second provider (Claude) reports into the same mailbox. lib/codex.ts keeps a
 * `getCodexHealth` alias for back-compat.
 */

import { CodexError } from "../codex-errors";
import type { CodexErrorKind } from "../codex-errors";

/** Re-export under provider-neutral names; the underlying model is shared. */
export type AiErrorKind = CodexErrorKind;
export { CodexError as AiError };

export type AiHealth = {
  ok: boolean;
  kind: AiErrorKind | null;
  message: string | null;
  retryAt: number | null;
  window: "5h" | "weekly" | "unknown" | null;
  /** Monotone counter — UI uses this to detect "a new error came in" vs
   *  "still the same one I'm already showing". */
  serial: number;
  /** Last successful AI call timestamp (epoch ms). */
  lastOkAt: number | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __getitAiHealth: AiHealth | undefined;
}

const _initialHealth: AiHealth = {
  ok: true,
  kind: null,
  message: null,
  retryAt: null,
  window: null,
  serial: 0,
  lastOkAt: null,
};

const health: AiHealth =
  globalThis.__getitAiHealth ??
  (globalThis.__getitAiHealth = { ..._initialHealth });

export function getAiHealth(): AiHealth {
  // If a rate-limit retry deadline has passed, auto-clear so the UI
  // stops showing the banner without a server round-trip.
  if (
    health.kind === "rate_limit" &&
    health.retryAt != null &&
    Date.now() >= health.retryAt
  ) {
    Object.assign(health, _initialHealth, { serial: health.serial });
  }
  return { ...health };
}

export function markOk(): void {
  if (!health.ok) {
    Object.assign(health, _initialHealth, { serial: health.serial + 1 });
  }
  health.lastOkAt = Date.now();
  health.ok = true;
}

export function markError(err: CodexError): void {
  health.ok = false;
  health.kind = err.kind;
  health.message = err.message;
  health.retryAt = err.retryAt ?? null;
  health.window = err.window ?? null;
  health.serial += 1;
}

/**
 * If we know we're inside an active rate-limit window, return a CodexError so
 * the caller can fail fast without burning another AI call. Otherwise null.
 */
export function preflightHealth(): CodexError | null {
  if (
    health.kind === "rate_limit" &&
    health.retryAt != null &&
    Date.now() < health.retryAt
  ) {
    return new CodexError("rate_limit", health.message ?? "Rate limit active", {
      retryAt: health.retryAt,
      window: health.window ?? "unknown",
    });
  }
  return null;
}
