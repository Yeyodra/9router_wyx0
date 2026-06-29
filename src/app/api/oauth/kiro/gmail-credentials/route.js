import { NextResponse } from "next/server";
import { saveCredential, getCredentials } from "../../../../../lib/oauth/services/kiroGmailTokenService.js";

export const dynamic = "force-dynamic";

// GET: list all credentials (no clientSecret exposed)
export async function GET() {
  const credentials = await getCredentials();
  return NextResponse.json({ credentials });
}

// POST: save new credential
// Body: { clientId, clientSecret, label? } OR { json: "<raw client_secret.json>", label? }
export async function POST(request) {
  const body = await request.json();

  let clientId, clientSecret, label;

  if (body.json) {
    // Parse raw client_secret.json content
    let parsed;
    try { parsed = JSON.parse(body.json); } catch {
      return NextResponse.json({ error: "Invalid JSON in 'json' field" }, { status: 400 });
    }
    // Support both 'installed' and 'web' OAuth types
    const creds = parsed.installed || parsed.web;
    if (!creds?.client_id || !creds?.client_secret) {
      return NextResponse.json({ error: "client_secret.json must contain client_id and client_secret" }, { status: 400 });
    }
    clientId = creds.client_id;
    clientSecret = creds.client_secret;
    label = body.label ?? null;
  } else {
    clientId = body.clientId;
    clientSecret = body.clientSecret;
    label = body.label ?? null;
  }

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "clientId and clientSecret are required" }, { status: 400 });
  }

  const credential = await saveCredential({ label, clientId, clientSecret });
  return NextResponse.json({ success: true, credential });
}
