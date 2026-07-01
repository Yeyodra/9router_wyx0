/**
 * login-kiro-builder-id.mjs
 * Standalone Builder ID Device Code Flow login script for 9router
 *
 * Flow:
 *   1. POST /api/auth/login → get auth_token cookie
 *   2. For each account (email|password):
 *      a. GET /api/oauth/kiro/device-code
 *      b. Open Camoufox → navigate to verification_uri_complete
 *      c. Log into AWS Builder ID portal (email → OTP? → password → consent)
 *      d. Poll POST /api/oauth/kiro/poll until success or timeout
 *   3. Stream CSV: email,status,connection_id,error,timestamp
 *
 * OTP support: If AWS requires email verification, reads 6-digit code via
 * Gmail API (gmail_tokens.json). Falls back to 120s manual wait if tokens
 * not found.
 *
 * Usage:
 *   node scripts/login-kiro-builder-id.mjs
 *
 *   ACCOUNTS_FILE=scripts/accounts.txt
 *   CONCURRENCY=2
 *   HEADLESS=false
 *   PROXY_URLS=http://user:pass@host:port
 *   ROUTER_URL=http://localhost:20128
 *   node scripts/login-kiro-builder-id.mjs
 */

import { firefox } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ─── Config ───────────────────────────────────────────────────────────────────
function parseProxyUrls() {
  const raw = process.env.PROXY_URLS || process.env.PROXY_URL || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

const CONFIG = {
  routerUrl:      process.env.ROUTER_URL || "http://localhost:3000",
  routerPassword: "123456",
  accountsFile:   process.env.ACCOUNTS_FILE || path.join(__dirname, "accounts.txt"),
  concurrency:    Math.min(8, Math.max(1, Number(process.env.CONCURRENCY) || 2)),
  headless:       process.env.HEADLESS !== "false",
  proxyUrls:      parseProxyUrls(),
  outputDir:      process.env.OUTPUT_DIR || path.join(__dirname, "results"),
  engine:         "camoufox",   // hardcoded — camoufox only
  pollTimeoutMs:  600_000,
  pollIntervalMs: 1_000,        // from HAR: interval: 1
  gmailTokenFile: process.env.GMAIL_TOKEN_FILE || path.join(__dirname, "..", "..", "qwencloud-generator", "gmail_tokens.json"),
};

// Helper: pick proxy for worker (round-robin)
function getProxyForWorker(workerId) {
  if (!CONFIG.proxyUrls.length) return null;
  return CONFIG.proxyUrls[(workerId - 1) % CONFIG.proxyUrls.length];
}

fs.mkdirSync(CONFIG.outputDir, { recursive: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nowIso() { return new Date().toISOString(); }

function log(workerId, email, msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`[${ts}][Worker ${workerId}] ${email} → ${msg}`);
}

// ─── Account file parser ──────────────────────────────────────────────────────
function loadAccounts(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`[ERROR] Accounts file not found: ${filePath}`);
    console.error("  Create a file with one account per line: email|password");
    process.exit(1);
  }
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const accounts = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [email, ...rest] = line.split("|");
    const password = rest.join("|");
    if (!email || !password) {
      console.warn(`[WARN] Skipping malformed line: ${line}`);
      continue;
    }
    accounts.push({ email: email.trim(), password: password.trim() });
  }
  return accounts;
}

// ─── 9router auth ─────────────────────────────────────────────────────────────
// Shared auth state — one token for all workers
const authState = {
  token: null,
  expiresAt: 0,   // ms timestamp
};

