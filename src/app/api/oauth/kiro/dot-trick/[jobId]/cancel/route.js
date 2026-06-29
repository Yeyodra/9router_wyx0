import { NextResponse } from "next/server";
import { getKiroDotTrickManager } from "../../../../../../lib/oauth/services/kiroDotTrickManager.js";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const { jobId } = await params;
  const manager = getKiroDotTrickManager();
  const job = manager.cancelJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ success: true, job });
}
