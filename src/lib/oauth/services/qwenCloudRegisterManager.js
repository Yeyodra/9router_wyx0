import {
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
} from "./kiroBulkImportManager.js";

export { buildLookupResponse };

export const QWEN_CLOUD_REGISTER_DEFAULT_CONCURRENCY = KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY;
export const QWEN_CLOUD_REGISTER_MIN_CONCURRENCY = KIRO_BULK_IMPORT_MIN_CONCURRENCY;
export const QWEN_CLOUD_REGISTER_MAX_CONCURRENCY = KIRO_BULK_IMPORT_MAX_CONCURRENCY;

// ─── Qwen Cloud constants (copied from qwenCloudBulkImportManager.js) ─────────
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

// ─── Slider CAPTCHA helpers (copied from qwenCloudBulkImportManager.js) ───────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function bezierDragPoints(totalX, steps = 40) {
  const cp1x = totalX * (0.25 + Math.random() * 0.15);
  const cp1y = -(2 + Math.random() * 4);
  const cp2x = totalX * (0.65 + Math.random() * 0.15);
  const cp2y = 2 + Math.random() * 4;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * mt * 0
      + 3 * mt * mt * t * cp1x
      + 3 * mt * t * t * cp2x
      + t * t * t * totalX;
    const y = mt * mt * mt * 0
      + 3 * mt * mt * t * cp1y
      + 3 * mt * t * t * cp2y
      + t * t * t * 0;
    points.push({
      x: x + (Math.random() - 0.5) * 1.5,
      y: y + (Math.random() - 0.5) * 1.5,
    });
  }
  return points;
}

async function solveSliderCaptcha(page) {
  try {
    const container = page.locator(SLIDER_CONTAINER_SEL).first();
    const containerVisible = await container.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!containerVisible) return false;
    const sliderBtn = page.locator(SLIDER_BTN_SEL).first();
    const sliderVisible = await sliderBtn.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!sliderVisible) return false;
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
  } catch {
    return false;
  }
}

async function handleSliderCaptchaIfPresent(page, { onStep, maxRetries = 3 } = {}) {
  const container = page.locator(SLIDER_CONTAINER_SEL).first();
  const visible = await container.isVisible({ timeout: 1_500 }).catch(() => false);
  if (!visible) return false;
  onStep?.("solving_captcha", "Detected Alibaba slide CAPTCHA — attempting to solve");
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const moved = await solveSliderCaptcha(page);
    if (!moved) break;
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
  onStep?.("captcha_failed", "Slide CAPTCHA could not be solved — marking for manual assist");
  return false;
}

