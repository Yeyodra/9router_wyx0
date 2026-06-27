import {
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
  parseKiroBulkAccounts,
} from "./kiroBulkImportManager.js";

export {
  buildLookupResponse,
  parseKiroBulkAccounts as parseQwenCloudBulkAccounts,
};

export const QWEN_CLOUD_BULK_IMPORT_DEFAULT_CONCURRENCY = KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY;
export const QWEN_CLOUD_BULK_IMPORT_MIN_CONCURRENCY = KIRO_BULK_IMPORT_MIN_CONCURRENCY;
export const QWEN_CLOUD_BULK_IMPORT_MAX_CONCURRENCY = KIRO_BULK_IMPORT_MAX_CONCURRENCY;

// ─── constants (copied 1:1 from test-qwen-dot.mjs) ───────────────────────────
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
const QWEN_API_NAME = "zeldaEasy.bailian-dash-workspace.api-key.createApiKey4AgentV4";

// ─── selectors (copied 1:1 from test-qwen-dot.mjs) ───────────────────────────
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
  'button:has-text("Lanjutkan")',
  'button:has-text("Continue")',
  'button:has-text("Continuar")',
  'button:has-text("Continuer")',
  'button:has-text("Weiter")',
  '[role="button"]:has-text("Allow")',
  '[role="button"]:has-text("Lanjutkan")',
  '[role="button"]:has-text("Continue")',
].join(", ");

const GOOGLE_BTN_SEL = [
  'a[href*="google"], a[href*="google_qwen"]',
  'button:has-text("Google")',
  'a:has-text("Google")',
  '[data-provider="google"]',
  'li:has-text("Google")',
  '.oauth-btn[data-type*="google"]',
  'div[class*="google"]:not([class*="captcha"])',
].join(", ");

// ─── Alibaba slide CAPTCHA solver ─────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Selectors for the Alibaba "slide to verify" widget
const SLIDER_CONTAINER_SEL = [
  ".nc-container",
  ".nc_wrapper",
  '[id*="nc_1"]',
  '[class*="nocaptcha"]',
  '[id*="nocaptcha"]',
].join(", ");

const SLIDER_BTN_SEL = [
  ".nc_iconfont.btn_slide",
  ".nc-lang-cnt",
  '[id*="nc_1_n1z"]',
  ".btn_slide",
  '[aria-label*="slide" i]',
  '[aria-label*="slider" i]',
].join(", ");

/**
 * Generate bezier curve points for human-like drag.
 * Returns array of {x, y} offsets from start position.
 */
function bezierDragPoints(totalX, steps = 40) {
  // Control points with slight vertical jitter for human feel
  const cp1x = totalX * (0.25 + Math.random() * 0.15);
  const cp1y = -(2 + Math.random() * 4);
  const cp2x = totalX * (0.65 + Math.random() * 0.15);
  const cp2y = 2 + Math.random() * 4;

  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    // Cubic bezier
    const x = mt * mt * mt * 0
      + 3 * mt * mt * t * cp1x
      + 3 * mt * t * t * cp2x
      + t * t * t * totalX;
    const y = mt * mt * mt * 0
      + 3 * mt * mt * t * cp1y
      + 3 * mt * t * t * cp2y
      + t * t * t * 0;
    // Add micro-jitter
    points.push({
      x: x + (Math.random() - 0.5) * 1.5,
      y: y + (Math.random() - 0.5) * 1.5,
    });
  }
  return points;
}

/**
 * Attempt to solve the Alibaba slide CAPTCHA once.
 * Returns true if slider moved successfully, false if elements not found.
 */
