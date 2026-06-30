import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../../dataDir.js";
import {
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
} from "./kiroBulkImportManager.js";
import { buildEmailPool } from "./kiroGmailTokenService.js";
import {
  parseAccountsJson,
  buildAccountsJson,
  buildAccountsJsonFilename,
} from "./kiroDotTrickAccountsSchema.js";

export { buildLookupResponse };

export const KIRO_DOT_TRICK_DEFAULT_CONCURRENCY = KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY;
export const KIRO_DOT_TRICK_MIN_CONCURRENCY = KIRO_BULK_IMPORT_MIN_CONCURRENCY;
export const KIRO_DOT_TRICK_MAX_CONCURRENCY = KIRO_BULK_IMPORT_MAX_CONCURRENCY;

const KIRO_DOT_TRICK_DIR = path.join(DATA_DIR, "kiro-dot-trick");

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
  "Darmawan", "Effendi", "Halim", "Irawan", "Jamaludin",
  "Kuncoro", "Laksana", "Maulana", "Novriadi", "Pamungkas", "Qodir",
  "Rohman", "Subagyo", "Tanjung", "Ulfa", "Vandra", "Waskito", "Yusuf",
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

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomChars(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

const VALID_MODES = new Set(["merge", "register-only", "login-only"]);

class KiroDotTrickManager extends KiroBulkImportManager {
  constructor() {
    super({
      googleAutomation: async () => ({ status: "failed", error: "not used" }),
      socialExchange: async () => ({ status: "failed", error: "not used" }),
      storageName: "kiro-dot-trick",
    });
  }

  /**
   * Start a dot-trick job.
   * @param {{ mode: string, gmailAccounts?: string[], count?: number, concurrency?: number, headless?: boolean, loginCooldownMs?: number, proxyUrls?: string[], accountsJson?: string }} param0
   */
  async startJob({
    mode,
    gmailAccounts = [],
    count = 0,
    concurrency,
    headless = true,
    loginCooldownMs = 60_000,
    proxyUrls = [],
    accountsJson,
  }) {
    // ── Validate mode ────────────────────────────────────────────────────────
    if (!VALID_MODES.has(mode)) {
      throw new Error(
        `Invalid mode "${mode}". Must be one of: merge, register-only, login-only`
      );
    }

    let accounts;
    const createdAt = nowIso();

    if (mode === "login-only") {
      // ── Parse + validate accountsJson ──────────────────────────────────────
      const result = parseAccountsJson(accountsJson);
      if (result.valid === false) {
        throw new Error(result.error);
      }
      if (!result.accounts || result.accounts.length === 0) {
        throw new Error("No eligible accounts in accountsJson");
      }
      // Build account objects from parsed results
      accounts = result.accounts.map((parsed) => ({
        id: randomUUID(),
        email: parsed.email,
        password: parsed.password,
        displayName: parsed.displayName || null,
        status: "queued",
        mode,
        reg_status: parsed.reg_status || null,
        login_status: null,
        suspended: parsed.suspended || false,
        registeredAt: parsed.registeredAt || null,
        connectionId: null,
        workerId: null,
        logs: [],
        currentStep: "queued",
        updatedAt: createdAt,
        // Internal runtime fields (not persisted)
        manualSession: null,
        runtimeSession: null,
        error: null,
      }));
    } else {
      // ── merge / register-only: build email pool from Gmail dot variants ────
      let emailPool = buildEmailPool(gmailAccounts, 2);
      if (count > 0) {
        emailPool = emailPool.slice(0, count);
      }
      if (emailPool.length === 0) {
        throw new Error("At least one Gmail account is required to generate email variants");
      }
      accounts = emailPool.map((email) => ({
        id: randomUUID(),
        email,
        password: null,
        displayName: null,
        status: "queued",
        mode,
        reg_status: null,
        login_status: null,
        suspended: false,
        registeredAt: null,
        connectionId: null,
        workerId: null,
        logs: [],
        currentStep: "queued",
        updatedAt: createdAt,
        // Internal runtime fields (not persisted)
        manualSession: null,
        runtimeSession: null,
        error: null,
      }));
    }

    // ── Delegate job creation to parent's internal mechanism ─────────────────
    // We replicate the parent's startJob pattern (without calling super.startJob)
    // since our account shape differs from parseKiroBulkAccounts output.
    const { normalizeBulkImportEngine, DEFAULT_BULK_IMPORT_ENGINE } = await import(
      "./bulkImportBrowserEngine.js"
    );

    const jobId = randomUUID();
    const resolvedProxyUrls = Array.isArray(proxyUrls)
      ? [...new Set(proxyUrls.map((v) => String(v || "").trim()).filter(Boolean))]
      : [];

    const job = {
      jobId,
      status: "running",
      concurrency: this._clampConcurrency(concurrency),
      engine: DEFAULT_BULK_IMPORT_ENGINE,
      proxyUrl: resolvedProxyUrls[0] || null,
      proxyUrls: resolvedProxyUrls,
      proxyMode:
        resolvedProxyUrls.length > 1
          ? "round-robin"
          : resolvedProxyUrls.length === 1
            ? "single"
            : "none",
      proxyPoolId: null,
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
      // Dot-trick specific fields
      mode,
      headless: Boolean(headless),
      loginCooldownMs: Number.isFinite(loginCooldownMs) ? loginCooldownMs : 60_000,
      accounts,
    };

    this.jobs.set(jobId, job);
    this.latestJobId = jobId;
    // Persist latest job id via parent's meta file
    this._writeLatestJobId(jobId);
    await this.persistJobSnapshot(job, { forcePreview: false });
    void this.runJob(jobId);
    return this.getJob(jobId);
  }

  /**
   * Process a single account — registration + (optionally) device-code login.
   * @param {object} job
   * @param {object} account
   * @param {number} workerId
   */
  async processAccount(job, account, workerId) {
    if (job.cancelRequested) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    const needsRegistration = account.mode === "merge" || account.mode === "register-only";
    const needsLogin = account.mode === "merge" || account.mode === "login-only";

    // ── REGISTER PHASE ───────────────────────────────────────────────────────
    if (needsRegistration) {
      let browser = null;
      let context = null;

      try {
        this.setAccountStep(
          account,
          "launching_browser",
          `Worker ${workerId}: launching browser for registration`
        );
        await this.persistJobSnapshot(job, { forcePreview: false });

        const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
        const proxyUrl = this._resolveWorkerProxy(job, workerId);
        browser = await launchBulkImportBrowser({ headless: job.headless, proxyUrl });
        if (job.workerBrowsers) job.workerBrowsers.add(browser);

        const { context: ctx, page } = await createFreshContext(browser);
        context = ctx;
        account.runtimeSession = { context, page, proxyUrl: proxyUrl || null };

        // Step 4: Navigate to Kiro sign-in
        this.setAccountStep(account, "navigating", "Navigating to app.kiro.dev/signin");
        await page.goto("https://app.kiro.dev/signin", {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await this.persistJobSnapshot(job, { forcePreview: true });

        // Step 5: Click "Builder ID" button → redirect to signin.aws domain
        this.setAccountStep(account, "clicking_builder_id", 'Clicking "Builder ID" button');
        await page.click('button:has-text("Builder ID"), [data-testid="builder-id-button"], a:has-text("Builder ID")', {
          timeout: 15_000,
        }).catch(async () => {
          // Fallback: look for any button that triggers Builder ID flow
          const buttons = await page.$$("button");
          for (const btn of buttons) {
            const text = await btn.textContent().catch(() => "");
            if (text && text.toLowerCase().includes("builder")) {
              await btn.click();
              return;
            }
          }
        });
        // Wait for redirect to signin.aws domain
        await page.waitForURL(/signin\.aws|auth\.aws/, { timeout: 20_000 }).catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });

        // Step 6: Fill email field → click Continue
        this.setAccountStep(account, "filling_email", `Filling email: ${account.email}`);
        await page.fill('input[type="email"], input[name="email"], #username', account.email, {
          timeout: 15_000,
        });
        await page.click('button[type="submit"], input[type="submit"], button:has-text("Continue"), button:has-text("Next")', {
          timeout: 10_000,
        });
        await this.persistJobSnapshot(job, { forcePreview: true });

        // Step 7: Fill display name
        const displayName = generateRealisticName();
        this.setAccountStep(account, "filling_name", `Filling display name: ${displayName}`);
        await page.fill(
          'input[name="name"], input[placeholder*="name"], input[id*="name"]',
          displayName,
          { timeout: 15_000 }
        ).catch(() => null); // name field may not always appear

        // Step 8: OTP / password setup — stub for MVP
        this.setAccountStep(account, "otp_pending", "TODO: OTP reading not yet implemented — registration stub");
        // TODO: Implement OTP reading via Gmail API
        // const accessToken = await getAccessToken(account.email);
        // const otp = await readOtpFromGmail(accessToken);

        // Step 9–10: Generate and fill password (stub — full flow needs OTP first)
        const generatedPassword = "Aa1!" + randomChars(12);
        account.password = generatedPassword;

        // For MVP — mark as failed with a clear TODO message so the job completes
        // rather than hanging. Real registration requires OTP support.
        this.finalizeAccount(account, "failed", {
          error: "readOtpFromGmail not yet implemented",
          step: "otp_pending",
          message: "Registration halted: OTP reading is not yet implemented. This is a planned follow-up.",
        });
        account.password = undefined; // clear password on failure
        account.runtimeSession = null;
        await context.close().catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });
        return;
      } catch (error) {
        account.reg_status = "failed";
        this.finalizeAccount(account, "failed", {
          error: error.message || "Registration failed unexpectedly.",
          step: "failed",
          message: error.message || "Registration failed unexpectedly.",
        });
        account.password = undefined;
        account.runtimeSession = null;
        if (context) await context.close().catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });
        return;
      } finally {
        if (browser && job.workerBrowsers) job.workerBrowsers.delete(browser);
        if (browser) await browser.close().catch(() => null);
      }
    }

    // ── LOGIN PHASE (merge or login-only) ────────────────────────────────────
    if (needsLogin) {
      // For merge mode: wait for login cooldown after registration
      if (account.mode === "merge") {
        const cooldown = job.loginCooldownMs || 60_000;
        this.setAccountStep(
          account,
          "login_cooldown",
          `Waiting ${cooldown}ms login cooldown before device-code flow`
        );
        await sleep(cooldown);
      }

      let browser = null;
      let context = null;

      try {
        this.setAccountStep(account, "login_device_code", "Starting device-code login flow");
        await this.persistJobSnapshot(job, { forcePreview: false });

        // Request device code from KiroService
        const { KiroService } = await import("./kiro.js");
        const deviceCodeResult = await KiroService.requestDeviceCode();
        const { verificationUriComplete, deviceCode, interval = 5 } = deviceCodeResult;

        this.setAccountStep(
          account,
          "opening_verification_browser",
          `Opening verification URL: ${verificationUriComplete}`
        );

        const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
        const proxyUrl = this._resolveWorkerProxy(job, workerId);
        browser = await launchBulkImportBrowser({ headless: job.headless, proxyUrl });
        if (job.workerBrowsers) job.workerBrowsers.add(browser);

        const { context: ctx, page } = await createFreshContext(browser);
        context = ctx;
        account.runtimeSession = { context, page, proxyUrl: proxyUrl || null };

        // Navigate to device verification URL
        await page.goto(verificationUriComplete, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await this.persistJobSnapshot(job, { forcePreview: true });

        // Fill email → Continue
        this.setAccountStep(account, "filling_login_email", `Filling login email: ${account.email}`);
        await page.fill('input[type="email"], input[name="email"], #username', account.email, {
          timeout: 15_000,
        });
        await page.click(
          'button[type="submit"], input[type="submit"], button:has-text("Continue"), button:has-text("Next")',
          { timeout: 10_000 }
        );
        await this.persistJobSnapshot(job, { forcePreview: true });

        // Fill password → Sign in
        this.setAccountStep(account, "filling_login_password", "Filling password");
        await page.fill('input[type="password"], input[name="password"], #password', account.password, {
          timeout: 15_000,
        });
        await page.click(
          'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Login")',
          { timeout: 10_000 }
        );
        await this.persistJobSnapshot(job, { forcePreview: true });

        // Click "Allow access"
        this.setAccountStep(account, "allowing_access", 'Clicking "Allow access"');
        await page.click(
          'button:has-text("Allow"), button:has-text("Allow access"), button:has-text("Authorize")',
          { timeout: 20_000 }
        ).catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });

        // Poll KiroService until connection is created
        this.setAccountStep(account, "polling_connection", "Polling for Kiro connection");
        const maxAttempts = Math.ceil(120 / interval);
        let connectionId = null;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (job.cancelRequested) break;
          await sleep(interval * 1000);
          try {
            const pollResult = await KiroService.pollDeviceCode(deviceCode);
            if (pollResult && pollResult.connectionId) {
              connectionId = pollResult.connectionId;
              break;
            }
            if (pollResult && pollResult.status === "authorized") {
              connectionId = pollResult.connectionId || pollResult.id || null;
              break;
            }
          } catch {
            // continue polling
          }
        }

        if (!connectionId) {
          throw new Error("Device code polling timed out — no connection created");
        }

        account.login_status = "success";
        account.connectionId = connectionId;
        this.finalizeAccount(account, "success", {
          connectionId,
          step: "connection_saved",
          message: "Kiro connection saved via device-code flow",
        });
        account.runtimeSession = null;
        await context.close().catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });
      } catch (error) {
        account.login_status = "failed";
        this.finalizeAccount(account, "failed", {
          error: error.message || "Device-code login failed.",
          step: "login_failed",
          message: error.message || "Device-code login failed.",
        });
        account.runtimeSession = null;
        if (context) await context.close().catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });
      } finally {
        if (browser && job.workerBrowsers) job.workerBrowsers.delete(browser);
        if (browser) await browser.close().catch(() => null);
      }
    }
  }

  /**
   * Export accounts.json for a job.
   * @param {string} jobId
   * @returns {{ json: string, filename: string } | null}
   */
  getAccountsJson(jobId) {
    const liveJob = this.jobs.get(jobId);
    const job = liveJob || this._readJobFile(jobId);
    if (!job) return null;

    const result = buildAccountsJson({
      jobId: job.jobId,
      mode: job.mode || "unknown",
      stats: job.summary || {},
      accounts: job.accounts || [],
    });

    return {
      json: JSON.stringify(result, null, 2),
      filename: buildAccountsJsonFilename(jobId),
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Clamp concurrency using the same logic as the parent. */
  _clampConcurrency(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return KIRO_DOT_TRICK_DEFAULT_CONCURRENCY;
    return Math.min(KIRO_DOT_TRICK_MAX_CONCURRENCY, Math.max(KIRO_DOT_TRICK_MIN_CONCURRENCY, parsed));
  }

  /** Resolve which proxy URL a worker should use. */
  _resolveWorkerProxy(job, workerId) {
    const urls = Array.isArray(job.proxyUrls) ? job.proxyUrls : [];
    if (urls.length > 1) return urls[(Math.max(1, workerId) - 1) % urls.length];
    return job.proxyUrl || urls[0] || null;
  }

  /** Write latest job id to meta file (mirrors parent's pattern). */
  _writeLatestJobId(jobId) {
    try {
      const metaFile = this.metaFile;
      const dir = path.dirname(metaFile);
      fs.mkdirSync(dir, { recursive: true });
      const tempFile = `${metaFile}.${process.pid}.tmp`;
      fs.writeFileSync(
        tempFile,
        JSON.stringify({ latestJobId: jobId, updatedAt: nowIso() }, null, 2),
        "utf8"
      );
      fs.renameSync(tempFile, metaFile);
    } catch {
      // Best-effort; parent will re-derive from disk.
    }
  }

  /** Read a persisted job file (mirrors parent's pattern). */
  _readJobFile(jobId) {
    try {
      const filePath = path.join(this.storageDir, `${jobId}.json`);
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

function getSingletonStore() {
  if (!globalThis.__kiroDotTrickSingleton) {
    globalThis.__kiroDotTrickSingleton = { manager: new KiroDotTrickManager() };
  }
  return globalThis.__kiroDotTrickSingleton;
}

export function getKiroDotTrickManager() {
  return getSingletonStore().manager;
}
