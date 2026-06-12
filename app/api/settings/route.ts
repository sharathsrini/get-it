/**
 * GET  /api/settings    → current persisted AppSettings (or env defaults)
 * POST /api/settings    → merge body into persisted settings
 *
 * The viewer reads this once at mount and writes on every toggle. Settings
 * survive app restarts because they live at <DATA_DIR>/settings.json.
 */

import { NextResponse } from "next/server";
import { loadSettings, saveSettings, type AppSettings } from "@/lib/settings-store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(loadSettings());
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const b = (body && typeof body === "object" ? body : {}) as Partial<AppSettings>;
  const current = loadSettings();
  const next: AppSettings = {
    autoGenerate:
      typeof b.autoGenerate === "boolean" ? b.autoGenerate : current.autoGenerate,
    maxRetries:
      typeof b.maxRetries === "number" && b.maxRetries >= 0
        ? b.maxRetries
        : current.maxRetries,
    aiProvider:
      b.aiProvider === "codex" || b.aiProvider === "claude"
        ? b.aiProvider
        : current.aiProvider,
  };
  saveSettings(next);
  return NextResponse.json(next);
}
