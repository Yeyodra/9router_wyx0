import { randomUUID } from "crypto";
import { KiroBulkImportManager } from "./kiroBulkImportManager.js";
import { buildEmailPool, getAccessToken, readOtpFromGmail } from "./kiroGmailTokenService.js";
import { KiroService } from "./kiro.js";
import { saveKiroOAuthConnection } from "./kiroConnections.js";
import { KIRO_CONFIG } from "../constants/oauth.js";

// ─── Inline name generator ────────────────────────────────────────────────────
const FIRST_NAMES = [
  "Agus","Budi","Dewi","Eko","Fitri","Hendra","Indah","Joko","Kurniawan","Lina",
  "Maya","Nanda","Putri","Reza","Sari","Taufik","Umar","Wulan","Yanti","Zainal",
  "James","Sarah","David","Emma","Michael","Laura","Robert","Anna","William","Grace",
  "Thomas","Maria","Daniel","Jessica","Kevin","Amanda","Jason","Rachel","Ryan","Karen",
];
const LAST_NAMES = [
  "Santoso","Wijaya","Kusuma","Pratama","Hidayat","Nugroho","Susanto","Rahayu",
  "Wibowo","Setiawan","Purnomo","Hakim","Firmansyah","Gunawan","Hartono",
  "Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Wilson",
  "Moore","Taylor","Anderson","Thomas","Jackson","White","Harris","Martin",
];

function generateRealisticName() {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}

