import { NextResponse } from "next/server";
import { getGmailAccounts, getCredentials } from "../../../../../lib/oauth/services/kiroGmailTokenService.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const [accounts, credentials] = await Promise.all([
    getGmailAccounts(),
    getCredentials(),
  ]);

  // Build credentialId → label lookup
  const credentialMap = Object.fromEntries(credentials.map(c => [c.id, c.label]));

  const enriched = accounts.map(acc => ({
    ...acc,
    credentialLabel: credentialMap[acc.credentialId] ?? null,
  }));

  return NextResponse.json({ accounts: enriched });
}
