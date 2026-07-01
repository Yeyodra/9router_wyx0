/**
 * register-kiro-imap.mjs
 * Standalone bulk Kiro account registration script
 * Flow: app.kiro.dev → AWS SSO signup (HAR-derived) + Gmail API OTP (dot trick)
 *
 * Usage:
 *   GMAIL_BASE_EMAIL=yourname@gmail.com COUNT=3 node scripts/register-kiro-imap.mjs
 */

import { chromium, firefox } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ─── Config ──────────────────────────────────────────────────────────────────
// PROXY_URLS: comma-separated proxy list, one per account (round-robin)
// Example: PROXY_URLS="http://user:pass@host1:port,http://user:pass@host2:port"
function parseProxyUrls() {
  const raw = process.env.PROXY_URLS || process.env.PROXY_URL || "";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

const CONFIG = {
  gmailTokenFile: process.env.GMAIL_TOKEN_FILE || path.join(__dirname, "..", "..", "qwencloud-generator", "gmail_tokens.json"),
  gmailBaseEmails: (process.env.GMAIL_BASE_EMAIL || "").split(",").map(s => s.trim()).filter(Boolean),
  count:       Number(process.env.COUNT)       || 0,  // 0 = unlimited (use full remaining pool)
  concurrency: Math.min(8, Math.max(1, Number(process.env.CONCURRENCY) || 2)),
  headless:    process.env.HEADLESS !== "false",
  proxyUrls:   parseProxyUrls(),   // list of proxies — rotated per worker
  outputDir:   process.env.OUTPUT_DIR   || path.join(__dirname, "results"),
  // ENGINE: "camoufox" (default, stealth Firefox) | "chromium"
  engine:      (process.env.ENGINE || "camoufox").toLowerCase(),
};

// Helper: pick proxy for worker (round-robin)
function getProxyForWorker(workerId) {
  if (!CONFIG.proxyUrls.length) return null;
  return CONFIG.proxyUrls[(workerId - 1) % CONFIG.proxyUrls.length];
}

if (!CONFIG.gmailBaseEmails.length) {
  console.error("[ERROR] GMAIL_BASE_EMAIL is required (comma-separated for multiple).");
  console.error("  GMAIL_BASE_EMAIL=you@gmail.com,other@gmail.com node scripts/register-kiro-imap.mjs");
  process.exit(1);
}
if (!fs.existsSync(CONFIG.gmailTokenFile)) {
  console.error(`[ERROR] Gmail token file not found: ${CONFIG.gmailTokenFile}`);
  console.error("  Run authorize.py in qwencloud-generator first, or set GMAIL_TOKEN_FILE env.");
  process.exit(1);
}

fs.mkdirSync(CONFIG.outputDir, { recursive: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nowIso() { return new Date().toISOString(); }

function log(workerId, email, msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`[${ts}][Worker ${workerId}] ${email} → ${msg}`);
}

// ─── Gmail dot trick ──────────────────────────────────────────────────────────
function generateGmailDotVariants(baseEmail, maxDots = 2) {
  const [local, domain] = baseEmail.split("@");
  if (!local || domain.toLowerCase() !== "gmail.com") {
    throw new Error(`GMAIL_BASE_EMAIL must be a @gmail.com address, got: ${baseEmail}`);
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

// Pre-generate pool at startup, shuffle once
function buildEmailPool(baseEmail, maxDots = 2) {
  const variants = generateGmailDotVariants(baseEmail, maxDots);
  // Fisher-Yates shuffle
  for (let i = variants.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [variants[i], variants[j]] = [variants[j], variants[i]];
  }
  return variants;
}

// Build combined pool from all base emails, shuffle once
const EMAIL_POOL = (() => {
  const pool = [];
  for (const base of CONFIG.gmailBaseEmails) {
    pool.push(...buildEmailPool(base, 2));
  }
  // Fisher-Yates shuffle across all variants from all accounts
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
})();
let emailPoolIdx = 0;

// ─── Account generator ───────────────────────────────────────────────────────
function generateRandomAccount() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const email = EMAIL_POOL[emailPoolIdx++ % EMAIL_POOL.length];
  const password = "Aa1!" + Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return { email, password };
}

// ─── Browser fingerprint randomization (from kiroBulkImportManager.js) ───────
const FP_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];
const FP_VIEWPORTS = [
  { width: 1920, height: 1080 }, { width: 1440, height: 900 },
  { width: 1536, height: 864  }, { width: 1366, height: 768 },
  { width: 1280, height: 800  }, { width: 1280, height: 720 },
];
const FP_LOCALES   = ["en-US", "en-GB", "en-CA", "en-AU", "en-SG"];
const FP_TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Asia/Singapore",
];

// ─── Realistic name generator (Indonesian + International) ───────────────────
// Sources: Dukcapil e-KTP data + SSA Top 100 Names (1926-2025)
const NAMES_ID_MALE = [
  "Sutrisno", "Slamet", "Mulyadi", "Herman", "Supardi", "Ismail", "Supriyanto",
  "Wahyudi", "Junaidi", "Suparman", "Agus", "Budi", "Dedi", "Eko", "Fajar",
  "Hendra", "Iwan", "Joko", "Kurniawan", "Lukman", "Muhamad", "Nurdin",
  "Oki", "Purnomo", "Rahmat", "Samsul", "Taufik", "Umar", "Yudi", "Zainal",
  "Andri", "Bayu", "Cahyo", "Dani", "Ferdi", "Galih", "Hadi", "Irfan",
  "Jaka", "Kevin", "Luki", "Maulana", "Nanda", "Oscar", "Putra", "Reza",
];
const NAMES_ID_FEMALE = [
  "Nurhayati", "Sulastri", "Sumiati", "Sumarni", "Sunarti", "Ernawati",
  "Aminah", "Kartini", "Dewi", "Eni", "Fitri", "Gita", "Heni", "Indah",
  "Julia", "Kiki", "Lina", "Maya", "Nita", "Putri", "Rina", "Sari",
  "Tini", "Upi", "Vina", "Wulan", "Yanti", "Zara", "Ayu", "Bella",
  "Citra", "Dina", "Eka", "Fani", "Hana", "Intan", "Jihan", "Kezia",
  "Laras", "Mira", "Nadia", "Okta", "Prita", "Ratna", "Sinta", "Tika",
];
const NAMES_INTL_MALE = [
  "James", "Michael", "John", "Robert", "David", "William", "Richard", "Joseph",
  "Thomas", "Charles", "Daniel", "Matthew", "Anthony", "Mark", "Steven",
  "Andrew", "Joshua", "Paul", "Kevin", "Brian", "Jason", "Ryan", "Jacob",
  "Nathan", "Adam", "Henry", "Noah", "Ethan", "Liam", "Lucas", "Mason",
  "Logan", "Gabriel", "Samuel", "Benjamin", "Aaron", "Tyler", "Justin",
  "Alexander", "Patrick", "Jack", "Sean", "Eric", "Dylan", "Christian",
];
const NAMES_INTL_FEMALE = [
  "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan",
  "Jessica", "Sarah", "Karen", "Lisa", "Ashley", "Emily", "Kimberly",
  "Michelle", "Amanda", "Stephanie", "Rachel", "Laura", "Rebecca", "Sharon",
  "Melissa", "Deborah", "Anna", "Olivia", "Katherine", "Emma", "Christine",
  "Angela", "Nicole", "Samantha", "Hannah", "Madison", "Grace", "Sophia",
  "Isabella", "Abigail", "Victoria", "Natalie", "Diana", "Julia", "Megan",
];
const ALL_FIRST_NAMES = [
  ...NAMES_ID_MALE, ...NAMES_ID_FEMALE,
  ...NAMES_INTL_MALE, ...NAMES_INTL_FEMALE,
];
const LAST_NAMES_ID = [
  "Santoso", "Wijaya", "Kusuma", "Pratama", "Putra", "Saputra", "Hidayat",
  "Nugroho", "Susanto", "Rahayu", "Wibowo", "Setiawan", "Purnomo", "Utama",
  "Hakim", "Firmansyah", "Gunawan", "Hartono", "Budiman", "Cahyadi",
  "Darmawan", "Effendi", "Halim", "Irawan", "Jamaludin", "Kuncoro",
  "Laksana", "Maulana", "Novriadi", "Pamungkas", "Rohman", "Subagyo",
  "Tanjung", "Waskito", "Yusuf",
];
const LAST_NAMES_INTL = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
  "Davis", "Wilson", "Anderson", "Taylor", "Thomas", "Moore", "Martin",
  "Jackson", "Lee", "Harris", "Clark", "Lewis", "Robinson", "Walker",
  "Hall", "Allen", "Young", "King", "Wright", "Scott", "Torres", "Rivera",
  "Collins", "Stewart", "Morris", "Murphy", "Cook", "Rogers", "Peterson",
];
const ALL_LAST_NAMES = [...LAST_NAMES_ID, ...LAST_NAMES_INTL];

