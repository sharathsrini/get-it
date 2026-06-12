/**
 * Thin wrapper around @openai/codex-sdk that gives us:
 *   - lazily-initialized singleton
 *   - sane defaults for "answer-only" mode (read-only sandbox, no approvals,
 *     web search off by default)
 *   - a `runJson` helper that runs a one-shot turn against an output-schema
 *     and returns the parsed JSON, with retry-on-parse-failure
 *   - structured CodexError classification (auth lost vs rate-limit vs
 *     generic). Every agent call funnels through here, so the rest of the
 *     app gets a single, stable shape to display.
 *
 * Note on the Codex binary: in packaged Electron builds the main process
 * resolves the bundled binary and exposes its absolute path through
 * CODEX_BINARY_PATH. Passing that path to the SDK avoids fragile
 * node_modules lookup from the standalone Next server.
 */

import { Codex } from "@openai/codex-sdk";
import type { ThreadOptions } from "@openai/codex-sdk";
import { CODEX_SCRATCH_DIR } from "./paths";
import { CodexError, classifyCodexError } from "./codex-errors";
import {
  getAiHealth,
  markOk,
  markError,
  preflightHealth,
  type AiHealth,
} from "./ai/health";
import { parseModelJson } from "./ai/json";

// Pure error model + presentation live in codex-errors.ts (no SDK dependency,
// so they're unit-testable). Re-export them here so callers keep importing
// the whole Codex surface from "@/lib/codex".
export {
  CodexError,
  classifyCodexError,
  toCodexErrorPayload,
} from "./codex-errors";
export type { CodexErrorKind } from "./codex-errors";

/**
 * The model every generative call runs on, pinned explicitly.
 *
 * Why pin it: the SDK only passes `--model` to the codex binary when we set
 * this option. If we leave it unset, the binary resolves the model itself —
 * first from the user's personal `~/.codex/config.toml`, then from a default
 * baked into the bundled binary. That bundled default is a now-retired model
 * (`gpt-5.3-codex`), which OpenAI rejects for ChatGPT-account auth with a 400
 * ("model is not supported when using Codex with a ChatGPT account"). It only
 * appeared to work for developers because their local `config.toml` happened
 * to override the default with a current model; users with a clean `~/.codex`
 * fell through to the dead default. Pinning here makes every install — across
 * OS, arch, and environment — deterministically use the same supported model,
 * independent of the binary's default and of any local config.
 *
 * Keep this current with the models available to ChatGPT-account auth. When
 * OpenAI retires it, ship an app update bumping this value (the in-app
 * "model unsupported" banner tells users exactly that).
 */
export const CODEX_MODEL = "gpt-5.5";

let _codex: Codex | null = null;

function getCodex(): Codex {
  if (_codex) return _codex;
  const codexPathOverride = process.env.CODEX_BINARY_PATH;
  _codex = new Codex({
    ...(codexPathOverride ? { codexPathOverride } : {}),
    config: {
      // disable image generation so we can use 'low' reasoning; the demo is
      // text-only so there is nothing to lose.
      tools: { image_gen: false },
    },
  });
  return _codex;
}

export type RunOptions = {
  /** Defaults to "low" — fastest answer-only model setting that allows tools=image_gen=false. */
  reasoning?: "low" | "medium" | "high";
  /** Allow live web search for this call (e.g. legal citations). */
  webSearch?: boolean;
  /** AbortSignal forwarded to the underlying child process. */
  signal?: AbortSignal;
  /** Override default thread options. */
  threadOverrides?: Partial<ThreadOptions>;
};

function threadOptions(opts: RunOptions = {}): ThreadOptions {
  return {
    model: CODEX_MODEL,
    sandboxMode: "read-only",
    approvalPolicy: "never",
    skipGitRepoCheck: true,
    workingDirectory: CODEX_SCRATCH_DIR,
    modelReasoningEffort: opts.reasoning ?? "low",
    webSearchEnabled: opts.webSearch ?? false,
    ...(opts.threadOverrides ?? {}),
  };
}

function buildThread(opts: RunOptions = {}) {
  return getCodex().startThread(threadOptions(opts));
}

