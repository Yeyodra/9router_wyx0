import { NextResponse } from "next/server";
import { getKiroDotTrickManager } from "../../../../../../lib/oauth/services/kiroDotTrickManager.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const manager = getKiroDotTrickManager();
  const job = await manager.getLatestJobWithPreview({ includeRecentTerminal: true });

  if (!job) {
    return NextResponse.json({ found: false });
  }

  return NextResponse.json({ found: true, job });
}