function generateRealisticName() {
  const first = ALL_FIRST_NAMES[Math.floor(Math.random() * ALL_FIRST_NAMES.length)];
  // 50% chance of adding last name (some AWS accounts only have first name)
  if (Math.random() < 0.5) {
    const last = ALL_LAST_NAMES[Math.floor(Math.random() * ALL_LAST_NAMES.length)];
    return `${first} ${last}`;
  }
  return first;
}

function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function buildRandomFingerprint() {
  const vp = randomPick(FP_VIEWPORTS);
  return {
    userAgent:         randomPick(FP_USER_AGENTS),
    viewport:          { width: vp.width + Math.floor((Math.random() - 0.5) * 40), height: vp.height + Math.floor((Math.random() - 0.5) * 20) },
    locale:            randomPick(FP_LOCALES),
    timezoneId:        randomPick(FP_TIMEZONES),
    colorScheme:       "light",
    deviceScaleFactor: randomPick([1, 1, 1, 1.25, 1.5]),
    isMobile:          false,
    hasTouch:          false,
  };
}

async function createFreshContext(browser) {
  const fp = buildRandomFingerprint();
  const context = await browser.newContext({
    ...fp,
    ...(CONFIG.proxyUrl ? { proxy: { server: CONFIG.proxyUrl } } : {}),
  });
  await context.addInitScript((ua) => {
    Object.defineProperty(navigator, "userAgent",  { get: () => ua });
    Object.defineProperty(navigator, "webdriver",  { get: () => false });
    Object.defineProperty(navigator, "plugins",    { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages",  { get: () => ["en-US", "en"] });
    const origQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
    if (origQuery) {
      window.navigator.permissions.query = (params) =>
        params.name === "notifications"
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(params);
    }
  }, fp.userAgent);
  const page = await context.newPage();
  return { context, page };
}

// ─── Slider CAPTCHA solver (from qwenCloudRegisterManager.js) ────────────────
const SLIDER_CONTAINER_SEL = [
  "#risk_slider_container", ".nc-container", ".nc_wrapper",
  '[id*="nc_1"]', '[class*="nocaptcha"]', '[id*="nocaptcha"]',
].join(", ");

const SLIDER_BTN_SEL = [
  ".nc_iconfont.btn_slide", ".nc-lang-cnt", '[id*="nc_1_n1z"]',
  ".btn_slide", '[aria-label*="slide" i]', '[aria-label*="slider" i]',
].join(", ");

function bezierDragPoints(totalX, steps = 40) {
  const cp1x = totalX * (0.25 + Math.random() * 0.15);
  const cp1y = -(2 + Math.random() * 4);
  const cp2x = totalX * (0.65 + Math.random() * 0.15);
  const cp2y = 2 + Math.random() * 4;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, mt = 1 - t;
    const x = mt*mt*mt*0 + 3*mt*mt*t*cp1x + 3*mt*t*t*cp2x + t*t*t*totalX;
    const y = mt*mt*mt*0 + 3*mt*mt*t*cp1y + 3*mt*t*t*cp2y + t*t*t*0;
    points.push({ x: x + (Math.random()-0.5)*1.5, y: y + (Math.random()-0.5)*1.5 });
  }
  return points;
}

async function solveSliderCaptcha(page) {
  try {
    const container = page.locator(SLIDER_CONTAINER_SEL).first();
    if (!await container.isVisible({ timeout: 2_000 }).catch(() => false)) return false;
    const sliderBtn = page.locator(SLIDER_BTN_SEL).first();
    if (!await sliderBtn.isVisible({ timeout: 2_000 }).catch(() => false)) return false;
    const btnBox = await sliderBtn.boundingBox().catch(() => null);
    if (!btnBox) return false;
    const containerBox = await container.boundingBox().catch(() => null);
    const trackWidth = containerBox ? containerBox.width : 280;
    const dragDistance = Math.max(trackWidth - btnBox.width - 8, 200);
    const startX = btnBox.x + btnBox.width / 2;
    const startY = btnBox.y + btnBox.height / 2;
    const points = bezierDragPoints(dragDistance, 45 + Math.floor(Math.random() * 15));
    await page.mouse.move(startX, startY);
    await sleep(80 + Math.random() * 120);
    await page.mouse.down();
    await sleep(50 + Math.random() * 80);
    for (const pt of points) {
      await page.mouse.move(startX + pt.x, startY + pt.y, { steps: 1 });
      await sleep(8 + Math.random() * 18);
    }
    await sleep(120 + Math.random() * 200);
    await page.mouse.up();
    await sleep(800 + Math.random() * 400);
    return true;
  } catch { return false; }
}

async function handleSliderCaptchaIfPresent(page, { maxRetries = 3 } = {}) {
  const container = page.locator(SLIDER_CONTAINER_SEL).first();
  if (!await container.isVisible({ timeout: 1_500 }).catch(() => false)) return false;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const moved = await solveSliderCaptcha(page);
    if (!moved) break;
    await sleep(1_500);
    if (!await container.isVisible({ timeout: 1_000 }).catch(() => false)) return true;
    if (attempt < maxRetries) await sleep(1_000 + Math.random() * 500);
  }
  return false;
}