// ─── extractEmailBody — parse raw RFC822, return decoded HTML/text body ──────
// Searches raw source for noise; this extracts just the email content.
function extractEmailBody(rawSource) {
  // Find MIME boundary
  const bMatch = rawSource.match(/boundary=["']?([^"'\r\n;]+)["']?/i);
  if (!bMatch) {
    // Not multipart — return content after headers
    const he = rawSource.indexOf("\r\n\r\n");
    return he >= 0 ? rawSource.slice(he + 4) : rawSource;
  }
  const parts = rawSource.split("--" + bMatch[1]);
  for (const part of parts) {
    if (/content-type:\s*text\/html/i.test(part)) {
      const he = part.indexOf("\r\n\r\n");
      if (he < 0) continue;
      let body = part.slice(he + 4).replace(/\r\n--.*/, "").trimEnd();
      if (/content-transfer-encoding:\s*base64/i.test(part)) {
        try { body = Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8"); } catch { /* keep raw */ }
      } else if (/content-transfer-encoding:\s*quoted-printable/i.test(part)) {
        body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      }
      return body;
    }
  }
  // Fallback: text/plain
  for (const part of parts) {
    if (/content-type:\s*text\/plain/i.test(part)) {
      const he = part.indexOf("\r\n\r\n");
      if (he < 0) continue;
      let body = part.slice(he + 4).replace(/\r\n--.*/, "").trimEnd();
      if (/content-transfer-encoding:\s*base64/i.test(part)) {
        try { body = Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8"); } catch { /* keep raw */ }
      }
      return body;
    }
  }
  return rawSource; // last resort
}

// ─── IMAP OTP reader (using imapflow) ────────────────────────────────────────
async function readOtpFromImap(targetEmail, imapConfig, { timeout = 120_000, since: sinceParam } = {}) {
  const { ImapFlow } = await import("imapflow");
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    let client;
    try {
      client = new ImapFlow({
        host: imapConfig.host || "imap.gmail.com",
        port: Number(imapConfig.port) || 993,
        secure: true,
        auth: { user: imapConfig.user, pass: imapConfig.pass },
        logger: false,
      });
      await client.connect();

      // Search INBOX + Spam (OTP might land in spam)
      for (const box of ["INBOX", "[Gmail]/Spam", "Spam", "Junk"]) {
        try { await client.mailboxOpen(box); } catch { continue; }
        // Search emails since OTP was sent (with 5s clock-skew buffer).
        // Falls back to last 60s if no timestamp provided. Narrow window prevents
        // stealing another worker's OTP in concurrent runs.
        const since = sinceParam
          ? new Date(sinceParam.getTime() - 5_000)
          : new Date(Date.now() - 60_000);
        const msgs = await client.search({ since });
        const recent = msgs.slice(-15).reverse();
        for (const uid of recent) {
          const msg = await client.fetchOne(uid, { source: true, envelope: true });
          const rawSource = msg.source?.toString() || "";
          // Parse MIME → get decoded HTML body (not raw RFC822 with base64/headers/noise)
          const source = extractEmailBody(rawSource);
          // Lenient To match — check envelope To, Cc, OR full source for target email
          const to = (msg.envelope?.to || []).map((t) => t.address || "").join(",").toLowerCase();
          const cc = (msg.envelope?.cc || []).map((t) => t.address || "").join(",").toLowerCase();
          const inSource = source.toLowerCase().includes(targetEmail.toLowerCase());
          if (!to.includes(targetEmail.toLowerCase()) && !cc.includes(targetEmail.toLowerCase()) && !inSource) continue;
          // 3-level OTP extraction (mirrors alibaba-cloud-farm reference):
          // Level 1: OTP in a styled <span>: >123456</span>
          let match = source.match(/>\s*(\d{6})\s*<\/span>/i);
          // Level 2: 6-digit near "code"/"verification"/"otp" keyword
          if (!match) match = source.match(/(?:code|verification|otp|verify)[^<]{0,20}?(\d{6})/i);
          // Level 3: any 6-digit DECIMAL number EXCLUDING common CSS colors (false positives)
          if (!match) {
            const blacklist = new Set(["181818", "666666", "808080", "999999", "333333", "000000", "111111", "222222", "444444", "555555", "777777", "888888"]);
            for (const m of source.matchAll(/\b(\d{6})\b/g)) {
              if (!blacklist.has(m[1])) { match = m; break; }
            }
          }
          if (match) {
            await client.logout();
            return match[1];
          }
        }
      }
      await client.logout();
    } catch (err) {
      console.log(`[QwenRegister] IMAP error: ${err.message}`);
      try { await client?.logout(); } catch { /* noop */ }
    }
    await sleep(3_000);
  }
  return null;
}

// ─── extractSecToken (copied from qwenCloudBulkImportManager.js) ──────────────
async function extractSecToken(cookieHeader) {
  try {
    const res = await fetch(QWEN_USER_INFO, {
      headers: {
        Cookie: cookieHeader,
        Referer: QWEN_HOME_URL,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!res.ok) return "";
    const raw = await res.text();
    const data = JSON.parse(raw);
    return (
      data?.sec_token ??
      data?.secToken ??
      data?.data?.sec_token ??
      data?.data?.secToken ??
      data?.content?.sec_token ??
      ""
    );
  } catch {
    return "";
  }
}

// ─── callApiGateway (copied from qwenCloudBulkImportManager.js) ───────────────
async function callApiGateway(cookieHeader, secToken, apiName, reqDTO, extraData = {}) {
  const paramsPayload = {
    Api: apiName,
    Data: {
      reqDTO,
      cornerstoneParam: QWEN_CORNERSTONE,
      ...extraData,
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
  try { return JSON.parse(text); } catch { return { _rawText: text.slice(0, 500) }; }
}

// ─── defaultSaveQwenCloudConnection (copied from qwenCloudBulkImportManager.js)
async function defaultSaveQwenCloudConnection({ email, apiKey, keyId, workspaceId, gmtExpire }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const connection = await createProviderConnection({
    provider: "qwen-cloud",
    authType: "apikey",
    apiKey,
    email,
    providerSpecificData: {
      loginEmail: email,
      automation: "register-imap",
      keyId: keyId || null,
      workspaceId: workspaceId || null,
      gmtExpire: gmtExpire || null,
    },
    testStatus: "active",
  });
  return { connection };
}

// ─── random account generator ─────────────────────────────────────────────────
function generateRandomAccount(emailDomain) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomPart = Array.from(
    { length: 10 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
  const email = `${randomPart}@${emailDomain}`;
  const password = "Aa1!" + Array.from(
    { length: 12 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
  return { email, password };
}

// ─── getImapConfig — reads from settings with env fallback ───────────────────
async function getImapConfig() {
  const { getSettings } = await import("../../db/repos/settingsRepo.js");
  const settings = await getSettings();
  return {
    user: settings.qwen_register_imap_user || process.env.QWEN_REGISTER_IMAP_USER || "",
    pass: settings.qwen_register_imap_pass || process.env.QWEN_REGISTER_IMAP_PASS || "",
    host: settings.qwen_register_imap_host || process.env.QWEN_REGISTER_IMAP_HOST || "imap.gmail.com",
    port: Number(settings.qwen_register_imap_port || process.env.QWEN_REGISTER_IMAP_PORT || 993),
    domain: settings.qwen_register_email_domain || process.env.QWEN_REGISTER_EMAIL_DOMAIN || "nzr.web.id",
  };
}

// ─── runQwenCloudRegistration — full registration flow ───────────────────────
async function runQwenCloudRegistration(page, email, password, imapConfig, { onStep } = {}) {
  page.setDefaultTimeout(120_000);

  // Debug logger — writes to file (survives stdout suppression)
  const _dbg = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try { require("fs").appendFileSync(require("path").join(process.cwd(), "debug-register.log"), line); } catch {}
    console.log(`[QwenRegister] ${msg}`);
  };
  _dbg(`runQwenCloudRegistration STARTED for ${email}`);

  // pollUrl helper — wait for URL predicate to be true (reused from GSuite flow)
  const pollUrl = async (predicate, { timeout = 45_000, interval = 600 } = {}) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (predicate(page.url())) return page.url();
      await sleep(interval);
    }
    return null;
  };

  // 1. Navigate to home.qwencloud.com/api-keys → triggers SSO redirect to login.htm
  //    (same entry point as GSuite Auto Login — only the register flow differs)
  onStep?.("navigating", "Navigating to home.qwencloud.com/api-keys (SSO redirect)");
  await page.goto(QWEN_HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
  await sleep(2_000);

  // 2. Wait for SSO login page (account.alibabacloud.com/sso/login.htm)
  onStep?.("waiting_sso_page", "Waiting for SSO login page to load");
  const ssoLanded = await pollUrl(
    (u) => u.includes("account.alibabacloud.com/sso/login.htm") || u.includes("account.alibabacloud.com/sso/"),
    { timeout: 30_000 }
  );
  if (!ssoLanded) {
    throw Object.assign(
      new Error(`Never reached SSO login page — stuck at: ${page.url().slice(0, 100)}`),
      { step: "sso_page_not_reached" }
    );
  }
  await sleep(3_000);

  // 3. Click "Sign Up" link on login page → navigates to sso/register page
  //    Login page (sso/login.htm) has: "Don't have an account? [Sign Up]" → sso/register?...
  onStep?.("clicking_signup_link", "Clicking Sign Up link to go to register page");
  const signUpLinkSelectors = [
    'a:has-text("Sign Up")',
    'a:has-text("Register")',
    'a:has-text("Create account")',
    'a[href*="register" i]',
  ];
  let linkClicked = false;
  for (const sel of signUpLinkSelectors) {
    const el = page.locator(sel).first();
    const visible = await el.isVisible({ timeout: 2_000 }).catch(() => false);
    if (visible) {
      await el.click({ timeout: 5_000 }).catch(() => null);
      linkClicked = true;
      onStep?.("signup_link_clicked", "Navigating to register page");
      break;
    }
  }
  if (!linkClicked) {
    onStep?.("signup_link_not_found", "Sign Up link not found — checking if already on register page");
  }

  // 3b. Wait for register page (sso/register) — it's a separate URL, not a tab
  onStep?.("waiting_register_page", "Waiting for register page to load");
  const regLanded = await pollUrl(
    (u) => u.includes("account.alibabacloud.com/sso/register"),
    { timeout: 15_000 }
  );
  if (!regLanded) {
    throw Object.assign(
      new Error(`Never reached register page — stuck at: ${page.url().slice(0, 100)}`),
      { step: "register_page_not_reached" }
    );
  }
  await sleep(3_000);

  // 4. Fill email
  onStep?.("filling_email", "Filling email field");
  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[id*="email" i]',
    'input[placeholder*="email" i]',
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
  ].join(", ");
  const emailInput = page.locator(emailSelectors).first();
  const emailVisible = await emailInput.isVisible({ timeout: 10_000 }).catch(() => false);
  if (emailVisible) {
    await emailInput.fill(email, { timeout: 10_000 });
    onStep?.("email_filled", `Filled email: ${email}`);
  } else {
    throw Object.assign(new Error("Email input not found on register form"), { step: "email_input_not_found" });
  }
  // Wait for email value to register + check_email.do validation to complete.
  // The Send Code button is typically disabled until email validation passes.
  await sleep(2_000);

  // 5. Click "Next" button → sends OTP (sendEmailCodeForEmailCodeRegister.do)
  //    The register page has a "Next" button (NOT "Send Code" — that's on the login page)
  onStep?.("clicking_next", "Clicking Next button to send OTP");
  const nextBtnSelectors = [
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'button[type="submit"]',
    '[role="button"]:has-text("Next")',
    'button:has-text("Sign Up")',
  ];
  let codeSent = false;
  const nextDeadline = Date.now() + 15_000;
  while (Date.now() < nextDeadline && !codeSent) {
    for (const sel of nextBtnSelectors) {
      const btn = page.locator(sel).first();
      const visible = await btn.isVisible({ timeout: 500 }).catch(() => false);
      if (visible) {
        const disabled = await btn.isDisabled().catch(() => false);
        if (disabled) continue;
        await btn.click({ timeout: 5_000 }).catch(() => null);
        codeSent = true;
        onStep?.("code_sent", "Next clicked — OTP sent to email");
        break;
      }
    }
    if (!codeSent) {
      // Fallback: scan all buttons for relevant text
      const buttons = await page.locator("button, [role='button']").all();
      for (const btn of buttons) {
        const txt = (await btn.innerText().catch(() => "")).trim().toLowerCase();
        if ((txt.includes("next") || txt.includes("continue") || txt.includes("sign up") || txt.includes("submit")) && await btn.isVisible().catch(() => false)) {
          const disabled = await btn.isDisabled?.().catch(() => false);
          if (disabled) continue;
          await btn.click().catch(() => null);
          codeSent = true;
          onStep?.("code_sent", `Clicked button: ${txt}`);
          break;
        }
      }
    }
    if (!codeSent) {
      onStep?.("next_button_waiting", "Waiting for Next button to become available…");
      await sleep(1_000);
    }
  }
  if (!codeSent) {
    throw Object.assign(
      new Error("Next button not found or not clickable after 15s — email validation may have failed"),
      { step: "next_button_not_found" }
    );
  }
  // Record timestamp — OTP email should arrive AFTER this point.
  // Passed to readOtpFromImap to narrow search window (prevents OTP theft in concurrent runs)
  const otpSentAt = new Date();
  // Wait for OTP input to appear (form advances to next step after Next)
  await sleep(3_000);

  // 6. Handle slider CAPTCHA if present (may appear after sending code)
  onStep?.("checking_captcha", "Checking for CAPTCHA after send code");
  await handleSliderCaptchaIfPresent(page, { onStep });
  for (const f of page.frames()) {
    if (f.url().includes("punish") || f.url().includes("captcha")) {
      await handleSliderCaptchaIfPresent(f, { onStep });
    }
  }
  await sleep(1_000);

  // 7. Poll IMAP for OTP (code was sent in step 5)
  onStep?.("waiting_otp", `Polling IMAP for OTP to ${email} (up to 120s)`);
  const otp = await readOtpFromImap(email, imapConfig, { timeout: 120_000, since: otpSentAt });
  if (!otp) {
    throw Object.assign(
      new Error(`OTP not received within 120s for ${email}`),
      { step: "otp_timeout" }
    );
  }
  onStep?.("otp_received", `OTP received: ${otp}`);
  await sleep(1_000);

  // 8. Fill OTP verification code — checkEmailCodeForEmailCodeRegister.do fires
  //    BEFORE nationality selection (HAR: OTP verify → getCountryList → emailCodeRegister)
  onStep?.("filling_otp", "Filling OTP code");
  const otpSelectors = [
    '#emailCaptcha',
    'input[name="emailCaptcha"]',
    'input[name*="otp" i]',
    'input[name*="code" i]',
    'input[placeholder*="code" i]',
    'input[placeholder*="verification" i]',
    'input[maxlength="6"]',
    'input[name*="verif" i]',
    'input[id*="code" i]',
    'input[id*="otp" i]',
    'input[name*="captcha" i]',
    'input[autocomplete="one-time-code"]',
  ].join(", ");
  const otpInput = page.locator(otpSelectors).first();
  const otpVisible = await otpInput.isVisible({ timeout: 5_000 }).catch(() => false);
  if (otpVisible) {
    await otpInput.fill(otp, { timeout: 5_000 });
    onStep?.("otp_filled", "Filled OTP input");
  } else {
    // fallback: multiple single-digit inputs
    const singleInputs = await page.locator('input[type="text"], input:not([type])').all();
    const visibleInputs = [];
    for (const inp of singleInputs) {
      if (await inp.isVisible().catch(() => false)) visibleInputs.push(inp);
    }
    if (visibleInputs.length >= 6) {
      for (let i = 0; i < 6; i++) {
        await visibleInputs[i].fill(otp[i]);
      }
      onStep?.("otp_filled", "Filled OTP into individual digit inputs");
    } else {
      throw Object.assign(new Error("Could not find OTP input field"), { step: "otp_input_not_found" });
    }
  }
  // Wait for OTP verification to complete server-side (checkEmailCodeForEmailCodeRegister.do)
  // — nationality dropdown only appears AFTER OTP is verified
  await sleep(3_000);

  // 9. Select Singapore nationality (region) — appears AFTER OTP verification
  //    Approach: iterate ALL <select> elements, find one with "Singapore" option
  //    (mirrors alibaba-cloud-farm reference — more robust than guessing id/name)
  onStep?.("selecting_country", "Selecting Singapore as country/region");
  let countrySelected = false;

  // Also check inside frames (register form may be in an iframe)
  const searchTargets = [page, ...page.frames()];
  for (const target of searchTargets) {
    if (countrySelected) break;
    const allSelects = await target.locator("select").all();
    for (const sel of allSelects) {
      if (countrySelected) break;
      if (!(await sel.isVisible().catch(() => false))) continue;
      const options = await sel.locator("option").all();
      for (const opt of options) {
        const text = (await opt.innerText().catch(() => "")).toLowerCase();
        if (text.includes("singapore")) {
          const val = await opt.getAttribute("value").catch(() => null);
          if (val) {
            await sel.selectOption({ value: val }).catch(() => null);
          } else {
            await sel.selectOption({ label: "Singapore" }).catch(() => null);
          }
          countrySelected = true;
          onStep?.("country_selected", "Selected Singapore (native select)");
          break;
        }
      }
    }
  }

  if (!countrySelected) {
    // Fallback: combobox with country/region placeholder (same as GSuite completeRegistration)
    const countryComboSel = [
      'input[role="combobox"][placeholder*="country" i]',
      'input[role="combobox"][placeholder*="region" i]',
      'input[role="combobox"][placeholder*="Select your" i]',
    ].join(", ");
    for (const target of searchTargets) {
      if (countrySelected) break;
      const combo = target.locator(countryComboSel).first();
      const comboVisible = await combo.isVisible({ timeout: 1_000 }).catch(() => false);
      if (comboVisible) {
        await combo.click({ timeout: 3_000 }).catch(() => null);
        await sleep(400);
        await combo.fill("Singapore").catch(() => null);
        await sleep(600);
        const sgOptSel = [
          'li:has-text("Singapore")',
          '[role="option"]:has-text("Singapore")',
          '[role="listbox"] *:has-text("Singapore")',
          'div[class*="option"]:has-text("Singapore")',
        ].join(", ");
        const sgOpt = target.locator(sgOptSel).first();
        if (await sgOpt.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await sgOpt.click({ timeout: 3_000 }).catch(() => null);
          countrySelected = true;
          onStep?.("country_selected", "Selected Singapore (combobox)");
          await sleep(400);
        }
      }
    }
  }

  if (!countrySelected) {
    onStep?.("country_not_found", "Country selection not found — proceeding without it");
  }
  await sleep(500);

  // 10. Check agreement checkbox if present
  const checkbox = page.locator('input[type="checkbox"]').first();
  const cbVisible = await checkbox.isVisible({ timeout: 2_000 }).catch(() => false);
  if (cbVisible) {
    const checked = await checkbox.isChecked().catch(() => true);
    if (!checked) {
      await checkbox.click();
      onStep?.("accepted_terms", "Checked agreement checkbox");
    }
  }
  await sleep(300);

  // 11. Click Continue / Sign Up (final submit) → emailCodeRegister.do → SSO redirect
  //     Button text is "Continue" on the Qwen Cloud onboarding page (same as GSuite completeRegistration)
  onStep?.("clicking_signup", "Clicking Continue / Sign Up button");
  const submitSel = [
    'button:has-text("Continue")',
    'button:has-text("Lanjutkan")',
    'button:has-text("Complete")',
    'button:has-text("Submit")',
    'button:has-text("Confirm")',
    'button:has-text("Sign Up")',
    'button:has-text("Register")',
    'button:has-text("Create Account")',
    'button[type="submit"]',
  ].join(", ");
  // Search page + all frames
  const searchTargets2 = [page, ...page.frames()];
  let submitClicked = false;
  for (const target of searchTargets2) {
    if (submitClicked) break;
    const submitLoc = target.locator(submitSel).first();
    const visible = await submitLoc.isVisible({ timeout: 1_000 }).catch(() => false);
    if (visible) {
      const txt = await submitLoc.innerText().catch(() => "");
      await submitLoc.click({ timeout: 5_000 }).catch(() => null);
      submitClicked = true;
      onStep?.("signup_submitted", `Clicked: ${txt.trim().slice(0, 40)}`);
    }
  }
  if (!submitClicked) {
    onStep?.("signup_button_not_found", "Submit button not found — trying all buttons");
    const fallbackTargets = [page, ...page.frames()];
    for (const target of fallbackTargets) {
      if (submitClicked) break;
      const allBtns = await target.locator("button, [role='button']").all();
      for (const btn of allBtns) {
        const txt = (await btn.innerText().catch(() => "")).trim().toLowerCase();
        if ((txt.includes("continue") || txt.includes("submit") || txt.includes("sign up") || txt.includes("confirm") || txt.includes("register")) && await btn.isVisible().catch(() => false)) {
          await btn.click();
          submitClicked = true;
          onStep?.("signup_submitted", `Clicked: ${txt}`);
          break;
        }
      }
    }
  }
  await sleep(5_000);

  // 12. Handle slider CAPTCHA if present (may appear after final signup)
  onStep?.("checking_captcha_final", "Checking for CAPTCHA after signup");
  await handleSliderCaptchaIfPresent(page, { onStep });
  for (const f of page.frames()) {
    if (f.url().includes("punish") || f.url().includes("captcha")) {
      await handleSliderCaptchaIfPresent(f, { onStep });
    }
  }
  await sleep(5_000);

  // 13. Wait for home.qwencloud.com landing (SSO redirect after registration)
  //     After emailCodeRegister.do succeeds → 302 login_aliyun → ssoLogin?code=… → home.qwencloud.com
  //     Then reuse GSuite post-login flow: extractSecToken → callApiGateway → createApiKey
  onStep?.("waiting_for_landing", "Waiting for Qwen Cloud dashboard");
  const landed = await pollUrl((u) => u.includes("home.qwencloud.com"), { timeout: 60_000 });
  if (!landed) {
    throw Object.assign(
      new Error(`Never landed on home.qwencloud.com — stuck at: ${page.url().slice(0, 100)}`),
      { step: "navigation_failed" }
    );
  }
  // 14. Wait for SPA to finish loading + extract cookies
  //     DO NOT reload page — the SSO code in ssoLogin?code=… is one-time use.
  //     Reloading triggers a new SSO redirect which fails (code already consumed) → no auth cookie.
  //     Just wait for network to settle, then extract cookies (same as GSuite flow).
  onStep?.("extracting_cookies", "Extracting session cookies");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => null);
  await sleep(2_000);

  let rawCookies = await page.context().cookies();
  let cookieMap = Object.fromEntries(rawCookies.map((c) => [c.name, c.value]));
  let cookieHeader = rawCookies.map((c) => `${c.name}=${c.value}`).join("; ");

  console.log(`[QwenRegister] Got ${rawCookies.length} cookies, has ticket: ${!!cookieMap.login_qwencloud_ticket}`);

  // Retry if auth cookie not yet set (SPA may need more time to settle)
  if (!cookieMap.login_qwencloud_ticket) {
    onStep?.("waiting_auth_cookie", "Auth cookie not found — retrying…");
    for (let i = 0; i < 5; i++) {
      await sleep(3_000);
      rawCookies = await page.context().cookies();
      cookieMap = Object.fromEntries(rawCookies.map((c) => [c.name, c.value]));
      cookieHeader = rawCookies.map((c) => `${c.name}=${c.value}`).join("; ");
      console.log(`[QwenRegister] Retry ${i+1}/5: ${rawCookies.length} cookies, has ticket: ${!!cookieMap.login_qwencloud_ticket}`);
      if (cookieMap.login_qwencloud_ticket) break;
    }
  }

  if (!cookieMap.login_qwencloud_ticket) {
    throw Object.assign(
      new Error("login_qwencloud_ticket cookie not found after registration — authentication may have failed"),
      { step: "cookie_missing" }
    );
  }

  onStep?.("extracting_sec_token", "Fetching sec_token");
  const secToken = await extractSecToken(cookieHeader);
  if (!secToken) {
    throw Object.assign(new Error("Failed to extract sec_token"), { step: "sec_token_failed" });
  }

  // 14b. Activate Bailian model service — without these API calls the workspace
  //      gets an API key but ZERO model entitlement, causing 403
  //      "Access to model denied" (AccessDenied.Unpurchased) on every model.
  //      Sequence captured from HAR (clean.har): home.qwencloud.com dashboard JS
  //      calls these on page load. We replicate them explicitly via the gateway.
  //      Flow: loginInfo → initSpace → queryBuyPostpaidResult → buyPostpaidCommodity
  //      → poll queryBuyPostpaidResult until "success" → then createApiKey.

  // (a) loginInfo — session init (first gateway call in HAR)
  onStep?.("activating_service", "Session init (loginInfo)");
  _dbg("Calling loginInfo...");
  {
    const r = await callApiGateway(
      cookieHeader, secToken,
      "zeldaEasy.cornerstone-portal.cs-console.loginInfo",
      {},
    ).catch(e => { _dbg(`loginInfo ERROR: ${e.message}`); return null; });
    _dbg(`loginInfo result: success=${r?.data?.success} errMsg=${r?.data?.errorMsg || ""} raw=${JSON.stringify(r).slice(0, 200)}`);
  }
  await sleep(1_000);

  // (b) initSpace — initialize Bailian workspace
  onStep?.("activating_service", "Initializing workspace (initSpace)");
  _dbg("Calling initSpace...");
  {
    const r = await callApiGateway(
      cookieHeader, secToken,
      "zeldaEasy.bailian-dash-workspace.space.initSpace",
      {},
    ).catch(e => { _dbg(`initSpace ERROR: ${e.message}`); return null; });
    _dbg(`initSpace result: success=${r?.data?.success} errMsg=${r?.data?.errorMsg || ""} raw=${JSON.stringify(r).slice(0, 200)}`);
  }
  await sleep(2_000);

  // (c) buyPostpaidCommodity — subscribe to free-tier model service (1M tokens)
  //     MUST use page.evaluate (browser fetch) — Node.js fetch triggers
  //     RISK.RISK_CONTROL_REJECTION because TLS fingerprint differs from browser.
  onStep?.("subscribing_service", "Subscribing to free-tier (buyPostpaidCommodity via browser)");
  _dbg("Calling buyPostpaidCommodity via page.evaluate (browser fetch)...");
  {
    const buyResult = await page.evaluate(async (token) => {
      const params = JSON.stringify({
        Api: "zeldaEasy.bailian-commerce.bill.buyPostpaidCommodity",
        Data: {
          reqDTO: {},
          cornerstoneParam: {
            domain: "home.qwencloud.com",
            consoleSite: "QWENCLOUD",
            productCode: "p_efm",
            protocol: "V2",
            xsp_lang: "en-US",
          },
          advertTrace: { channel: "", fromApp: "qwencloud" },
        },
      });
      const body = new URLSearchParams({
        product: "sfm_bailian",
        action: "IntlBroadScopeAspnGateway",
        sec_token: token,
        region: "ap-southeast-1",
        params,
      }).toString();
      const url = "https://cs-data.qwencloud.com/data/api.json?product=sfm_bailian&action=IntlBroadScopeAspnGateway&api=" + encodeURIComponent("zeldaEasy.bailian-commerce.bill.buyPostpaidCommodity");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        credentials: "include",
      });
      return res.text();
    }, secToken).catch(e => { _dbg(`buyPostpaid page.evaluate ERROR: ${e.message}`); return null; });
    _dbg(`buyPostpaid (browser) result: ${String(buyResult).slice(0, 300)}`);
  }

  // (d) Wait briefly then proceed — HAR shows manual flow calls createApiKey while
  //     polling is still returning "buying". Some commodities (sfm_training etc.)
  //     always return "fail" via RISK_CONTROL_REJECTION — this is normal and does
  //     NOT block inference models. Waiting for a non-"buying" status is wrong;
  //     just give the backend a few seconds to provision the workspace.
  onStep?.("waiting_subscription", "Waiting for subscription to provision (5s)");
  await sleep(5_000);
  _dbg("Subscription wait complete — proceeding to createApiKey");

  // 15. Create API key (retry 3x for NotAuthorised)
  onStep?.("creating_api_key", "Creating Qwen Cloud API key");
  let createResp;
  const CREATE_RETRIES = 3;
  const CREATE_RETRY_DELAY = 8_000;
  for (let attempt = 1; attempt <= CREATE_RETRIES; attempt++) {
    _dbg(`createApiKey attempt ${attempt}/${CREATE_RETRIES} (browser fetch)...`);
    const rawCreate = await page.evaluate(async ({ token, apiName, cornerstone, desc }) => {
      const params = JSON.stringify({
        Api: apiName,
        Data: {
          reqDTO: { description: desc },
          cornerstoneParam: cornerstone,
        },
      });
      const body = new URLSearchParams({
        product: "sfm_bailian",
        action: "IntlBroadScopeAspnGateway",
        sec_token: token,
        region: "ap-southeast-1",
        params,
      }).toString();
      const url = "https://cs-data.qwencloud.com/data/api.json?product=sfm_bailian&action=IntlBroadScopeAspnGateway&api=" + encodeURIComponent(apiName);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          credentials: "include",
        });
        return res.text();
      } catch (e) {
        return null;
      }
    }, {
      token: secToken,
      apiName: QWEN_API_NAME,
      cornerstone: QWEN_CORNERSTONE,
      desc: `poolprox-${Date.now()}`,
    }).catch(() => null);

    try { createResp = rawCreate ? JSON.parse(rawCreate) : null; } catch { createResp = { _rawText: String(rawCreate).slice(0, 500) }; }
    _dbg(`createApiKey attempt ${attempt} raw: ${JSON.stringify(createResp).slice(0, 400)}`);
    const errMsg = createResp?.data?.errorMsg || createResp?.data?.DataV2?.errorMsg || "";
    if (errMsg.includes("NotAuthorised") || errMsg.includes("NotAuthorized")) {
      if (attempt < CREATE_RETRIES) {
        onStep?.("creating_api_key", `Workspace not ready (attempt ${attempt}/${CREATE_RETRIES}) — retrying in ${CREATE_RETRY_DELAY / 1000}s`);
        _dbg(`createApiKey NotAuthorised — retrying in ${CREATE_RETRY_DELAY}ms`);
        await sleep(CREATE_RETRY_DELAY);
        continue;
      }
    }
    break;
  }

  const inner      = createResp?.data?.DataV2?.data?.data ?? {};
  const apiKey      = inner.key || inner.apiKey || inner.api_key || "";
  const workspaceId = inner.workspace_id || "";
  const gmtExpire   = inner.gmt_expire || "";
  const keyId       = String(inner.id || "");

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

  // 16. Verify API key — hit Dashscope with a minimal completion request.
  //     A valid key returns choices[0]; an unprovisioned / denied key returns
  //     an error object. We treat anything other than a model response as a
  //     failure so the account is not saved as "active" when it cannot
  //     actually serve requests.
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

  return { apiKey, keyId, workspaceId, gmtExpire };
}

