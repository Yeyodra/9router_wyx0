#!/usr/bin/env node
/**
 * test-qwen-dot.mjs
 *
 * JS port of etteum-pool/scripts/auth/app/providers/qwen_cloud.py
 *
 * Flow:
 *   1. Launch Camoufox → navigate to home.qwencloud.com/api-keys
 *   2. Drive Google OAuth (click Google btn on Alibaba SSO → fill email/pw)
 *   3. Handle first_login registration (new account binding)
 *   4. Extract session cookies
 *   5. GET /tool/user/info.json → sec_token
 *   6. POST createApiKey4AgentV4 → parse key from data.DataV2.data.data.key
 *   7. Save result
 *
 * Usage:
 *   node scripts/test-qwen-dot.mjs --password=<pw>
 *   node scripts/test-qwen-dot.mjs --email=akuncursork.e1@gmail.com --password=<pw>
 *   node scripts/test-qwen-dot.mjs --headless=false --password=<pw> --engine=chromium
 *
 * Options:
 *   --email     dot-trick Gmail   (default: akuncursorke.1@gmail.com)
 *   --password  Google password   (required)
 *   --engine    camoufox|chromium (default: camoufox)
 *   --headless  true|false        (default: true)
 *   --debug     true|false        (default: false)
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── args ─────────────────────────────────────────────────────────────────────
function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/s);
    if (m) out[m[1]] = m[2];
    else if (arg.startsWith("--")) out[arg.slice(2)] = true;
  }
  return out;
}

const args    = parseArgs();
const EMAIL   = String(args.email    ?? "akuncursorke.1@gmail.com");
const PASSWORD = String(args.password ?? "");
const ENGINE  = String(args.engine   ?? "camoufox");
const HEADLESS = args.headless !== "false" && args.headless !== false;
const DEBUG   = args.debug === "true" || args.debug === true;

if (!PASSWORD) {
  console.error("❌  --password is required");
  process.exit(1);
}

function dbg(msg) {
  if (DEBUG) console.log(`[qwen-cloud-debug] ${msg}`);
}

// ─── constants (mirrors qwen_cloud.py) ────────────────────────────────────────
const QWEN_HOME_URL    = "https://home.qwencloud.com/api-keys";
const QWEN_USER_INFO   = "https://home.qwencloud.com/tool/user/info.json";
const QWEN_API_GW      = "https://cs-data.qwencloud.com/data/api.json";
const QWEN_PRODUCT     = "sfm_bailian";
const QWEN_ACTION      = "IntlBroadScopeAspnGateway";
const QWEN_REGION      = "ap-southeast-1";
const QWEN_CORNERSTONE = {
  domain: "home.qwencloud.com",
  consoleSite: "QWENCLOUD",
  console: "ONE_CONSOLE",
  xsp_lang: "en-US",
  protocol: "V2",
  productCode: "p_efm",
  switchAgentType: "1",
  region: QWEN_REGION,
};

// ─── selectors (matching kiroGoogleAutomation.js) ─────────────────────────────
const EMAIL_SEL = [
  'input[type="email"]',
  'input[autocomplete="username"]',
  'input#identifierId',
  'input[name="identifier"]',
  'input[aria-label*="Email" i]',
].join(", ");

const PASS_SEL = [
  'input[type="password"]',
  'input[name="Passwd"]',
  'input[aria-label*="Password" i]',
  'input[aria-label*="Sandi" i]',
].join(", ");

const NEXT_SEL = [
  "#identifierNext button",
  "#passwordNext button",
  'button:has-text("Next")',
  'button:has-text("Berikutnya")',
  'button:has-text("Continue")',
].join(", ");

const ALLOW_SEL = [
  "#submit_approve_access",
  'button:has-text("Allow")',
  'button:has-text("Izinkan")',
  '[role="button"]:has-text("Allow")',
  'button:has-text("Continue")',
].join(", ");

// Alibaba SSO — "Sign in with Google" button
const GOOGLE_BTN_SEL = [
  'a[href*="google"], a[href*="google_qwen"]',
  'button:has-text("Google")',
  'a:has-text("Google")',
  '[data-provider="google"]',
  'li:has-text("Google")',
  '.oauth-btn[data-type*="google"]',
  'div[class*="google"]:not([class*="captcha"])',
].join(", ");

// ─── helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryClick(page, selector, { timeout = 8_000 } = {}) {
  try {
    await page.locator(selector).first().click({ timeout });
    return true;
  } catch { return false; }
}

async function tryFill(page, selector, value, { timeout = 10_000 } = {}) {
  const loc = page.locator(selector).first();
  try {
    await loc.waitFor({ state: "visible", timeout });
    await loc.fill(value, { timeout: 5_000 });
    const actual = await loc.inputValue().catch(() => "");
    if (actual === value) return true;
  } catch { /* noop */ }
  // React-controlled input fallback (mirrors fillInputResilient in kiroGoogleAutomation.js)
  try {
    await loc.click({ timeout: 3_000 });
    await loc.fill("", { timeout: 2_000 });
    await loc.type(value, { delay: 40, timeout });
    return true;
  } catch { return false; }
}

