/**
 * Claude implementation of the AiProvider interface.
 *
 * The Codex SDK enforces an output schema natively; the Claude CLI does not, so
 * we reproduce that contract by (a) prepending a strict-JSON system instruction
 * carrying the JSON Schema and (b) reusing the shared fence-stripping parser
 * with a single retry — exactly the retry-on-parse-blip behaviour lib/codex.ts
 * has. Errors are classified into the shared model and reported into the shared
 * health mailbox so the in-app banner works unchanged.
 */

import { runClaudePrint } from "../claude";
import { classifyClaudeError } from "../claude-errors";
import { parseModelJson } from "./json";
import { markError, markOk, preflightHealth } from "./health";
import type {
  AiProvider,
  AiRunOptions,
  RunJsonInThreadArgs,
  RunJsonInThreadResult,
  RunJsonResult,
} from "./provider";

/**
 * Wrap a prompt with an instruction to answer with ONE JSON object conforming
 * to the schema and nothing else. Kept as a constant prefix + schema so the
 * stable part stays cacheable, mirroring how the agents structure their own
 * prompts.
 */
function withSchemaInstruction(prompt: string, outputSchema: object): string {
  return `${prompt}

────────────────────────────────────────
OUTPUT CONTRACT (STRICT)
Respond with EXACTLY ONE JSON object and nothing else — no prose, no
explanation, no markdown code fence. The object MUST validate against this
JSON Schema:

${JSON.stringify(outputSchema)}`;
}

async function runOnce<T>(
  input: string,
  outputSchema: object,
  opts: AiRunOptions | undefined,
  resumeSessionId: string | undefined,
): Promise<{ data: T; usage: unknown; sessionId: string | null }> {
  const res = await runClaudePrint({
    prompt: resumeSessionId ? input : withSchemaInstruction(input, outputSchema),
    resumeSessionId,
    webSearch: opts?.webSearch ?? false,
    signal: opts?.signal,
  });
  const data = parseModelJson<T>(res.text);
  return { data, usage: res.usage, sessionId: res.sessionId };
}

export const claudeProvider: AiProvider = {
  id: "claude",

  async runJson<T>(
    prompt: string,
    outputSchema: object,
    opts?: AiRunOptions,
  ): Promise<RunJsonResult<T>> {
    const preflight = preflightHealth();
    if (preflight) throw preflight;

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data, usage } = await runOnce<T>(
          prompt,
          outputSchema,
          opts,
          undefined,
        );
        markOk();
        return { data, usage };
      } catch (err) {
        lastErr = err;
        const classified = classifyClaudeError(err);
        // Auth / rate-limit / binary / model failures won't clear on an
        // immediate retry — bubble up so the banner takes over.
        if (classified.kind !== "generic") {
          markError(classified);
          throw classified;
        }
        // generic (often a parse blip): loop once more.
      }
    }
    const finalErr = classifyClaudeError(lastErr);
    if (finalErr.kind !== "generic") markError(finalErr);
    throw finalErr;
  },

  async runJsonInThread<T>(
    args: RunJsonInThreadArgs,
  ): Promise<RunJsonInThreadResult<T>> {
    const preflight = preflightHealth();
    if (preflight) throw preflight;
    const opts = args.opts;

    if (args.resume) {
      try {
        const { data, usage, sessionId } = await runOnce<T>(
          args.resume.input,
          args.outputSchema,
          opts,
          args.resume.threadId,
        );
        markOk();
        return { data, usage, threadId: sessionId ?? args.resume.threadId };
      } catch (err) {
        const classified = classifyClaudeError(err);
        if (classified.kind !== "generic") markError(classified);
        throw classified;
      }
    }

    if (!args.start) {
      throw new Error("runJsonInThread: provide `start` or `resume`");
    }

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data, usage, sessionId } = await runOnce<T>(
          args.start.input,
          args.outputSchema,
          opts,
          undefined,
        );
        markOk();
        return { data, usage, threadId: sessionId };
      } catch (err) {
        lastErr = err;
        const classified = classifyClaudeError(err);
        if (classified.kind !== "generic") {
          markError(classified);
          throw classified;
        }
      }
    }
    const finalErr = classifyClaudeError(lastErr);
    if (finalErr.kind !== "generic") markError(finalErr);
    throw finalErr;
  },
};
