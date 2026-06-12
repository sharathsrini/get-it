/**
 * Provider-neutral AI interface.
 *
 * Every generative agent in the app needs exactly two operations:
 *   • a one-shot JSON run against an output schema (detection, viz, kg,
 *     flashcards, quizzes, feynman), and
 *   • a thread-aware JSON run (start a new thread, or resume an existing one)
 *     for multi-turn chat.
 *
 * Both the OpenAI Codex provider and the Anthropic Claude provider implement
 * this interface; the active one is chosen at runtime from the persisted
 * settings (see lib/ai/index.ts). The return shapes mirror the original
 * lib/codex.ts signatures so callers were able to switch import paths without
 * touching their call sites.
 */

/** Identifier persisted in settings and reported to the wizard. */
export type AiProviderId = "codex" | "claude";

export type AiRunOptions = {
  /** Defaults to "low" — fastest answer-only setting. */
  reasoning?: "low" | "medium" | "high";
  /** Allow live web search for this call (e.g. legal citations). */
  webSearch?: boolean;
  /** AbortSignal forwarded to the underlying child process / SDK call. */
  signal?: AbortSignal;
};

export type RunJsonResult<T> = { data: T; usage: unknown };

export type RunJsonInThreadArgs = {
  outputSchema: object;
  opts?: AiRunOptions;
  /** Continue an existing thread by id, sending only the new turn input. */
  resume?: { threadId: string; input: string };
  /** Open a new thread and send the full first-turn prompt. */
  start?: { input: string };
};

export type RunJsonInThreadResult<T> = {
  data: T;
  usage: unknown;
  threadId: string | null;
};

export interface AiProvider {
  readonly id: AiProviderId;

  /**
   * Run a single turn that must return JSON conforming to `outputSchema`.
   * Retries once on an un-parseable response. Throws CodexError on failure so
   * callers can pattern-match on `.kind`.
   */
  runJson<T>(
    prompt: string,
    outputSchema: object,
    opts?: AiRunOptions,
  ): Promise<RunJsonResult<T>>;

  /**
   * Thread-aware JSON runner for multi-turn tools (chat). Exactly one of
   * `start` / `resume` must be supplied.
   */
  runJsonInThread<T>(
    args: RunJsonInThreadArgs,
  ): Promise<RunJsonInThreadResult<T>>;
}