function getHost(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

/** Poll page.url() until predicate returns true — safer than waitForURL across redirect chains */
async function pollUrl(page, predicate, { timeout = 60_000, interval = 600 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const url = page.url();
    if (predicate(url)) return url;
    await sleep(interval);
  }
  return null;
}

// ─── Google OAuth driver (port of _drive_qwen_google_auth) ────────────────────
async function driveGoogleAuth(page, email, password) {
  let emailTransitionDeadline = 0;
  let passwordTransitionDeadline = 0;
  let googleBtnClicked = false;

  for (let i = 0; i < 180; i++) {
    let cur;
    try { cur = page.url(); } catch { return; }

    const host = getHost(cur);
    dbg(`drive_google loop: ${cur.slice(0, 80)}`);

    // ── done conditions (mirrors Python)
    if (host.endsWith("alibabacloud.com") && cur.includes("first_login")) {
      dbg("Reached first_login — Google auth done"); return;
    }
    if (host.endsWith("alibabacloud.com") && cur.includes("login_aliyun")) {
      dbg("Reached login_aliyun — Google auth done"); return;
    }
    if (host.endsWith("qwencloud.com")) {
      dbg(`Redirected to qwencloud: ${cur.slice(0, 80)}`); return;
    }

    const now = Date.now();
    const onAlibaba = host.endsWith("alibabacloud.com") || host === "account.qwencloud.com";

    // ── on Alibaba SSO page → click Google button
    if (onAlibaba && !host.startsWith("accounts.google")) {
      if (!googleBtnClicked) {
        dbg(`On Alibaba page, trying to click Google button: ${cur.slice(0, 80)}`);
        const clicked = await tryClick(page, GOOGLE_BTN_SEL, { timeout: 5_000 });
        if (clicked) {
          dbg(`Clicked Google sign-in button`);
          googleBtnClicked = true;
          await sleep(2_000);
        } else {
          dbg("Google button not found yet, waiting...");
          await sleep(1_000);
        }
      } else {
        await sleep(700);
      }
      continue;
    }

    // ── handle Google OAuth consent page
    const allowLoc = page.locator(ALLOW_SEL).first();
    const allowCount = await allowLoc.count().catch(() => 0);
    if (allowCount > 0 && await allowLoc.isVisible().catch(() => false)) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => null);
      await sleep(300);
      await allowLoc.click({ timeout: 5_000 }).catch(() => null);
      dbg("Handled Google consent/allow");
      await sleep(1_000);
      continue;
    }

    // ── on Google accounts page → fill email / password
    const onGoogle = host.endsWith("accounts.google.com");
    if (onGoogle) {
      googleBtnClicked = false; // reset in case we come back

      const passLoc = page.locator(PASS_SEL).first();
      const passVisible = await passLoc.isVisible().catch(() => false);
      if (passVisible) {
        if (now < passwordTransitionDeadline) { await sleep(500); continue; }
        const filled = await tryFill(page, PASS_SEL, password);
        if (filled) {
          dbg("Filled password");
          passwordTransitionDeadline = Date.now() + 8_000;
          await sleep(500);
          await tryClick(page, NEXT_SEL);
          await sleep(1_500);
          continue;
        }
      }

      const emailLoc = page.locator(EMAIL_SEL).first();
      const emailVisible = await emailLoc.isVisible().catch(() => false);
      if (emailVisible) {
        if (now < emailTransitionDeadline) { await sleep(500); continue; }
        const filled = await tryFill(page, EMAIL_SEL, email);
        if (filled) {
          dbg("Filled email");
          emailTransitionDeadline = Date.now() + 6_000;
          await sleep(500);
          await tryClick(page, NEXT_SEL);
          await sleep(1_500);
          continue;
        }
      }
    }

    await sleep(700);
  }
}

