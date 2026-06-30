import { NextResponse } from "next/server";
import { getKiroDotTrickManager } from "../../../../../lib/oauth/services/kiroDotTrickManager.js";

export const dynamic = "force-dynamic";

// GET: return latest active or recently completed job
export async function GET() {
  const manager = getKiroDotTrickManager();
  const result = manager.getLatestJobWithPreview({ includeRecentTerminal: true });
  if (!result) return NextResponse.json({ found: false });
  return NextResponse.json({ found: true, job: result });
}

// POST: start a new dot-trick job
export async function POST(request) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body?.mode) {
      return NextResponse.json({ error: "mode is required (merge, register-only, login-only)" }, { status: 400 });
    }

    if ((body.mode === "merge" || body.mode === "register-only") && (!Array.isArray(body.gmailAccounts) || body.gmailAccounts.length === 0)) {
      return NextResponse.json({ error: "gmailAccounts is required for merge and register-only modes" }, { status: 400 });
    }

    if (body.mode === "login-only" && !body.accountsJson) {
      return NextResponse.json({ error: "accountsJson is required for login-only mode" }, { status: 400 });
    }

    const manager = getKiroDotTrickManager();

    // 409 if a job is already running
    const existing = manager.getLatestJobWithPreview({ includeRecentTerminal: false });
    if (existing && (existing.status === "running" || existing.status === "queued")) {
      return NextResponse.json({ error: "A job is already running", job: existing }, { status: 409 });
    }

    const job = await manager.startJob({
      mode: body.mode,
      gmailAccounts: body.gmailAccounts || [],
      count: body.count ?? 0,
      concurrency: body.concurrency,
      headless: body.headless ?? true,
      loginCooldownMs: body.loginCooldownMs ?? 60000,
      proxyUrls: body.proxyUrls || [],
      accountsJson: body.accountsJson,
    });

    return NextResponse.json({ success: true, job });
  } catch (error) {
    const status = error?.status || 500;
    return NextResponse.json({ error: error?.message || "Failed to start dot-trick job" }, { status });
  }
}
