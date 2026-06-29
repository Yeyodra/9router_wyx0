import { randomUUID } from "node:crypto";
import { getAdapter } from "../../db/driver.js";

// ---------------------------------------------------------------------------
// Credential CRUD
// ---------------------------------------------------------------------------

/**
 * Save a new OAuth2 credential. Returns the saved record WITHOUT clientSecret.
 * @param {{ label?: string, clientId: string, clientSecret: string }} param0
 */
export async function saveCredential({ label, clientId, clientSecret }) {
  const db = await getAdapter();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.run(
    `INSERT INTO kiroGmailCredentials (id, label, clientId, clientSecret, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    [id, label ?? null, clientId, clientSecret, createdAt]
  );
  return { id, label: label ?? null, clientId, createdAt };
}

/**
 * List all credentials — clientSecret is NOT included.
 * @returns {{ id: string, label: string|null, clientId: string, createdAt: string }[]}
 */
export async function getCredentials() {
  const db = await getAdapter();
  return db.all(`SELECT id, label, clientId, createdAt FROM kiroGmailCredentials`);
}

/**
 * Get a single credential by id — includes clientSecret.
 * @param {string} id
 */
export async function getCredentialById(id) {
  const db = await getAdapter();
  return db.get(`SELECT * FROM kiroGmailCredentials WHERE id = ?`, [id]) ?? null;
}

/**
 * Delete a credential by id.
 * @param {string} id
 * @returns {boolean} true if a row was deleted
 */
export async function deleteCredential(id) {
  const db = await getAdapter();
  db.run(`DELETE FROM kiroGmailCredentials WHERE id = ?`, [id]);
  const row = db.get(`SELECT changes() AS c`);
  return (row?.c ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Token CRUD
// ---------------------------------------------------------------------------

/**
 * Upsert a Gmail token row.
 * @param {{ email: string, accessToken: string, refreshToken: string, expiresAt: number, credentialId?: string }} param0
 */
export async function saveToken({ email, accessToken, refreshToken, expiresAt, credentialId }) {
  const db = await getAdapter();
  const now = new Date().toISOString();

  // Check if row exists so we can preserve createdAt on update
  const existing = db.get(`SELECT id, createdAt FROM kiroGmailTokens WHERE email = ?`, [email]);

  if (existing) {
    db.run(
      `UPDATE kiroGmailTokens
       SET accessToken = ?, refreshToken = ?, expiresAt = ?, credentialId = ?, updatedAt = ?
       WHERE email = ?`,
      [accessToken, refreshToken, expiresAt, credentialId ?? existing.credentialId ?? null, now, email]
    );
  } else {
    const id = randomUUID();
    db.run(
      `INSERT INTO kiroGmailTokens (id, email, accessToken, refreshToken, expiresAt, credentialId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, email, accessToken, refreshToken, expiresAt, credentialId ?? null, now, now]
    );
  }
}

/**
 * Delete a token by email.
 * @param {string} email
 */
export async function revokeToken(email) {
  const db = await getAdapter();
  db.run(`DELETE FROM kiroGmailTokens WHERE email = ?`, [email]);
}

/**
 * Return all Gmail accounts with validity info.
 * @returns {{ email: string, expiresAt: number, isValid: boolean, dotVariantCount: number, credentialId: string|null }[]}
 */