// ─── Manager class ────────────────────────────────────────────────────────────
export class QwenCloudRegisterManager extends KiroBulkImportManager {
  constructor({
    saveConnection = defaultSaveQwenCloudConnection,
    storageName = "qwen-cloud-register",
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

  // Override startJob: accepts { count, engine, proxyUrl, proxyPoolId, concurrency }
  // instead of { accounts } — generates random emails on the fly
  async startJob({ count, concurrency, engine, proxyUrl, proxyUrls, proxyMode, proxyPoolId, proxySource }) {
    if (!Number.isFinite(count) || count < 1) {
      throw Object.assign(new Error("count must be a positive integer"), { error: "count must be a positive integer" });
    }

    const imapConfig = await getImapConfig();
    if (!imapConfig.user || !imapConfig.pass) {
      throw Object.assign(
        new Error("IMAP credentials not configured. Go to register-config to set them."),
        { error: "IMAP credentials not configured. Go to register-config to set them." }
      );
    }

    // Generate random accounts
    const accounts = Array.from({ length: count }, (_, i) => ({
      ...generateRandomAccount(imapConfig.domain),
      line: i + 1,
    }));

    // Temporarily pass as pre-parsed accounts by overriding parseKiroBulkAccounts behaviour
    // We call the parent runJob machinery directly via a custom startJobFromParsed path
    return this._startJobFromAccounts(accounts, { concurrency, engine, proxyUrl, proxyUrls, proxyMode, proxyPoolId, proxySource, imapConfig });
  }

  async _startJobFromAccounts(accounts, { concurrency, engine, proxyUrl, proxyUrls, proxyMode, proxyPoolId, proxySource, imapConfig }) {
    const { randomUUID } = await import("crypto");
    const { DATA_DIR } = await import("../../dataDir.js");
    const path = await import("node:path");
    const { normalizeBulkImportEngine, DEFAULT_BULK_IMPORT_ENGINE } = await import("./bulkImportBrowserEngine.js");
    const { isAutoConcurrencyValue } = await import("../../systemSpecs.js");

    const jobId = randomUUID();
    const createdAt = new Date().toISOString();
    const resolvedEngine = engine ? normalizeBulkImportEngine(engine) : DEFAULT_BULK_IMPORT_ENGINE;

    const rawProxyUrls = Array.isArray(proxyUrls) ? proxyUrls : (proxyUrl ? [proxyUrl] : []);
    const resolvedProxyUrls = [...new Set(rawProxyUrls.map((v) => String(v || "").trim()).filter(Boolean))];

    // clamp concurrency — reuse parent's clamping via a simple inline
    let resolvedConcurrency = 2; // default for registration (slower flow)
    if (isAutoConcurrencyValue(concurrency)) {
      resolvedConcurrency = 2;
    } else {
      const parsed = Number.parseInt(concurrency, 10);
      resolvedConcurrency = Number.isFinite(parsed)
        ? Math.min(8, Math.max(1, parsed))
        : 2;
    }

    const job = {
      jobId,
      status: "running",
      concurrency: resolvedConcurrency,
      engine: resolvedEngine,
      proxyUrl: resolvedProxyUrls[0] || null,
      proxyUrls: resolvedProxyUrls,
      proxyMode: proxyMode || (resolvedProxyUrls.length > 1 ? "round-robin" : (resolvedProxyUrls.length === 1 ? "single" : "none")),
      proxyPoolId: proxyPoolId || null,
      proxySource: proxySource || null,
      createdAt,
      startedAt: createdAt,
      finishedAt: null,
      error: null,
      cancelRequested: false,
      browser: null,
      workerBrowsers: new Set(),
      nextIndex: 0,
      manualFollowups: new Set(),
      persistPromise: Promise.resolve(),
      lastPreview: null,
      lastPreviewCapturedAt: 0,
      imapConfig,
      accounts: accounts.map((account) => ({
        line: account.line,
        email: account.email,
        password: account.password,
        status: "queued",
        error: null,
        connectionId: null,
        workerId: null,
        manualSession: null,
        runtimeSession: null,
        currentStep: "queued",
        updatedAt: createdAt,
        logs: [{ id: randomUUID(), at: createdAt, step: "queued", message: "Queued and waiting for an available worker", level: "info" }],
      })),
    };

    this.jobs.set(jobId, job);
    this.latestJobId = jobId;

    // Persist meta
    const fs = await import("node:fs");
    const storageDir = path.join(DATA_DIR, "qwen-cloud-register");
    fs.mkdirSync(storageDir, { recursive: true });
    const metaFile = path.join(storageDir, "meta.json");
    const tempMeta = `${metaFile}.${process.pid}.tmp`;
    fs.writeFileSync(tempMeta, JSON.stringify({ latestJobId: jobId, updatedAt: createdAt }, null, 2), "utf8");
    fs.renameSync(tempMeta, metaFile);

    await this.persistJobSnapshot(job, { forcePreview: false });
    void this.runJob(jobId);

    // Return sanitized job (use parent's sanitize via getJob)
    return this.getJob(jobId);
  }

  async processAccount(job, account, workerId, browser) {
    const { context, page } = await createFreshContext(browser);
    account.runtimeSession = { context, page };

    try {
      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} preparing browser context`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      const result = await runQwenCloudRegistration(page, account.email, account.password, job.imapConfig, {
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
        message: "Qwen Cloud API key registered and saved successfully",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: error.message || "Unexpected registration failure.",
        step: error.step || "failed",
        message: error.message || "Unexpected registration failure.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } finally {
      account.password = undefined;
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export function getQwenCloudRegisterManager() {
  if (!globalThis.__qwenCloudRegisterManagerSingleton) {
    globalThis.__qwenCloudRegisterManagerSingleton = new QwenCloudRegisterManager();
  }
  return globalThis.__qwenCloudRegisterManagerSingleton;
}
