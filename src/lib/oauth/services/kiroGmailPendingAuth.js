// Shared module-level store for pending Gmail OAuth authorizations.
// Map of state (UUID) → { credentialId, port, server, expiresAt, redirectUri }
// This module is a singleton by virtue of Node.js module caching.
// Using globalThis ensures survival across Next.js hot-reloads in dev mode.

if (!globalThis.__kiroGmailPendingAuth) {
  globalThis.__kiroGmailPendingAuth = new Map();
}

export const pendingAuthorizations = globalThis.__kiroGmailPendingAuth;