async function loginRouter() {
  const resp = await fetch(`${CONFIG.routerUrl}/api/auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ password: CONFIG.routerPassword }),
  });
  if (!resp.ok) {
    throw new Error(`9router login failed: ${resp.status} ${await resp.text()}`);
  }
  // Extract auth_token from set-cookie response header
  const setCookie = resp.headers.get("set-cookie") || "";
  const match = setCookie.match(/auth_token=([^;]+)/);
  if (!match) {
    throw new Error("auth_token cookie not found in login response");
  }
  authState.token = match[1];
  // JWT expires in 24h — refresh proactively at 23h
  authState.expiresAt = Date.now() + 23 * 60 * 60 * 1000;
  console.log("[auth] 9router login successful — token acquired");
}

async function getAuthToken() {
  if (!authState.token || Date.now() >= authState.expiresAt) {
    await loginRouter();
  }
  return authState.token;
}

// Background token refresh — runs every 23h
async function startTokenRefreshLoop() {
  // Initial login done in main(); this loop handles renewal
  while (true) {
    const msUntilRefresh = Math.max(0, authState.expiresAt - Date.now());
    await sleep(msUntilRefresh);
    try {
      await loginRouter();
      console.log("[auth] Token refreshed proactively");
    } catch (err) {
      console.error("[auth] Token refresh failed:", err.message);
      // Retry in 1 minute
      authState.expiresAt = Date.now() + 60_000;
    }
  }
}

function routerHeaders(token) {
  return {
    "Cookie":       `auth_token=${token}`,
    "Content-Type": "application/json",
  };
}

// ─── Device Code flow ─────────────────────────────────────────────────────────
async function fetchDeviceCode(token) {
  const resp = await fetch(`${CONFIG.routerUrl}/api/oauth/kiro/device-code`, {
    headers: { Cookie: `auth_token=${token}` },
  });
  if (!resp.ok) {
    throw new Error(`device-code API failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

async function pollOnce(token, deviceCode, extraData) {
  const resp = await fetch(`${CONFIG.routerUrl}/api/oauth/kiro/poll`, {
    method:  "POST",
    headers: routerHeaders(token),
    body: JSON.stringify({
      deviceCode,
      codeVerifier: "",
      extraData,
    }),
  });
  if (!resp.ok) {
    throw new Error(`poll API error: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

// ─── Browser fingerprint (for non-camoufox fallback only) ─────────────────────
const FP_VIEWPORTS = [
  { width: 1920, height: 1080 }, { width: 1440, height: 900 },
  { width: 1536, height: 864  }, { width: 1366, height: 768 },
  { width: 1280, height: 800  },
];
function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ─── Browser launcher ─────────────────────────────────────────────────────────
async function launchBrowser() {
  const camoufox = require("camoufox-js");
  // Camoufox handles its own fingerprinting; proxy set at context level
  const opts = await camoufox.launchOptions({ headless: CONFIG.headless });
  return firefox.launch(opts);
}

// ─── AWS Builder ID portal automation ────────────────────────────────────────

// Selectors — mirrored from kiroGoogleAutomation.js + task spec
const AWS_EMAIL_SELECTORS = [
  'input[type="email"]',
  'input[name="username"]',
  'input[placeholder*="email" i]',
  '#username',
  'input[autocomplete="username"]',
  'input[aria-label*="Email" i]',
].join(", ");

const AWS_PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
  '#password',
  'input[aria-label*="Password" i]',
].join(", ");

const AWS_NEXT_SELECTORS = [
  'button:has-text("Next")',
  'button:has-text("Continue")',
  '#identifierNext button',
  'button[type="submit"]',
  'input[type="submit"]',
];

const AWS_SIGNIN_SELECTORS = [
  'button:has-text("Sign in")',
  'button:has-text("Submit")',
  'button[type="submit"]',
  '#passwordNext button',
  'input[type="submit"]',
];

const AWS_CONSENT_SELECTORS = [
  'button:has-text("Allow")',
  'input[type="submit"][value*="Allow" i]',
  '#submit_approve_access',
  'button:has-text("Confirm")',
  '[role="button"]:has-text("Allow")',
  'button:has-text("Accept")',
  'button:has-text("Yes")',
  'button:has-text("Authorize")',
];

const AWS_COOKIE_SELECTORS = [
  '#awsccc-cb-btn-accept',
  'button:has-text("Accept")',
  'button:has-text("Accept all")',
  'button:has-text("Accept cookies")',
];

const AWS_OTP_SELECTORS = [
  'input[placeholder*="6-digit" i]',
  'input[placeholder*="verification code" i]',
  'input[placeholder*="Verification" i]',
  'input[data-testid*="code" i]',
  'input[data-testid*="otp" i]',
  'input[name="emailCaptcha"]',
  '#emailCaptcha',
  'input[placeholder*="code" i]',
  'input[autocomplete="one-time-code"]',
  'input[name*="code" i]',
  'input[inputmode="numeric"]',
  'input[maxlength="6"]',
].join(", ");

async function dismissCookieConsent(page, workerId, email) {
  for (const sel of AWS_COOKIE_SELECTORS) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await btn.click();
        log(workerId, email, "cookie consent dismissed");
        await sleep(500);
        return;
      }
    } catch { /* not present */ }
  }
}

// ─── Gmail API OTP ────────────────────────────────────────────────────────────
function _extractPart(payload, mime) {
  if (payload.mimeType === mime && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }
  for (const p of payload.parts || []) {
    const t = _extractPart(p, mime);
    if (t) return t;
  }
  return "";
}

function loadGmailTokens() {
  return JSON.parse(fs.readFileSync(CONFIG.gmailTokenFile, "utf8"));
}

function saveGmailTokens(data) {
  fs.writeFileSync(CONFIG.gmailTokenFile, JSON.stringify(data, null, 2), "utf8");
}

function normalizeGmail(email) {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  if (["gmail.com", "googlemail.com"].includes(domain.toLowerCase())) {
    return `${local.replace(/\./g, "").split("+")[0]}@${domain}`;
  }
  return email;
}

async function getGmailAccessToken(email) {
  const data = loadGmailTokens();
  const base = normalizeGmail(email);
  const accounts = data.accounts || {};
  const acc = accounts[base] || accounts[email];
  if (!acc) throw new Error(`No Gmail token found for ${email} (normalized: ${base}). Run authorize.py first.`);

  if (acc.access_token && acc.expires_at && acc.expires_at > Date.now() / 1000 + 60) {
    return acc.access_token;
  }

  const clientId = acc.client_id || data.default_client?.client_id;
  const clientSecret = acc.client_secret || data.default_client?.client_secret;
  const refreshToken = acc.refresh_token;
  if (!refreshToken) throw new Error(`No refresh_token for ${email}. Run authorize.py first.`);

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = await resp.json();
  if (!json.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(json)}`);

  acc.access_token = json.access_token;
  acc.expires_at = Math.floor(Date.now() / 1000) + (json.expires_in || 3600);
  saveGmailTokens(data);
  return json.access_token;
}

async function readOtpFromGmail(email, { timeout = 120_000, since = null } = {}) {
  const deadline = Date.now() + timeout;
  const sinceMs = since ? new Date(since).getTime() - 60_000 : Date.now() - 120_000;
  // AWS Builder ID login OTP sender is login.awsapps.com (different from signin.aws used during registration)
  const q = encodeURIComponent("from:no-reply@login.awsapps.com OR from:no-reply@signin.aws");
  const listUrl = `https://www.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=10`;

  let pollCount = 0;
  let lastMsgCount = -1;
  while (Date.now() < deadline) {
    pollCount++;
    try {
      const accessToken = await getGmailAccessToken(email);
      const listResp = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (listResp.status === 429) { await sleep(5_000); continue; }
      if (!listResp.ok) { await sleep(2_000); continue; }

      const { messages = [] } = await listResp.json();
      if (pollCount === 1 || messages.length !== lastMsgCount) {
        log(null, email, `[poll #${pollCount}] Gmail: ${messages.length} msg(s) from signin.aws (waiting for new OTP...)`);
      }
      lastMsgCount = messages.length;

      for (const m of messages) {
        const msgResp = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!msgResp.ok) continue;
        const msg = await msgResp.json();
        const msgDate = parseInt(msg.internalDate || "0");
        if (msgDate < sinceMs) continue;

        const headers = Object.fromEntries((msg.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
        if (!(headers["from"] || "").includes("signin.aws") && !(headers["from"] || "").includes("login.awsapps.com")) continue;

        // Confirm email is addressed to THIS specific alias — prevents cross-worker OTP theft
        const to = (headers["to"] || "").replace(/[<>]/g, "").toLowerCase();
        const normalizedEmail = email.toLowerCase();
        const normalizedBase = normalizedEmail.replace(/\./g, "").split("@")[0] + "@" + normalizedEmail.split("@")[1];
        if (!to.includes(normalizedEmail) && !to.includes(normalizedBase)) {
          log(null, email, `  → msg skipped: To="${headers["to"]}" doesn't match ${email}`);
          continue;
        }
        log(null, email, `  → NEW email: subj="${headers["subject"]}" date=${new Date(msgDate).toISOString()}`);

        const combined = _extractPart(msg.payload || {}, "text/plain") + " " + _extractPart(msg.payload || {}, "text/html");

        // AWS OTP email: 6-digit code inside a large styled div (font-size:36px or bold)
        // Try specific patterns first before fallback
        const divMatch = combined.match(/<div[^>]*font-size:\s*36px[^>]*>\s*(\d{6})\s*<\/div>/i)
          || combined.match(/<div[^>]*font-weight:\s*bold[^>]*padding-bottom[^>]*>\s*(\d{6})\s*<\/div>/i)
          || combined.match(/Verification code[^<]*<\/div>\s*<div[^>]*>\s*(\d{6})\s*<\/div>/is)
          || combined.match(/verification code\b[\s\S]{0,200}?(\d{6})/i);
        if (divMatch) {
          log(null, email, `OTP found: ${divMatch[1]}`);
          return divMatch[1];
        }
        log(null, email, `  → no OTP found in email body`);
      }
    } catch (err) {
      log(null, email, `Gmail poll error: ${err.message}`);
    }
    await sleep(3_000);
  }
  return null;
}

async function clickFirst(page, selectors, timeoutMs = 10_000) {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await el.click({ timeout: timeoutMs });
        return sel;
      }
    } catch { /* try next */ }
  }
  return null;
}

async function typeCharByChar(page, selector, text, delayMs = 35) {
  const el = page.locator(selector).first();
  await el.click();
  await el.fill("");
  for (const ch of text) {
    await el.type(ch, { delay: delayMs });
  }
}

/**
 * runBrowserAuth — navigates the full AWS Builder ID Device Code portal.
 * Resolves when consent approved (or throws on error).
 * Accepts a `closedSignal` object { closed: false } so poll loop can
 * signal early termination.
 */
async function runBrowserAuth(browser, verificationUriComplete, email, password, workerId, closedSignal) {
  let context = null;
  let page = null;

  try {
    // Camoufox: proxy split into server/username/password
    const proxyUrl = getProxyForWorker(workerId);
    let proxyOpt = {};
    if (proxyUrl) {
      try {
        const u = new URL(proxyUrl);
        proxyOpt = {
          proxy: {
            server:   `${u.protocol}//${u.hostname}:${u.port}`,
            username: decodeURIComponent(u.username),
            password: decodeURIComponent(u.password),
          },
        };
      } catch {
        proxyOpt = { proxy: { server: proxyUrl } };
      }
    }

    const vp = randomPick(FP_VIEWPORTS);
    context = await browser.newContext({
      viewport: vp,
      ...proxyOpt,
    });
    page = await context.newPage();
    await page.setViewportSize(vp).catch(() => null);

    log(workerId, email, `navigating to ${verificationUriComplete}`);
    await page.goto(verificationUriComplete, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await sleep(1_500);

    // Step 3a: cookie consent (may appear)
    await dismissCookieConsent(page, workerId, email);

    // Step 3b: wait for redirect to signin.aws
    log(workerId, email, "waiting for signin.aws redirect...");
    try {
      await page.waitForURL((url) => url.href.includes("signin.aws"), { timeout: 30_000 });
    } catch {
      // May already be on signin.aws or different redirect path — continue
      log(workerId, email, "signin.aws wait timed out — checking current URL");
    }
    await sleep(1_000);
    await dismissCookieConsent(page, workerId, email);

    log(workerId, email, `on: ${page.url()}`);

    // Step 3c: email field
    log(workerId, email, "filling email...");
    await page.waitForSelector(AWS_EMAIL_SELECTORS, { timeout: 30_000 });
    await typeCharByChar(page, AWS_EMAIL_SELECTORS, email, 35);
    await sleep(300 + Math.random() * 200);

    const nextClicked = await clickFirst(page, AWS_NEXT_SELECTORS, 10_000);
    if (!nextClicked) throw new Error("Could not click Next/Continue after email");
    log(workerId, email, `clicked: ${nextClicked}`);
    await page.waitForLoadState("domcontentloaded");
    await sleep(1_500);

    // Step 3c.5: OTP (if required — not all accounts need it)
    const otpSentAt = new Date();
    // Check if OTP field appeared (max 15s — some accounts skip OTP entirely)
    let otpFieldVisible = false;
    for (let i = 0; i < 10; i++) {
      for (const sel of AWS_OTP_SELECTORS.split(", ")) {
        if (await page.locator(sel.trim()).first().isVisible({ timeout: 1_000 }).catch(() => false)) {
          otpFieldVisible = true;
          break;
        }
      }
      if (otpFieldVisible) break;
      // Also check if password field appeared — if so, OTP not needed
      const pwVisible = await page.locator(AWS_PASSWORD_SELECTORS).first().isVisible({ timeout: 500 }).catch(() => false);
      if (pwVisible) break;
      await sleep(1_500);
    }

    if (otpFieldVisible) {
      log(workerId, email, "OTP field detected — polling Gmail API...");
      // Check if Gmail tokens file exists — if not, skip OTP (user must handle manually)
      const gmailTokensExist = fs.existsSync(CONFIG.gmailTokenFile);
      if (!gmailTokensExist) {
        log(workerId, email, `WARN: Gmail tokens not found at ${CONFIG.gmailTokenFile} — cannot auto-fill OTP. Waiting 120s for manual OTP...`);
        // Wait up to 120s for manual OTP entry
        await sleep(120_000);
      } else {
        const otp = await readOtpFromGmail(email, { timeout: 120_000, since: otpSentAt });
        if (!otp) throw new Error("OTP not received within 120s");
        log(workerId, email, `OTP received: ${otp}`);
        // Fill OTP
        let otpFilled = false;
        for (const selRaw of AWS_OTP_SELECTORS.split(", ")) {
          const sel = selRaw.trim();
          try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
              await el.click();
              await sleep(200);
              for (const ch of otp) {
                await page.keyboard.type(ch, { delay: 35 });
              }
              otpFilled = true;
              break;
            }
          } catch { /* try next */ }
        }
        if (!otpFilled) throw new Error("OTP input field disappeared before we could fill it");
        // Submit OTP
        await clickFirst(page, AWS_NEXT_SELECTORS, 10_000);
        await page.waitForLoadState("domcontentloaded");
        await sleep(2_000);
        log(workerId, email, "OTP submitted");
      }
    } else {
      log(workerId, email, "no OTP required — proceeding to password");
    }

    // Step 3d: password field
    log(workerId, email, "filling password...");
    await page.waitForSelector(AWS_PASSWORD_SELECTORS, { timeout: 30_000 });
    const pwdEl = page.locator(AWS_PASSWORD_SELECTORS).first();
    await pwdEl.click();
    await pwdEl.fill(password);
    await sleep(200 + Math.random() * 200);

    const signInClicked = await clickFirst(page, AWS_SIGNIN_SELECTORS, 10_000);
    if (!signInClicked) throw new Error("Could not click Sign in / Submit after password");
    log(workerId, email, `clicked: ${signInClicked}`);
    await page.waitForLoadState("domcontentloaded");
    await sleep(2_000);

    // Step 3e: consent/allow page
    log(workerId, email, "waiting for consent page...");
    try {
      await page.waitForURL(
        (url) => url.href.includes("oidc") || url.href.includes("consent") || url.href.includes("oauth"),
        { timeout: 30_000 }
      );
    } catch {
      log(workerId, email, "consent URL wait timed out — looking for Allow button anyway");
    }
    await sleep(1_000);

    const allowClicked = await clickFirst(page, AWS_CONSENT_SELECTORS, 15_000);
    if (!allowClicked) throw new Error("Could not find Allow/Confirm button on consent page");
    log(workerId, email, `consent clicked: ${allowClicked}`);
    await page.waitForLoadState("domcontentloaded");
    await sleep(1_500);

    // Step 3f: success indicator
    log(workerId, email, "waiting for success indicator...");
    try {
      await page.waitForURL(
        (url) =>
          url.href.includes("workflowResultHandle") ||
          (url.href.includes("view.awsapps.com/start") && !url.href.includes("/device")),
        { timeout: 30_000 }
      );
      log(workerId, email, "browser: success URL detected");
    } catch {
      log(workerId, email, "browser: success URL timeout — assuming approved");
    }

    closedSignal.closed = true;
    return { status: "browser_done" };
  } finally {
    if (page)    await page.close().catch(() => null);
    if (context) await context.close().catch(() => null);
  }
}

