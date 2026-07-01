/**
 * kiro-token-extractor.mjs
 * Login ke Kiro (AWS Builder ID) via Playwright, route device-code flow through
 * 9router API instead of hitting AWS OIDC directly.
 *
 * Flow:
 *   1. POST /api/auth/login → get auth_token cookie
 *   2. For each account (email|password):
 *      a. GET /api/oauth/kiro/device-code  (via 9router)
 *      b. Open browser → navigate to verification_uri_complete
 *      c. Log into AWS Builder ID portal (email → OTP? → password → consent)
 *      d. Poll POST /api/oauth/kiro/poll until success or timeout
 *   3. Stream CSV: email,status,connection_id,error,timestamp
 *
 * Env vars:
 *   CSV_FILE      → path ke CSV hasil registration (required)
 *   ROUTER_URL    → 9router base URL (default: http://localhost:3000)
 *   ENGINE        → camoufox | chromium (default: camoufox)
 *   HEADLESS      → true | false (default: true)
 *   CONCURRENCY   → 1-4 (default: 2)
 */

import { firefox, chromium } from "playwright";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ─── Guard against Playwright internal Firefox/Camoufox uncaughtException ─────
// playwright-core has a bug where FFBrowserContext emits pageError with
// pageError.location === undefined, crashing the Node.js process.
// This guard swallows only that specific internal Playwright error.
process.on("uncaughtException", (err) => {
  if (
    err instanceof TypeError &&
    err.message.includes("Cannot read properties of undefined") &&
    err.message.includes("url") &&
    err.stack?.includes("playwright")
  ) {
    // Playwright internal Firefox bug — safe to swallow
    return;
  }
  // Re-throw anything else so real errors still crash loudly
  console.error("[FATAL uncaughtException]", err);
  process.exit(1);
});

// ─── Config ──────────────────────────────────────────────────────────────────
const CONFIG = {
  csvFile:        process.env.CSV_FILE     || path.join(__dirname, "results", getLatestCsv()),
  engine:         (process.env.ENGINE || "camoufox").toLowerCase(),
  headless:       process.env.HEADLESS !== "false",
  concurrency:    Math.min(4, Math.max(1, Number(process.env.CONCURRENCY) || 2)),
  outputDir:      path.join(__dirname, "results"),
  routerUrl:      process.env.ROUTER_URL || "http://localhost:3000",
  routerPassword: "123456",
  pollTimeoutMs:  600_000,
  // Gmail API config
  gmailTokenFile: process.env.GMAIL_TOKEN_FILE || path.join(__dirname, "..", "..", "qwencloud-generator", "gmail_tokens.json"),
  gmailBaseEmail: process.env.GMAIL_BASE_EMAIL || "",
};

function getLatestCsv() {
  try {
    const dir = path.join(__dirname, "results");
    const files = fs.readdirSync(dir).filter(f => f.startsWith("kiro-accounts-") && f.endsWith(".csv"));
    if (!files.length) return "";
    files.sort().reverse();
    return files[0];
  } catch { return ""; }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function log(workerId, email, msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`[${ts}][Worker ${workerId}] ${email} → ${msg}`);
}
function nowIso() { return new Date().toISOString(); }

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

// ─── Gmail API OTP (ported from register-kiro-imap.mjs) ──────────────────────
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
  return acc.access_token;
}