// ─── Gmail API helpers ────────────────────────────────────────────────────────
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
  // Try normalized base, then original email, then first account
  const acc = accounts[base] || accounts[email];
  if (!acc) throw new Error(`No Gmail token found for ${email} (normalized: ${base}). Run authorize.py first.`);

  // Return cached token if still valid (60s buffer)
  if (acc.access_token && acc.expires_at && acc.expires_at > Date.now() / 1000 + 60) {
    return acc.access_token;
  }

  // Refresh via OAuth2
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

  // Update cache
  acc.access_token = json.access_token;
  acc.expires_at = Math.floor(Date.now() / 1000) + (json.expires_in || 3600);
  saveGmailTokens(data);
  return json.access_token;
}

// ─── Gmail API OTP reader ─────────────────────────────────────────────────────
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

async function readOtpFromGmail(email, { timeout = 120_000, since = null } = {}) {
  const deadline = Date.now() + timeout;
  // Allow 60s clock skew tolerance — same as qwencloud-generator pattern
  // sinceMs is set 60s BEFORE the provided timestamp to handle server clock drift
  const sinceMs = since
    ? new Date(since).getTime() - 60_000
    : Date.now() - 120_000;

  // AWS Builder ID OTP sender — confirmed from actual inbox
  const q = encodeURIComponent("from:no-reply@signin.aws");
  const listUrl = `https://www.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=10`;

  let pollCount = 0;
  while (Date.now() < deadline) {
    pollCount++;
    try {
      const accessToken = await getGmailAccessToken(email);

      const listResp = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (listResp.status === 429) {
        log(null, email, "Gmail API rate limited (429) — backing off 5s");
        await sleep(5_000);
        continue;
      }
      if (!listResp.ok) {
        const body = await listResp.text().catch(() => "");
        log(null, email, `Gmail API list error ${listResp.status}: ${body.slice(0, 100)} — retrying`);
        await sleep(2_000);
        continue;
      }

      const listData = await listResp.json();
      const messages = listData.messages || [];
      log(null, email, `[poll #${pollCount}] Gmail: ${messages.length} message(s) from signin.aws found`);

      for (const m of messages) {
        const msgResp = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!msgResp.ok) continue;
        const msg = await msgResp.json();

        const msgDate = parseInt(msg.internalDate || "0");
        // Skip emails clearly older than our window
        if (msgDate < sinceMs) {
          log(null, email, `  → msg ${m.id} skipped: internalDate ${msgDate} < sinceMs ${sinceMs}`);
          continue;
        }

        const headers = Object.fromEntries(
          (msg.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value])
        );

        const from = headers["from"] || "";
        const subject = headers["subject"] || "";
        log(null, email, `  → msg ${m.id}: from="${from}" subject="${subject}" date=${msgDate}`);

        // Confirm it's from AWS Builder ID
        if (!from.includes("signin.aws")) continue;

        // Confirm email is addressed to THIS specific alias — prevents cross-worker OTP theft
        const to = (headers["to"] || "").replace(/[<>]/g, "").toLowerCase();
        const normalizedEmail = email.toLowerCase();
        const normalizedBase = normalizedEmail.replace(/\./g, "").split("@")[0] + "@" + normalizedEmail.split("@")[1];
        if (!to.includes(normalizedEmail) && !to.includes(normalizedBase)) {
          log(null, email, `  → msg ${m.id} skipped: To="${headers["to"]}" doesn't match ${email}`);
          continue;
        }

        const text = _extractPart(msg.payload || {}, "text/plain");
        const html = _extractPart(msg.payload || {}, "text/html");
        const combined = text + " " + html;

        // Extract 6-digit OTP — same last-resort strategy as qwencloud
        const codes = [...combined.matchAll(/\b(\d{6})\b/g)].map(m => m[1]);
        if (codes.length > 0) {
          log(null, email, `  → OTP candidates: ${codes.join(", ")} → using ${codes[0]}`);
          return codes[0];
        }
        log(null, email, `  → no 6-digit code found in email body`);
      }
    } catch (err) {
      log(null, email, `Gmail poll error: ${err.message} — retrying`);
    }
    await sleep(3_000);
  }
  return null;
}

