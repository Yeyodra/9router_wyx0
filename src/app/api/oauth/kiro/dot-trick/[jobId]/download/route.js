import { NextResponse } from "next/server";
import { getKiroDotTrickManager } from "../../../../../../../lib/oauth/services/kiroDotTrickManager.js";
import { buildAccountsJsonFilename } from "../../../../../../../lib/oauth/services/kiroDotTrickAccountsSchema.js";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const manager = getKiroDotTrickManager();

  // Get the job first to check mode and existence
  const job = await manager.getJobWithPreview(params.jobId);
  if (!job) {
    return NextResponse.json({ error: "Dot-trick job not found" }, { status: 404 });
  }

  if (job.mode === "login-only") {
    return NextResponse.json({ error: "No accounts.json available for login-only jobs" }, { status: 400 });
  }

  const result = manager.getAccountsJson(params.jobId);
  if (!result) {
    return NextResponse.json({ error: "accounts.json not available for this job" }, { status: 404 });
  }

  const filename = buildAccountsJsonFilename(params.jobId);

  return new Response(result.json, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
