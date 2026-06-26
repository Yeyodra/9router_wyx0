/**
 * qwenKeyStatus.mjs
 *
 * Check Qwen Cloud API key status for account pool management.
 *
 * Returns one of:
 *   "active"    — key is valid and has quota
 *   "exhausted" — quota exceeded / rate limit
 *   "blocked"   — key is blocked or deleted on Qwen Cloud console
 *   "invalid"   — 401/403, key doesn't exist or revoked
 *   "error"     — network or unexpected error
 *
 * Usage:
 *   import { checkQwenKeyStatus } from "./qwenKeyStatus.mjs";
 *   const { status, detail } = await checkQwenKeyStatus(apiKey);
 *
 * Or run standalone:
 *   node scripts/qwenKeyStatus.mjs --key=sk-ws-H...
 *   node scripts/qwenKeyStatus.mjs  (reads key from qwen-dot-result.json)
 */

// ─── Qwen quota error codes that mean "exhausted" ────────────────────────────
const EXHAUSTED_CODES = new Set([
  "Throttling.RateQuota",      // free-tier token quota exceeded
  "Throttling.UserQuota",      // user-level quota exceeded
  "Throttling",                // general throttle
  "QuotaExceeded",
  "PaymentRequired",
  "InsufficientBalance",
  "ReachedUserQuota",
  "AccessDenied.InsufficientBalance",
]);

// ─── Qwen codes that mean the key itself is invalid/revoked ───────────────────
const INVALID_CODES = new Set([
  "InvalidApiKey",
  "Unauthorized",
  "AuthenticationError",
  "AccessDenied.InvalidApiKey",
]);

const BASE = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const UA   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

/**
 * Check key status via a minimal chat/models call.
 * DashScope returns HTTP 200 even for quota errors — check body.code.
 *
 * @param {string} apiKey
 * @returns {Promise<{status: string, detail: string, httpStatus: number}>}
 */
