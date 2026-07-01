import { NextResponse } from "next/server";
import { getKiroDotTrickManager } from "../../../../../lib/oauth/services/kiroDotTrickManager.js";

export const dynamic = "force-dynamic";

// GET: return latest active or recently completed job
export async function GET() {
  const manager = getKiroDotTrickManager();
  const result = await manager.getLatestJobWithPreview({ includeRecentTerminal: true });
  if (!result) return NextResponse.json({ found: false });
  return NextResponse.json({ found: true, job: result });
}

// POST: start a new dot-trick job
export async function POST(request) {
  try {
    const body = await request.json();

    if (!Array.isArray(body?.gmailAccounts) || body.gmailAccounts.length === 0) {
      return NextResponse.json({ error: "gmailAccounts is required" }, { status: 400 });
    }

    const manager = getKiroDotTrickManager();

    const existing = await manager.getLatestJobWithPreview({ includeRecentTerminal: false });
    if (existing && (existing.status === "running" || existing.status === "queued")) {
      return NextResponse.json({ error: "A job is already running", job: existing }, { status: 409 });
    }

    const job = await manager.startJob({
      gmailAccounts: body.gmailAccounts,
      count: body.count ?? 0,
      concurrency: body.concurrency,
      engine: body.engine,
      headless: body.headless ?? true,
      loginCooldownMs: body.loginCooldownMs ?? 60000,
      proxyUrls: body.proxyUrls || [],
      proxyPoolId: body.proxyPoolId,
    });

    const sanitized = await manager.getJobWithPreview(job.jobId);
    return NextResponse.json({ success: true, job: sanitized || job });
  } catch (error) {
    const status = error?.status || 500;
    return NextResponse.json({ error: error?.message || "Failed to start dot-trick job" }, { status });
  }
}
