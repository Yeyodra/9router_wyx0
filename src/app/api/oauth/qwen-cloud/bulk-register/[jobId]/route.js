import { NextResponse } from "next/server";
import { buildLookupResponse, getQwenCloudRegisterManager } from "@/lib/oauth/services/qwenCloudRegisterManager";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { jobId } = await params;
  const manager = getQwenCloudRegisterManager();
  const job = await manager.getJobWithPreview(jobId);

  if (!job) {
    return NextResponse.json(
      {
        success: false,
        ...buildLookupResponse(null, { stale: true }),
        error: "Registration job not found",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, ...buildLookupResponse(job) });
}