async function readOtpFromGmail(email, { timeout = 120_000, since = null } = {}) {
  const normalizedEmail = normalizeGmail(email);
  const deadline = Date.now() + timeout;
  let pollCount = 0;
  let lastSeenIds = new Set();

  // AWS Builder ID OTP comes from both domains depending on flow type
  const q = encodeURIComponent("from:no-reply@login.awsapps.com OR from:no-reply@signin.aws");
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=10`;

  while (Date.now() < deadline) {
    pollCount++;
    try {
      const token = await getGmailAccessToken(normalizedEmail);
      const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (listRes.status === 429) { await sleep(5_000); continue; }
      if (!listRes.ok) { await sleep(2_000); continue; }

      const { messages = [] } = await listRes.json();
      if (pollCount % 5 === 1) log(null, email, `[poll #${pollCount}] Gmail: ${messages.length} msg(s) found`);

      // sinceMs: 30s before password submit to catch delayed OTP delivery
      const sinceMs = since ? new Date(since).getTime() - 30_000 : Date.now() - 60_000;

      for (const m of messages) {
        // Only cache messages that are definitely too old (>5min before OTP trigger)
        // Never cache recent messages — let them be re-checked each poll in case content updates
        const isCachedOld = lastSeenIds.has(m.id);
        if (isCachedOld) continue;
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!msgRes.ok) continue;
        const msg = await msgRes.json();

        const msgDate = parseInt(msg.internalDate || "0");
        if (msgDate < sinceMs) {
          log(null, email, `  → msg ${m.id} skipped: too old (${new Date(msgDate).toISOString()})`);
          lastSeenIds.add(m.id);
          continue;
        }

        const headers = Object.fromEntries((msg.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
        const from = headers["from"] || "";
        const subject = headers["subject"] || "";
        const to = (headers["to"] || "").replace(/[<>]/g, "").toLowerCase();
        log(null, email, `  → msg ${m.id}: from="${from}" subj="${subject}"`);

        // Confirm sender is AWS
        if (!from.includes("signin.aws") && !from.includes("login.awsapps.com")) {
          lastSeenIds.add(m.id);
          continue;
        }

        // Skip To-address check — Gmail API already scopes to correct inbox,
        // and dot-trick aliases all deliver to same account.

        const text = _extractPart(msg.payload || {}, "text/plain");
        const html = _extractPart(msg.payload || {}, "text/html");
        const combined = text + " " + html;

        // AWS OTP: 6-digit code in large styled div or near "verification code" text
        const divMatch = combined.match(/<div[^>]*font-size:\s*36px[^>]*>\s*(\d{6})\s*<\/div>/i)
          || combined.match(/<div[^>]*font-weight:\s*bold[^>]*padding-bottom[^>]*>\s*(\d{6})\s*<\/div>/i)
          || combined.match(/Verification code[^<]*<\/div>\s*<div[^>]*>\s*(\d{6})\s*<\/div>/is)
          || combined.match(/verification code\b[\s\S]{0,200}?(\d{6})/i)
          || combined.match(/\b(\d{6})\b/);

        if (divMatch) {
          log(null, email, `  → OTP found: ${divMatch[1]}`);
          return divMatch[1];
        }
        log(null, email, `  → no 6-digit code found in email body`);
        lastSeenIds.add(m.id);
      }
    } catch (err) {
      log(null, email, `Gmail poll error: ${err.message}`);
    }
    await sleep(3_000);
  }
  return null;
}

// ─── Parse CSV ────────────────────────────────────────────────────────────────
function parseCsv(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
  const accounts = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 3) continue;
    const [email, password, status] = parts;
    if (status?.trim() === "success") {
      accounts.push({ email: email.trim(), password: password.trim() });
    }
  }
  return accounts;
}

// ─── Browser launcher ────────────────────────────────────────────────────────
async function launchBrowser() {
  if (CONFIG.engine === "camoufox") {
    const camoufox = require("camoufox-js");
    const opts = await camoufox.launchOptions({ headless: CONFIG.headless });
    return firefox.launch(opts);
  }
  return chromium.launch({
    headless: CONFIG.headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });
}

