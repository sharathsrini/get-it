/**
 * POST /api/codex/logout
 *
 * Runs `codex logout`. Returns { ok: boolean }. The client side
 * follows up by re-launching the Electron setup wizard.
 */

import { NextResponse } from "next/server";
import { runLogout } from "@/lib/codex-account";
import { runClaudeLogout } from "@/lib/claude-account";
import { getActiveProviderId } from "@/lib/ai";

export const runtime = "nodejs";

export async function POST() {
  const ok = getActiveProviderId() === "claude" ? runClaudeLogout() : runLogout();
  return NextResponse.json({ ok });
}
