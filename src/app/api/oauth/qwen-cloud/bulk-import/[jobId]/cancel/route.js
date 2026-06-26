import { NextResponse } from "next/server";
import { getQwenCloudBulkImportManager } from "@/lib/oauth/services/qwenCloudBulkImportManager";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const { jobId } = await params;
  const manager = getQwenCloudBulkImportManager();
  const job = manager.cancelJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Bulk import job not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    job,
  });
}
