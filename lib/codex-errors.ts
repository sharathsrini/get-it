/**
 * Pure error model for Claude/Anthropic calls — classification + presentation,
 * with no dependency on the Anthropic SDK or the runtime health mailbox. Kept
 * separate from `codex.ts` so this (deterministic, side-effect-free) logic can
 * be unit-tested in isolation. `codex.ts` re-exports everything here, so
 * callers keep importing from `@/lib/codex`.
 */

/**
 * Error kinds that we want the UI to react to differently. Anything not
 * one of these stays `generic`; the calling code can still surface the
 * raw message but the banner won't claim a rate-limit when there isn't one.
 */
export type CodexErrorKind =
  | "auth_lost" // ANTHROPIC_API_KEY missing, invalid, or revoked
  | "rate_limit" // hit Anthropic's rate limit
  | "binary_missing" // kept for backward compat with stored work-context; never emitted
  | "model_unsupported" // the pinned model is unavailable → update the app
  | "generic";

export class CodexError extends Error {
  readonly kind: CodexErrorKind;
  /**
   * If `kind === "rate_limit"` and the model gave us a deadline,
   * `retryAt` is a unix-ms timestamp the UI can count down to. Optional;
   * the wrapper falls back to a phrased message when no deadline is
   * available.
   */
  readonly retryAt?: number;
  /**
   * Coarse window the rate limit belongs to, when the message tells us.
   * "5h" or "weekly" — the same labels the codex TUI uses. Falls back to
   * "unknown" if we can't tell.
   */
  readonly window?: "5h" | "weekly" | "unknown";

  constructor(
    kind: CodexErrorKind,
    message: string,
    extras?: { retryAt?: number; window?: "5h" | "weekly" | "unknown" },
  ) {
    super(message);
    this.name = "CodexError";
    this.kind = kind;
    this.retryAt = extras?.retryAt;
    this.window = extras?.window;
  }
}

const RX_RATE_LIMIT =
  /(rate.?limit|usage limit|too many requests|429|quota|you've hit|you have hit)/i;
const RX_TRY_AGAIN_SECONDS = /try again in\s*(\d+(?:\.\d+)?)\s*(s|ms|seconds?)/i;
const RX_TRY_AGAIN_MIN = /try again in\s*(\d+(?:\.\d+)?)\s*(m|mins?|minutes?)/i;
const RX_TRY_AGAIN_HOUR = /try again in\s*(\d+(?:\.\d+)?)\s*(h|hrs?|hours?)/i;
const RX_AUTH = /(not logged in|please.*log ?in|unauthori[sz]ed|401|invalid api key|invalid x-api-key|token (?:has )?expired|sign in|api_key)/i;
const RX_BINARY = /(unable to locate codex|cannot find module|enoent.*codex|codex.*not found|spawn .* enoent)/i;
const RX_MODEL_UNSUPPORTED =
  /model is not supported|model_not_found|(?:unknown|unsupported|deprecated|retired) model|model.{0,20}(?:is )?(?:no longer|not) (?:available|supported)/i;
const RX_WEEKLY = /\bweekly\b/i;
const RX_FIVE_H = /\b(5\s*h|5\s*hour|five hour)\b/i;

/**
 * Fallback cooldown applied to a rate-limit error whose message carries no
 * parseable "try again in X" deadline (common for ChatGPT-account quota
 * messages). Without a deadline the old code left `retryAt` undefined, which
 * meant `preflightHealth` never short-circuited and a background queue would
 * keep firing calls back-to-back — each one re-hitting the limit — in a tight
 * loop. Giving every rate-limit a concrete (if conservative) deadline makes
 * the short-circuit and the banner countdown always work; the user can retry
 * once it elapses. We never auto-resume — retries are always user-initiated.
 */
export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;

export function classifyCodexError(err: unknown): CodexError {
  if (err instanceof CodexError) return err;
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Claude call failed";

  if (RX_BINARY.test(msg)) {
    return new CodexError("binary_missing", msg);
  }

  if (RX_AUTH.test(msg)) {
    return new CodexError("auth_lost", msg);
  }

  if (RX_MODEL_UNSUPPORTED.test(msg)) {
    // Preserve the original detail (which model the server refused) so logs
    // stay diagnosable; the banner shows its own user-facing copy by kind.
    return new CodexError("model_unsupported", msg);
  }

  if (RX_RATE_LIMIT.test(msg)) {
    let retryAt: number | undefined;
    const sec = RX_TRY_AGAIN_SECONDS.exec(msg);
    const min = RX_TRY_AGAIN_MIN.exec(msg);
    const hr = RX_TRY_AGAIN_HOUR.exec(msg);
    if (sec) {
      const unit = sec[2].toLowerCase();
      const value = Number(sec[1]);
      const ms = unit.startsWith("ms") ? value : value * 1000;
      retryAt = Date.now() + ms;
    } else if (min) {
      retryAt = Date.now() + Number(min[1]) * 60_000;
    } else if (hr) {
      retryAt = Date.now() + Number(hr[1]) * 3_600_000;
    } else {
      // No deadline in the message — apply the fallback cooldown so the
      // health mailbox can short-circuit subsequent calls instead of
      // letting a queue hammer the API in a loop.
      retryAt = Date.now() + DEFAULT_RATE_LIMIT_COOLDOWN_MS;
    }
    const window: "5h" | "weekly" | "unknown" = RX_WEEKLY.test(msg)
      ? "weekly"
      : RX_FIVE_H.test(msg)
        ? "5h"
        : "unknown";
    return new CodexError("rate_limit", msg, { retryAt, window });
  }

  return new CodexError("generic", msg);
}

/**
 * Map any thrown error into a stable `{ kind, message }` payload for an API
 * JSON response, so a request/response surface (flashcards, quiz, Feynman, …)
 * can return a friendly reason and the error `kind` instead of an opaque 500.
 * The client renders this inline next to a manual Retry button; the top-bar
 * health banner carries the same account-level reason in parallel.
 */
export function toCodexErrorPayload(err: unknown): {
  kind: CodexErrorKind;
  message: string;
} {
  const e = err instanceof CodexError ? err : classifyCodexError(err);
  const friendly: Record<CodexErrorKind, string> = {
    rate_limit:
      "Claude rate limit reached — see the notice at the top. Try again once it clears.",
    auth_lost:
      "Claude API key missing or invalid. Set ANTHROPIC_API_KEY and restart, then try again.",
    binary_missing:
      "The AI engine isn't available. Check your configuration and try again.",
    model_unsupported:
      "This version of Get It uses a Claude model that's no longer available. Download the latest Get It to fix this.",
    generic: "Something went wrong talking to Claude. Please try again.",
  };
  return { kind: e.kind, message: friendly[e.kind] };
}