export async function checkQwenKeyStatus(apiKey) {
  if (!apiKey || typeof apiKey !== "string") {
    return { status: "invalid", detail: "empty or non-string key", httpStatus: 0 };
  }

  let res, body;
  try {
    // Use /models — cheap, no token consumption
    res = await fetch(`${BASE}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": UA,
      },
      signal: AbortSignal.timeout(15_000),
    });

    body = await res.json().catch(() => null);
  } catch (err) {
    return { status: "error", detail: `network: ${err.message}`, httpStatus: 0 };
  }

  const code    = body?.code || body?.error?.code || "";
  const message = body?.message || body?.error?.message || "";

  // ── HTTP-level auth failures
  if (res.status === 401 || res.status === 403) {
    return { status: "invalid", detail: `HTTP ${res.status} — ${message || code}`, httpStatus: res.status };
  }

  // ── Payment required (some regions use 402)
  if (res.status === 402) {
    return { status: "exhausted", detail: `HTTP 402 — ${message || code}`, httpStatus: res.status };
  }

  // ── 429 is rate-limited but key is still active
  if (res.status === 429) {
    return { status: "active", detail: `rate-limited (429) — key is valid`, httpStatus: res.status };
  }

  // ── Non-200 unexpected
  if (!res.ok) {
    return { status: "error", detail: `HTTP ${res.status} — ${message || code}`, httpStatus: res.status };
  }

  // ── 200 but error code in body (DashScope pattern)
  if (code) {
    if (EXHAUSTED_CODES.has(code)) {
      return { status: "exhausted", detail: `${code}: ${message}`, httpStatus: res.status };
    }
    if (INVALID_CODES.has(code)) {
      return { status: "invalid", detail: `${code}: ${message}`, httpStatus: res.status };
    }
    // Unknown error code — treat as error
    return { status: "error", detail: `${code}: ${message}`, httpStatus: res.status };
  }

  // ── 200 with models list → active
  if (Array.isArray(body?.data) && body.data.length > 0) {
    return { status: "active", detail: `${body.data.length} models available`, httpStatus: 200 };
  }

  // ── Fallback — 200 but no models and no error → assume active
  return { status: "active", detail: "200 OK", httpStatus: 200 };
}

/**
 * Check key status via Qwen console API (listApiKeys4Agent).
 * Requires session cookies + sec_token — use when you have them.
 * Returns blocked/deleted status from console without a real inference call.
 *
 * @param {string} cookieHeader
 * @param {string} secToken
 * @param {string} apiKey  — to match against listed keys
 * @returns {Promise<{status: string, detail: string}|null>}  null if key not found
 */
export async function checkQwenKeyStatusViaConsole(cookieHeader, secToken, apiKey) {
  const QWEN_API_GW  = "https://cs-data.qwencloud.com/data/api.json";
  const QWEN_PRODUCT = "sfm_bailian";
  const QWEN_ACTION  = "IntlBroadScopeAspnGateway";
  const QWEN_REGION  = "ap-southeast-1";
  const CORNERSTONE  = {
    domain: "home.qwencloud.com", consoleSite: "QWENCLOUD",
    console: "ONE_CONSOLE", xsp_lang: "en-US", protocol: "V2",
    productCode: "p_efm", switchAgentType: "1", region: QWEN_REGION,
  };

  const paramsPayload = {
    Api: "zeldaEasy.bailian-dash-workspace.api-key.listApiKeys4Agent",
    Data: {
      reqDTO: { pageNo: 1, pageSize: 50, description: "" },
      cornerstoneParam: CORNERSTONE,
    },
  };

  const body = new URLSearchParams({
    product: QWEN_PRODUCT, action: QWEN_ACTION,
    sec_token: secToken, region: QWEN_REGION,
    params: JSON.stringify(paramsPayload),
  }).toString();

  try {
    const res = await fetch(
      `${QWEN_API_GW}?product=${QWEN_PRODUCT}&action=${QWEN_ACTION}&api=zeldaEasy.bailian-dash-workspace.api-key.listApiKeys4Agent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookieHeader,
          Referer: "https://home.qwencloud.com",
          Origin: "https://home.qwencloud.com",
          "User-Agent": UA,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      }
    );

    const data = await res.json();
    const items = data?.data?.DataV2?.data?.data?.items ?? [];

    // Match by key suffix (console masks the middle of the key)
    const suffix = apiKey.slice(-8);
    const found  = items.find((k) => (k.key || k.token || "").endsWith(suffix));
    if (!found) return null;

    if (found.deleted === 1) {
      return { status: "invalid", detail: "key deleted on console" };
    }
    if (found.blocked === 1) {
      return { status: "blocked", detail: "key blocked on console" };
    }
    return { status: "active", detail: `console: ok, expires ${found.gmt_expire}` };
  } catch (err) {
    return { status: "error", detail: `console check failed: ${err.message}` };
  }
}

// ─── standalone CLI ───────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("qwenKeyStatus.mjs")) {
  import("node:fs").then(async ({ readFileSync }) => {
    import("node:path").then(async ({ default: path }) => {
      import("node:url").then(async ({ fileURLToPath }) => {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));

        const args = Object.fromEntries(
          process.argv.slice(2)
            .filter((a) => a.startsWith("--"))
            .map((a) => { const [k, ...v] = a.slice(2).split("="); return [k, v.join("=")]; })
        );

        let apiKey = args.key;
        if (!apiKey) {
          try {
            const result = JSON.parse(readFileSync(path.join(__dirname, "qwen-dot-result.json"), "utf8"));
            apiKey = result.apiKey;
            console.log(`Using key from qwen-dot-result.json: ...${apiKey.slice(-12)}`);
          } catch {
            console.error("❌  --key required or qwen-dot-result.json must exist");
            process.exit(1);
          }
        }

        console.log(`\nChecking key: ...${apiKey.slice(-12)}`);
        const result = await checkQwenKeyStatus(apiKey);
        const icon = result.status === "active" ? "✅" : result.status === "exhausted" ? "⚠️" : "❌";
        console.log(`${icon}  status:  ${result.status}`);
        console.log(`   detail:  ${result.detail}`);
        console.log(`   http:    ${result.httpStatus}`);
      });
    });
  });
}
