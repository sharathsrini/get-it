/**
 * Codex implementation of the AiProvider interface.
 *
 * Thin adapter over lib/codex.ts (the OpenAI binding). All the heavy lifting —
 * SDK wrapper, retry-on-parse, error classification, health reporting — already
 * lives there; this just maps the provider-neutral signatures onto it.
 */

import { runJson, runJsonInThread } from "../codex";
import type {
  AiProvider,
  AiRunOptions,
  RunJsonInThreadArgs,
  RunJsonInThreadResult,
  RunJsonResult,
} from "./provider";

export const codexProvider: AiProvider = {
  id: "codex",

  runJson<T>(
    prompt: string,
    outputSchema: object,
    opts?: AiRunOptions,
  ): Promise<RunJsonResult<T>> {
    return runJson<T>(prompt, outputSchema, opts);
  },

  runJsonInThread<T>(
    args: RunJsonInThreadArgs,
  ): Promise<RunJsonInThreadResult<T>> {
    return runJsonInThread<T>(args);
  },
};
