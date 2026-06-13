import { randomUUID } from "crypto";
import {
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
  parseKiroBulkAccounts,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
} from "./kiroBulkImportManager.js";
import { runGoogleAccountAutomation } from "./googleAutomation.js";
import { QoderService } from "./qoder.js";

const QODER_PROVIDER_ID = "qoder";
const QODER_LABEL = "Qoder";
const QODER_POLL_TIMEOUT_MS = 3 * 60_000;
const QODER_POLL_INTERVAL_MS = 2_000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function defaultSaveQoderConnection({ tokens, email }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const providerSpecificData = {
    authMethod: "device",
    userId: tokens.userId || "",
    machineId: tokens.machineId || "",
    organizationId: tokens.organizationId || "",
    loginEmail: email,
    automation: "gsuite-bulk",
  };

  const connectionData = {
    provider: QODER_PROVIDER_ID,
    authType: "oauth",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || "",
    email,
    displayName: tokens.displayName || email.split("@")[0],
    providerSpecificData,
    expiresAt: tokens.expireTime
      ? new Date(tokens.expireTime).toISOString()
      : null,
    testStatus: "active",
  };

  const connection = await createProviderConnection(connectionData);
  return { connection };
}

async function defaultBrowserLauncher(proxyUrl) {
  const { chromium } = await import("playwright");
  const launchOptions = { headless: true };
  if (proxyUrl) {
    launchOptions.proxy = { server: proxyUrl };
  }
  return chromium.launch(launchOptions);
}

class QoderBulkImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher = defaultBrowserLauncher,
    saveConnection = defaultSaveQoderConnection,
    qoderServiceFactory = () => new QoderService(),
    storageName = "qoder-bulk-import",
    proxyUrl = null,
  } = {}) {
    super({
      browserLauncher: () => browserLauncher(proxyUrl),
      googleAutomation: null,
      socialExchange: null,
      kiroServiceFactory: qoderServiceFactory,
      storageName,
    });
    this.saveConnection = saveConnection;
    this.qoderServiceFactory = qoderServiceFactory;
    this.proxyUrl = proxyUrl;
  }

  async processAccount(job, account, workerId) {
    if (job.cancelRequested || !job.browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    const qoderService = this.qoderServiceFactory();
    const { verificationUriComplete, codeVerifier, nonce, machineId } = qoderService.initiateDeviceFlow();

    const { context, page } = await createFreshContext(job.browser);
    account.runtimeSession = { context, page };

    const pollPromise = this.pollForToken(qoderService, nonce, codeVerifier, job);

    try {
      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} preparing Qoder device flow`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      const automationResult = await runGoogleAccountAutomation({
        page,
        authUrl: verificationUriComplete,
        email: account.email,
        password: account.password,
        successPromise: pollPromise,
        shortTimeoutMs: QODER_POLL_TIMEOUT_MS,
        serviceLabel: QODER_LABEL,
        openingStep: "opening_qoder_login",
        openingMessage: "Opening Qoder device login page",
        successStep: "qoder_token_received",
        successMessage: "Qoder device token received",
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult.status === "success") {
        this.setAccountStep(account, "saving_connection", "Saving Qoder connection to database");
        await this.persistJobSnapshot(job, { forcePreview: true });

        const tokenData = automationResult.tokenData || automationResult;
        let displayName = "";
        try {
          const userInfo = await qoderService.fetchUserInfo(tokenData.accessToken);
          displayName = userInfo.name || userInfo.email || "";
        } catch {}

        const { connection } = await this.saveConnection({
          tokens: {
            accessToken: tokenData.accessToken,
            refreshToken: tokenData.refreshToken || "",
            userId: tokenData.userId || "",
            machineId,
            organizationId: tokenData.organizationId || "",
            expireTime: tokenData.expireTime || null,
            displayName,
          },
          email: account.email,
        });

        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "Qoder connection saved successfully",
        });
        account.runtimeSession = null;
        await context.close().catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });
        return;
      }

      if (automationResult.status === "needs_manual") {
        account.manualSession = { context, page, opened: false, openedAt: null };
        this.setAccountStep(account, "awaiting_manual", "Waiting for manual completion");
        this.finalizeAccount(account, "needs_manual", {
          error: automationResult.error,
          step: "awaiting_manual",
          message: automationResult.error,
        });
        await this.persistJobSnapshot(job, { forcePreview: true });

        await this.runQoderManualFollowup(job, account, workerId, context, pollPromise, qoderService, machineId);
        return;
      }

      const terminalStatus = automationResult.status?.startsWith("failed") ? automationResult.status : "failed";
      this.finalizeAccount(account, terminalStatus, {
        error: automationResult.error || "Qoder Google automation failed.",
        step: terminalStatus,
        message: automationResult.error || "Qoder Google automation failed.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: error.message || "Unexpected Qoder bulk import failure.",
        step: "failed",
        message: error.message || "Unexpected Qoder bulk import failure.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } finally {
      account.password = undefined;
    }
  }

  async pollForToken(qoderService, nonce, codeVerifier, job) {
    const startTime = Date.now();
    while (Date.now() - startTime < QODER_POLL_TIMEOUT_MS) {
      if (job.cancelRequested) {
        throw new Error("Job cancelled during token polling");
      }
      try {
        const result = await qoderService.pollDeviceToken({ nonce, codeVerifier });
        if (result.status === "ok") {
          return { tokenData: result };
        }
      } catch (error) {
        if (error.message && !error.message.includes("timeout")) {
          throw error;
        }
      }
      await wait(QODER_POLL_INTERVAL_MS);
    }
    throw new Error("Qoder device token poll timed out");
  }

  async runQoderManualFollowup(job, account, workerId, context, pollPromise, qoderService, machineId) {
    const followupPromise = (async () => {
      try {
        const result = await pollPromise;
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
          await this.persistJobSnapshot(job, { forcePreview: true });
          return;
        }

        const tokenData = result.tokenData || result;
        this.setAccountStep(account, "saving_connection", "Saving Qoder connection");
        await this.persistJobSnapshot(job, { forcePreview: true });

        let displayName = "";
        try {
          const userInfo = await qoderService.fetchUserInfo(tokenData.accessToken);
          displayName = userInfo.name || userInfo.email || "";
        } catch {}

        const { connection } = await this.saveConnection({
          tokens: {
            accessToken: tokenData.accessToken,
            refreshToken: tokenData.refreshToken || "",
            userId: tokenData.userId || "",
            machineId,
            organizationId: tokenData.organizationId || "",
            expireTime: tokenData.expireTime || null,
            displayName,
          },
          email: account.email,
        });

        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "Qoder connection saved successfully",
        });
        await this.persistJobSnapshot(job, { forcePreview: true });
      } catch (error) {
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
        } else {
          this.finalizeAccount(account, "failed", {
            error: error.message || "Manual assist flow failed.",
            step: "failed",
            message: error.message || "Manual assist flow failed.",
          });
        }
        await this.persistJobSnapshot(job, { forcePreview: true });
      } finally {
        account.manualSession = null;
        account.runtimeSession = null;
        await context.close().catch(() => null);
        job.manualFollowups.delete(followupPromise);
        await this.persistJobSnapshot(job, { forcePreview: true });
      }
    })();

    job.manualFollowups.add(followupPromise);
  }
}

function getSingletonStore() {
  if (!globalThis.__qoderBulkImportSingleton) {
    globalThis.__qoderBulkImportSingleton = {
      manager: new QoderBulkImportManager(),
    };
  }
  return globalThis.__qoderBulkImportSingleton;
}

export function getQoderBulkImportManager() {
  return getSingletonStore().manager;
}

export {
  QoderBulkImportManager,
  buildLookupResponse,
  parseKiroBulkAccounts,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
};
