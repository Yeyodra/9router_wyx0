import { getKiroDotTrickManager } from "../../../../../../lib/oauth/services/kiroDotTrickManager.js";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { jobId } = await params;
  const manager = getKiroDotTrickManager();

  // Check job exists
  const jobResult = manager.getJobWithPreview(jobId);
  if (!jobResult) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (jobResult.mode === "login-only") {
    return new Response(JSON.stringify({ error: "accounts.json download not available for login-only jobs" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = manager.getAccountsJson(jobId);
  if (!result) {
    return new Response(JSON.stringify({ error: "No accounts.json available for this job" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(result.json, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
    },
  });
}
