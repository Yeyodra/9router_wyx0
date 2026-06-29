import { NextResponse } from "next/server";
import { saveToken, getCredentialById } from "../../../../../lib/oauth/services/kiroGmailTokenService.js";
import { pendingAuthorizations } from "../../../../../lib/oauth/services/kiroGmailPendingAuth.js";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/oauth/kiro/gmail-callback?code=<code>&state=<state>&port=<port>
// Called internally by the local callback server spawned in gmail-authorize.
// ---------------------------------------------------------------------------

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  // 1. Validate required params
  if (!code || !state) {
    return NextResponse.json(
      { error: "code and state required" },
      { status: 400 }
    );
  }

  // 2. Look up pending authorization by state token
  const pending = pendingAuthorizations.get(state);
  if (!pending) {
    return NextResponse.json(
      { error: "Invalid or expired state" },
      { status: 400 }
    );
  }

  // 3. Load credential (needed for token exchange)
  const credential = await getCredentialById(pending.credentialId);
  if (!credential) {
    return NextResponse.json(
      { error: "Credential not found" },
      { status: 404 }
    );
  }

  // 4. Exchange authorization code for tokens with Google
  let tokenResp;
  try {
    tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: credential.clientId,
        client_secret: credential.clientSecret,
        redirect_uri: pending.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Token exchange request failed: ${err.message}` },
      { status: 502 }
    );
  }

  if (!tokenResp.ok) {
    const body = await tokenResp.text();
    return NextResponse.json(
      { error: `Token exchange failed: ${tokenResp.status} ${body}` },
      { status: 502 }
    );
  }

  const tokens = await tokenResp.json();

  // 5. Decode email from id_token (middle segment of JWT, base64url-encoded JSON)
  let email;
  try {
    const payload = JSON.parse(
      Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()
    );
    email = payload.email;
  } catch {
    return NextResponse.json(
      { error: "Could not decode email from id_token" },
      { status: 502 }
    );
  }

  if (!email) {
    return NextResponse.json(
      { error: "id_token payload missing email claim" },
      { status: 502 }
    );
  }

  // 6. Compute expiry epoch (seconds)
  const expiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600);

  // 7. Persist token to DB via upsert
  await saveToken({
    email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
    credentialId: pending.credentialId,
  });

  // 8. Clean up pending state — discard the code, we're done with it
  pendingAuthorizations.delete(state);

  return NextResponse.json({ success: true, email });
}