function generatePassword() {
  return "Aa1!" + randomUUID().replace(/-/g, "").slice(0, 12);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Slider CAPTCHA helpers ───────────────────────────────────────────────────
const SLIDER_CONTAINER_SEL = [
  '.nc_scale', '.nc-container', '[class*="slider"][class*="container"]',
  '[id*="nc_"] .scale', '.slidercaptcha', '[class*="captcha"][class*="slider"]',
].join(", ");

const SLIDER_BTN_SEL = [
  '.nc_iconfont.btn_slide', '.btn_slide', '.nc-lang-cnt',
  '[class*="slider"][class*="btn"]', '[class*="slide"][class*="button"]',
  '.slidercaptcha .slider', '[class*="captcha"] .handler',
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

async function dismissCookieConsent(page) {
  const acceptSelectors = [
    'button:has-text("Accept")',
    'button:has-text("Accept all")',
    'button:has-text("Accept cookies")',
    'button:has-text("I agree")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
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

// ─── Class ────────────────────────────────────────────────────────────────────
export class KiroDotTrickManager extends KiroBulkImportManager {
  constructor() {
    super({
      googleAutomation: async () => ({ status: "failed", error: "not used" }),
      socialExchange: async () => ({ status: "failed", error: "not used" }),
      storageName: "kiro-dot-trick",
    });
  }

  async startJob({ gmailAccounts = [], count = 0, concurrency, engine, headless = true, loginCooldownMs = 60_000, proxyUrls = [], proxyPoolId }) {
    if (!Array.isArray(gmailAccounts) || gmailAccounts.length === 0) {
      throw Object.assign(new Error("gmailAccounts is required"), { status: 400 });
    }

    // Build email pool from authorized Gmail accounts
    const emailPool = buildEmailPool(gmailAccounts, 2);
    if (emailPool.length === 0) {
      throw Object.assign(new Error("No dot-variant emails generated from provided gmailAccounts"), { status: 400 });
    }

    const selected = count > 0 ? emailPool.slice(0, count) : emailPool;
    if (selected.length === 0) {
      throw Object.assign(new Error("No accounts to process"), { status: 400 });
    }

    const jobId = randomUUID();
    const createdAt = new Date().toISOString();

    const { normalizeBulkImportEngine, DEFAULT_BULK_IMPORT_ENGINE } = await import("./bulkImportBrowserEngine.js");
    const resolvedEngine = engine ? normalizeBulkImportEngine(engine) : DEFAULT_BULK_IMPORT_ENGINE;

    const resolvedProxyUrls = Array.isArray(proxyUrls) ? proxyUrls.filter(Boolean) : [];

    const job = {
      jobId,
      status: "running",
      concurrency: Math.max(1, Math.min(8, Number(concurrency) || 2)),
      engine: resolvedEngine,
      proxyUrl: resolvedProxyUrls[0] || null,
      proxyUrls: resolvedProxyUrls,
      proxyMode: resolvedProxyUrls.length > 1 ? "round-robin" : (resolvedProxyUrls.length === 1 ? "single" : "none"),
      proxyPoolId: proxyPoolId || null,
      proxySource: null,
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
      loginCooldownMs,
      headless,
      accounts: selected.map((email, idx) => ({
        line: idx + 1,
        email,
        password: generatePassword(),
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

    await this.persistJobSnapshot(job, { forcePreview: false });
    void this.runJob(jobId);
    return { jobId, status: job.status };
  }


  async processAccount(job, account, workerId) {
    if (job.cancelRequested) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled", step: "cancelled", message: "Cancelled before start" });
      return;
    }

    const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
    const { createFreshContext } = await import("./kiroBulkImportManager.js");
    const proxyUrl = job.proxyUrls?.length
      ? job.proxyUrls[workerId % job.proxyUrls.length]
      : job.proxyUrl || null;

    let browser;
    let context;
    let page;

    const step = (name, msg, level = "info") => {
      this.setAccountStep(account, name, msg, level);
      void this.persistJobSnapshot(job, { forcePreview: false });
    };

    try {
      // ── BROWSER LAUNCH ──────────────────────────────────────────────────────
      browser = await launchBulkImportBrowser({
        engine: job.engine || "chromium",
        headless: job.headless !== false,
        proxyUrl,
      });
      job.workerBrowsers.add(browser);

      // When using Camoufox, let it manage its own fingerprint — do NOT inject Chrome UA
      // Camoufox already handles anti-detection natively; Chrome UA on Firefox = detectable mismatch
      if ((job.engine || "chromium") === "camoufox") {
        context = await browser.newContext();
        page = await context.newPage();
      } else {
        ({ context, page } = await createFreshContext(browser));
      }
      account.runtimeSession = { context, page, proxyUrl };

      // ── REGISTER PHASE ──────────────────────────────────────────────────────
      step("navigating", "Loading app.kiro.dev/signin");
      page.setDefaultTimeout(120_000);
      await page.goto("https://app.kiro.dev/signin", { waitUntil: "domcontentloaded", timeout: 60_000 });
      await sleep(2_000);

      // Click Builder ID
      step("clicking_builder_id", "Clicking Builder ID button");
      const builderIdSelectors = [
        'button:has-text("Builder ID")',
        '[role="button"]:has-text("Builder ID")',
        'a:has-text("Builder ID")',
        'div:has-text("Builder ID")',
        'button:has-text("Builder")',
      ];
      let builderIdClicked = false;
      for (let attempt = 0; attempt < 15 && !builderIdClicked; attempt++) {
        for (const sel of builderIdSelectors) {
          try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
              await el.click({ timeout: 5_000 });
              builderIdClicked = true;
              break;
            }
          } catch { /* try next */ }
        }
        if (!builderIdClicked) await sleep(1_000);
      }
      if (!builderIdClicked) throw Object.assign(new Error("Builder ID button not found"), { step: "builder_id_not_found" });

      // Wait for signin.aws
      step("waiting_sso", "Waiting for AWS SSO login page to load");
      for (let i = 0; i < 20; i++) {
        const url = page.url();
        if (url.includes("signin.aws")) break;
        await sleep(1_000);
      }
      await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => null);
      await sleep(3_000);
      step("sso_loaded", `AWS SSO page loaded: ${page.url().slice(0, 80)}`);

      // Human-like dwell time before interacting — AWS detects instant interaction as bot
      const dwellMs = 1_000 + Math.floor(Math.random() * 29_000); // 1-30s
      step("human_dwell", `Waiting ${Math.round(dwellMs / 1000)}s before interacting (human simulation)`);
      await sleep(dwellMs);

      // Fill email char-by-char
      step("filling_email", `Entering email: ${account.email}`);
      const emailInputSelectors = [
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
        for (const sel of emailInputSelectors) {
          try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
              await el.click();
              await sleep(200);
              await el.fill("");
              for (const ch of account.email) {
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
      if (!emailFilled) throw Object.assign(new Error("Email input not found"), { step: "email_input_not_found" });
      await sleep(500);

      // Click Next
      const nextSelectors = [
        'button:has-text("Next")', 'button:has-text("Continue")',
        'button:has-text("Send")', 'button:has-text("Verify")',
        '#identifierNext button', 'button[type="submit"]',
        '[role="button"]:has-text("Next")', '[role="button"]:has-text("Continue")',
      ];
      step("clicking_next", "Clicking Next after email");
      for (const sel of nextSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await el.click({ timeout: 5_000 });
            break;
          }
        } catch { /* try next */ }
      }
      // Wait for redirect to profile.aws.amazon.com
      step("waiting_redirect", "Waiting for redirect to profile.aws.amazon.com");
      for (let i = 0; i < 30; i++) {
        const url = page.url();
        if (url.includes("profile.aws.amazon.com")) break;
        await sleep(1_000);
      }
      await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => null);
      await sleep(3_000);
      step("redirected", `Now at: ${page.url().slice(0, 100)}`);

      // Fill name with ERR-837 retry
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
      for (let attempt = 0; attempt < 30 && !nameFilled; attempt++) {
        for (const sel of nameSelectors) {
          try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 1_000 }).catch(() => false)) {
              const randomName = generateRealisticName();
              step("filling_name", `Entering name: ${randomName} (found: ${sel})`);
              await sleep(800 + Math.random() * 600);
              await el.click();
              await sleep(300 + Math.random() * 200);
              await el.clear();
              await sleep(150);
              for (const ch of randomName) {
                await el.pressSequentially(ch, { delay: 80 + Math.random() * 80 });
              }
              await sleep(1_200 + Math.random() * 800);
              // Click Continue — retry up to 3x if ERR-837
              for (let clickAttempt = 0; clickAttempt < 3; clickAttempt++) {
                let clicked = false;
                for (const nsel of nextSelectors) {
                  try {
                    const nb = page.locator(nsel).first();
                    if (await nb.isVisible({ timeout: 2_000 }).catch(() => false)) {
                      await nb.click({ timeout: 5_000 });
                      clicked = true;
                      break;
                    }
                  } catch { /* try next */ }
                }
                if (!clicked) break;
                await sleep(2_000);
                const hasError = await page.locator('[data-testid="error-alert-blocked"]').first()
                  .isVisible({ timeout: 1_500 }).catch(() => false);
                if (!hasError) break;
                // ERR-837 detected — clear field, generate new name, fill again
                step("name_retry", `ERR-837 detected — clearing and retrying with new name (attempt ${clickAttempt + 2})`);
                await sleep(1_000);
                try {
                  await el.click();
                  await sleep(200);
                  await el.clear();
                  await sleep(150);
                  await el.fill("");
                  const retryName = generateRealisticName();
                  step("filling_name", `Retrying with new name: ${retryName}`);
                  for (const ch of retryName) {
                    await el.pressSequentially(ch, { delay: 80 + Math.random() * 80 });
                  }
                  await sleep(1_200 + Math.random() * 800);
                } catch { /* ignore clear errors, continue to next click attempt */ }
              }
              nameFilled = true;
              await sleep(3_000);
              break;
            }
          } catch { /* try next */ }
        }
        if (!nameFilled) await sleep(1_000);
      }

      // Wait for OTP field
      step("waiting_otp_field", "Waiting for OTP/verification code field");
      await sleep(2_000);
      const otpFieldSelectors = [
        'input[placeholder*="6-digit" i]',
        'input[placeholder*="6-d" i]',
        'input[placeholder*="verification code" i]',
        'input[placeholder*="Verification" i]',
        'input[data-testid*="code" i]', 'input[data-testid*="otp" i]',
        'input[data-testid*="verification" i]',
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
              otpFieldFound = true;
              break;
            }
          } catch { /* try next */ }
        }
        if (otpFieldFound) break;
        await handleSliderCaptchaIfPresent(page);
        await sleep(1_500);
      }
      if (!otpFieldFound) throw Object.assign(new Error("OTP field never appeared after entering email"), { step: "otp_field_not_found" });

      // Poll Gmail for OTP
      step("waiting_otp", "Polling Gmail API for OTP (up to 120s)");
      const otp = await readOtpFromGmail(account.email, { timeout: 120_000, since: otpSentAt });
      if (!otp) throw Object.assign(new Error("OTP not received within 120s"), { step: "otp_timeout" });
      step("otp_received", `OTP received: ${otp}`);

      // Fill OTP
      step("filling_otp", "Entering OTP code");
      let otpFilled = false;
      for (const sel of otpFieldSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await el.click();
            await sleep(200);
            for (const ch of otp) { await page.keyboard.type(ch, { delay: 35 }); }
            otpFilled = true;
            break;
          }
        } catch { /* try next */ }
      }
      if (!otpFilled) throw Object.assign(new Error("OTP field disappeared"), { step: "otp_fill_failed" });
      await sleep(500);

      // Click Next after OTP
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

      // Wait for password field
      step("waiting_password_field", "Waiting for password field");
      const pwSelectors = [
        'input[type="password"]', 'input[name="password"]',
        'input[name="new-password"]', 'input[autocomplete="new-password"]',
        'input[placeholder*="password" i]', 'input[placeholder*="Password" i]',
        '#password', '#new-password',
      ];
      const confirmSelectors = [
        'input[placeholder*="re-enter" i]',
        'input[placeholder*="Re-enter" i]',
        'input[placeholder*="confirm" i]',
        'input[placeholder*="Confirm" i]',
        'input[name="confirmPassword"]',
        'input[name="confirm-password"]',
        '#confirmPassword', '#confirmPwd',
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
      if (!pwFieldFound) throw Object.assign(new Error("Password field never appeared after OTP submission"), { step: "password_field_not_found" });

      // Step 11: Fill password
      await dismissCookieConsent(page);
      await sleep(500);

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
        if (pwVisible && !confirmVisible) { bothVisible = true; break; }
        await sleep(1_000);
      }

      // Fill password + confirm
      step("filling_password", "Entering password");
      for (const sel of pwSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await el.click();
            await sleep(300);
            await el.fill(account.password);
            await sleep(500);
            for (const csel of confirmSelectors) {
              try {
                const cel = page.locator(csel).first();
                if (await cel.isVisible({ timeout: 1_000 }).catch(() => false)) {
                  await cel.click();
                  await sleep(300);
                  await cel.fill(account.password);
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

      // Submit / Create account
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
            break;
          }
        } catch { /* try next */ }
      }
      await sleep(5_000);

      // Wait for app.kiro.dev authorized
      step("waiting_authorized", "Waiting for Kiro dashboard (up to 60s)");
      const authDeadline = Date.now() + 60_000;
      let authorized = false;
      while (Date.now() < authDeadline) {
        const url = page.url();
        if (url.includes("app.kiro.dev") && !url.includes("/signin")) { authorized = true; break; }
        if (url.includes("app.kiro.dev/signin/oauth")) {
          await sleep(3_000);
          const newUrl = page.url();
          if (newUrl.includes("app.kiro.dev") && !newUrl.includes("/signin")) { authorized = true; break; }
        }
        await sleep(1_500);
      }
      if (!authorized) throw Object.assign(new Error(`Never reached dashboard. Stuck at: ${page.url()}`), { step: "authorization_failed" });
      step("authorized", `Registration success — ${page.url()}`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      // ── SUSPEND CHECK ────────────────────────────────────────────────────────
      step("suspend_check", "Checking for AWS suspension email (up to 2min)");
      const suspendCheckStart = Date.now();
      const suspendDeadline = suspendCheckStart + 120_000;
      let isSuspended = false;
      const suspendQ = encodeURIComponent("from:no-reply@amazonaws.com subject:Action Needed");
      const suspendListUrl = `https://www.googleapis.com/gmail/v1/users/me/messages?q=${suspendQ}&maxResults=10`;

      while (Date.now() < suspendDeadline && !job.cancelRequested) {
        await sleep(10_000);
        try {
          const accessToken = await getAccessToken(account.email);
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
            if (msgDate < suspendCheckStart - 30_000) continue;
            const headers = Object.fromEntries((msg.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
            const to = headers["to"] || "";
            const emailLocal = account.email.split("@")[0].replace(/\./g, "");
            if (to.includes(emailLocal) || to.toLowerCase().includes(account.email.toLowerCase())) {
              step("suspended", `Account suspended by AWS — "${headers["subject"]}" to ${to}`, "error");
              isSuspended = true;
              break;
            }
          }
        } catch { /* continue polling */ }
        if (isSuspended) break;
      }

      if (isSuspended) {
        this.finalizeAccount(account, "failed", {
          error: "AWS suspended account within 2min of creation",
          step: "suspended",
          message: "AWS suspended — skipping login phase",
        });
        await this.persistJobSnapshot(job, { forcePreview: true });
        return;
      }

      step("suspend_check_passed", "No suspension detected — proceeding to login");
      await this.persistJobSnapshot(job, { forcePreview: true });

      // ── COOLDOWN ─────────────────────────────────────────────────────────────
      const cooldownMs = job.loginCooldownMs ?? 60_000;
      step("cooldown", `Waiting ${Math.round(cooldownMs / 1000)}s before login`);
      await sleep(cooldownMs);

      if (job.cancelRequested) {
        this.finalizeAccount(account, "cancelled", { error: "Cancelled during cooldown", step: "cancelled", message: "Cancelled during cooldown" });
        return;
      }

      // ── LOGIN PHASE — Device Code Flow ───────────────────────────────────────
      step("login_start", "Starting Device Code login flow — registering OIDC client");
      const kiroService = new KiroService();
      const region = "us-east-1";
      const { clientId, clientSecret } = await kiroService.registerClient(region);

      step("login_device_auth", "Starting device authorization with AWS OIDC");
      const deviceAuth = await kiroService.startDeviceAuthorization(
        clientId, clientSecret, KIRO_CONFIG.issuerUrl, region
      );

      const verificationUriComplete = deviceAuth.verificationUriComplete;
      const verificationUri = deviceAuth.verificationUri;
      const deviceCode = deviceAuth.deviceCode;
      const pollInterval = deviceAuth.interval || 5;

      step("login_device_code", `Got device code — navigating to verification URL`);

      // ── Launch a SEPARATE browser for login (mirrors script L1138-1141)
      let loginBrowser;
      let loginContext;
      let loginPage;

      loginBrowser = await launchBulkImportBrowser({
        engine: job.engine || "chromium",
        headless: job.headless !== false,
        proxyUrl,
      });
      job.workerBrowsers.add(loginBrowser);

      if ((job.engine || "chromium") === "camoufox") {
        loginContext = await loginBrowser.newContext();
      } else {
        loginContext = await loginBrowser.newContext({ viewport: { width: 1440, height: 900 } });
      }
      loginPage = await loginContext.newPage();
      loginPage.setDefaultTimeout(120_000);

      // Start background poll using KiroService directly
      const pollPromise = (async () => {
        const deadline = Date.now() + 600_000;
        while (Date.now() < deadline) {
          await sleep(pollInterval * 1000);
          const result = await kiroService.pollDeviceToken(clientId, clientSecret, deviceCode, region);
          if (result.success) return result;
          if (result.pending) continue;
          throw new Error(`poll error: ${result.error || JSON.stringify(result)}`);
        }
        throw new Error("login poll timeout after 10min");
      })();

      // ── Continuous cookie consent dismisser (script L1143-1164)
      const loginCookieSelectors = [
        '[data-id="awsccc-cb-btn-accept"]',
        'button[data-id*="accept" i]',
        '#awsccc-cb-btn-accept',
      ];
      let cookieDismissActive = true;
      const cookieDismissLoop = (async () => {
        while (cookieDismissActive) {
          try {
            for (const sel of loginCookieSelectors) {
              const el = loginPage.locator(sel).first();
              if (await el.isVisible({ timeout: 400 }).catch(() => false)) {
                await el.click({ timeout: 2_000 }).catch(() => null);
                step("login_cookie_dismissed", "Dismissed cookie consent popup");
              }
            }
          } catch { /* ignore */ }
          await sleep(1_500);
        }
      })();

      // Navigate to the device verification URL (script L1166-1171)
      step("login_navigating", "Navigating to verification URL");
      await loginPage.goto(verificationUriComplete || verificationUri, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await sleep(2_000);

      // ── Step 3a: Enter email (script L1173-1217)
      step("login_filling_email", "Filling email on verification page");
      const loginEmailSelectors = [
        'input[name="email"]',
        'input[type="email"]',
        '#email',
        'input[placeholder*="email" i]',
      ];
      let loginEmailFilled = false;
      for (const sel of loginEmailSelectors) {
        try {
          await loginPage.locator(sel).first().fill(account.email, { timeout: 5_000 });
          loginEmailFilled = true;
          break;
        } catch { /* try next */ }
      }
      if (!loginEmailFilled) throw Object.assign(new Error("Could not find email input field"), { step: "login_email_not_found" });

      // Click Continue/Next after email
      const loginNextSelectors = [
        'button:has-text("Continue")',
        'button:has-text("Next")',
        'button:has-text("Get started")',
        'button:has-text("Sign in")',
        'button[type="submit"]',
        'input[type="submit"]',
        '#next_button',
      ];
      let nextClicked = false;
      for (let attempt = 0; attempt < 10 && !nextClicked; attempt++) {
        for (const sel of loginNextSelectors) {
          try {
            const el = loginPage.locator(sel).first();
            if (await el.isVisible({ timeout: 1_500 }).catch(() => false)) {
              await el.click({ timeout: 5_000 });
              nextClicked = true;
              break;
            }
          } catch { /* try next */ }
        }
        if (!nextClicked) await sleep(1_000);
      }
      if (!nextClicked) throw Object.assign(new Error("Could not find Next/Continue button after email"), { step: "login_next_not_found" });

      await loginPage.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => null);
      await sleep(2_500);

      // ── Step 3c: Enter password (script L1222-1277)
      step("login_filling_password", "Waiting for password field");
      const loginPwSelectors = [
        'input[name="password"]',
        'input[type="password"]',
        '#password',
      ];
      let passwordFilled = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        for (const sel of loginPwSelectors) {
          try {
            const el = loginPage.locator(sel).first();
            if (await el.isVisible({ timeout: 1_500 }).catch(() => false)) {
              await el.click();
              await sleep(200);
              await el.fill(account.password);
              passwordFilled = true;
              break;
            }
          } catch { /* try next */ }
        }
        if (passwordFilled) break;
        await sleep(1_000);
      }
      if (!passwordFilled) throw Object.assign(new Error("Could not find password input field after 20s"), { step: "login_password_not_found" });

      const loginSignInSelectors = [
        'button:has-text("Sign in")',
        'button:has-text("Submit")',
        'button:has-text("Continue")',
        'button:has-text("Next")',
        'button[type="submit"]',
        'input[type="submit"]',
      ];
      step("login_submitting_password", "Submitting password");
      let signInClicked = false;
      for (const sel of loginSignInSelectors) {
        try {
          const el = loginPage.locator(sel).first();
          if (await el.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await el.click({ timeout: 5_000 });
            signInClicked = true;
            break;
          }
        } catch { /* try next */ }
      }
      if (!signInClicked) {
        try {
          await loginPage.locator('input[type="password"]').first().press("Enter");
        } catch { /* ignore */ }
      }
      await loginPage.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => null);
      await sleep(2_000);

      // ── Consent/Allow selectors — declared BEFORE OTP phase to avoid hoisting error (script L1279-1290)
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

      // ── Step 3d: OTP "Verify your identity" — appears AFTER password on some accounts (script L1292-1370)
      step("login_otp_check", "Checking for OTP field after password (up to 30s)");
      const loginOtpSentAt = new Date();
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
          if (await loginPage.locator(sel).first().isVisible({ timeout: 1_000 }).catch(() => false)) {
            otpFieldVisible = true;
            step("login_otp_found", `OTP field found after password: ${sel}`);
            break;
          }
        }
        if (otpFieldVisible) break;
        // Also check if consent page already appeared — skip OTP check
        let consentVisible = false;
        for (const sel of allowSelectors) {
          if (await loginPage.locator(sel).first().isVisible({ timeout: 500 }).catch(() => false)) {
            consentVisible = true;
            break;
          }
        }
        if (consentVisible) { step("login_otp_skip", "Consent page appeared — skipping OTP check"); break; }
        await sleep(1_500);
      }

      if (otpFieldVisible) {
        step("login_otp_fill", "OTP required — reading from Gmail");
        const otp = await readOtpFromGmail(account.email, { timeout: 180_000, since: loginOtpSentAt });
        if (!otp) throw Object.assign(new Error("OTP not received within 180s"), { step: "login_otp_timeout" });
        step("login_otp_received", `OTP received: ${otp}`);

        // Fill OTP
        for (const sel of otpSelectors) {
          try {
            const el = loginPage.locator(sel).first();
            if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
              await el.click();
              await sleep(200);
              for (const ch of otp) await loginPage.keyboard.type(ch, { delay: 35 });
              break;
            }
          } catch { /* try next */ }
        }
        await sleep(500);

        // Submit OTP
        for (const sel of ['button:has-text("Continue")', 'button:has-text("Submit")', 'button:has-text("Verify")', 'button[type="submit"]']) {
          try {
            const el = loginPage.locator(sel).first();
            if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
              await el.click({ timeout: 5_000 });
              step("login_otp_submitted", `OTP submitted via: ${sel}`);
              break;
            }
          } catch { /* try next */ }
        }
        await sleep(3_000);
      }

      // ── Step 3e: Consent/Allow pages (up to 180s) (script L1372-1426)
      step("login_allow_access", "Waiting for consent/allow pages (up to 180s)");

      const isSuccessPage = async () => {
        try {
          return await loginPage.evaluate(() => {
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

      // 120 iterations x 1.5s = 180s
      for (let i = 0; i < 120; i++) {
        if (await isSuccessPage()) {
          step("login_success_page", `Success page detected at iteration ${i + 1}`);
          break;
        }
        let clicked = false;
        for (const sel of allowSelectors) {
          try {
            const el = loginPage.locator(sel).first();
            if (await el.isVisible({ timeout: 1_000 }).catch(() => false)) {
              await el.click({ timeout: 5_000 });
              step("allow_clicked", `Clicked consent: ${sel}`);
              clicked = true;
              await sleep(2_000);
              break;
            }
          } catch { /* try next */ }
        }
        if (!clicked) {
          if (i % 10 === 9) step("login_consent_wait", `Consent wait ${i + 1}/120 — url=${loginPage.url().slice(0, 80)}`);
          await sleep(1_500);
        }
      }

      const successDetected = await isSuccessPage();
      if (!successDetected) {
        step("allow_not_found", "Success page not detected — poll may still succeed", "warn");
      }

      // Stop cookie dismisser (script L1428-1429)
      cookieDismissActive = false;
      await cookieDismissLoop;

      // Await poll result
      step("login_polling", "Waiting for AWS OIDC device token (up to 10min)");
      const pollResult = await pollPromise;
      if (!pollResult?.success) {
        throw Object.assign(new Error("Login poll did not return success"), { step: "login_poll_failed" });
      }

      // Save connection using kiroConnections.js
      step("login_saving_connection", "Saving Kiro connection to database");
      const connection = await saveKiroOAuthConnection({
        accessToken: pollResult.tokens.accessToken,
        refreshToken: pollResult.tokens.refreshToken,
        expiresIn: pollResult.tokens.expiresIn,
        profileArn: null,
        authMethod: "builder-id",
        providerLabel: "Builder ID",
      });

      step("login_success", `Login successful — connection: ${connection.id}`);
      this.finalizeAccount(account, "success", {
        connectionId: connection.id,
        step: "connection_saved",
        message: `Kiro connection saved (${account.email})`,
      });
      await this.persistJobSnapshot(job, { forcePreview: true });

    } catch (err) {
      if (job.cancelRequested) {
        this.finalizeAccount(account, "cancelled", { error: "Job cancelled", step: "cancelled", message: "Job cancelled" });
      } else {
        this.finalizeAccount(account, "failed", {
          error: err.message || String(err),
          step: err.step || "failed",
          message: err.message || String(err),
        });
      }
      await this.persistJobSnapshot(job, { forcePreview: true });
    } finally {
      account.runtimeSession = null;
      // Close login browser if it was launched
      if (loginBrowser) {
        try { await loginContext?.close(); } catch { /* ignore */ }
        job.workerBrowsers.delete(loginBrowser);
        try { await loginBrowser.close(); } catch { /* ignore */ }
      }
      // Close register browser
      try { await context.close(); } catch { /* ignore */ }
      job.workerBrowsers.delete(browser);
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
function getSingletonStore() {
  if (!globalThis.__kiroDotTrickSingleton) {
    globalThis.__kiroDotTrickSingleton = { manager: new KiroDotTrickManager() };
  }
  return globalThis.__kiroDotTrickSingleton;
}

export function getKiroDotTrickManager() {
  return getSingletonStore().manager;
}


