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
 * @returns {{ valid: boolean, error?: string, data?: object }}
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

  return { valid: true, data: parsed };
}

/**
 * Filter accounts array to only those eligible for login-only mode.
 * Eligible: reg_status === "success" AND suspended !== true
 *
 * @param {object[]} accounts
 * @returns {object[]}
 */
export function filterEligibleAccounts(accounts) {
  return accounts.filter(
    (a) => a.reg_status === "success" && a.suspended !== true
  );
}
