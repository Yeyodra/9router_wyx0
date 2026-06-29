/**
 * kiroDotTrickAccountsSchema.js
 * accounts.json format spec + parse/validate/filter helpers for Kiro Dot Trick.
 * Pure logic — no DB, no network, no side effects.
 */

/** accounts.json schema version */
export const ACCOUNTS_JSON_VERSION = 1;

/**
 * Build output JSON for register-only mode.
 * Only includes accounts where reg_status === "success".
 *
 * @param {{ jobId: string, mode: string, stats: object, accounts: object[] }} param
 * @returns {{ version: number, createdAt: string, mode: string, jobId: string, stats: object, accounts: object[] }}
 */
export function buildAccountsJson({ jobId, mode, stats, accounts }) {
  const filtered = accounts
    .filter((a) => a.reg_status === "success")
    .map((a) => ({
      email: a.email,
      password: a.password,
      displayName: a.displayName,
      reg_status: a.reg_status,
      suspended: a.suspended,
      registeredAt: a.registeredAt,
    }));

  return {
    version: ACCOUNTS_JSON_VERSION,
    createdAt: new Date().toISOString(),
    mode,
    jobId,
    stats,
    accounts: filtered,
  };
}

/**
 * Parse and validate an accounts.json string (used for login-only mode input).
 *
 * Validates:
 * - Valid JSON
 * - Has `version` field
 * - Has `accounts` array
 * - Each account has `email` and `password`
 *
 * @param {string} jsonString
 * @returns {{ valid: boolean, error?: string, accounts?: object[], stats?: object }}
 */
export function parseAccountsJson(jsonString) {
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    return { valid: false, error: `Invalid JSON: ${err.message}` };
  }

  if (parsed.version === undefined || parsed.version === null) {
    return { valid: false, error: "Missing required field: version" };
  }

  if (!Array.isArray(parsed.accounts)) {
    return { valid: false, error: "Missing or invalid field: accounts must be an array" };
  }

  for (let i = 0; i < parsed.accounts.length; i++) {
    const account = parsed.accounts[i];
    if (!account.email) {
      return { valid: false, error: `Account at index ${i} is missing required field: email` };
    }
    if (!account.password) {
      return { valid: false, error: `Account at index ${i} is missing required field: password` };
    }
  }

  const total = parsed.accounts.length;
  const suspendedCount = parsed.accounts.filter((a) => a.suspended === true).length;
  const filteredCount = parsed.accounts.filter((a) => a.reg_status !== "success").length;
  const eligible = parsed.accounts.filter(
    (a) => a.reg_status === "success" && a.suspended !== true
  );

  return {
    valid: true,
    accounts: eligible,
    stats: {
      total,
      eligible: eligible.length,
      suspended: suspendedCount,
      filtered: filteredCount,
    },
  };
}

/**
 * Build the filename for an accounts.json export.
 *
 * @param {string} jobId
 * @returns {string} e.g. "accounts-2026-06-30-abcd1234.json"
 */
export function buildAccountsJsonFilename(jobId) {
  const datePrefix = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const shortId = String(jobId || "").slice(0, 8);
  return `accounts-${datePrefix}-${shortId}.json`;
}
