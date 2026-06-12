/**
 * Thin wrapper around @anthropic-ai/sdk that gives us:
 *   - lazily-initialized singleton (API key from ANTHROPIC_API_KEY env var)
 *   - a `runJson` helper that runs a one-shot prompt and returns parsed JSON,
 *     with retry-on-parse-failure
 *   - thread-like multi-turn support for chat via serialized message history
 *     encoded in the threadId string
 *   - structured CodexError classification (auth lost vs rate-limit vs
 *     generic). Every agent call funnels through here so the rest of the
 *     app gets a single, stable shape to display.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources";
import { CodexError, classifyCodexError } from "./codex-errors";
import type { CodexErrorKind } from "./codex-errors";

// Pure error model + presentation live in codex-errors.ts (no SDK dependency,
// so they're unit-testable). Re-export them here so callers keep importing
// the whole surface from "@/lib/codex".
export {
  CodexError,
  classifyCodexError,
  toCodexErrorPayload,
} from "./codex-errors";
export type { CodexErrorKind } from "./codex-errors";

/** The Claude model every generative call runs on, pinned explicitly. */
export const CODEX_MODEL = "claude-opus-4-8";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  _client = new Anthropic();
  return _client;
}

export type RunOptions = {
  /** Reasoning depth: "low" = no extended thinking, "medium"/"high" = adaptive thinking. */
  reasoning?: "low" | "medium" | "high";
  /** AbortSignal forwarded to the underlying HTTP request. */
  signal?: AbortSignal;
  /** Kept for API compatibility; web search is not available via Claude API. */
  webSearch?: boolean;
  /** Kept for API compatibility; ignored. */
  threadOverrides?: Record<string, unknown>;
};

/** Extract only text blocks from a Claude response (thinking blocks are skipped). */
function extractText(response: Anthropic.Message): string {
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text) throw new Error("Empty response from Claude");
  return text;
}

/** Strip markdown code fences the model sometimes wraps JSON in, then parse. */
function parseTurnJson<T>(text: string): T {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty response from Claude");
  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}

function buildRequestParams(
  messages: MessageParam[],
  opts: RunOptions,
): Anthropic.MessageCreateParamsNonStreaming {
  const useThinking = (opts.reasoning ?? "low") !== "low";
  return {
    model: CODEX_MODEL,
    max_tokens: useThinking ? 16384 : 8192,
    ...(useThinking ? { thinking: { type: "adaptive" as const } } : {}),
    messages,
  };
}

/** Classify an error into a CodexError, handling Anthropic SDK typed errors first. */
function classifyError(err: unknown): CodexError {
  if (err instanceof CodexError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new CodexError("auth_lost", err.message);
  }
  if (err instanceof Anthropic.RateLimitError) {
    const headers = err.headers as unknown as Record<string, string> | undefined;
    const retryAfter = headers?.["retry-after"];
    const ms = retryAfter ? parseFloat(retryAfter) * 1000 : 60_000;
    return new CodexError("rate_limit", err.message, {
      retryAt: Date.now() + (isNaN(ms) ? 60_000 : ms),
      window: "unknown",
    });
  }
  if (err instanceof Anthropic.BadRequestError && /model/i.test(err.message)) {
    return new CodexError("model_unsupported", err.message);
  }
  return classifyCodexError(err);
}

// ── Health mailbox ──────────────────────────────────────────────────────
// Process-local snapshot of the most recent error. The UI polls
// /api/codex/health to render a banner with a countdown + reconnect
// button. We also short-circuit calls while a rate limit is still active.
export type CodexHealth = {
  ok: boolean;
  kind: CodexErrorKind | null;
  message: string | null;
  retryAt: number | null;
  window: "5h" | "weekly" | "unknown" | null;
  /** Monotone counter — UI uses this to detect "a new error came in". */
  serial: number;
  /** Last successful Claude call timestamp (epoch ms). */
  lastOkAt: number | null;
};

declare global {
  var __getitCodexHealth: CodexHealth | undefined;
}

const _initialHealth: CodexHealth = {
  ok: true,
  kind: null,
  message: null,
  retryAt: null,
  window: null,
  serial: 0,
  lastOkAt: null,
};

const health: CodexHealth =
  globalThis.__getitCodexHealth ??
  (globalThis.__getitCodexHealth = { ..._initialHealth });

export function getCodexHealth(): CodexHealth {
  if (
    health.kind === "rate_limit" &&
    health.retryAt != null &&
    Date.now() >= health.retryAt
  ) {
    Object.assign(health, _initialHealth, { serial: health.serial });
  }
  return { ...health };
}

