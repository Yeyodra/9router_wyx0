import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { getCredentialById, saveToken } from "../../../../../lib/oauth/services/kiroGmailTokenService.js";
import { pendingAuthorizations } from "../../../../../lib/oauth/services/kiroGmailPendingAuth.js";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Google OAuth2 authorization URL.
 * @param {string} clientId
 * @param {string} redirectUri
 * @param {string} state
 * @returns {string}
 */
function buildGoogleAuthUrl(clientId, redirectUri, state) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope:
      "https://www.googleapis.com/auth/gmail.readonly openid email profile",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Spawn a callback server on exactly the given port.
 * If the port is already in use (stale server from previous attempt),
 * force-close it first then retry once — so we always use the exact
 * registered redirect URI (localhost:8085/callback).
 * @param {number} port
 * @returns {Promise<{ server: http.Server, port: number }>}
 */
async function spawnCallbackServer(port) {
  const tryBind = () => new Promise((resolve, reject) => {
    const s = http.createServer();
    s.on("error", reject);
    s.listen(port, "127.0.0.1", () => resolve(s));
  });

  try {
    const server = await tryBind();
    return { server, port };
  } catch (err) {
    if (err.code !== "EADDRINUSE") throw err;
    // Port busy — close any stale pending auth servers on this port, then retry once
    for (const [state, pending] of pendingAuthorizations.entries()) {
      if (pending.port === port) {
        try { pending.server.close(); } catch { /* ignore */ }
        pendingAuthorizations.delete(state);
      }
    }
    // Brief wait for OS to release the port
    await new Promise((r) => setTimeout(r, 200));
    const server = await tryBind();
    return { server, port };
  }
}

/**
 * Close the local server and remove the pending auth entry.
 * @param {string} state
 */
function cleanupPending(state) {
  const pending = pendingAuthorizations.get(state);
  if (!pending) return;
  try {
    pending.server.close();
  } catch {
    /* ignore */
  }
  pendingAuthorizations.delete(state);
}

// ---------------------------------------------------------------------------
// GET /api/oauth/kiro/gmail-authorize?credential_id=<id>
// ---------------------------------------------------------------------------

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const credentialId = searchParams.get("credential_id");

  // 1. Validate required param
  if (!credentialId) {
    return NextResponse.json(
      { error: "credential_id is required" },
      { status: 400 }
    );
  }

  // 2. Load credential from DB (includes clientSecret — server-side only)
  const credential = await getCredentialById(credentialId);
  if (!credential) {
    return NextResponse.json(
      { error: "Credential not found" },
      { status: 404 }
    );
  }

  // 3. Spawn local HTTP callback server (try 8085, 8086, 8087)
  let server, port;
  try {
    ({ server, port } = await spawnCallbackServer(8085));
  } catch (err) {
    return NextResponse.json(
      { error: err.message },
      { status: 503 }
    );
  }

  // 4. Generate unique state token
  const state = randomUUID();

  // 5. Build Google OAuth2 authorization URL
  const redirectUri = `http://localhost:${port}/callback`;
  const authUrl = buildGoogleAuthUrl(credential.clientId, redirectUri, state);

  // 6. Register pending authorization with 5-minute timeout
  pendingAuthorizations.set(state, {
    credentialId,
    port,
    server,
    expiresAt: Date.now() + 5 * 60 * 1000,
    redirectUri,
  });
  setTimeout(() => cleanupPending(state), 5 * 60 * 1000);

  // 7. Wire local server — inline token exchange (no HTTP round-trip to Next.js)
  server.on("request", (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname !== "/callback") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const code = url.searchParams.get("code");
    const cbState = url.searchParams.get("state");

    if (!code || !cbState) {
      res.writeHead(400);
      res.end("Missing code or state");
      return;
    }

    // Look up pending authorization
    const cbPending = pendingAuthorizations.get(cbState);
    if (!cbPending) {
      res.writeHead(400);
      res.end("Invalid or expired state");
      return;
    }

    // Do token exchange + userinfo + saveToken inline (no HTTP call to Next.js)
    (async () => {
      try {
        // 1. Load credential
        const cbCredential = await getCredentialById(cbPending.credentialId);
        if (!cbCredential) throw new Error("Credential not found");

        // 2. Exchange code for tokens
        const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: cbCredential.clientId,
            client_secret: cbCredential.clientSecret,
            redirect_uri: cbPending.redirectUri,
            grant_type: "authorization_code",
          }).toString(),
        });
        if (!tokenResp.ok) {
          const body = await tokenResp.text();
          throw new Error(`Token exchange failed: ${tokenResp.status} ${body}`);
        }
        const tokens = await tokenResp.json();

        // 3. Get email from Google userinfo endpoint
        const userinfoResp = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (!userinfoResp.ok) throw new Error("Failed to get user info from Google");
        const userinfo = await userinfoResp.json();
        const email = userinfo.email;
        if (!email) throw new Error("Google userinfo missing email claim");

        // 4. Save token to DB
        const expiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600);
        await saveToken({
          email,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt,
          credentialId: cbPending.credentialId,
        });

        // 5. Clean up pending state
        pendingAuthorizations.delete(cbState);

        // 6. Respond to browser
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Authorization successful! You can close this tab.</h2><p>Gmail account linked: " + email + "</p></body></html>");
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Authorization failed</h2><p>" + (err.message || "Unknown error") + "</p></body></html>");
      } finally {
        setTimeout(() => { try { server.close(); } catch {} }, 1000);
      }
    })();
  });

  return NextResponse.json({ authUrl, state, port });
}