// ─── Poll loop ─────────────────────────────────────────────────────────────────
async function pollUntilSuccess(token, deviceCode, extraData, workerId, email, closedSignal) {
  const deadline = Date.now() + CONFIG.pollTimeoutMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    if (closedSignal.closed) {
      // Browser errored out — stop polling
      throw new Error("browser closed before poll succeeded");
    }

    await sleep(CONFIG.pollIntervalMs);
    attempts++;

    try {
      const result = await pollOnce(token, deviceCode, extraData);

      if (result.success) {
        log(workerId, email, `poll success after ${attempts} attempts`);
        return result;
      }

      if (result.pending || result.error === "authorization_pending") {
        if (attempts % 30 === 0) {
          log(workerId, email, `still polling... (${attempts}s elapsed)`);
        }
        continue;
      }

      // Non-pending, non-success error
      throw new Error(`poll error: ${result.error || JSON.stringify(result)}`);
    } catch (err) {
      if (err.message.startsWith("poll error:") || err.message.startsWith("browser closed")) {
        throw err;
      }
      // Network transient error — retry
      log(workerId, email, `poll network error (retry): ${err.message}`);
    }
  }

  throw new Error(`poll timeout after ${CONFIG.pollTimeoutMs / 1000}s`);
}

// ─── Worker ───────────────────────────────────────────────────────────────────
async function runWorker(account, workerId) {
  const { email, password } = account;
  let browser = null;

  try {
    // Ensure we have a valid token
    const token = await getAuthToken();

    // Step 1: Get device code
    log(workerId, email, "fetching device code...");
    let deviceData;
    try {
      deviceData = await fetchDeviceCode(token);
    } catch (err) {
      return { email, status: "failed_device_code", connection_id: "", error: err.message, timestamp: nowIso() };
    }

    const {
      device_code:              deviceCode,
      verification_uri_complete: verificationUriComplete,
      _clientId,
      _clientSecret,
      _region,
      _authMethod,
    } = deviceData;

    log(workerId, email, `device code: ${deviceData.user_code} — ${verificationUriComplete}`);

    const extraData = {
      _clientId,
      _clientSecret,
      _region:     _region     || "us-east-1",
      _authMethod: _authMethod || "builder-id",
    };

    // Step 2: Launch browser
    log(workerId, email, `launching camoufox browser`);
    browser = await launchBrowser();

    // closedSignal lets poll loop detect browser early exit
    const closedSignal = { closed: false };

    // Step 3: Run poll + browser in parallel
    let pollResult;
    try {
      [pollResult] = await Promise.all([
        pollUntilSuccess(token, deviceCode, extraData, workerId, email, closedSignal).catch((err) => {
          closedSignal.closed = true;
          throw err;
        }),
        runBrowserAuth(browser, verificationUriComplete, email, password, workerId, closedSignal).catch((err) => {
          closedSignal.closed = true;
          log(workerId, email, `browser error: ${err.message}`);
          // Don't throw — let poll loop handle failure
          return { status: "browser_error", error: err.message };
        }),
      ]);
    } catch (err) {
      // Poll loop threw (timeout or fatal)
      if (err.message.includes("poll timeout")) {
        return { email, status: "failed_poll_timeout", connection_id: "", error: err.message, timestamp: nowIso() };
      }
      if (err.message.includes("browser closed")) {
        return { email, status: "failed_browser", connection_id: "", error: "browser exited before auth completed", timestamp: nowIso() };
      }
      throw err;
    }

    const connectionId = pollResult?.connection?.id || "";
    log(workerId, email, `SUCCESS — connection_id: ${connectionId}`);
    return { email, status: "success", connection_id: connectionId, error: "", timestamp: nowIso() };

  } catch (err) {
    log(workerId, email, `FAILED: ${err.message}`);
    return { email, status: "failed", connection_id: "", error: err.message, timestamp: nowIso() };
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
}

// ─── CSV streaming ────────────────────────────────────────────────────────────
function appendToCsv(streamCsvPath, r) {
  try {
    const err = (r.error || "").replace(/,/g, ";").replace(/\n/g, " ");
    const line = `${r.email},${r.status},${r.connection_id},${err},${r.timestamp}\n`;
    fs.appendFileSync(streamCsvPath, line, "utf8");
  } catch { /* non-fatal */ }
}

// ─── Worker pool ──────────────────────────────────────────────────────────────
async function runWorkerPool(accounts, concurrency, streamCsvPath) {
  const results = [];
  let nextIdx = 0;
  let active = 0;

  return new Promise((resolve) => {
    async function tryLaunch() {
      while (active < concurrency && nextIdx < accounts.length) {
        const account = accounts[nextIdx];
        const workerId = nextIdx + 1;
        nextIdx++;
        active++;

        runWorker(account, workerId).then(async (result) => {
          results.push(result);
          appendToCsv(streamCsvPath, result);
          active--;

          // 5-15s jitter between workers
          const jitterMs = 5_000 + Math.floor(Math.random() * 10_000);
          console.log(`[jitter] Worker ${workerId} done — waiting ${(jitterMs / 1000).toFixed(1)}s before next job`);
          await sleep(jitterMs);
          tryLaunch();
          if (active === 0 && nextIdx >= accounts.length) resolve(results);
        });
      }
      if (active === 0 && nextIdx >= accounts.length) resolve(results);
    }
    tryLaunch();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log(" Kiro Builder ID Login — Device Code Flow");
  console.log("=".repeat(60));
  console.log(`  Router URL   : ${CONFIG.routerUrl}`);
  console.log(`  Accounts file: ${CONFIG.accountsFile}`);
  console.log(`  Concurrency  : ${CONFIG.concurrency}`);
  console.log(`  Headless     : ${CONFIG.headless}`);
  console.log(`  Poll timeout : ${CONFIG.pollTimeoutMs / 1000}s`);
  console.log(`  Gmail tokens : ${fs.existsSync(CONFIG.gmailTokenFile) ? CONFIG.gmailTokenFile : "not found (manual OTP fallback)"}`);
  console.log(`  Output dir   : ${CONFIG.outputDir}`);
  if (CONFIG.proxyUrls.length > 0) {
    console.log(`  Proxies      : ${CONFIG.proxyUrls.length} (round-robin per worker)`);
    CONFIG.proxyUrls.forEach((p, i) => {
      const masked = p.replace(/\/\/([^:]+):([^@]+)@/, "//***:***@");
      console.log(`    [${i + 1}] ${masked}`);
    });
  } else {
    console.log(`  Proxies      : none`);
  }
  console.log("=".repeat(60));
  console.log();

  // Step 0: 9router login
  console.log("[auth] Logging into 9router...");
  try {
    await loginRouter();
  } catch (err) {
    console.error(`[FATAL] 9router login failed: ${err.message}`);
    process.exit(1);
  }

  // Start background token refresh loop (fire-and-forget)
  startTokenRefreshLoop().catch(() => null);

  // Load accounts
  const accounts = loadAccounts(CONFIG.accountsFile);
  if (accounts.length === 0) {
    console.error("[ERROR] No accounts found in accounts file");
    process.exit(1);
  }
  console.log(`Loaded ${accounts.length} accounts:`);
  for (const acc of accounts) {
    console.log(`  ${acc.email}`);
  }
  console.log();

  // Create streaming CSV
  const csvTs = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19).replace("T", "-");
  const streamCsvPath = path.join(CONFIG.outputDir, `kiro-login-${csvTs}.csv`);
  fs.writeFileSync(streamCsvPath, "email,status,connection_id,error,timestamp\n", "utf8");
  console.log(`Streaming CSV: ${streamCsvPath}`);
  console.log();

  const startTime = Date.now();
  const results = await runWorkerPool(accounts, CONFIG.concurrency, streamCsvPath);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const success       = results.filter((r) => r.status === "success");
  const failedTimeout = results.filter((r) => r.status === "failed_poll_timeout");
  const failedBrowser = results.filter((r) => r.status === "failed_browser");
  const failedDevice  = results.filter((r) => r.status === "failed_device_code");
  const failedOther   = results.filter(
    (r) => !["success", "failed_poll_timeout", "failed_browser", "failed_device_code"].includes(r.status)
  );

  console.log();
  console.log("=".repeat(60));
  console.log(" RESULTS");
  console.log("=".repeat(60));
  console.log(`  Total          : ${results.length}`);
  console.log(`  Success        : ${success.length}`);
  console.log(`  Poll timeout   : ${failedTimeout.length}`);
  console.log(`  Browser error  : ${failedBrowser.length}`);
  console.log(`  Device code err: ${failedDevice.length}`);
  console.log(`  Other failures : ${failedOther.length}`);
  console.log(`  Elapsed        : ${elapsed}s`);
  console.log();

  if (success.length > 0) {
    console.log("Successful logins:");
    for (const r of success) {
      console.log(`  ✓ ${r.email} | connection: ${r.connection_id}`);
    }
    console.log();
  }

  if (failedTimeout.length + failedBrowser.length + failedDevice.length + failedOther.length > 0) {
    console.log("Failed accounts:");
    for (const r of [...failedTimeout, ...failedBrowser, ...failedDevice, ...failedOther]) {
      console.log(`  ✗ ${r.email} [${r.status}] — ${r.error}`);
    }
    console.log();
  }

  console.log(`CSV saved: ${streamCsvPath}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("[FATAL]", err.message);
  process.exit(1);
});
