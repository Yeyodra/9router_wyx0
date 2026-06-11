import {
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
  parseKiroBulkAccounts,
} from "./kiroBulkImportManager.js";
import { runGoogleAccountAutomation } from "./kiroGoogleAutomation.js";

const CODEBUDDY_PROVIDER_ID = "codebuddy";
const CODEBUDDY_LABEL = "CodeBuddy";
const CODEBUDDY_POLL_TIMEOUT_MS = 15 * 60_000;
const CODEBUDDY_POLL_INTERVAL_MS = 5_000;
const CODEBUDDY_MAX_TRANSIENT_POLL_ERRORS = 6;
const CODEBUDDY_COOKIE_DOMAINS = new Set(["codebuddy.ai", "www.codebuddy.ai"]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCodeBuddyAuthUrl(rawUrl, state) {
  if (!rawUrl && !state) return rawUrl;
  const url = rawUrl ? new URL(rawUrl) : new URL("https://www.codebuddy.ai/login");
  const platform = url.searchParams.get("platform") || "CLI";
  const effectiveState = state || url.searchParams.get("state");
  const normalized = new URL("https://www.codebuddy.ai/login");
  normalized.searchParams.set("platform", platform);
  if (effectiveState) normalized.searchParams.set("state", effectiveState);
  return normalized.toString();
}

async function defaultSaveCodeBuddyConnection({ tokens, email }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const providerSpecificData = {
    ...(tokens.providerSpecificData || {}),
    loginEmail: email,
    automation: "gsuite-bulk",
  };

  if (tokens.webCookie) {
    providerSpecificData.webCookie = tokens.webCookie;
    providerSpecificData.webCookieCapturedAt = tokens.webCookieCapturedAt || new Date().toISOString();
  }

  const connection = await createProviderConnection({
    provider: CODEBUDDY_PROVIDER_ID,
    authType: "oauth",
    ...tokens,
    email,
    providerSpecificData,
    expiresAt: tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
      : null,
    testStatus: "active",
  });

  return { connection };
}

async function defaultRequestDeviceCode(providerId) {
  const { requestDeviceCode } = await import("../providers.js");
  return requestDeviceCode(providerId);
}

async function defaultPollForToken(providerId, deviceCode) {
  const { pollForToken } = await import("../providers.js");
  return pollForToken(providerId, deviceCode);
}

async function captureCodeBuddyWebCookie(context) {
  if (!context?.cookies) return null;

  try {
    const cookies = await context.cookies(["https://www.codebuddy.ai", "https://codebuddy.ai"]);
    const usefulCookies = cookies
      .filter((cookie) => {
        const domain = String(cookie.domain || "").replace(/^\./, "").toLowerCase();
        return CODEBUDDY_COOKIE_DOMAINS.has(domain)
          || domain.endsWith(".codebuddy.ai");
      })
      .filter((cookie) => cookie.name && cookie.value)
      .sort((left, right) => String(left.name).localeCompare(String(right.name)));

    if (usefulCookies.length === 0) return null;

    return usefulCookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  } catch {
    return null;
  }
}

async function attachCodeBuddyWebCookie(context, tokens = {}) {
  const webCookie = await captureCodeBuddyWebCookie(context);
  if (!webCookie) return tokens;

  return {
    ...tokens,
    webCookie,
    webCookieCapturedAt: new Date().toISOString(),
  };
}

function createCodeBuddyPollPromise({
  deviceCode,
  pollToken,
  onStep,
  timeoutMs = CODEBUDDY_POLL_TIMEOUT_MS,
  pollIntervalMs = CODEBUDDY_POLL_INTERVAL_MS,
  maxTransientErrors = CODEBUDDY_MAX_TRANSIENT_POLL_ERRORS,
}) {
  return (async () => {
    const startedAt = Date.now();
    let lastStepAt = 0;
    let transientErrors = 0;

    while (Date.now() - startedAt < timeoutMs) {
      if (Date.now() - lastStepAt > pollIntervalMs - 100) {
        onStep?.("polling_codebuddy_token", "Waiting for CodeBuddy OAuth token");
        lastStepAt = Date.now();
      }

      const result = await pollToken(CODEBUDDY_PROVIDER_ID, deviceCode);
      if (result.success) {
        return {
          tokens: result.tokens,
        };
      }

      if (!result.pending && result.error !== "authorization_pending" && result.error !== "slow_down") {
        if (result.error === "request_failed" && transientErrors < maxTransientErrors) {
          transientErrors += 1;
          onStep?.(
            "codebuddy_poll_retry",
            `CodeBuddy token poll failed temporarily (${transientErrors}/${maxTransientErrors}); retrying`
          );
          await wait(pollIntervalMs);
          continue;
        }
        throw new Error(result.errorDescription || result.error || "CodeBuddy OAuth polling failed");
      }

      await wait(pollIntervalMs);
    }

    throw new Error("Timed out waiting for CodeBuddy OAuth token");
  })();
}

export class CodeBuddyBulkImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher,
    googleAutomation = runGoogleAccountAutomation,
    requestDeviceCodeFn = defaultRequestDeviceCode,
    pollToken = defaultPollForToken,
    saveConnection = defaultSaveCodeBuddyConnection,
    pollIntervalMs = CODEBUDDY_POLL_INTERVAL_MS,
  } = {}) {
    super({
      browserLauncher,
      googleAutomation,
      storageName: "codebuddy-bulk-import",
    });
    this.requestDeviceCode = requestDeviceCodeFn;
    this.pollToken = pollToken;
    this.saveConnection = saveConnection;
    this.pollIntervalMs = pollIntervalMs;
  }

  async runManualFollowup(job, account, workerId, context, successPromise) {
    const followupPromise = (async () => {
      try {
        const result = await successPromise;
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
          await this.persistJobSnapshot(job, { forcePreview: true });
          return;
        }

        this.setAccountStep(account, "saving_connection", "Saving CodeBuddy OAuth connection");
        await this.persistJobSnapshot(job, { forcePreview: true });
        const tokensWithCookie = await attachCodeBuddyWebCookie(context, result.tokens);
        const { connection } = await this.saveConnection({
          tokens: tokensWithCookie,
          email: account.email,
        });

        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "CodeBuddy connection saved successfully",
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
          this.finalizeAccount(account, "failed_exchange", {
            error: error.message || "Manual assist flow failed during token polling.",
            step: "exchange_failed",
            message: error.message || "Manual assist flow failed during token polling.",
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

  async processAccount(job, account, workerId) {
    if (job.cancelRequested || !job.browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    const { context, page } = await createFreshContext(job.browser);
    account.runtimeSession = { context, page };

    try {
      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} is preparing a browser context`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      this.setAccountStep(account, "requesting_codebuddy_state", "Requesting CodeBuddy OAuth state");
      const deviceData = await this.requestDeviceCode(CODEBUDDY_PROVIDER_ID);
      const authUrl = normalizeCodeBuddyAuthUrl(deviceData.verification_uri, deviceData.device_code);
      if (!authUrl || !deviceData.device_code) {
        throw new Error("CodeBuddy did not return an OAuth login URL");
      }

      const successPromise = createCodeBuddyPollPromise({
        deviceCode: deviceData.device_code,
        pollToken: this.pollToken,
        pollIntervalMs: this.pollIntervalMs,
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      const automationResult = await this.googleAutomation({
        page,
        authUrl,
        email: account.email,
        password: account.password,
        successPromise,
        serviceLabel: CODEBUDDY_LABEL,
        openingStep: "opening_codebuddy_oauth",
        openingMessage: "Opening CodeBuddy OAuth page",
        successStep: "codebuddy_token_received",
        successMessage: "CodeBuddy OAuth token received",
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult.status === "success") {
        this.setAccountStep(account, "saving_connection", "Saving CodeBuddy OAuth connection");
        await this.persistJobSnapshot(job, { forcePreview: true });
        const tokensWithCookie = await attachCodeBuddyWebCookie(context, automationResult.tokens);
        const { connection } = await this.saveConnection({
          tokens: tokensWithCookie,
          email: account.email,
        });
        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "CodeBuddy connection saved successfully",
        });
        account.runtimeSession = null;
        await context.close().catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });
        return;
      }

      if (automationResult.status === "needs_manual") {
        account.manualSession = {
          context,
          page,
          opened: false,
          openedAt: null,
        };
        this.setAccountStep(account, "awaiting_manual", "Waiting for manual completion in the browser session");
        this.finalizeAccount(account, "needs_manual", {
          error: automationResult.error,
          step: "awaiting_manual",
          message: automationResult.error,
        });
        await this.persistJobSnapshot(job, { forcePreview: true });
        await this.runManualFollowup(job, account, workerId, context, successPromise);
        return;
      }

      this.finalizeAccount(account, automationResult.status || "failed", {
        error: automationResult.error || "CodeBuddy Google automation failed.",
        step: automationResult.status || "failed",
        message: automationResult.error || "CodeBuddy Google automation failed.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      if (job.cancelRequested) {
        this.finalizeAccount(account, "cancelled", {
          error: "Job cancelled",
          step: "cancelled",
          message: "Job cancelled while CodeBuddy automation was running",
        });
      } else {
        this.finalizeAccount(account, "failed", {
          error: error.message || "Unexpected CodeBuddy bulk import failure.",
          step: "failed",
          message: error.message || "Unexpected CodeBuddy bulk import failure.",
        });
      }
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } finally {
      account.password = undefined;
    }
  }
}

function getSingletonStore() {
  if (!globalThis.__codeBuddyBulkImportSingleton) {
    globalThis.__codeBuddyBulkImportSingleton = {
      manager: new CodeBuddyBulkImportManager(),
    };
  }
  return globalThis.__codeBuddyBulkImportSingleton;
}

export function getCodeBuddyBulkImportManager() {
  return getSingletonStore().manager;
}

export {
  buildLookupResponse,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY as CODEBUDDY_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY as CODEBUDDY_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY as CODEBUDDY_BULK_IMPORT_MIN_CONCURRENCY,
  parseKiroBulkAccounts as parseCodeBuddyBulkAccounts,
};