/** Strip markdown code fences the model sometimes wraps JSON in, then parse. */
function parseTurnJson<T>(finalResponse: string | undefined): T {
  return parseModelJson<T>(finalResponse);
}

// ── Health mailbox ──────────────────────────────────────────────────────
// The health mailbox is provider-neutral and lives in lib/ai/health.ts so
// both the Codex and Claude providers report into the same snapshot. We keep
// the legacy `CodexHealth` type alias and `getCodexHealth` export here so
// existing callers (e.g. /api/codex/health) keep working unchanged.
export type CodexHealth = AiHealth;

export function getCodexHealth(): CodexHealth {
  return getAiHealth();
}

/**
 * Run a single turn that must return JSON conforming to the supplied schema.
 * Retries once if the model returns un-parseable text. Throws CodexError on
 * failure so callers can pattern-match on `.kind`.
 */
export async function runJson<T>(
  prompt: string,
  outputSchema: object,
  opts: RunOptions = {},
): Promise<{ data: T; usage: unknown }> {
  // Short-circuit: if we know we're inside a rate-limit window, fail fast
  // without burning another Codex call.
  const preflight = preflightHealth();
  if (preflight) throw preflight;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const thread = buildThread(opts);
    try {
      const turn = await thread.run(prompt, {
        outputSchema,
        signal: opts.signal,
      });
      const parsed = parseTurnJson<T>(turn.finalResponse);
      markOk();
      return { data: parsed, usage: turn.usage };
    } catch (err) {
      lastErr = err;
      const classified = classifyCodexError(err);
      // Auth/rate-limit/binary failures: don't bother retrying — the
      // condition isn't going to clear in 200ms. Bubble up immediately so
      // the in-app banner can take over.
      if (classified.kind !== "generic") {
        markError(classified);
        throw classified;
      }
    }
  }
  const finalErr = classifyCodexError(lastErr);
  if (finalErr.kind !== "generic") markError(finalErr);
  throw finalErr;
}

/**
 * Thread-aware JSON runner for multi-turn tools (chat).
 *
 * Two modes, exactly one of which must be supplied:
 *   • start  — open a NEW thread and send the full first-turn prompt (system
 *              + document + history). Returns the new `threadId` to persist.
 *              Retries once on a parse blip, like runJson.
 *   • resume — continue an EXISTING thread by `threadId`, sending only the new
 *              turn input. The model still has the document + prior turns in
 *              its own context, so we don't resend them (and the stable prefix
 *              is a guaranteed cache hit). No internal retry: on any generic
 *              failure (including a lost/expired session) the caller falls
 *              back to `start` with full context, so a resume never silently
 *              degrades the answer.
 *
 * Rate-limit / auth / binary errors are classified and thrown immediately in
 * both modes so the health banner takes over.
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
    const thread = getCodex().resumeThread(args.resume.threadId, threadOptions(opts));
    try {
      const turn = await thread.run(args.resume.input, {
        outputSchema: args.outputSchema,
        signal: opts.signal,
      });
      const parsed = parseTurnJson<T>(turn.finalResponse);
      markOk();
      return { data: parsed, usage: turn.usage, threadId: thread.id ?? args.resume.threadId };
    } catch (err) {
      const classified = classifyCodexError(err);
      if (classified.kind !== "generic") markError(classified);
      throw classified;
    }
  }

  if (!args.start) throw new Error("runJsonInThread: provide `start` or `resume`");

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const thread = buildThread(opts);
    try {
      const turn = await thread.run(args.start.input, {
        outputSchema: args.outputSchema,
        signal: opts.signal,
      });
      const parsed = parseTurnJson<T>(turn.finalResponse);
      markOk();
      return { data: parsed, usage: turn.usage, threadId: thread.id };
    } catch (err) {
      lastErr = err;
      const classified = classifyCodexError(err);
      if (classified.kind !== "generic") {
        markError(classified);
        throw classified;
      }
    }
  }
  const finalErr = classifyCodexError(lastErr);
  if (finalErr.kind !== "generic") markError(finalErr);
  throw finalErr;
}