async function solveSliderCaptcha(page) {
  try {
    // Check if captcha container is present and visible
    const container = page.locator(SLIDER_CONTAINER_SEL).first();
    const containerVisible = await container.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!containerVisible) return false;

    // Find the slider button
    const sliderBtn = page.locator(SLIDER_BTN_SEL).first();
    const sliderVisible = await sliderBtn.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!sliderVisible) return false;

    // Get slider button bounding box
    const btnBox = await sliderBtn.boundingBox().catch(() => null);
    if (!btnBox) return false;

    // Get container width to know how far to drag
    const containerBox = await container.boundingBox().catch(() => null);
    const trackWidth = containerBox ? containerBox.width : 280;

    // Drag distance = track width minus button width minus small margin
    const dragDistance = Math.max(trackWidth - btnBox.width - 8, 200);

    // Start position: center of slider button
    const startX = btnBox.x + btnBox.width / 2;
    const startY = btnBox.y + btnBox.height / 2;

    // Generate human-like bezier path
    const points = bezierDragPoints(dragDistance, 45 + Math.floor(Math.random() * 15));

    // Execute the drag via mouse events
    await page.mouse.move(startX, startY);
    await sleep(80 + Math.random() * 120);
    await page.mouse.down();
    await sleep(50 + Math.random() * 80);

    for (const pt of points) {
      await page.mouse.move(startX + pt.x, startY + pt.y, { steps: 1 });
      // Variable delay between moves — humans are not perfectly timed
      await sleep(8 + Math.random() * 18);
    }

    // Hold at end briefly before releasing
    await sleep(120 + Math.random() * 200);
    await page.mouse.up();
    await sleep(800 + Math.random() * 400);

    return true;
  } catch {
    return false;
  }
}

/**
 * Detect and solve slider CAPTCHA if present. Retries up to maxRetries times.
 * Returns true if CAPTCHA was detected and solved (or gone), false if not detected.
 */
async function handleSliderCaptchaIfPresent(page, { onStep, maxRetries = 3 } = {}) {
  const container = page.locator(SLIDER_CONTAINER_SEL).first();
  const visible = await container.isVisible({ timeout: 1_500 }).catch(() => false);
  if (!visible) return false;

  onStep?.("solving_captcha", "Detected Alibaba slide CAPTCHA — attempting to solve");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const moved = await solveSliderCaptcha(page);
    if (!moved) break;

    // Wait for CAPTCHA to disappear or page to change
    await sleep(1_500);
    const stillVisible = await container.isVisible({ timeout: 1_000 }).catch(() => false);
    if (!stillVisible) {
      onStep?.("captcha_solved", `Slide CAPTCHA solved on attempt ${attempt}`);
      return true;
    }

    if (attempt < maxRetries) {
      onStep?.("captcha_retry", `Slide CAPTCHA attempt ${attempt} failed — retrying`);
      await sleep(1_000 + Math.random() * 500);
    }
  }

  onStep?.("captcha_failed", "Slide CAPTCHA could not be solved automatically — marking for manual assist");
  return false;
}