export async function getGmailAccounts() {
  const db = await getAdapter();
  const rows = db.all(`SELECT email, expiresAt, credentialId FROM kiroGmailTokens`);
  const nowSec = Date.now() / 1000;
  return rows.map((row) => ({
    email: row.email,
    expiresAt: row.expiresAt,
    isValid: row.expiresAt > nowSec + 60,
    dotVariantCount: countDotVariants(row.email),
    credentialId: row.credentialId ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Access token — with auto-refresh
// ---------------------------------------------------------------------------

/**
 * Get a valid access token for the given email. Refreshes automatically if expired.
 * Throws on refresh failure.
 * @param {string} email
 * @returns {Promise<string>}
 */
export async function getAccessToken(email) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM kiroGmailTokens WHERE email = ?`, [email]);
  if (!row) throw new Error(`No token found for email: ${email}`);

  const nowSec = Date.now() / 1000;
  if (row.expiresAt > nowSec + 60) {
    // Still valid
    return row.accessToken;
  }

  // Expired — need to refresh
  if (!row.credentialId) throw new Error(`Token for ${email} is expired and has no credentialId for refresh`);

  const cred = db.get(`SELECT * FROM kiroGmailCredentials WHERE id = ?`, [row.credentialId]);
  if (!cred) throw new Error(`Credential ${row.credentialId} not found for refresh`);

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      refresh_token: row.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "(unreadable)");
    throw new Error(`Token refresh failed for ${email}: ${resp.status} ${body}`);
  }

  const data = await resp.json();
  const newAccessToken = data.access_token;
  const newExpiresAt = Math.floor(Date.now() / 1000) + (data.expires_in ?? 3599);

  const now = new Date().toISOString();
  db.run(
    `UPDATE kiroGmailTokens SET accessToken = ?, expiresAt = ?, updatedAt = ? WHERE email = ?`,
    [newAccessToken, newExpiresAt, now, email]
  );

  return newAccessToken;
}

// ---------------------------------------------------------------------------
// Dot-variant utilities
// ---------------------------------------------------------------------------

/**
 * Normalize a Gmail address: remove dots from local part, strip +alias.
 * Handles gmail.com and googlemail.com.
 * @param {string} email
 * @returns {string}
 */
export function normalizeGmail(email) {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  if (["gmail.com", "googlemail.com"].includes(domain.toLowerCase())) {
    return `${local.replace(/\./g, "").split("+")[0]}@${domain}`;
  }
  return email;
}

/**
 * Generate all dot-placement variants of a Gmail address up to maxDots dots.
 * Only gmail.com and googlemail.com are accepted.
 * @param {string} baseEmail
 * @param {number} maxDots
 * @returns {string[]}
 */
export function generateGmailDotVariants(baseEmail, maxDots = 2) {
  const [local, domain] = baseEmail.split("@");
  const domainLower = domain?.toLowerCase();
  if (!local || !["gmail.com", "googlemail.com"].includes(domainLower)) {
    throw new Error(`generateGmailDotVariants requires a @gmail.com or @googlemail.com address, got: ${baseEmail}`);
  }

  const n = local.length;
  if (n < 2) return [`${local}@${domain}`];

  const variants = new Set();
  const gaps = n - 1;

  for (let mask = 0; mask < (1 << gaps); mask++) {
    let dots = 0;
    for (let i = 0; i < gaps; i++) if (mask & (1 << i)) dots++;
    if (dots > maxDots) continue;

    let s = "";
    for (let i = 0; i < gaps; i++) {
      s += local[i];
      if (mask & (1 << i)) s += ".";
    }
    s += local[gaps];
    variants.add(`${s}@${domain}`);
  }

  return [...variants].sort();
}

/**
 * Build a flat, shuffled pool of dot variants across an array of base emails.
 * Unlike the original script (single email), this accepts an array.
 * @param {string[]} baseEmails
 * @param {number} maxDots
 * @returns {string[]}
 */
export function buildEmailPool(baseEmails, maxDots = 2) {
  const all = baseEmails.flatMap((email) => generateGmailDotVariants(email, maxDots));
  // Fisher-Yates shuffle
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

/**
 * Count how many dot variants exist for a given email with the given maxDots.
 * @param {string} email
 * @param {number} maxDots
 * @returns {number}
 */
export function countDotVariants(email, maxDots = 2) {
  try {
    return generateGmailDotVariants(email, maxDots).length;
  } catch {
    return 0;
  }
}
