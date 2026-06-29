import { NextResponse } from "next/server";
import { deleteCredential, getCredentialById, revokeToken, getGmailAccounts } from "../../../../../../lib/oauth/services/kiroGmailTokenService.js";

export const dynamic = "force-dynamic";

export async function DELETE(request, { params }) {
  const { id } = await params;

  // Check credential exists
  const existing = await getCredentialById(id);
  if (!existing) {
    return NextResponse.json({ error: "Credential not found" }, { status: 404 });
  }

  // Revoke all associated gmail tokens (credentialId FK cleanup)
  const accounts = await getGmailAccounts();
  for (const account of accounts) {
    if (account.credentialId === id) {
      await revokeToken(account.email);
    }
  }

  await deleteCredential(id);
  return NextResponse.json({ success: true });
}