function getHost(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

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

/** Poll page.url() until predicate returns true — copied from test-qwen-dot.mjs */
async function pollUrl(page, predicate, { timeout = 60_000, interval = 600 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const url = page.url();
    if (predicate(url)) return url;
    await sleep(interval);
  }
  return null;
}

// ─── driveGoogleAuth (copied 1:1 from test-qwen-dot.mjs, onStep added) ────────
async function driveGoogleAuth(page, email, password, { onStep, timeout = 90_000 } = {}) {
  let emailTransitionDeadline = 0;
  let passwordTransitionDeadline = 0;
  let googleBtnClicked = false;
  const deadline = Date.now() + timeout;

  for (let i = 0; i < 180; i++) {
    if (Date.now() > deadline) {
      throw Object.assign(
        new Error(`Google OAuth timed out after ${timeout / 1000}s — possible CAPTCHA or Google challenge`),
        { step: "google_auth_timeout" }
      );
    }
    let cur;
    try { cur = page.url(); } catch { return; }

    const host = getHost(cur);

    // ── done conditions (mirrors Python)
    if (host.endsWith("alibabacloud.com") && cur.includes("first_login")) {
      return;
    }
    if (host.endsWith("alibabacloud.com") && cur.includes("login_aliyun")) {
      return;
    }
    if (host.endsWith("qwencloud.com")) {
      return;
    }

    const now = Date.now();
    const onAlibaba = host.endsWith("alibabacloud.com") || host === "account.qwencloud.com";

    // ── on Alibaba SSO page → handle slider CAPTCHA then click Google button
    if (onAlibaba && !host.startsWith("accounts.google")) {
      // Check and solve slider CAPTCHA before attempting Google button click
      const hadCaptcha = await handleSliderCaptchaIfPresent(page, { onStep });
      if (hadCaptcha) {
        // After solving (or failing) captcha, wait for page to settle
        await sleep(1_500);
        // If captcha failed to solve, skip clicking Google btn this iteration
        const stillCaptcha = await page.locator(SLIDER_CONTAINER_SEL).first().isVisible({ timeout: 500 }).catch(() => false);
        if (stillCaptcha) {
          await sleep(700);
          continue;
        }
        // Captcha cleared — reset googleBtnClicked so we retry clicking
        googleBtnClicked = false;
      }
      if (!googleBtnClicked) {
        onStep?.("clicking_google_btn", "Clicking Google sign-in button on Alibaba SSO");
        const clicked = await tryClick(page, GOOGLE_BTN_SEL, { timeout: 5_000 });
        if (clicked) {
          googleBtnClicked = true;
          await sleep(2_000);
        } else {
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
      onStep?.("google_consent_allowed", "Handled Google consent");
      await sleep(1_000);
      continue;
    }

    // ── handle Google Workspace "Welcome to your new account" dialog
    const iUnderstandSel = [
      'button:has-text("I understand")',
      'button:has-text("I Understand")',
      '[role="button"]:has-text("I understand")',
      'button:has-text("Saya mengerti")',
      'button:has-text("Mengerti")',
    ].join(", ");
    const iUnderstandLoc = page.locator(iUnderstandSel).first();
    if (await iUnderstandLoc.isVisible({ timeout: 500 }).catch(() => false)) {
      onStep?.("accepting_workspace_terms", "Accepting Google Workspace welcome terms");
      await iUnderstandLoc.click({ timeout: 5_000 }).catch(() => null);
      await sleep(1_000);
      continue;
    }

    // ── on Google accounts domain
    const onGoogle = host.startsWith("accounts.google");
    if (!onGoogle) { await sleep(700); continue; }

    // Email step
    const emailLoc = page.locator(EMAIL_SEL).first();
    const emailVisible = await emailLoc.isVisible().catch(() => false);
    if (emailVisible && (!emailTransitionDeadline || now < emailTransitionDeadline)) {
      const currentVal = await emailLoc.inputValue().catch(() => "");
      if (currentVal !== email) {
        onStep?.("filling_google_email", "Entering Google email");
        await tryFill(page, EMAIL_SEL, email);
        emailTransitionDeadline = Date.now() + 8_000;
        await sleep(600);
        await tryClick(page, NEXT_SEL);
        await sleep(1_500);
      } else if (emailTransitionDeadline && now > emailTransitionDeadline) {
        await tryClick(page, NEXT_SEL);
        await sleep(1_500);
      } else {
        await sleep(700);
      }
      continue;
    }

    // Password step
    const passLoc = page.locator(PASS_SEL).first();
    const passVisible = await passLoc.isVisible().catch(() => false);
    if (passVisible && (!passwordTransitionDeadline || now < passwordTransitionDeadline)) {
      const currentVal = await passLoc.inputValue().catch(() => "");
      if (currentVal !== password) {
        onStep?.("filling_google_password", "Entering Google password");
        await tryFill(page, PASS_SEL, password);
        passwordTransitionDeadline = Date.now() + 8_000;
        await sleep(600);
        await tryClick(page, NEXT_SEL);
        await sleep(1_500);
      } else if (passwordTransitionDeadline && now > passwordTransitionDeadline) {
        await tryClick(page, NEXT_SEL);
        await sleep(1_500);
      } else {
        await sleep(700);
      }
      continue;
    }

    await sleep(700);
  }
}

// ─── completeRegistration (copied 1:1 from test-qwen-dot.mjs) ─────────────────
async function completeRegistration(page, url, { onStep } = {}) {
  onStep?.("completing_registration", "Completing Alibaba account registration");

  const nameSel = [
    'input[name="nickname"]',
    'input[placeholder*="name" i]',
    'input[placeholder*="nama" i]',
  ].join(", ");

  const nameLoc = page.locator(nameSel).first();
  if (await nameLoc.count().catch(() => 0) > 0) {
    const currentName = await nameLoc.inputValue().catch(() => "");
    if (!currentName) {
      const randomName = `user${Math.random().toString(36).slice(2, 10)}`;
      await tryFill(page, nameSel, randomName);
      await sleep(500);
    }
  }

  // ── Handle Qwen Cloud "Select your country/region" signup page ──────────────
  // The dropdown is a combobox input (role="combobox"), not a native <select>.
  // We click it, type "Singapore" to filter, then click the matching option.
  const countryComboSel = [
    'input[role="combobox"][placeholder*="country" i]',
    'input[role="combobox"][placeholder*="region" i]',
    'input[role="combobox"][placeholder*="Select your" i]',
  ].join(", ");

  const comboLoc = page.locator(countryComboSel).first();
  const comboVisible = await comboLoc.isVisible({ timeout: 2_000 }).catch(() => false);
  if (comboVisible) {
    onStep?.("selecting_country", "Selecting Singapore as country/region");
    // Click to open dropdown
    await comboLoc.click({ timeout: 3_000 }).catch(() => null);
    await sleep(400);
    // Clear and type to filter
    await comboLoc.fill("Singapore").catch(() => null);
    await sleep(600);
    // Click the Singapore option from the dropdown list
    const sgOptSel = [
      'li:has-text("Singapore")',
      '[role="option"]:has-text("Singapore")',
      '[role="listbox"] *:has-text("Singapore")',
      'div[class*="option"]:has-text("Singapore")',
      'div[class*="item"]:has-text("Singapore")',
    ].join(", ");
    const sgOpt = page.locator(sgOptSel).first();
    if (await sgOpt.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await sgOpt.click({ timeout: 3_000 }).catch(() => null);
      await sleep(400);
    }
  } else {
    // Fallback: native <select>
    const nativeSelectSel = [
      'select[name="countryCode"]',
      'select[name="country"]',
      'select[id*="country" i]',
    ].join(", ");
    const nativeLoc = page.locator(nativeSelectSel).first();
    if (await nativeLoc.isVisible({ timeout: 1_000 }).catch(() => false)) {
      onStep?.("selecting_country", "Selecting Singapore as country/region (native select)");
      try { await nativeLoc.selectOption({ value: "SG" }); }
      catch { try { await nativeLoc.selectOption({ label: "Singapore" }); } catch { /* noop */ } }
      await sleep(400);
    }
  }

  // ── Check all agreement/terms checkboxes ────────────────────────────────────
  const checkboxSel = [
    'input[type="checkbox"][name*="agree" i]',
    'input[type="checkbox"][name*="term" i]',
    'input[type="checkbox"][id*="agree" i]',
    'input[type="checkbox"][id*="term" i]',
    'input[type="checkbox"]',
  ].join(", ");

  const checkboxes = page.locator(checkboxSel);
  const checkboxCount = await checkboxes.count().catch(() => 0);
  if (checkboxCount > 0) {
    onStep?.("accepting_terms", "Accepting Qwen Cloud terms and agreements");
    for (let i = 0; i < checkboxCount; i++) {
      const cb = checkboxes.nth(i);
      const checked = await cb.isChecked().catch(() => true);
      if (!checked) {
        await cb.check({ timeout: 3_000 }).catch(() => null);
        await sleep(200);
      }
    }
    await sleep(300);
  }

  // ── Click Continue / Submit button ──────────────────────────────────────────
  const submitSel = [
    'button:has-text("Continue")',
    'button:has-text("Lanjutkan")',
    'button:has-text("Complete")',
    'button:has-text("Submit")',
    'button:has-text("Confirm")',
    'button:has-text("Register")',
    'button:has-text("Create Account")',
    'button[type="submit"]',
  ].join(", ");

  const submitLoc = page.locator(submitSel).first();
  if (await submitLoc.count().catch(() => 0) > 0) {
    await submitLoc.click().catch(() => null);
    await sleep(3_000);
  }

  // Wait up to 10s for redirect away from first_login
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!page.url().includes("first_login")) return;
    await sleep(500);
  }
}

// ─── extractSecToken (copied 1:1 from test-qwen-dot.mjs) ─────────────────────
async function extractSecToken(cookieHeader) {
  try {
    const res = await fetch(QWEN_USER_INFO, {
      headers: {
        Cookie: cookieHeader,
        Referer: QWEN_HOME_URL,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!res.ok) {
      console.log(`[QwenCloud] user/info.json returned ${res.status}`);
      return "";
    }
    const raw = await res.text();
    console.log(`[QwenCloud] user/info.json raw: ${raw.slice(0, 300)}`);
    const data = JSON.parse(raw);
    const token =
      data?.sec_token ??
      data?.secToken ??
      data?.data?.sec_token ??
      data?.data?.secToken ??
      data?.content?.sec_token ??
      "";
    console.log(token ? `[QwenCloud] sec_token: ${token.slice(0, 20)}...` : `[QwenCloud] sec_token not found. keys: ${Object.keys(data).join(", ")}`);
    return token;
  } catch (e) {
    console.log(`[QwenCloud] sec_token extraction failed: ${e.message}`);
    return "";
  }
}

// ─── callApiGateway (copied 1:1 from test-qwen-dot.mjs) ──────────────────────
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

  const text = await res.text();
  console.log(`[QwenCloud] gateway HTTP ${res.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    return { _rawText: text.slice(0, 500) };
  }
}

// ─── Save Qwen Cloud connection ───────────────────────────────────────────────
async function defaultSaveQwenCloudConnection({ email, apiKey, keyId, workspaceId, gmtExpire }) {
  const { createProviderConnection } = await import("../../../models/index.js");

  const connection = await createProviderConnection({
    provider: "qwen-cloud",
    authType: "apikey",
    apiKey,
    email,
    providerSpecificData: {
      loginEmail: email,
      automation: "gsuite-bulk",
      keyId: keyId || null,
      workspaceId: workspaceId || null,
      gmtExpire: gmtExpire || null,
    },
    testStatus: "active",
  });

  return { connection };
}

// ─── runQwenCloudAccountAutomation (1:1 port of test-qwen-dot.mjs main block) ─
async function runQwenCloudAccountAutomation(page, email, password, { onStep } = {}) {
  page.setDefaultTimeout(120_000);

  // 1. Navigate to api-keys → triggers SSO redirect
  onStep?.("navigating", "Navigating to home.qwencloud.com/api-keys");
  await page.goto(QWEN_HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
  await sleep(2_000);

  // 2. Drive Google OAuth
  onStep?.("google_auth", "Starting Google OAuth flow");
  await driveGoogleAuth(page, email, password, { onStep });
  await sleep(2_000);

  // 3. Handle first_login registration if new account
  const postGoogleUrl = page.url();
  if (postGoogleUrl.includes("first_login") && postGoogleUrl.includes("reg_and_bind")) {
    onStep?.("completing_registration", "Completing registration for new account");
    await completeRegistration(page, postGoogleUrl, { onStep });
  } else if (postGoogleUrl.includes("first_login")) {
    await sleep(3_000);
  }

  // 4. Wait for home.qwencloud.com landing
  onStep?.("waiting_for_landing", "Waiting for Qwen Cloud dashboard");
  const landed = await pollUrl(page, (u) => u.includes("home.qwencloud.com"), { timeout: 45_000 });
  if (!landed) {
    throw Object.assign(
      new Error(`Never landed on home.qwencloud.com — stuck at: ${page.url().slice(0, 100)}`),
      { step: "navigation_failed" }
    );
  }
  await sleep(1_500);

  // 5. Extract cookies (exactly as in test-qwen-dot.mjs)
  onStep?.("extracting_cookies", "Extracting session cookies");
  const context = page.context();
  const rawCookies = await context.cookies();
  const cookieMap  = Object.fromEntries(rawCookies.map((c) => [c.name, c.value]));
  const cookieHeader = rawCookies.map((c) => `${c.name}=${c.value}`).join("; ");

  console.log(`[QwenCloud] Got ${rawCookies.length} cookies`);

  if (!cookieMap.login_qwencloud_ticket) {
    throw Object.assign(
      new Error("login_qwencloud_ticket cookie not found after login — authentication may have failed"),
      { step: "cookie_missing" }
    );
  }

  // 6. Get sec_token (exactly as in test-qwen-dot.mjs)
  onStep?.("extracting_sec_token", "Fetching sec_token");
  const secToken = await extractSecToken(cookieHeader);
  if (!secToken) {
    throw Object.assign(
      new Error("Failed to extract sec_token from user/info.json"),
      { step: "sec_token_failed" }
    );
  }

  // 7. Create API key — retry up to 3x with backoff for new accounts that
  //    need a few seconds for workspace provisioning (NotAuthorised race).
  onStep?.("creating_api_key", "Creating Qwen Cloud API key");
  let createResp;
  const CREATE_RETRIES = 3;
  const CREATE_RETRY_DELAY = 8_000;
  for (let attempt = 1; attempt <= CREATE_RETRIES; attempt++) {
    createResp = await callApiGateway(
      cookieHeader,
      secToken,
      QWEN_API_NAME,
      { description: `poolprox-${Date.now()}` }
    );
    const errMsg =
      createResp?.data?.errorMsg ||
      createResp?.data?.DataV2?.errorMsg || "";
    // NotAuthorised = workspace not yet provisioned, retry after delay
    if (errMsg.includes("NotAuthorised") || errMsg.includes("NotAuthorized")) {
      if (attempt < CREATE_RETRIES) {
        onStep?.("creating_api_key", `Workspace not ready (attempt ${attempt}/${CREATE_RETRIES}) — retrying in ${CREATE_RETRY_DELAY / 1000}s`);
        await sleep(CREATE_RETRY_DELAY);
        continue;
      }
    }
    break;
  }

  // Parse key: resp.data.DataV2.data.data.key (field is "key" not "apiKey")
  const inner      = createResp?.data?.DataV2?.data?.data ?? {};
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
    throw Object.assign(
      new Error(`createApiKey returned no key: ${errMsg}`),
      { step: "key_creation_failed" }
    );
  }

  // 8. Verify API key — hit Dashscope with a minimal completion request.
  //    A valid key returns choices[0]; an unprovisioned / denied key returns
  //    an error object.  We treat anything other than a model response as
  //    a failure so the account is not saved as "active" when it cannot
  //    actually serve requests.
  onStep?.("verifying_api_key", "Verifying API key with a test model call");
  try {
    const verifyBody = JSON.stringify({
      model: "qwen3-14b",
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
      max_tokens: 10,
      enable_thinking: false,
    });
    const verifyRes = await fetch(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: verifyBody,
        signal: AbortSignal.timeout(30_000),
      }
    );
    const verifyData = await verifyRes.json().catch(() => null);
    const hasResponse = verifyData?.choices?.[0]?.message?.content != null;
    if (!hasResponse) {
      const verifyErr =
        verifyData?.error?.message ||
        verifyData?.error?.code ||
        JSON.stringify(verifyData).slice(0, 200);
      throw Object.assign(
        new Error(`API key verification failed: ${verifyErr}`),
        { step: "key_verification_failed" }
      );
    }
    onStep?.("key_verified", "API key verified — model responded successfully");
  } catch (err) {
    if (err.step === "key_verification_failed") throw err;
    throw Object.assign(
      new Error(`API key verification error: ${err.message}`),
      { step: "key_verification_failed" }
    );
  }

  return { apiKey, keyId, workspaceId, gmtExpire, description };
}

// ─── Singleton ────────────────────────────────────────────────────────────────
let _singleton = null;

export function getQwenCloudBulkImportManager() {
  if (!_singleton) {
    _singleton = new QwenCloudBulkImportManager();
  }
  return _singleton;
}

// ─── Manager class ────────────────────────────────────────────────────────────
export class QwenCloudBulkImportManager extends KiroBulkImportManager {
  constructor({
    saveConnection = defaultSaveQwenCloudConnection,
    storageName = "qwen-cloud-bulk-import",
    ...rest
  } = {}) {
    super({
      googleAutomation: async () => ({ status: "failed", error: "not used" }),
      socialExchange: async () => { throw new Error("not used"); },
      storageName,
      ...rest,
    });
    this.saveConnection = saveConnection;
  }

  async processAccount(job, account, workerId, browser) {
    const { context, page } = await createFreshContext(browser);
    account.runtimeSession = { context, page };

    try {
      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} preparing browser context`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      const result = await runQwenCloudAccountAutomation(page, account.email, account.password, {
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      this.setAccountStep(account, "saving_connection", "Saving Qwen Cloud API key");
      await this.persistJobSnapshot(job, { forcePreview: true });

      const { connection } = await this.saveConnection({
        email: account.email,
        apiKey: result.apiKey,
        keyId: result.keyId,
        workspaceId: result.workspaceId,
        gmtExpire: result.gmtExpire,
      });

      this.finalizeAccount(account, "success", {
        connectionId: connection.id,
        step: "connection_saved",
        message: "Qwen Cloud API key saved successfully",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: error.message || "Unexpected Qwen Cloud bulk import failure.",
        step: error.step || "failed",
        message: error.message || "Unexpected Qwen Cloud bulk import failure.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } finally {
      account.password = undefined;
    }
  }
}
