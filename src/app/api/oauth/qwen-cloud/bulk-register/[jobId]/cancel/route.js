import { NextResponse } from "next/server";
import { getQwenCloudRegisterManager } from "@/lib/oauth/services/qwenCloudRegisterManager";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const { jobId } = await params;
  const manager = getQwenCloudRegisterManager();
  const job = manager.cancelJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Registration job not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, job });
}
