import { NextResponse } from "next/server";
import { listCodexGatewayAccounts } from "@/sse/services/codexGateway.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await listCodexGatewayAccounts();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.log("Error listing Codex gateway accounts:", error);
    return NextResponse.json({ error: "Failed to list Codex gateway accounts" }, { status: 500 });
  }
}
