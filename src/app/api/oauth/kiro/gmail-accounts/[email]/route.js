import { NextResponse } from "next/server";
import { revokeToken, getGmailAccounts } from "../../../../../../lib/oauth/services/kiroGmailTokenService.js";

export const dynamic = "force-dynamic";

export async function DELETE(request, { params }) {
  const email = decodeURIComponent(await params.email);

  // Check account exists
  const accounts = await getGmailAccounts();
  const exists = accounts.some(a => a.email === email);
  if (!exists) {
    return NextResponse.json({ error: "Gmail account not found" }, { status: 404 });
  }

  await revokeToken(email);
  return NextResponse.json({ success: true });
}