// ─── Registration handler (port of _complete_registration) ────────────────────
async function completeRegistration(page, curUrl) {
  dbg(`Completing registration at: ${curUrl.slice(0, 80)}`);
  await sleep(3_000);

  // Nationality dropdown if present
  const natSel = 'select[name="nationality"], input[name="nationality"]';
  const natLoc = page.locator(natSel).first();
  if (await natLoc.count().catch(() => 0) > 0) {
    try {
      const tag = await natLoc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
      if (tag === "select") await natLoc.selectOption("SG").catch(() => null);
      else await natLoc.fill("SG").catch(() => null);
      await sleep(500);
    } catch { /* noop */ }
  }

  // Agreement checkbox
  const cbSel = [
    'input[type="checkbox"][name*="agree"]',
    'input[type="checkbox"][id*="agree"]',
    'input[type="checkbox"][id*="protocol"]',
    'input[type="checkbox"]',
  ].join(", ");
  const cbLoc = page.locator(cbSel).first();
  if (await cbLoc.count().catch(() => 0) > 0) {
    const checked = await cbLoc.isChecked().catch(() => false);
    if (!checked) { await cbLoc.click().catch(() => null); await sleep(300); }
  }

  // Submit button
  const submitSel = [
    'button[type="submit"]',
    'button:has-text("Next")',
    'button:has-text("Register")',
    'button:has-text("Sign Up")',
    'button:has-text("Create Account")',
  ].join(", ");
  const submitLoc = page.locator(submitSel).first();
  if (await submitLoc.count().catch(() => 0) > 0) {
    await submitLoc.click().catch(() => null);
    dbg("Clicked registration submit button");
    await sleep(3_000);
  }

  // Wait up to 10s for redirect away from first_login
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!page.url().includes("first_login")) {
      dbg(`Registration redirect complete: ${page.url().slice(0, 80)}`);
      return;
    }
    await sleep(500);
  }
  dbg("Still on first_login after submit — continuing anyway");
}

