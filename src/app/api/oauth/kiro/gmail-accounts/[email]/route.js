import { NextResponse } from "next/server";
import { revokeToken } from "../../../../../../lib/oauth/services/kiroGmailTokenService.js";
import { getAdapter } from "../../../../../../lib/db/driver.js";

export const dynamic = "force-dynamic";

export async function DELETE(_request, { params }) {
  const email = decodeURIComponent(params.email);

  // Check token exists
  const db = await getAdapter();
  const existing = db.get(`SELECT email FROM kiroGmailTokens WHERE email = ?`, [email]);
  if (!existing) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  await revokeToken(email);

  return NextResponse.json({ success: true });
}