function markOk() {
  if (!health.ok) {
    Object.assign(health, _initialHealth, { serial: health.serial + 1 });
  }
  health.lastOkAt = Date.now();
  health.ok = true;
}

function markError(err: CodexError) {
  health.ok = false;
  health.kind = err.kind;
  health.message = err.message;
  health.retryAt = err.retryAt ?? null;
  health.window = err.window ?? null;
  health.serial += 1;
}

function preflightHealth(): CodexError | null {
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

/**
 * Run a single turn that must return JSON. Retries once if the model returns
 * un-parseable text. Throws CodexError on failure so callers can
 * pattern-match on `.kind`.
 *
 * The `outputSchema` parameter is preserved for API compatibility — callers
 * already embed "Output JSON" instructions in their prompts, so Claude
 * complies without a server-enforced schema constraint.
 */
export async function runJson<T>(
  prompt: string,
  _outputSchema: object,
  opts: RunOptions = {},
): Promise<{ data: T; usage: unknown }> {
  const preflight = preflightHealth();
  if (preflight) throw preflight;

  const messages: MessageParam[] = [{ role: "user", content: prompt }];

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await getClient().messages.create(
        buildRequestParams(messages, opts),
        { signal: opts.signal },
      );
      const text = extractText(response);
      const parsed = parseTurnJson<T>(text);
      markOk();
      return { data: parsed, usage: response.usage };
    } catch (err) {
      lastErr = err;
      const classified = classifyError(err);
      if (classified.kind !== "generic") {
        markError(classified);
        throw classified;
      }
    }
  }
  const finalErr = classifyError(lastErr);
  if (finalErr.kind !== "generic") markError(finalErr);
  throw finalErr;
}

/**
 * Multi-turn JSON runner for chat.
 *
 * Since the Anthropic API is stateless, conversation history is encoded as a
 * base64 JSON message list in the threadId. On `start`, a new conversation is
 * opened; on `resume`, the prior messages are decoded and the new turn
 * appended before sending.
 *
 * Old Codex thread IDs (UUIDs) will fail to decode as base64 JSON and throw a
 * generic error, causing the chat route's fallback to the full-context `start`
 * path, which handles the transition transparently.
 */
export async function runJsonInThread<T>(args: {
  outputSchema: object;
  opts?: RunOptions;
  resume?: { threadId: string; input: string };
  start?: { input: string };
}): Promise<{ data: T; usage: unknown; threadId: string | null }> {
  const preflight = preflightHealth();
  if (preflight) throw preflight;
  const opts = args.opts ?? {};

  if (args.resume) {
    let priorMessages: MessageParam[];
    try {
      priorMessages = JSON.parse(
        Buffer.from(args.resume.threadId, "base64").toString("utf-8"),
      ) as MessageParam[];
      if (!Array.isArray(priorMessages)) throw new Error("not an array");
    } catch {
      throw new CodexError("generic", "thread state unreadable; rebuild required");
    }
    const messages: MessageParam[] = [
      ...priorMessages,
      { role: "user", content: args.resume.input },
    ];
    try {
      const response = await getClient().messages.create(
        buildRequestParams(messages, opts),
        { signal: opts.signal },
      );
      const text = extractText(response);
      const parsed = parseTurnJson<T>(text);
      markOk();
      const updated: MessageParam[] = [...messages, { role: "assistant", content: text }];
      return {
        data: parsed,
        usage: response.usage,
        threadId: Buffer.from(JSON.stringify(updated)).toString("base64"),
      };
    } catch (err) {
      const classified = classifyError(err);
      if (classified.kind !== "generic") markError(classified);
      throw classified;
    }
  }

  if (!args.start) throw new Error("runJsonInThread: provide `start` or `resume`");

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages: MessageParam[] = [{ role: "user", content: args.start.input }];
    try {
      const response = await getClient().messages.create(
        buildRequestParams(messages, opts),
        { signal: opts.signal },
      );
      const text = extractText(response);
      const parsed = parseTurnJson<T>(text);
      markOk();
      const updated: MessageParam[] = [...messages, { role: "assistant", content: text }];
      return {
        data: parsed,
        usage: response.usage,
        threadId: Buffer.from(JSON.stringify(updated)).toString("base64"),
      };
    } catch (err) {
      lastErr = err;
      const classified = classifyError(err);
      if (classified.kind !== "generic") {
        markError(classified);
        throw classified;
      }
    }
  }
  const finalErr = classifyError(lastErr);
  if (finalErr.kind !== "generic") markError(finalErr);
  throw finalErr;
}
