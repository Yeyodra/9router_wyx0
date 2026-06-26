import { NextResponse } from "next/server";
import { getQwenCloudRegisterManager } from "@/lib/oauth/services/qwenCloudRegisterManager";
import { resolveBulkImportProxy } from "@/lib/oauth/services/bulkImportProxyResolver";
import { buildLookupResponse } from "@/lib/oauth/services/qwenCloudRegisterManager";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const count = Number.parseInt(body?.count, 10);

    if (!Number.isFinite(count) || count < 1) {
      return NextResponse.json(
        { error: "count must be a positive integer" },
        { status: 400 }
      );
    }

    if (count > 100) {
      return NextResponse.json(
        { error: "count must not exceed 100" },
        { status: 400 }
      );
    }

    const { proxyUrl, proxyUrls, proxyMode, proxyPoolId, proxySource, error: proxyError } =
      await resolveBulkImportProxy({
        proxyPoolId: body?.proxyPoolId,
        proxyUrl: body?.proxyUrl,
      });
    if (proxyError) {
      return NextResponse.json({ error: proxyError }, { status: 400 });
    }

    const manager = getQwenCloudRegisterManager();
    const job = await manager.startJob({
      count,
      concurrency: body?.concurrency,
      engine: body?.engine,
      proxyUrl,
      proxyUrls,
      proxyMode,
      proxyPoolId,
      proxySource,
    });

    return NextResponse.json({ success: true, job });
  } catch (error) {
    return NextResponse.json(
      { error: error?.error || error?.message || "Failed to start Qwen Cloud registration job" },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  const manager = getQwenCloudRegisterManager();
  const searchParams = new URL(request.url).searchParams;
  const scope = searchParams.get("scope");
  const includeRecentTerminal = scope === "recent" || scope === "all";
  const job = await manager.getLatestJobWithPreview({ includeRecentTerminal });

  if (!job) {
    return NextResponse.json(
      {
        success: false,
        ...buildLookupResponse(null),
        error: "Registration job not found",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, ...buildLookupResponse(job) });
}
