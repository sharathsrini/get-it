/**
 * Low-level Claude Code CLI driver + binary resolution.
 *
 * Mirrors the role lib/codex.ts plays for OpenAI, but for Anthropic. We drive
 * the `claude` CLI in non-interactive "print" mode rather than an SDK, for one
 * decisive reason: only the CLI's own login flow stores a *subscription* OAuth
 * credential (Claude Pro / Max), which is what lets Get It. run against the
 * plan the user already pays for — no separate per-token API billing, no shared
 * key pool. That is the same "bring your own subscription" model the Codex path
 * uses, so the two providers stay symmetric.
 *
 * Print mode contract (stable across recent CLI versions):
 *   claude -p --output-format json [--model M] [--resume SID]
 *   • the prompt is written to stdin,
 *   • stdout is a single JSON envelope:
 *       { type:"result", subtype, is_error, result:"<text>",
 *         session_id:"...", usage:{...}, ... }
 *   • `result` is the assistant's final text; `session_id` is the thread id we
 *     persist (the analogue of a Codex thread id).
 *
 * The binary itself is a Node CLI shipped by the `@anthropic-ai/claude-code`
 * npm package, so unlike Codex's per-triple Rust binary it is the SAME file on
 * every platform. We resolve it from (in order): an explicit env override the
 * Electron main process sets, the project's node_modules `.bin`, the package's
 * own `cli.js` (run with the current Node), and finally the system PATH.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { CODEX_SCRATCH_DIR } from "./paths";

/**
 * The model every generative call runs on, pinned explicitly — the analogue of
 * CODEX_MODEL. Keep this current with what Claude *subscription* auth allows.
 * When Anthropic retires it, ship an app update bumping this value (the in-app
 * "model unsupported" banner tells users exactly that). An alias ("sonnet") is
 * used so the CLI resolves the latest matching snapshot for the account.
 */
export const CLAUDE_MODEL = "sonnet";

export type ResolvedClaudeBinary = {
  /** Executable to spawn (either the `claude` launcher or `node`). */
  command: string;
  /** Leading args (e.g. the path to cli.js when launched via node). */
  prefixArgs: string[];
};

/**
 * Resolve how to invoke the Claude CLI. Returns null when nothing is found, so
 * the provider can surface a clean binary_missing error instead of throwing.
 */
export function resolveClaudeBinary(): ResolvedClaudeBinary | null {
  // 1) Explicit override from the Electron main process.
  const override = process.env.CLAUDE_BINARY_PATH;
  if (override && fs.existsSync(override)) {
    return override.endsWith(".js")
      ? { command: process.execPath, prefixArgs: [override] }
      : { command: override, prefixArgs: [] };
  }

  const exe = process.platform === "win32" ? "claude.cmd" : "claude";

  // 2) node_modules/.bin/claude in the project / standalone tree.
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "node_modules", ".bin", exe);
    if (fs.existsSync(candidate)) return { command: candidate, prefixArgs: [] };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 3) The package's own cli.js — run with the current Node executable.
  try {
    const moduleRequire = createRequire(import.meta.url);
    const cliJs = moduleRequire.resolve("@anthropic-ai/claude-code/cli.js");
    if (fs.existsSync(cliJs)) {
      return { command: process.execPath, prefixArgs: [cliJs] };
    }
  } catch {
    /* not installed as a module — fall through */
  }

  // 4) System PATH.
  return { command: exe, prefixArgs: [] };
}

/** Where Claude Code persists its credentials + config. */
export function claudeHomeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR
    ? path.resolve(process.env.CLAUDE_CONFIG_DIR)
    : path.join(os.homedir(), ".claude");
}

export type ClaudePrintArgs = {
  /** Full prompt text (sent on stdin). */
  prompt: string;
  /** Resume an existing session by id (multi-turn chat). */
  resumeSessionId?: string;
  /** Allow the WebSearch tool for this call (e.g. legal citations). */
  webSearch?: boolean;
  signal?: AbortSignal;
  /** Hard ceiling so a wedged child can never hang a request forever. */
  timeoutMs?: number;
};

export type ClaudePrintResult = {
  /** The assistant's final text (expected to be a JSON object string). */
  text: string;
  /** Session id to persist as the thread id, when the CLI reports one. */
  sessionId: string | null;
  /** Raw usage block from the envelope, passed through to callers. */
  usage: unknown;
};

/**
 * Run one Claude CLI print-mode turn and return the parsed envelope. Rejects
 * with an Error whose message carries the CLI's own text so the Claude error
 * classifier can map it to a kind. Never resolves on a non-success envelope.
 */
export function runClaudePrint(args: ClaudePrintArgs): Promise<ClaudePrintResult> {
  return new Promise((resolve, reject) => {
    const resolved = resolveClaudeBinary();
    if (!resolved) {
      reject(new Error("Unable to locate claude binary"));
      return;
    }

    const cliArgs = [
      ...resolved.prefixArgs,
      "-p",
      "--output-format",
      "json",
      "--model",
      CLAUDE_MODEL,
    ];
    // Keep the run hermetic: by default grant no tools so nothing ever blocks
    // on an interactive approval prompt. Only widen to WebSearch when asked.
    if (args.webSearch) {
      cliArgs.push("--allowed-tools", "WebSearch");
    } else {
      cliArgs.push("--allowed-tools", "");
    }
    if (args.resumeSessionId) {
      cliArgs.push("--resume", args.resumeSessionId);
    }

    let child;
    try {
      child = spawn(resolved.command, cliArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: fs.existsSync(CODEX_SCRATCH_DIR) ? CODEX_SCRATCH_DIR : process.cwd(),
        env: process.env,
        windowsHide: true,
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(new Error("claude call timed out"));
    }, args.timeoutMs ?? 180_000);

    const onAbort = () => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(new Error("claude call aborted"));
    };
    if (args.signal) {
      if (args.signal.aborted) {
        onAbort();
        return;
      }
      args.signal.addEventListener("abort", onAbort, { once: true });
    }

    function finish(err: Error | null, value?: ClaudePrintResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (args.signal) args.signal.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve(value as ClaudePrintResult);
    }

    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    child.once("error", (e) => finish(e instanceof Error ? e : new Error(String(e))));
    child.once("exit", (code) => {
      if (settled) return;
      const trimmed = stdout.trim();
      if (!trimmed) {
        finish(
          new Error(
            stderr.trim() || `claude exited with code ${code} and no output`,
          ),
        );
        return;
      }
      let envelope: Record<string, unknown>;
      try {
        envelope = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        // Not JSON — surface whatever the CLI printed (often an auth or
        // rate-limit message) so the classifier can act on it.
        finish(new Error(trimmed || stderr.trim() || "claude returned no JSON"));
        return;
      }
      const isError = envelope.is_error === true || envelope.subtype === "error";
      const resultText =
        typeof envelope.result === "string" ? (envelope.result as string) : "";
      if (isError || !resultText) {
        finish(
          new Error(
            resultText ||
              (typeof envelope.error === "string" ? (envelope.error as string) : "") ||
              stderr.trim() ||
              `claude reported an error (${String(envelope.subtype ?? "unknown")})`,
          ),
        );
        return;
      }
      finish(null, {
        text: resultText,
        sessionId:
          typeof envelope.session_id === "string"
            ? (envelope.session_id as string)
            : null,
        usage: envelope.usage ?? null,
      });
    });

    // Send the prompt on stdin and close it so the CLI starts.
    try {
      child.stdin?.write(args.prompt);
      child.stdin?.end();
    } catch (e) {
      finish(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