// ─── Cookie consent auto-dismisser ───────────────────────────────────────────
async function dismissCookieConsent(page) {
  const acceptSelectors = [
    // AWS cookie banner (profile.aws.amazon.com, signin.aws)
    'button:has-text("Accept")',
    'button:has-text("Accept all")',
    'button:has-text("Accept cookies")',
    'button:has-text("I agree")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
    // AWS specific cookie consent IDs
    '#awsccc-cb-btn-accept',
    '[data-id="awsccc-cb-btn-accept"]',
    'button[data-id*="accept" i]',
    '[id*="accept" i][class*="cookie" i]',
    '[class*="cookie" i] button:has-text("Accept")',
    '[class*="consent" i] button:has-text("Accept")',
    '[id*="cookie" i] button:has-text("Accept")',
  ];
  for (const sel of acceptSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        await el.click({ timeout: 3_000 }).catch(() => null);
        await sleep(500);
        return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

// ─── Kiro Registration Flow (from HAR analysis) ───────────────────────────────
async function runKiroRegistration(page, email, password, { workerId, onStep } = {}) {
  const step = (name, msg) => {
    log(workerId, email, `${name}: ${msg}`);
    onStep?.(name, msg);
  };

  page.setDefaultTimeout(120_000);

  // ── Step 1: Navigate to Kiro signin ─────────────────────────────────────────
  step("navigating", "Loading app.kiro.dev/signin");
  await page.goto("https://app.kiro.dev/signin", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(2_000);

  // ── Step 2: Click "Builder ID" button ────────────────────────────────────────
  step("clicking_builder_id", "Clicking Builder ID button");
  const builderIdSelectors = [
    'button:has-text("Builder ID")',
    '[role="button"]:has-text("Builder ID")',
    'a:has-text("Builder ID")',
    'div:has-text("Builder ID")',
    // Fallback: any element with AWS icon + "Builder ID" text
    'button:has-text("Builder")',
  ];

  let builderIdClicked = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    for (const sel of builderIdSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await el.click({ timeout: 5_000 });
          builderIdClicked = true;
          step("builder_id_clicked", `Clicked: ${sel}`);
          break;
        }
      } catch { /* try next */ }
    }
    if (builderIdClicked) break;
    await sleep(1_000);
  }
  if (!builderIdClicked) {
    throw Object.assign(new Error("Builder ID button not found on Kiro signin page"), { step: "builder_id_not_found" });
  }
  // ── Step 3: Wait for AWS SSO login page to fully load ───────────────────────
  step("waiting_sso", "Waiting for AWS SSO login page to load");
  // Wait for navigation to AWS SSO domain
  for (let i = 0; i < 20; i++) {
    const url = page.url();
    if (url.includes("signin.aws")) break;
    await sleep(1_000);
  }
  // Wait for page to be fully loaded (network idle)
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => null);
  await sleep(3_000); // extra buffer for React SPA to render

  step("sso_loaded", `AWS SSO page loaded: ${page.url().slice(0, 80)}`);

  // ── Step 4: Enter email ───────────────────────────────────────────────────────
  step("filling_email", `Entering email: ${email}`);
  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[placeholder*="email" i]',
    'input[placeholder*="Email" i]',
    '#email',
  ];

  let emailFilled = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    for (const sel of emailSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await el.click();
          await sleep(200);
          await el.fill("");
          for (const ch of email) {
            await page.keyboard.type(ch, { delay: 35 });
          }
          const val = await el.inputValue().catch(() => "");
          if (val.includes("@")) { emailFilled = true; break; }
        }
      } catch { /* try next */ }
    }
    if (emailFilled) break;
    await sleep(1_500);
  }
  if (!emailFilled) {
    throw Object.assign(new Error("Email input not found or could not be filled"), { step: "email_fill_failed" });
  }
  await sleep(500);

  // ── Step 5: Click Next/Continue ───────────────────────────────────────────────
  step("clicking_next", "Clicking Next after email");
  const nextSelectors = [
    'button:has-text("Next")', 'button:has-text("Continue")',
    'button:has-text("Send")', 'button:has-text("Verify")',
    '#identifierNext button', 'button[type="submit"]',
    '[role="button"]:has-text("Next")', '[role="button"]:has-text("Continue")',
  ];
  for (const sel of nextSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await el.click({ timeout: 5_000 });
        break;
      }
    } catch { /* try next */ }
  }
  // ── Step 5b: Wait for redirect to profile.aws.amazon.com ────────────────────
  step("waiting_redirect", "Waiting for redirect to profile.aws.amazon.com");
  for (let i = 0; i < 30; i++) {
    const url = page.url();
    if (url.includes("profile.aws.amazon.com")) break;
    await sleep(1_000);
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => null);
  await sleep(3_000); // extra buffer for React SPA to render
  step("redirected", `Now at: ${page.url().slice(0, 100)}`);

  // ── Step 5c: Handle "Enter your name" form ───────────────────────────────────
  // Poll up to 30s for name input — SPA transitions via hash router, may take time
  // From screenshot: input[placeholder="Maria José Silva"] or input with label "Name"
  const nameSelectors = [
    'input[placeholder*="José" i]',
    'input[placeholder*="Silva" i]',
    'input[placeholder*="Maria" i]',
    'input[name="name"]',
    'input[name="fullName"]',
    'input[name="displayName"]',
    'input[placeholder*="name" i]',
    'input[placeholder*="Full name" i]',
    'input[autocomplete="name"]',
    '#name', '#fullName',
  ];
  let nameFilled = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    for (const sel of nameSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1_000 }).catch(() => false)) {
          const randomName = generateRealisticName();
          step("filling_name", `Entering name: ${randomName} (found: ${sel})`);
          // Human-like: pause before interacting, type char-by-char with random delay
          await sleep(800 + Math.random() * 600);
          await el.click();
          await sleep(300 + Math.random() * 200);
          await el.clear();
          await sleep(150);
          for (const ch of randomName) {
            await el.pressSequentially(ch, { delay: 80 + Math.random() * 80 });
          }
          // Pause after typing — simulate human reading what they typed
          await sleep(1_200 + Math.random() * 800);
          // Click Continue — retry up to 3x if ERR-837 appears
          for (let clickAttempt = 0; clickAttempt < 3; clickAttempt++) {
            let clicked = false;
            for (const nsel of nextSelectors) {
              try {
                const nb = page.locator(nsel).first();
                if (await nb.isVisible({ timeout: 2_000 }).catch(() => false)) {
                  await nb.click({ timeout: 5_000 });
                  step("name_submitted", `Clicked Continue after name (attempt ${clickAttempt + 1})`);
                  clicked = true;
                  break;
                }
              } catch { /* try next */ }
            }
            if (!clicked) break;
            await sleep(2_000);
            // Check for ERR-837 error alert — if present, retry
            const hasError = await page.locator('[data-testid="error-alert-blocked"]').first()
              .isVisible({ timeout: 1_500 }).catch(() => false);
            if (!hasError) break;
            step("name_retry", `ERR-837 detected — retrying Continue (attempt ${clickAttempt + 2})`);
            await sleep(1_000 + Math.random() * 500);
          }
          nameFilled = true;
          await sleep(3_000);
          break;
        }
      } catch { /* try next selector */ }
    }
    if (nameFilled) break;
    await sleep(1_000);
  }
  if (!nameFilled) {
    step("name_skipped", "Name field not found after 30s — skipping");
  }

  // ── Step 6: Wait for OTP field to appear, record time ────────────────────────
  step("waiting_otp_field", "Waiting for OTP/verification code field");
  await sleep(2_000);

  const otpFieldSelectors = [
    // AWS Builder ID uses input[type="text"] with placeholder "6-digit verification code"
    'input[placeholder*="6-digit" i]',
    'input[placeholder*="6-d" i]',
    'input[placeholder*="verification code" i]',
    'input[placeholder*="Verification" i]',
    // AWS Builder ID data-testid patterns
    'input[data-testid*="code" i]', 'input[data-testid*="otp" i]',
    'input[data-testid*="verification" i]',
    // Generic
    'input[name="emailCaptcha"]', '#emailCaptcha',
    'input[placeholder*="code" i]',
    'input[placeholder*="OTP" i]', 'input[autocomplete="one-time-code"]',
    'input[name*="code" i]', 'input[name*="otp" i]',
    'input[inputmode="numeric"]', 'input[maxlength="6"]',
    'input[type="number"]',
  ];

  const otpSentAt = new Date();
  let otpFieldFound = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    for (const sel of otpFieldSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1_500 }).catch(() => false)) {
          log(workerId, email, `  [otp field found] selector: ${sel}`);
          otpFieldFound = true;
          break;
        }
      } catch { /* try next */ }
    }
    if (otpFieldFound) break;
    // Also check for slider CAPTCHA while waiting
    await handleSliderCaptchaIfPresent(page);
    await sleep(1_500);
  }
  if (!otpFieldFound) {
    throw Object.assign(new Error("OTP field never appeared after entering email"), { step: "otp_field_not_found" });
  }

  // ── Step 7: Read OTP via Gmail API ───────────────────────────────────────────
  step("waiting_otp", "Polling Gmail API for OTP email (up to 120s)...");
  const otp = await readOtpFromGmail(email, { timeout: 120_000, since: otpSentAt });
  if (!otp) {
    throw Object.assign(new Error("OTP not received within 120s"), { step: "otp_timeout" });
  }
  step("otp_received", `OTP: ${otp}`);

  // ── Step 8: Fill OTP ──────────────────────────────────────────────────────────
  step("filling_otp", "Entering OTP code");
  let otpFilled = false;
  for (const sel of otpFieldSelectors) {
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
  if (!otpFilled) {
    throw Object.assign(new Error("OTP input field disappeared before we could fill it"), { step: "otp_fill_failed" });
  }
  await sleep(500);

  // ── Step 9: Click Next/Verify after OTP ───────────────────────────────────────
  step("submitting_otp", "Clicking Next after OTP");
  for (const sel of nextSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await el.click({ timeout: 5_000 });
        break;
      }
    } catch { /* try next */ }
  }
  await sleep(3_000);

  // ── Step 10: Wait for password field ─────────────────────────────────────────
  step("waiting_password_field", "Waiting for password setup field");
  const pwSelectors = [
    'input[type="password"]', 'input[name="password"]',
    'input[name="new-password"]', 'input[autocomplete="new-password"]',
    'input[placeholder*="password" i]', 'input[placeholder*="Password" i]',
    '#password', '#new-password',
  ];

  let pwFieldFound = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    for (const sel of pwSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1_500 }).catch(() => false)) {
          pwFieldFound = true;
          break;
        }
      } catch { /* try next */ }
    }
    if (pwFieldFound) break;
    await sleep(1_500);
  }
  if (!pwFieldFound) {
    throw Object.assign(new Error("Password field never appeared after OTP submission"), { step: "password_field_not_found" });
  }

  // ── Step 11: Fill password (Kiro's JS handles JWE encryption) ─────────────────
  // Dismiss any cookie consent popup before filling password
  await dismissCookieConsent(page);
  await sleep(500);

  const confirmSelectors = [
    'input[placeholder*="re-enter" i]',
    'input[placeholder*="Re-enter" i]',
    'input[placeholder*="confirm" i]',
    'input[placeholder*="Confirm" i]',
    'input[name="confirmPassword"]',
    'input[name="confirm-password"]',
    '#confirmPassword', '#confirmPwd',
  ];

  // Wait for BOTH password AND confirm password fields to be visible before filling
  // (AWS Builder ID renders confirm field first, then password field appears)
  step("waiting_both_pw_fields", "Waiting for both password fields to appear");
  let bothVisible = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    let pwVisible = false;
    let confirmVisible = false;
    for (const sel of pwSelectors) {
      try {
        if (await page.locator(sel).first().isVisible({ timeout: 500 }).catch(() => false)) {
          pwVisible = true; break;
        }
      } catch { /* try next */ }
    }
    for (const csel of confirmSelectors) {
      try {
        if (await page.locator(csel).first().isVisible({ timeout: 500 }).catch(() => false)) {
          confirmVisible = true; break;
        }
      } catch { /* try next */ }
    }
    if (pwVisible && confirmVisible) { bothVisible = true; break; }
    if (pwVisible && !confirmVisible) { bothVisible = true; break; } // confirm may not exist
    await sleep(1_000);
  }

  step("filling_password", "Entering password");
  for (const sel of pwSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await el.click();
        await sleep(300);
        await el.fill(password);
        await sleep(500);
        // Now fill confirm password
        for (const csel of confirmSelectors) {
          try {
            const cel = page.locator(csel).first();
            if (await cel.isVisible({ timeout: 1_000 }).catch(() => false)) {
              await cel.click();
              await sleep(300);
              await cel.fill(password);
              step("confirm_password_filled", "Confirm password filled");
              break;
            }
          } catch { /* noop */ }
        }
        break;
      }
    } catch { /* try next */ }
  }
  await sleep(500);

  // ── Step 12: Submit / Create account ─────────────────────────────────────────
  step("submitting", "Clicking Create account / Submit");
  const submitSelectors = [
    'button:has-text("Create account")', 'button:has-text("Submit")',
    'button:has-text("Register")', 'button:has-text("Sign up")',
    'button:has-text("Continue")', 'button:has-text("Next")',
    'button[type="submit"]', '[role="button"]:has-text("Create account")',
  ];
  for (const sel of submitSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await el.click({ timeout: 5_000 });
        step("submitted", `Clicked: ${sel}`);
        break;
      }
    } catch { /* try next */ }
  }
  await sleep(5_000);

  // ── Step 13: Wait for app.kiro.dev authorized ─────────────────────────────────
  step("waiting_authorized", "Waiting for Kiro dashboard (up to 60s)");
  const authDeadline = Date.now() + 60_000;
  let authorized = false;
  while (Date.now() < authDeadline) {
    const url = page.url();
    if (url.includes("app.kiro.dev") && !url.includes("/signin")) {
      authorized = true;
      break;
    }
    // Also accept signin/oauth callback as intermediate success
    if (url.includes("app.kiro.dev/signin/oauth")) {
      await sleep(3_000);
      const newUrl = page.url();
      if (newUrl.includes("app.kiro.dev") && !newUrl.includes("/signin")) {
        authorized = true;
        break;
      }
    }
    await sleep(1_500);
  }

  if (!authorized) {
    throw Object.assign(
      new Error(`Never reached app.kiro.dev after registration. Stuck at: ${page.url()}`),
      { step: "authorization_failed" }
    );
  }

  step("authorized", `SUCCESS — reached: ${page.url()}`);

  // ── Step 14: Suspend validation — poll Gmail 2 min for AWS "Action Needed" email ──
  // If AWS sends "Response Required: Action Needed on Your AWS Account" within 2 min
  // → account is suspended immediately after creation, skip from pool
  step("suspend_check", "Waiting 2 min to check for AWS suspension email...");
  const suspendCheckStart = Date.now();
  const suspendDeadline = suspendCheckStart + 120_000; // 2 minutes
  let isSuspended = false;

  const suspendQ = encodeURIComponent("from:no-reply@amazonaws.com subject:Action Needed");
  const suspendListUrl = `https://www.googleapis.com/gmail/v1/users/me/messages?q=${suspendQ}&maxResults=10`;

  while (Date.now() < suspendDeadline) {
    await sleep(10_000); // poll every 10s
    try {
      const accessToken = await getGmailAccessToken(email);
      const listResp = await fetch(suspendListUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!listResp.ok) continue;
      const { messages = [] } = await listResp.json();
      for (const m of messages) {
        const msgResp = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!msgResp.ok) continue;
        const msg = await msgResp.json();
        const msgDate = parseInt(msg.internalDate || "0");
        // Only consider emails sent after registration started
        if (msgDate < suspendCheckStart - 30_000) continue;
        const headers = Object.fromEntries((msg.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
        const to = headers["to"] || "";
        // Check if this suspension email is addressed to this specific alias
        if (to.includes(email.split("@")[0].replace(/\./g, "")) || to.toLowerCase().includes(email.toLowerCase())) {
          step("suspended", `Account suspended by AWS — email detected: "${headers["subject"]}" to ${to}`);
          isSuspended = true;
          break;
        }
      }
    } catch { /* continue polling */ }
    if (isSuspended) break;
  }

  if (isSuspended) {
    return { email, password, status: "suspended", error: "AWS suspended account within 2 min of creation" };
  }

  step("suspend_check_passed", "No suspension email — account is clean ✓");
  return {
    email,
    password,
    status: "success",
  };
}


