/**
 * Active-provider selector + the convenience surface agents import.
 *
 * Agents and API routes used to import `runJson` / `runJsonInThread` straight
 * from "@/lib/codex". They now import from "@/lib/ai" instead: same signatures,
 * but the call is dispatched to whichever provider the user picked (persisted
 * in settings, defaulting to Codex). This keeps the per-call-site churn to a
 * single import-path change.
 *
 * The provider is resolved fresh on every call so switching it from the
 * Settings popover takes effect immediately, with no server restart.
 */

import { loadSettings } from "../settings-store";
import { codexProvider } from "./codex-provider";
import { claudeProvider } from "./claude-provider";
import type {
  AiProvider,
  AiProviderId,
  AiRunOptions,
  RunJsonInThreadArgs,
  RunJsonInThreadResult,
  RunJsonResult,
} from "./provider";

export type {
  AiProvider,
  AiProviderId,
  AiRunOptions,
  RunJsonInThreadArgs,
  RunJsonInThreadResult,
  RunJsonResult,
} from "./provider";

// Health + error model, re-exported so callers get the whole AI surface from
// one module (provider-neutral names, with the legacy ones kept for callers
// that still import them).
export { getAiHealth, type AiHealth } from "./health";
export {
  CodexError,
  classifyCodexError,
  toCodexErrorPayload,
} from "../codex-errors";
export type { CodexErrorKind } from "../codex-errors";

const PROVIDERS: Record<AiProviderId, AiProvider> = {
  codex: codexProvider,
  claude: claudeProvider,
};

/** The active provider id from persisted settings (defaults to codex). */
export function getActiveProviderId(): AiProviderId {
  try {
    return loadSettings().aiProvider;
  } catch {
    return "codex";
  }
}

export function getProvider(): AiProvider {
  return PROVIDERS[getActiveProviderId()] ?? codexProvider;
}

export function runJson<T>(
  prompt: string,
  outputSchema: object,
  opts?: AiRunOptions,
): Promise<RunJsonResult<T>> {
  return getProvider().runJson<T>(prompt, outputSchema, opts);
}

export function runJsonInThread<T>(
  args: RunJsonInThreadArgs,
): Promise<RunJsonInThreadResult<T>> {
  return getProvider().runJsonInThread<T>(args);
}
