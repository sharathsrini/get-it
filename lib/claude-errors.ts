/**
 * Claude error classification.
 *
 * Maps errors thrown by the Claude CLI subprocess into the SAME shared error
 * model the rest of the app already understands (CodexError + CodexErrorKind),
 * so the health banner, fail-fast preflight, and inline retry buttons behave
 * identically whichever provider is active.
 *
 * Anthropic-specific surface this catches that the Codex classifier doesn't:
 *   • the `claude` binary being missing (spawn ENOENT on a different name),
 *   • OAuth / subscription auth being absent or expired,
 *   • Claude's "5-hour" subscription usage window wording.
 *
 * Anything that doesn't match a known shape falls through to the generic
 * Codex classifier so we still surface a useful raw message.
 */

import {
  CodexError,
  classifyCodexError,
  DEFAULT_RATE_LIMIT_COOLDOWN_MS,
} from "./codex-errors";

const RX_CLAUDE_BINARY =
  /(unable to locate claude|cannot find module|enoent.*claude|claude.*not found|spawn .*claude.* enoent|claude code is not installed)/i;
const RX_CLAUDE_AUTH =
  /(not logged in|please.*log ?in|unauthori[sz]ed|401|invalid api key|oauth.*(expired|invalid|revoked)|token (?:has )?expired|sign in|run .*claude.* login|no credentials|credentials? (?:not found|missing))/i;
const RX_CLAUDE_RATE_LIMIT =
  /(rate.?limit|usage limit|too many requests|429|quota|you've hit|you have hit|overloaded|capacity)/i;
const RX_TRY_AGAIN_SECONDS = /(?:try again|retry) in\s*(\d+(?:\.\d+)?)\s*(s|ms|seconds?)/i;
const RX_TRY_AGAIN_MIN = /(?:try again|retry) in\s*(\d+(?:\.\d+)?)\s*(m|mins?|minutes?)/i;
const RX_TRY_AGAIN_HOUR = /(?:try again|retry) in\s*(\d+(?:\.\d+)?)\s*(h|hrs?|hours?)/i;
const RX_WEEKLY = /\bweekly\b/i;
const RX_FIVE_H = /\b(5\s*h|5\s*hour|five hour)\b/i;
// Claude rejects an unknown/unavailable model name with a 404 "model: ..."
const RX_MODEL_UNSUPPORTED =
  /model.{0,30}(?:not found|does not exist|is not (?:available|supported)|unsupported|deprecated)|not_found_error.*model/i;

export function classifyClaudeError(err: unknown): CodexError {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Claude call failed";

  if (RX_CLAUDE_BINARY.test(msg)) {
    return new CodexError("binary_missing", msg);
  }
  if (RX_CLAUDE_AUTH.test(msg)) {
    return new CodexError("auth_lost", msg);
  }
  if (RX_MODEL_UNSUPPORTED.test(msg)) {
    return new CodexError("model_unsupported", msg);
  }
  if (RX_CLAUDE_RATE_LIMIT.test(msg)) {
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
      retryAt = Date.now() + DEFAULT_RATE_LIMIT_COOLDOWN_MS;
    }
    const window: "5h" | "weekly" | "unknown" = RX_WEEKLY.test(msg)
      ? "weekly"
      : RX_FIVE_H.test(msg)
        ? "5h"
        : "unknown";
    return new CodexError("rate_limit", msg, { retryAt, window });
  }

  // Fall back to the shared classifier for anything else (covers generic
  // network/parse failures with a sensible default kind).
  return classifyCodexError(err);
}