// ─── sec_token extraction (port of _extract_sec_token) ────────────────────────
async function extractSecToken(cookieHeader) {
  try {
    const res = await fetch(QWEN_USER_INFO, {
      headers: {
        Cookie: cookieHeader,
        Referer: QWEN_HOME_URL,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!res.ok) { dbg(`user/info.json returned ${res.status}`); return ""; }
    const raw = await res.text();
    dbg(`user/info.json raw response: ${raw.slice(0, 300)}`);
    const data = JSON.parse(raw);
    const token =
      data?.sec_token ??
      data?.secToken ??
      data?.data?.sec_token ??
      data?.data?.secToken ??
      data?.content?.sec_token ??
      "";
    dbg(token ? `sec_token extracted: ${token.slice(0, 20)}...` : `sec_token not found in keys: ${Object.keys(data).join(", ")}`);
    return token;
  } catch (e) {
    dbg(`sec_token extraction failed: ${e.message}`);
    return "";
  }
}

// ─── API gateway call (port of _call_api_gateway) ─────────────────────────────
async function callApiGateway(cookieHeader, secToken, apiName, reqDTO) {
  const paramsPayload = {
    Api: apiName,
    Data: {
      reqDTO,
      cornerstoneParam: QWEN_CORNERSTONE,
    },
  };

  const body = new URLSearchParams({
    product: QWEN_PRODUCT,
    action: QWEN_ACTION,
    sec_token: secToken,
    region: QWEN_REGION,
    params: JSON.stringify(paramsPayload),
  }).toString();

  const url = `${QWEN_API_GW}?product=${QWEN_PRODUCT}&action=${QWEN_ACTION}&api=${encodeURIComponent(apiName)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader,
      Referer: QWEN_HOME_URL,
      Origin: "https://home.qwencloud.com",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    body,
  });

  const data = await res.json();
  dbg(`API ${apiName} → ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  return data;
}

// ─── main ─────────────────────────────────────────────────────────────────────
let browser;

try {
  const { launchBulkImportBrowser } = await import(
    pathToFileURL(path.join(ROOT, "src/lib/oauth/services/bulkImportBrowserEngine.js")).href
  );

  console.log(`\n⏩  Launching ${ENGINE} (headless=${HEADLESS})`);
  browser = await launchBulkImportBrowser({ engine: ENGINE, headless: HEADLESS });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page    = await context.newPage();
  page.setDefaultTimeout(120_000);

  // ── 1. Navigate to api-keys → triggers SSO redirect ──────────────────────────
  console.log("⏩  Navigating to home.qwencloud.com/api-keys");
  await page.goto(QWEN_HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
  await sleep(2_000);

  // ── 2. Drive Google OAuth ─────────────────────────────────────────────────────
  console.log("⏩  Driving Google OAuth...");
  await driveGoogleAuth(page, EMAIL, PASSWORD);
  await sleep(2_000);

  // ── 3. Handle first_login registration if new account ─────────────────────────
  const postGoogleUrl = page.url();
  dbg(`Post-Google URL: ${postGoogleUrl.slice(0, 100)}`);

  if (postGoogleUrl.includes("first_login") && postGoogleUrl.includes("reg_and_bind")) {
    console.log("⏩  New account detected — completing registration");
    await completeRegistration(page, postGoogleUrl);
  } else if (postGoogleUrl.includes("first_login")) {
    dbg("first_login (non-reg) — waiting for redirect");
    await sleep(3_000);
  }

  // ── 4. Wait for home.qwencloud.com landing ────────────────────────────────────
  console.log("⏩  Waiting for home.qwencloud.com...");
  const landed = await pollUrl(page, (u) => u.includes("home.qwencloud.com"), { timeout: 45_000 });
  if (!landed) throw new Error(`Never landed on home.qwencloud.com — stuck at: ${page.url().slice(0, 100)}`);

  console.log(`⏩  Landed: ${page.url().slice(0, 80)}`);
  await sleep(1_500);

  // ── 5. Extract cookies ────────────────────────────────────────────────────────
  const rawCookies = await context.cookies();
  const cookieMap  = Object.fromEntries(rawCookies.map((c) => [c.name, c.value]));
  const cookieHeader = rawCookies.map((c) => `${c.name}=${c.value}`).join("; ");

  dbg(`Got ${rawCookies.length} cookies`);

  if (!cookieMap.login_qwencloud_ticket) {
    throw new Error("login_qwencloud_ticket cookie not found after login — authentication may have failed");
  }
  console.log(`⏩  login_qwencloud_ticket present (${rawCookies.length} cookies total)`);

  // ── 6. Get sec_token ──────────────────────────────────────────────────────────
  console.log("⏩  Fetching sec_token...");
  const secToken = await extractSecToken(cookieHeader);
  if (!secToken) throw new Error("Failed to extract sec_token from user/info.json");
  console.log(`⏩  sec_token: ${secToken.slice(0, 12)}...`);

  // ── 7. Create API key ─────────────────────────────────────────────────────────
  console.log("⏩  Creating API key...");
  const createResp = await callApiGateway(
    cookieHeader,
    secToken,
    "zeldaEasy.bailian-dash-workspace.api-key.createApiKey4AgentV4",
    { description: `poolprox-${Date.now()}` }
  );

  // Parse key: resp.data.DataV2.data.data.key  (field is "key" not "apiKey")
  const inner = createResp?.data?.DataV2?.data?.data ?? {};
  const apiKey      = inner.key || inner.apiKey || inner.api_key || "";
  const workspaceId = inner.workspace_id || "";
  const gmtExpire   = inner.gmt_expire || "";
  const keyId       = String(inner.id || "");
  const description = inner.description || "";

  if (!apiKey) {
    const errMsg =
      createResp?.data?.errorMsg ||
      createResp?.data?.DataV2?.errorMsg ||
      JSON.stringify(createResp).slice(0, 300);
    throw new Error(`createApiKey returned no key: ${errMsg}`);
  }

  console.log(`\n🔑  API key: ${apiKey}`);
  console.log(`    workspace: ${workspaceId}  id: ${keyId}  expires: ${gmtExpire}`);

  // ── 8. Save result ────────────────────────────────────────────────────────────
  const result = {
    email: EMAIL,
    engine: ENGINE,
    apiKey,
    workspaceId,
    keyId,
    description,
    gmtExpire,
    secToken,
    timestamp: new Date().toISOString(),
    finalUrl: page.url(),
  };

  const outPath = path.join(__dirname, "qwen-dot-result.json");
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\n✅  Done → scripts/qwen-dot-result.json`);

} catch (err) {
  console.error(`\n❌  ${err.message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => null);
}
