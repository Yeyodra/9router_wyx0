import {
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
} from "./kiroBulkImportManager.js";
import { FiveSimClient } from "./fiveSimClient.js";
import {
  createCodeBuddyCnApiKey,
  generateCodeBuddyCnKeyName,
  runCodeBuddyCnPhoneLogin,
} from "./codebuddyCnPhoneAutomation.js";

const PROVIDER_ID = "codebuddy-cn";
const DEFAULT_COUNT = 1;
const MAX_COUNT = 8;
const OTP_POLL_TIMEOUT_MS = 150_000;
const OTP_POLL_INTERVAL_MS = 5_000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.max(1, parsed));
}

async function defaultSaveConnection({ apiKey, keyMeta, label, phone }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const connection = await createProviderConnection({
    provider: PROVIDER_ID,
    authType: "apikey",
    name: keyMeta?.name || label,
    apiKey,
    email: label,
    providerSpecificData: {
      automation: "5sim-phone",
      phone,
      codebuddyApiKeyId: keyMeta?.id || null,
      codebuddyApiKeyName: keyMeta?.name || null,
      codebuddyApiKeyExpiresAt: keyMeta?.expiresAt || null,
    },
    testStatus: "active",
  });
  return { connection };
}

export class CodeBuddyCnPhoneImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher,
    fiveSimClientFactory = (options) => new FiveSimClient(options),
    phoneLoginFn = runCodeBuddyCnPhoneLogin,
    createApiKeyFn = createCodeBuddyCnApiKey,
    saveConnection = defaultSaveConnection,
  } = {}) {
    super({
      browserLauncher,
      storageName: "codebuddy-cn-phone-import",
    });
    this.fiveSimClientFactory = fiveSimClientFactory;
    this.phoneLogin = phoneLoginFn;
    this.createApiKey = createApiKeyFn;
    this.saveConnection = saveConnection;
  }

  async startJob({ fiveSimToken, count, concurrency, engine, proxyUrl, country, operator, product }) {
    const token = String(fiveSimToken || "").trim();
    if (!token) throw new Error("5sim API token is required");
    const total = clampCount(count);
    const accounts = Array.from({ length: total }, (_, index) => `codebuddy-cn-${index + 1}@5sim.local|${token}`);
    const job = await super.startJob({ accounts, concurrency, engine, proxyUrl });
    const runtimeJob = this.jobs.get(job.jobId);
    if (runtimeJob) {
      runtimeJob.fiveSim = {
        country: country || "hongkong",
        operator: operator || "any",
        product: product || "codebuddy",
      };
    }
    return job;
  }

  async processAccount(job, account, workerId) {
    if (job.cancelRequested || !job.browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    const { context, page } = await createFreshContext(job.browser);
    account.runtimeSession = { context, page };
    const fiveSim = this.fiveSimClientFactory({ token: account.password });
    let order = null;

    try {
      this.setAccountStep(account, "buying_5sim_number", "Buying 5sim CodeBuddy Hong Kong number");
      await this.persistJobSnapshot(job, { forcePreview: true });
      order = await fiveSim.buyActivation(job.fiveSim || {});
      account.email = order.phone || account.email;

      const loginResult = await this.phoneLogin({
        page,
        phone: order.phone,
        codeProvider: () => fiveSim.waitForCode(order.id, {
          timeoutMs: OTP_POLL_TIMEOUT_MS,
          pollIntervalMs: OTP_POLL_INTERVAL_MS,
        }),
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      const keyMeta = await this.createApiKey(page, (step, message) => {
        this.setAccountStep(account, step, message);
        void this.persistJobSnapshot(job, { forcePreview: false });
      });

      this.setAccountStep(account, "saving_connection", "Saving CodeBuddy CN generated API key");
      const label = loginResult.webEmail || `phone:${order.phone}`;
      const { connection } = await this.saveConnection({
        apiKey: keyMeta.key,
        keyMeta,
        label,
        phone: order.phone,
      });

      await fiveSim.finishOrder(order.id).catch(() => null);
      this.finalizeAccount(account, "success", {
        connectionId: connection.id,
        step: "connection_saved",
        message: "CodeBuddy CN connection saved with generated API key",
      });
    } catch (error) {
      if (order?.id) await fiveSim.cancelOrder(order.id).catch(() => null);
      if (error.status === "needs_manual") {
        account.manualSession = { context, page, opened: false, openedAt: null };
      }
      this.finalizeAccount(account, error.status || "failed", {
        error: error.message || "CodeBuddy CN phone automation failed",
        step: error.step || "failed",
        message: error.message || "CodeBuddy CN phone automation failed",
      });
      if (error.status === "needs_manual") {
        await this.persistJobSnapshot(job, { forcePreview: true });
        return;
      }
    } finally {
      account.password = undefined;
      if (account.status !== "needs_manual") {
        account.runtimeSession = null;
        await context.close().catch(() => null);
      }
      await this.persistJobSnapshot(job, { forcePreview: true });
      await wait(10);
    }
  }
}

function getSingletonStore() {
  if (!globalThis.__codeBuddyCnPhoneImportSingleton) {
    globalThis.__codeBuddyCnPhoneImportSingleton = {
      manager: new CodeBuddyCnPhoneImportManager(),
    };
  }
  return globalThis.__codeBuddyCnPhoneImportSingleton;
}

export function getCodeBuddyCnPhoneImportManager() {
  return getSingletonStore().manager;
}

export {
  buildLookupResponse,
  generateCodeBuddyCnKeyName,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY as CODEBUDDY_CN_PHONE_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY as CODEBUDDY_CN_PHONE_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY as CODEBUDDY_CN_PHONE_IMPORT_MIN_CONCURRENCY,
};