// ─── Kiro Token Extraction via Device Code Flow + Playwright automation ───────
async function extractKiroToken(email, password, workerId) {
  let browser = null;
  let context = null;
  let cookieDismissActive = false;
  let cookieDismissLoop = Promise.resolve();

  try {
    // ── Phase 0: Get device code from 9router
    log(workerId, email, "requesting device code from 9router");
    const token = await getAuthToken();
    const deviceCodeResp = await fetch(`${CONFIG.routerUrl}/api/oauth/kiro/device-code`, {
      headers: { Cookie: `auth_token=${token}` },
    });
    if (!deviceCodeResp.ok) throw new Error(`device-code API failed: ${deviceCodeResp.status} ${await deviceCodeResp.text()}`);
    const deviceCodeData = await deviceCodeResp.json();
    const deviceAuth = {
      deviceCode: deviceCodeData.device_code,
      userCode: deviceCodeData.user_code,
      verificationUri: deviceCodeData.verification_uri,
      verificationUriComplete: deviceCodeData.verification_uri_complete,
      expiresIn: deviceCodeData.expires_in,
      interval: deviceCodeData.interval || 1,
    };
    const extraData = {
      _clientId: deviceCodeData._clientId,
      _clientSecret: deviceCodeData._clientSecret,
      _region: deviceCodeData._region || "us-east-1",
      _authMethod: deviceCodeData._authMethod || "builder-id",
    };

    log(workerId, email, `verificationUri: ${deviceAuth.verificationUri}`);
    log(workerId, email, `userCode: ${deviceAuth.userCode}`);

    // ── Phase 1: Start polling token in background (will succeed once browser login done)
    const token2 = await getAuthToken();
    const pollPromise = (async () => {
      const deadline = Date.now() + CONFIG.pollTimeoutMs;
      while (Date.now() < deadline) {
        await sleep(deviceAuth.interval * 1000);
        const resp = await fetch(`${CONFIG.routerUrl}/api/oauth/kiro/poll`, {
          method: "POST",
          headers: { "Cookie": `auth_token=${token2}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceCode: deviceAuth.deviceCode,
            codeVerifier: "",
            extraData,
          }),
        });
        if (!resp.ok) throw new Error(`poll API error: ${resp.status}`);
        const result = await resp.json();
        if (result.success) return result;
        if (result.pending || result.error === "authorization_pending") continue;
        throw new Error(`poll error: ${result.error || JSON.stringify(result)}`);
      }
      throw new Error("poll timeout");
    })();

    // ── Phase 2: Launch browser and automate the verification URL
    log(workerId, email, `launching browser (${CONFIG.engine})`);
    browser = await launchBrowser();
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);

    // ── Continuous cookie consent dismisser — runs every 1.5s for entire session ─
    const cookieSelectors = [
      '[data-id="awsccc-cb-btn-accept"]',
      'button[data-id*="accept" i]',
      '#awsccc-cb-btn-accept',
    ];
    cookieDismissActive = true;
    cookieDismissLoop = (async () => {
      while (cookieDismissActive) {
        try {
          for (const sel of cookieSelectors) {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 400 }).catch(() => false)) {
              await el.click({ timeout: 2_000 }).catch(() => null);
              log(workerId, email, "dismissed cookie consent popup");
              break;
            }
          }
        } catch { /* ignore */ }
        await sleep(1_500);
      }
    })();

    // Navigate to the device verification URL
    log(workerId, email, "navigating to verification URL");
    await page.goto(deviceAuth.verificationUriComplete || deviceAuth.verificationUri, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    // ── Step 3a: Enter email
    log(workerId, email, "filling email field");
    const emailSelectors = [
      'input[name="email"]',
      'input[type="email"]',
      '#email',
      'input[placeholder*="email" i]',
    ];
    let emailFilled = false;
    for (const sel of emailSelectors) {
      try {
        await page.locator(sel).first().fill(email, { timeout: 5_000 });
        emailFilled = true;
        break;
      } catch { /* try next */ }
    }
    if (!emailFilled) throw new Error("Could not find email input field");

    // Click Continue/Next/Submit after email
    // AWS Builder ID uses a React button — wait up to 10s for it to appear, then click
    const nextSelectors = [
      'button:has-text("Continue")',
      'button:has-text("Next")',
      'button:has-text("Get started")',
      'button:has-text("Sign in")',
      'button[type="submit"]',
      'input[type="submit"]',
      '#next_button',
    ];
    let nextClicked = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      for (const sel of nextSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 1_500 }).catch(() => false)) {
            await el.click({ timeout: 5_000 });
            log(workerId, email, `clicked next after email: ${sel}`);
            nextClicked = true;
            break;
          }
        } catch { /* try next */ }
      }
      if (nextClicked) break;
      await sleep(1_000);
    }
    if (!nextClicked) throw new Error("Could not find Next/Continue button after email");

    // Wait for page transition (SPA — DOM updates in-place, no full reload)
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => null);
    await sleep(2_500);

    // ── Step 3c: Enter password
    // Wait explicitly for password field — AWS SSO SPA transitions in-place
    log(workerId, email, "waiting for password field...");
    const passwordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
      '#password',
    ];
    let passwordFilled = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      for (const sel of passwordSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 1_500 }).catch(() => false)) {
            log(workerId, email, `password field found (${sel}) at attempt ${attempt + 1}`);
            await el.click();
            await sleep(200);
            await el.fill(password);
            passwordFilled = true;
            break;
          }
        } catch { /* try next */ }
      }
      if (passwordFilled) break;
      await sleep(1_000);
    }
    if (!passwordFilled) throw new Error("Could not find password input field after 20s");

    // Submit password — use specific Sign in button, fallback to generic submit
    const signInSelectors = [
      'button:has-text("Sign in")',
      'button:has-text("Submit")',
      'button:has-text("Continue")',
      'button:has-text("Next")',
      'button[type="submit"]',
      'input[type="submit"]',
    ];
    log(workerId, email, "submitting password...");
    let signInClicked = false;
    for (const sel of signInSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await el.click({ timeout: 5_000 });
          log(workerId, email, `clicked sign in: ${sel}`);
          signInClicked = true;
          break;
        }
      } catch { /* try next */ }
    }
    if (!signInClicked) {
      // Last resort: press Enter on password field
      try {
        await page.locator('input[type="password"]').first().press("Enter");
        log(workerId, email, "Sign in via Enter key (button fallback)");
      } catch { /* ignore */ }
    }
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => null);
    await sleep(2_000);

    // ── Consent/Allow selectors (declared here — used by both OTP phase and consent phase)
    const allowSelectors = [
      '[data-testid="allow-access-button"]',
      '#cli_verification_btn',
      '[data-analytics="consent-allow-access"]',
      '[data-analytics="accept-user-code"]',
      'button:has-text("Allow access")',
      'button:has-text("Confirm and continue")',
      'button:has-text("Allow")',
      'input[type="submit"][value="Allow"]',
      'input[type="submit"][value*="Allow" i]',
    ];

    // ── Step 3d: OTP "Verify your identity" — appears AFTER password on some accounts
    // AWS Builder ID sends a 6-digit code to email after password submit
    const otpSentAt = new Date();
    let otpFieldVisible = false;
    const otpSelectors = [
      'input[placeholder*="6-digit" i]',
      'input[placeholder*="verification code" i]',
      'input[placeholder*="Verification" i]',
      'input[autocomplete="one-time-code"]',
      'input[name*="otp" i]',
      'input[inputmode="numeric"]',
      'input[maxlength="6"]',
      'input[data-testid*="otp" i]',
      'input[data-testid*="code" i]',
    ];
    // Poll up to 30s for OTP field
    for (let i = 0; i < 20; i++) {
      for (const sel of otpSelectors) {
        if (await page.locator(sel).first().isVisible({ timeout: 1_000 }).catch(() => false)) {
          otpFieldVisible = true;
          log(workerId, email, `OTP field found after password: ${sel}`);
          break;
        }
      }
      if (otpFieldVisible) break;
      // Also check if consent page already appeared — skip OTP check
      for (const sel of allowSelectors) {
        if (await page.locator(sel).first().isVisible({ timeout: 500 }).catch(() => false)) {
          log(workerId, email, "consent page appeared — skipping OTP");
          break;
        }
      }
      await sleep(1_500);
    }

    if (otpFieldVisible) {
      log(workerId, email, "OTP required — polling Gmail API for 'Verify your identity' email");
      const gmailTokensExist = fs.existsSync(CONFIG.gmailTokenFile);
      if (!gmailTokensExist) {
        log(workerId, email, `WARN: Gmail tokens not found — waiting 120s for manual OTP input`);
        await sleep(120_000);
      } else {
        const otp = await readOtpFromGmail(email, {
          timeout: 180_000,
          since: otpSentAt,
        });
        if (!otp) throw new Error("OTP not received within 180s");
        log(workerId, email, `OTP received: ${otp}`);

        // Fill OTP
        for (const sel of otpSelectors) {
          try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
              await el.click();
              await sleep(200);
              for (const ch of otp) await page.keyboard.type(ch, { delay: 35 });
              break;
            }
          } catch { /* try next */ }
        }
        await sleep(500);

        // Submit OTP
        for (const sel of ['button:has-text("Continue")', 'button:has-text("Submit")', 'button:has-text("Verify")', 'button[type="submit"]']) {
          try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
              await el.click({ timeout: 5_000 });
              log(workerId, email, `OTP submitted via: ${sel}`);
              break;
            }
          } catch { /* try next */ }
        }
        await sleep(3_000);
        log(workerId, email, "OTP phase complete");
      }
    } else {
      log(workerId, email, "no OTP required after password");
    }

    // ── Step 3d: Consent/Allow page — AWS SSO Builder ID has TWO consent pages:
    // 1. "Confirm and continue" (#cli_verification_btn or [data-analytics="accept-user-code"])
    // 2. "Allow access" ([data-testid="allow-access-button"] or [data-analytics="consent-allow-access"])
    // Loop runs for 180s (120 × 1.5s) to handle both pages sequentially.
    log(workerId, email, "waiting for consent/allow pages (up to 180s)");

    // ── Step 3e: Success detection helper
    const isSuccessPage = async () => {
      try {
        return await page.evaluate(() => {
          const text = (document.body?.innerText || "").toLowerCase();
          return (
            text.includes("request approved") ||
            text.includes("authorization complete") ||
            text.includes("you can now close") ||
            text.includes("you can close this window") ||
            text.includes("can now access your data") ||
            text.includes("successfully authorized") ||
            document.title?.toLowerCase().includes("success")
          );
        });
      } catch { return false; }
    };

    // 120 iterations × 1.5s = 180s — matches poll timeout
    for (let i = 0; i < 120; i++) {
      // Check success FIRST — may have already passed both consent pages
      if (await isSuccessPage()) {
        log(workerId, email, `consent loop: success page detected at iteration ${i + 1}`);
        break;
      }

      // Try clicking any visible consent button
      let clicked = false;
      for (const sel of allowSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 1_000 }).catch(() => false)) {
            await el.click({ timeout: 5_000 });
            log(workerId, email, `clicked consent: ${sel}`);
            clicked = true;
            await sleep(2_000); // wait for next page to render
            break;
          }
        } catch { /* try next */ }
      }

      if (!clicked) {
        if (i % 10 === 9) {
          log(workerId, email, `[consent-wait] attempt ${i + 1}/120 — url=${page.url().slice(0, 80)}`);
        }
        await sleep(1_500);
      }
    }

    // Final success check
    const successDetected = await isSuccessPage();

    if (successDetected) {
      log(workerId, email, "browser success page detected");
    } else {
      log(workerId, email, "WARN: success page not detected — continuing with poll");
    }

    // ── Phase 3: Wait for poll to resolve
    log(workerId, email, "waiting for poll to resolve (connection saving to 9router DB)");
    const pollResult = await pollPromise;
    const connectionId = pollResult?.connection?.id || "";
    log(workerId, email, `SUCCESS — connection_id: ${connectionId}`);
    return {
      email,
      connectionId,
      status: "success",
      connection_id: connectionId,
      error: "",
      timestamp: nowIso(),
    };
  } catch (err) {
    log(workerId, email, `FAILED: ${err.message}`);
    return { email, status: "failed", connection_id: "", error: err.message, timestamp: nowIso() };
  } finally {
    cookieDismissActive = false;           // stop background loop before closing
    await cookieDismissLoop.catch(() => null); // wait for loop to exit cleanly
    if (context) await context.close().catch(() => null);
    if (browser) await browser.close().catch(() => null);
  }
}

// ─── CSV streaming ────────────────────────────────────────────────────────────
function appendToCsv(streamCsvPath, r) {
  try {
    const err = (r.error || "").replace(/,/g, ";").replace(/\n/g, " ");
    const line = `${r.email},${r.status},${r.connection_id || ""},${err},${r.timestamp}\n`;
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

        extractKiroToken(account.email, account.password, workerId).then(async (result) => {
          results.push(result);
          appendToCsv(streamCsvPath, result);
          active--;

          // 5-15s jitter between workers
          const jitterMs = 5_000 + Math.floor(Math.random() * 10_000);
          console.log(`[jitter] Worker ${workerId} done — waiting ${(jitterMs / 1000).toFixed(1)}s before next`);
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

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log(" Kiro Token Extractor — Builder ID Login via 9router");
  console.log("=".repeat(60));
  console.log(`  CSV file     : ${CONFIG.csvFile}`);
  console.log(`  Router URL   : ${CONFIG.routerUrl}`);
  console.log(`  Engine       : ${CONFIG.engine}`);
  console.log(`  Headless     : ${CONFIG.headless}`);
  console.log(`  Concurrency  : ${CONFIG.concurrency}`);
  console.log("=".repeat(60));

  if (!CONFIG.csvFile || !fs.existsSync(CONFIG.csvFile)) {
    console.error(`ERROR: CSV file not found: ${CONFIG.csvFile}`);
    console.error("Set CSV_FILE env var to the path of your accounts CSV.");
    process.exit(1);
  }

  // Login to 9router first
  await loginRouter();
  startTokenRefreshLoop().catch(() => null);

  const accounts = parseCsv(CONFIG.csvFile);
  if (!accounts.length) {
    console.error("ERROR: No accounts with status=success found in CSV.");
    process.exit(1);
  }
  console.log(`\nLoaded ${accounts.length} accounts from CSV.\n`);

  fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const streamCsvPath = path.join(CONFIG.outputDir, `kiro-extract-${ts}.csv`);
  fs.writeFileSync(streamCsvPath, "email,status,connection_id,error,timestamp\n", "utf8");
  console.log(`Streaming results to: ${streamCsvPath}\n`);

  const results = await runWorkerPool(accounts, CONFIG.concurrency, streamCsvPath);

  // Summary
  const success = results.filter(r => r.status === "success");
  const failed  = results.filter(r => r.status === "failed");
  console.log("\n" + "=".repeat(60));
  console.log(` Summary: ${success.length} success, ${failed.length} failed`);
  console.log("=".repeat(60));
  if (success.length) {
    console.log("\nSuccessful connections:");
    success.forEach(r => console.log(`  ✓ ${r.email} | connection_id: ${r.connection_id || "(empty)"}`));
  }
  if (failed.length) {
    console.log("\nFailed accounts:");
    failed.forEach(r => console.log(`  ✗ ${r.email} | ${r.error}`));
  }
  console.log(`\nCSV output: ${streamCsvPath}`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
