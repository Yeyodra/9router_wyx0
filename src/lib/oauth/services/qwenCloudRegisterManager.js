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
  "#risk_slider_container",
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

async function solveSliderCaptcha(locatorCtx, mouseCtx) {
  try {
    const container = locatorCtx.locator(SLIDER_CONTAINER_SEL).first();
    const containerVisible = await container.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!containerVisible) return false;
    const sliderBtn = locatorCtx.locator(SLIDER_BTN_SEL).first();
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
    await mouseCtx.mouse.move(startX, startY);
    await sleep(80 + Math.random() * 120);
    await mouseCtx.mouse.down();
    await sleep(50 + Math.random() * 80);
    for (const pt of points) {
      await mouseCtx.mouse.move(startX + pt.x, startY + pt.y, { steps: 1 });
      await sleep(8 + Math.random() * 18);
    }
    await sleep(120 + Math.random() * 200);
    await mouseCtx.mouse.up();
    await sleep(800 + Math.random() * 400);
    return true;
  } catch {
    return false;
  }
}

async function handleSliderCaptchaIfPresent(page, { onStep, maxRetries = 3, mouseCtx } = {}) {
  const container = page.locator(SLIDER_CONTAINER_SEL).first();
  const visible = await container.isVisible({ timeout: 1_500 }).catch(() => false);
  if (!visible) return false;
  onStep?.("solving_captcha", "Detected Alibaba slide CAPTCHA — attempting to solve");
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const moved = await solveSliderCaptcha(page, mouseCtx ?? page);
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

  // Find passport.alibabacloud.com iframe frame
  async function findRegisterFrame(pg) {
    for (const f of pg.frames()) {
      if (f.url().includes("passport.alibabacloud.com")) return f;
    }
    return null;
  }

  // ── Step 1: Navigate ────────────────────────────────────────────────────────
  onStep?.("navigating", "Navigating to Alibaba Cloud register page");
  await page.goto(
    "https://account.alibabacloud.com/register/intl_register.htm",
    { waitUntil: "domcontentloaded", timeout: 120_000 }
  );

  // ── Step 2: Wait for passport iframe ────────────────────────────────────────
  onStep?.("waiting_iframe", "Waiting for passport iframe to load");
  let frame = null;
  for (let wait = 0; wait < 15; wait++) {
    try {
      await page.waitForSelector("iframe[src*='passport']", { timeout: 5_000 });
    } catch { /* keep trying */ }
    await sleep(2_000);
    frame = await findRegisterFrame(page);
    if (frame) break;
  }
  if (!frame) {
    throw Object.assign(
      new Error("passport.alibabacloud.com iframe not found after 30s"),
      { step: "iframe_not_found" }
    );
  }

  // ── Step 3: Individual account type + Next ──────────────────────────────────
  onStep?.("selecting_individual", "Selecting Individual account type");
  let individualLabel = null;
  for (let i = 0; i < 10; i++) {
    const labels = await frame.locator("label").all();
    for (const lbl of labels) {
      const txt = await lbl.innerText().catch(() => "");
      if (txt.trim().toLowerCase().includes("individual")) {
        const vis = await lbl.isVisible().catch(() => false);
        if (vis) { individualLabel = lbl; break; }
      }
    }
    if (individualLabel) break;
    await sleep(2_000);
    frame = await findRegisterFrame(page);
    if (!frame) break;
  }
  if (!individualLabel) {
    throw Object.assign(
      new Error("Individual label not found in register frame"),
      { step: "individual_not_found" }
    );
  }
  await individualLabel.click();
  await sleep(2_000);
  // Click Next link
  const nextLink = await frame.locator("a").filter({ hasText: "Next" }).first();
  const nextLinkVis = await nextLink.isVisible().catch(() => false);
  if (nextLinkVis) await nextLink.click();
  await sleep(5_000);


  // ── Step 4: Fill form (email, password, confirmPwd) ─────────────────────────
  onStep?.("filling_form", "Filling email and password fields");
  frame = await findRegisterFrame(page);
  await sleep(3_000);

  const emailField = frame.locator("#email");
  const pwField = frame.locator("#password");
  const confirmField = frame.locator("#confirmPwd");

  if (!(await emailField.count()) || !(await pwField.count())) {
    throw Object.assign(
      new Error("Email or password fields not found in register frame"),
      { step: "form_fields_not_found" }
    );
  }

  // Fill email char-by-char
  await emailField.click();
  await sleep(300);
  for (const ch of email) {
    await page.keyboard.type(ch, { delay: 30 });
  }
  await sleep(500);

  // Fill password char-by-char
  await pwField.click();
  await sleep(300);
  for (const ch of password) {
    await page.keyboard.type(ch, { delay: 30 });
  }
  await sleep(500);

  // Fill confirmPwd char-by-char
  if (await confirmField.count()) {
    await confirmField.click();
    await sleep(300);
    for (const ch of password) {
      await page.keyboard.type(ch, { delay: 30 });
    }
  }
  await sleep(1_000);

  // ── Step 5: Click initial Sign Up button ─────────────────────────────────────
  onStep?.("clicking_signup", "Clicking initial Sign Up button");
  const allBtns = await frame.locator("button").all();
  let signupClicked = false;
  for (const btn of allBtns) {
    const txt = (await btn.innerText().catch(() => "")).toLowerCase();
    if (txt.includes("sign up")) {
      await btn.click();
      signupClicked = true;
      break;
    }
  }
  if (!signupClicked) {
    throw Object.assign(
      new Error("Sign Up button not found in register frame"),
      { step: "signup_button_not_found" }
    );
  }

  // ── Step 6: Poll for tabs (success) or slider (captcha) ──────────────────────
  onStep?.("checking_captcha", "Checking for captcha or form advance");
  let tabsFound = false;
  for (let wait = 0; wait < 15; wait++) {
    await sleep(2_000);
    frame = await findRegisterFrame(page);
    if (!frame) continue;

    const tabs = await frame.locator("li[role='tab']").all();
    if (tabs.length > 0) {
      tabsFound = true;
      break;
    }

    const slider = frame.locator("#risk_slider_container");
    const sliderVis = await slider.isVisible().catch(() => false);
    if (sliderVis) {
      const solved = await handleSliderCaptchaIfPresent(frame, { onStep, mouseCtx: page });
      if (solved) {
        await sleep(3_000);
        frame = await findRegisterFrame(page);
        if (frame) {
          const tabsAfter = await frame.locator("li[role='tab']").all();
          if (tabsAfter.length > 0) { tabsFound = true; break; }
        }
      } else {
        throw Object.assign(
          new Error("Slider captcha could not be solved"),
          { step: "slider_failed" }
        );
      }
    }
  }
  if (!tabsFound) {
    throw Object.assign(
      new Error("Form did not advance after Sign Up — no tabs appeared"),
      { step: "form_submit_failed" }
    );
  }

  // ── Step 7: Select email verification tab (index 1) ──────────────────────────
  onStep?.("selecting_email_tab", "Selecting email verification tab");
  frame = await findRegisterFrame(page);
  const tabs = await frame.locator("li[role='tab']").all();
  if (tabs.length >= 2) {
    await tabs[1].click();
    await sleep(3_000);
  }

  // ── Step 8: Select Singapore country ─────────────────────────────────────────
  onStep?.("selecting_country", "Selecting Singapore country code");
  frame = await findRegisterFrame(page);
  const selects = await frame.locator("select").all();
  let countrySelected = false;
  for (const sel of selects) {
    const options = await sel.locator("option").all();
    for (const opt of options) {
      const txt = (await opt.innerText().catch(() => "")).toLowerCase();
      if (txt.includes("singapore")) {
        const val = await opt.getAttribute("value").catch(() => null);
        if (val) {
          await sel.selectOption({ value: val }).catch(() => null);
        } else {
          await sel.selectOption({ label: "Singapore" }).catch(() => null);
        }
        countrySelected = true;
        break;
      }
    }
    if (countrySelected) break;
  }

  // ── Step 9: Click Send button ─────────────────────────────────────────────────
  onStep?.("clicking_send", "Clicking Send verification code button");
  frame = await findRegisterFrame(page);
  const sendBtns = await frame.locator("button, [role='button']").all();
  for (const btn of sendBtns) {
    const txt = (await btn.innerText().catch(() => "")).toLowerCase();
    const vis = await btn.isVisible().catch(() => false);
    if (vis && txt.includes("send")) {
      await btn.click();
      break;
    }
  }
  await sleep(3_000);

  // ── Step 10: Read OTP from IMAP ───────────────────────────────────────────────
  onStep?.("waiting_otp", "Waiting for OTP email");
  const otpSentAt = new Date();
  const otp = await readOtpFromImap(email, imapConfig, { timeout: 120_000, since: otpSentAt });
  if (!otp) {
    throw Object.assign(new Error("OTP not received within timeout"), { step: "otp_timeout" });
  }
  onStep?.("otp_received", `OTP received: ${otp}`);

  // ── Step 11: Fill OTP ─────────────────────────────────────────────────────────
  onStep?.("filling_otp", "Filling OTP code");
  frame = await findRegisterFrame(page);
  let otpInput = null;

  // Try known selectors first
  const otpSelectors = [
    "#emailCaptcha",
    "input[name='emailCaptcha']",
    "input[placeholder*='code']",
    "input[placeholder*='verification']",
    "input[name*='code']",
    "input[name*='captcha']",
  ];
  for (const sel of otpSelectors) {
    const el = frame.locator(sel).first();
    if (await el.count() && await el.isVisible().catch(() => false)) {
      otpInput = el;
      break;
    }
  }

  // Fallback: first visible input that is not email/country/checkbox
  if (!otpInput) {
    const allInputs = await frame.locator("input").all();
    for (const inp of allInputs) {
      try {
        if (!await inp.isVisible().catch(() => false)) continue;
        const id = (await inp.getAttribute("id").catch(() => "") || "").toLowerCase();
        const name = (await inp.getAttribute("name").catch(() => "") || "").toLowerCase();
        const type = (await inp.getAttribute("type").catch(() => "") || "").toLowerCase();
        if (id === "email" || name === "email") continue;
        if (id.includes("country") || name.includes("country")) continue;
        if (type === "checkbox") continue;
        otpInput = inp;
        break;
      } catch { /* skip */ }
    }
  }

  if (otpInput) {
    await otpInput.click();
    await sleep(200);
    for (const ch of otp) {
      await page.keyboard.type(ch, { delay: 30 });
    }
  }
  await sleep(500);

  // ── Step 12: Check agreement checkbox ────────────────────────────────────────
  onStep?.("accepting_terms", "Checking terms agreement checkbox");
  frame = await findRegisterFrame(page);
  const checkbox = frame.locator("input[type='checkbox']").first();
  if (await checkbox.count()) {
    const checked = await checkbox.isChecked().catch(() => true);
    if (!checked) await checkbox.click();
  }

  // ── Step 13: Click final Sign Up / Confirm button ────────────────────────────
  onStep?.("final_submit", "Clicking final Sign Up / Confirm button");
  frame = await findRegisterFrame(page);
  const finalBtns = await frame.locator("button, [role='button']").all();
  for (const btn of finalBtns) {
    const txt = (await btn.innerText().catch(() => "")).toLowerCase();
    if (txt.includes("sign up") || txt.includes("confirm") || txt.includes("register")) {
      await btn.click();
      break;
    }
  }
  await sleep(8_000);

  // ── Step 14: Check if still on register page (failure) ───────────────────────
  const postUrl = page.url();
  if (postUrl.includes("register")) {
    const bodyTxt = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    if (bodyTxt.includes("verification code") || bodyTxt.includes("sign up")) {
      throw Object.assign(
        new Error("Still on register page after final submit — registration failed"),
        { step: "registration_failed" }
      );
    }
  }

  // ── Step 15: Navigate to Model Studio (session carries from register) ────────
  onStep?.("waiting_dashboard", "Opening Model Studio (session carries from register)");
  await page.goto("https://modelstudio.console.alibabacloud.com/", {
    waitUntil: "domcontentloaded", timeout: 120_000
  });

  // Poll up to 90s for SPA to load — check for login page (session lost) or dashboard
  let dashboardLoaded = false;
  for (let wait = 0; wait < 30; wait++) {
    await sleep(3_000);
    const bodyTxt = await page.locator("body").innerText().catch(() => "");
    if (/sign in|enter your email|log on/i.test(bodyTxt)) {
      throw Object.assign(
        new Error("Session lost after registration — Model Studio redirected to login"),
        { step: "session_lost" }
      );
    }
    if (/dashboard|model studio|api/i.test(bodyTxt)) {
      dashboardLoaded = true;
      break;
    }
  }

  // ── Step 16: Click Dashboard tab via JS evaluate (15 retries × 2s) ───────────
  onStep?.("clicking_dashboard", "Clicking Dashboard tab in top nav");
  for (let wait = 0; wait < 15; wait++) {
    const clicked = await page.evaluate(() => {
      const els = document.querySelectorAll('a, span, li, [role="tab"], div');
      for (const el of els) {
        const txt = (el.innerText || el.textContent || '').trim();
        if (txt === 'Dashboard') {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) { el.click(); return true; }
        }
      }
      return false;
    });
    if (clicked) break;
    await sleep(2_000);
  }
  await sleep(5_000);

  // ── Step 17: Navigate to API Key page (4 search rounds + direct URL fallback) ─
  onStep?.("navigating_apikey", "Navigating to API Key page");
  // First: dismiss any modal overlays (3 attempts)
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const modals = document.querySelectorAll('[class*="modal"], [role="dialog"], [class*="dialog"]');
      for (const m of modals) {
        const rect = m.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const btns = m.querySelectorAll('button, [role="button"], .ant-modal-close, [class*="close"]');
        for (const b of btns) {
          const txt = (b.innerText || '').toLowerCase();
          if (txt.includes('ok') || txt.includes('close') || txt.includes('got it') || txt.includes('confirm') || b.className.includes('close')) {
            b.click(); return true;
          }
        }
      }
      return false;
    });
    await sleep(1_000);
    await page.keyboard.press("Escape").catch(() => null);
    await sleep(1_000);
  }

  let apiKeyPageReached = false;
  for (let searchRound = 0; searchRound < 4; searchRound++) {
    // Scroll all scrollable containers to bottom
    await page.evaluate(() => {
      document.querySelectorAll('*').forEach(el => {
        if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
      });
    });
    await sleep(2_000);

    // Click "API Key" via JS evaluate (own text node match first, then innerText)
    const clicked = await page.evaluate(() => {
      const els = document.querySelectorAll('a, span, li, [role="menuitem"], button, div, p');
      for (const el of els) {
        const ownText = Array.from(el.childNodes)
          .filter(n => n.nodeType === 3)
          .map(n => n.textContent.trim()).join('');
        if (ownText === 'API Key' || ownText === 'api-key' || ownText === 'API key') {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) { el.click(); return true; }
        }
      }
      for (const el of els) {
        const txt = (el.innerText || '').trim();
        if (txt === 'API Key' || txt === 'api-key') {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) { el.click(); return true; }
        }
      }
      return false;
    });

    if (clicked) { apiKeyPageReached = true; break; }

    if (searchRound === 0) {
      // Try expanding "Manage" section
      const allEls = await page.locator("span, div, a").all();
      for (const el of allEls) {
        const txt = (await el.innerText().catch(() => "")).trim().toLowerCase();
        if (txt === "manage" && await el.isVisible().catch(() => false)) {
          await el.click().catch(() => null);
          await sleep(2_000);
          break;
        }
      }
    } else if (searchRound === 2) {
      // Direct URL fallback
      await page.goto(
        "https://modelstudio.console.alibabacloud.com/ap-southeast-1?tab=dashboard#/api-key",
        { waitUntil: "domcontentloaded", timeout: 60_000 }
      );
      await sleep(5_000);
      apiKeyPageReached = true;
      break;
    }
  }

  if (!apiKeyPageReached) {
    // Final check: body text may already show API key page
    const body = await page.locator("body").innerText().catch(() => "");
    if (/api key|create/i.test(body)) apiKeyPageReached = true;
  }

  await sleep(5_000);

  // Check for session loss after navigation
  const bodyAfterNav = await page.locator("body").innerText().catch(() => "");
  if (/sign in|enter your email/i.test(bodyAfterNav)) {
    throw Object.assign(
      new Error("Session lost — API Key page redirected to login"),
      { step: "session_lost" }
    );
  }

  // ── Step 18: Click "Create API Key" button (10 retries × 2s, via JS evaluate) ─
  onStep?.("creating_api_key", "Clicking Create API Key button");
  // Scroll right in case button is hidden
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(el => {
      if (el.scrollWidth > el.clientWidth) el.scrollLeft = el.scrollWidth;
    });
  });
  await sleep(2_000);

  let createClicked = false;
  for (let wait = 0; wait < 10; wait++) {
    const clicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('button, [role="button"], a');
      for (const b of btns) {
        const txt = (b.innerText || '').trim().toLowerCase();
        const rect = b.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          if (txt.includes('create') && (txt.includes('api') || txt.includes('key'))) {
            b.click(); return txt;
          }
          if (txt === 'create') { b.click(); return txt; }
        }
      }
      return null;
    });
    if (clicked) { createClicked = true; break; }
    await sleep(2_000);
  }

  if (!createClicked) {
    throw Object.assign(
      new Error("Create API Key button not found on API Key page"),
      { step: "create_button_not_found" }
    );
  }
  await sleep(5_000);

  // ── Step 19: Click OK in the Create API Key modal (10 retries × 2s) ──────────
  onStep?.("confirming_api_key", "Clicking OK in Create API Key form");
  let okClicked = false;
  for (let wait = 0; wait < 10; wait++) {
    const clicked = await page.evaluate(() => {
      const modals = document.querySelectorAll('[class*="modal"], [role="dialog"], [class*="dialog"]');
      for (const m of modals) {
        const rect = m.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const btns = m.querySelectorAll('button, [role="button"]');
        for (const b of btns) {
          const txt = (b.innerText || '').trim().toLowerCase();
          const brect = b.getBoundingClientRect();
          if (brect.width > 0 && brect.height > 0 && txt === 'ok') { b.click(); return true; }
        }
      }
      const allBtns = document.querySelectorAll('button, [role="button"]');
      for (const b of allBtns) {
        const txt = (b.innerText || '').trim().toLowerCase();
        const brect = b.getBoundingClientRect();
        if (brect.width > 0 && brect.height > 0 && txt === 'ok') { b.click(); return true; }
      }
      return false;
    });
    if (clicked) { okClicked = true; break; }
    await sleep(2_000);
  }
  // okClicked failure is non-fatal — key may still appear

  // ── Step 20: Extract API key from DOM (30 retries × 2s) ──────────────────────
  onStep?.("extracting_api_key", "Extracting API key from page");
  let apiKey = null;
  for (let wait = 0; wait < 30; wait++) {
    const found = await page.evaluate(() => {
      // Method 1: input with sk- value
      for (const inp of document.querySelectorAll('input')) {
        const val = inp.value || inp.getAttribute('value') || '';
        if (val.startsWith('sk-') && val.length > 20) return val;
      }
      // Method 2: element text containing sk-
      for (const el of document.querySelectorAll('span, div, p, code, td, [class*="modal"], [role="dialog"]')) {
        const txt = el.innerText || el.textContent || '';
        const m = txt.match(/sk-[A-Za-z0-9._\-]+/);
        if (m && m[0].length > 20) return m[0];
      }
      // Method 3: textarea
      for (const ta of document.querySelectorAll('textarea')) {
        const val = ta.value || '';
        if (val.startsWith('sk-') && val.length > 20) return val;
      }
      return null;
    });

    if (found) { apiKey = found; break; }

    // At wait=5: try clicking copy button, then clipboard
    if (wait === 5) {
      await page.evaluate(() => {
        const btns = document.querySelectorAll('button, [role="button"]');
        for (const b of btns) {
          const txt = (b.innerText || '').toLowerCase();
          if (txt.includes('copy') || b.className.includes('copy')) { b.click(); return true; }
        }
        return false;
      });
      await sleep(1_000);
      try {
        const clip = await page.evaluate(() => navigator.clipboard.readText());
        if (clip && clip.startsWith('sk-') && clip.length > 20) { apiKey = clip; break; }
      } catch { /* clipboard may not be available */ }
    }

    if (wait % 5 === 0) onStep?.("extracting_api_key", `Still waiting for API key... (${wait * 2}s)`);
    await sleep(2_000);
  }

  // Close modal after extracting key
  if (apiKey) {
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button, [role="button"]');
      for (const b of btns) {
        const txt = (b.innerText || '').toLowerCase();
        const rect = b.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          if (txt.includes('ok') || txt.includes('close') || txt.includes('done') || txt.includes('confirm')) {
            b.click(); return true;
          }
        }
      }
      return false;
    });
  }

  if (!apiKey) {
    throw Object.assign(
      new Error("API key not found in page after 60s — extraction failed"),
      { step: "key_extraction_failed" }
    );
  }

  onStep?.("key_verified", `API key extracted: ${apiKey.slice(0, 20)}...`);
  return { apiKey, keyId: null, workspaceId: null, gmtExpire: null };
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
