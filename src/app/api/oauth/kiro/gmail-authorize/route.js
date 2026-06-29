import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { getCredentialById } from "../../../../../lib/oauth/services/kiroGmailTokenService.js";
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
 * Try to bind an HTTP server to startPort, startPort+1, startPort+2.
 * Returns { server, port } for the first available port.
 * @param {number} startPort
 * @returns {Promise<{ server: http.Server, port: number }>}
 */
async function spawnCallbackServer(startPort) {
  for (let port = startPort; port <= startPort + 2; port++) {
    try {
      const server = await new Promise((resolve, reject) => {
        const s = http.createServer();
        s.on("error", reject);
        s.listen(port, "127.0.0.1", () => resolve(s));
      });
      return { server, port };
    } catch {
      // try next port
    }
  }
  throw new Error(`Could not bind to ports ${startPort}-${startPort + 2}`);
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

  // 7. Wire local server to forward browser callback → Next.js API route
  server.on("request", (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const cbState = url.searchParams.get("state");
      const apiBase =
        process.env.NEXT_PUBLIC_APP_URL ||
        `http://localhost:${process.env.PORT || 20128}`;
      fetch(
        `${apiBase}/api/oauth/kiro/gmail-callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(cbState)}&port=${port}`
      )
        .then(() => {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h2>Authorization successful! You can close this tab.</h2></body></html>"
          );
          setTimeout(() => server.close(), 1000);
        })
        .catch(() => {
          res.writeHead(500);
          res.end("Authorization failed");
          setTimeout(() => server.close(), 1000);
        });
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  return NextResponse.json({ authUrl, state, port });
}
