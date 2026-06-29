import { NextResponse } from "next/server";
import { getKiroDotTrickManager } from "../../../../../lib/oauth/services/kiroDotTrickManager.js";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { jobId } = await params;
  const manager = getKiroDotTrickManager();
  const result = manager.getJobWithPreview(jobId);
  if (!result) return NextResponse.json({ found: false, stale: true });
  return NextResponse.json({ found: true, job: result });
}
