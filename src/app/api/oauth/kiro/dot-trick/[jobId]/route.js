import { NextResponse } from "next/server";
import { getKiroDotTrickManager } from "../../../../../../lib/oauth/services/kiroDotTrickManager.js";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { jobId } = await params;
  const manager = getKiroDotTrickManager();
  const job = await manager.getJobWithPreview(jobId);

  if (!job) {
    return NextResponse.json({ error: "Dot-trick job not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, job });
}