// ─── CSV writer ───────────────────────────────────────────────────────────────
function writeResultsCsv(results, outputDir) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19).replace("T", "-");
  const outFile = path.join(outputDir, `kiro-accounts-${ts}.csv`);
  const lines = ["email,password,status,error,timestamp"];
  for (const r of results) {
    const err = (r.error || "").replace(/,/g, ";").replace(/\n/g, " ");
    lines.push(`${r.email},${r.password},${r.status},${err},${r.timestamp}`);
  }
  fs.writeFileSync(outFile, lines.join("\n") + "\n", "utf8");
  return outFile;
}

// ─── Worker pool ──────────────────────────────────────────────────────────────
async function runWorkerPool(accounts, concurrency, streamCsvPath = null) {
  const results = [];
  let nextIdx = 0;
  let active = 0;
  const delayMs = Number(process.env.DELAY_BETWEEN_ACCOUNTS || 0) * 1000;

  // Helper: append one result line to streaming CSV immediately
  function appendToCsv(r) {
    if (!streamCsvPath) return;
    try {
      const err = (r.error || "").replace(/,/g, ";").replace(/\n/g, " ");
      const line = `${r.email},${r.password},${r.status},${err},${r.timestamp}\n`;
      fs.appendFileSync(streamCsvPath, line, "utf8");
    } catch { /* non-fatal */ }
  }

  return new Promise((resolve) => {
    async function tryLaunch() {
      while (active < concurrency && nextIdx < accounts.length) {
        const account = accounts[nextIdx];
        const workerId = nextIdx + 1;
        nextIdx++;
        active++;

        // Delay before launching each worker (except the first)
        if (delayMs > 0 && workerId > 1) {
          console.log(`[delay] Waiting ${delayMs/1000}s before launching Worker ${workerId}...`);
          await sleep(delayMs);
        }

        runWorker(account, workerId).then(async (result) => {
          results.push(result);
          appendToCsv(result); // stream write immediately — progress preserved on early exit
          active--;
          // Random jitter delay before picking next job — breaks AWS velocity detection
          const jitterMs = 20_000 + Math.floor(Math.random() * 25_000); // 20-45s
          console.log(`[jitter] Worker ${workerId} done — waiting ${(jitterMs/1000).toFixed(1)}s before next job`);
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

// ─── Browser launcher (Chromium or Camoufox) ─────────────────────────────────
async function launchBrowser(proxyUrl = null) {
  if (CONFIG.engine === "camoufox") {
    const camoufox = require("camoufox-js");
    // For Camoufox/Firefox, proxy MUST be set at context level, not launch level
    const opts = await camoufox.launchOptions({ headless: CONFIG.headless });
    return firefox.launch(opts);
  }
  // Chromium: proxy can be set at launch level
  return chromium.launch({
    headless: CONFIG.headless,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
    ...(proxyUrl ? { proxy: { server: proxyUrl } } : {}),
  });
}

async function runWorker(account, workerId) {
  const { email, password } = account;
  let browser = null;
  let context = null;
  const proxyUrl = getProxyForWorker(workerId);

  try {
    log(workerId, email, `launching browser (${CONFIG.engine})${proxyUrl ? ` via proxy ${proxyUrl.replace(/\/\/.*@/, "//***@")}` : ""}`);
    browser = await launchBrowser(proxyUrl);

    // Camoufox handles its own fingerprint — skip createFreshContext for it
    let page;
    if (CONFIG.engine === "camoufox") {
      // Firefox/Camoufox: proxy credentials MUST be split into server/username/password
      // NOT embedded in URL like http://user:pass@host:port — Firefox doesn't parse that
      let proxyOpt = {};
      if (proxyUrl) {
        try {
          const u = new URL(proxyUrl);
          proxyOpt = {
            proxy: {
              server: `${u.protocol}//${u.hostname}:${u.port}`,
              username: decodeURIComponent(u.username),
              password: decodeURIComponent(u.password),
            }
          };
        } catch { proxyOpt = { proxy: { server: proxyUrl } }; }
      }
      context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        ...proxyOpt,
      });
      page = await context.newPage();
      await page.setViewportSize({ width: 1440, height: 900 }).catch(() => null);
    } else {
      const fresh = await createFreshContext(browser);
      context = fresh.context;
      page = fresh.page;
    }

    const result = await runKiroRegistration(page, email, password, { workerId });
    return { ...result, timestamp: nowIso() };
  } catch (err) {
    log(workerId, email, `FAILED: ${err.message}`);
    return { email, password, status: "failed", error: err.message, timestamp: nowIso() };
  } finally {
    if (context) await context.close().catch(() => null);
    if (browser) await browser.close().catch(() => null);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log(" Kiro Bulk Register — Gmail Dot Trick Mode");
  console.log("=".repeat(60));
  console.log(`  Base email(s): ${CONFIG.gmailBaseEmails.join(", ")}`);
  console.log(`  Email pool   : ${EMAIL_POOL.length} variants`);
  console.log(`  Count        : ${CONFIG.count}`);
  console.log(`  Concurrency  : ${CONFIG.concurrency}`);
  console.log(`  Headless     : ${CONFIG.headless}`);
  console.log(`  Output dir   : ${CONFIG.outputDir}`);
  if (CONFIG.proxyUrls.length > 0) {
    console.log(`  Proxies      : ${CONFIG.proxyUrls.length} (round-robin per worker)`);
    CONFIG.proxyUrls.forEach((p, i) => {
      const masked = p.replace(/\/\/([^:]+):([^@]+)@/, "//***:***@");
      console.log(`    [${i+1}] ${masked}`);
    });
  } else {
    console.log(`  Proxies      : none`);
  }
  console.log("=".repeat(60));
  console.log();

  // Generate accounts — if COUNT=0 (unlimited), use all remaining unused pool slots
  const count = CONFIG.count > 0 ? CONFIG.count : EMAIL_POOL.length;
  const accounts = Array.from({ length: count }, () =>
    generateRandomAccount()
  );
  console.log(`Generated ${accounts.length} accounts to register (${CONFIG.count === 0 ? "unlimited — full pool" : `COUNT=${CONFIG.count}`}):`);
  for (const acc of accounts) {
    console.log(`  ${acc.email}`);
  }
  console.log();

  const startTime = Date.now();

  // Create streaming CSV file upfront — append per-result so progress is never lost
  const csvTs = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19).replace("T", "-");
  const streamCsvPath = path.join(CONFIG.outputDir, `kiro-accounts-${csvTs}.csv`);
  fs.writeFileSync(streamCsvPath, "email,password,status,error,timestamp\n", "utf8");
  console.log(`Streaming CSV: ${streamCsvPath}`);
  console.log();

  const results = await runWorkerPool(accounts, CONFIG.concurrency, streamCsvPath);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const success   = results.filter((r) => r.status === "success");
  const suspended = results.filter((r) => r.status === "suspended");
  const failed    = results.filter((r) => r.status === "failed");

  console.log();
  console.log("=".repeat(60));
  console.log(" RESULTS");
  console.log("=".repeat(60));
  console.log(`  Total     : ${results.length}`);
  console.log(`  Success   : ${success.length}`);
  console.log(`  Suspended : ${suspended.length}`);
  console.log(`  Failed    : ${failed.length}`);
  console.log(`  Elapsed   : ${elapsed}s`);
  console.log();

  if (success.length > 0) {
    console.log("Successful accounts:");
    for (const r of success) {
      console.log(`  ✓ ${r.email} | ${r.password}`);
    }
    console.log();
  }

  if (suspended.length > 0) {
    console.log("Suspended accounts (AWS suspended within 2 min — excluded from pool):");
    for (const r of suspended) {
      console.log(`  ⚠ ${r.email}`);
    }
    console.log();
  }

  if (failed.length > 0) {
    console.log("Failed accounts:");
    for (const r of failed) {
      console.log(`  ✗ ${r.email} — ${r.error}`);
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
