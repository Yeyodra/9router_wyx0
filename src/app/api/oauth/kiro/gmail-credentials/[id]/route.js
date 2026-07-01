import { NextResponse } from "next/server";
import { getCredentialById, deleteCredential } from "../../../../../../lib/oauth/services/kiroGmailTokenService.js";
import { getAdapter } from "../../../../../../lib/db/driver.js";

export const dynamic = "force-dynamic";

export async function DELETE(_request, { params }) {
  const { id } = params;

  // Check credential exists
  const existing = await getCredentialById(id);
  if (!existing) {
    return NextResponse.json({ error: "Credential not found" }, { status: 404 });
  }

  // Delete associated gmail tokens first (FK cleanup)
  const db = await getAdapter();
  db.run(`DELETE FROM kiroGmailTokens WHERE credentialId = ?`, [id]);

  // Delete credential itself
  await deleteCredential(id);

  return NextResponse.json({ success: true });
}
