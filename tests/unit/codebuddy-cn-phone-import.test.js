import { describe, expect, it, vi } from "vitest";
import { FiveSimClient } from "../../src/lib/oauth/services/fiveSimClient.js";
import {
  CodeBuddyCnPhoneImportManager,
  generateCodeBuddyCnKeyName,
} from "../../src/lib/oauth/services/codebuddyCnPhoneImportManager.js";

describe("FiveSimClient", () => {
  it("buys a CodeBuddy Hong Kong activation number with bearer auth", async () => {
    const calls = [];
    const client = new FiveSimClient({
      token: "five-token",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          async json() {
            return { id: 42, phone: "+85251234567", product: "codebuddy" };
          },
        };
      },
    });

    const order = await client.buyActivation({
      country: "hongkong",
      operator: "any",
      product: "codebuddy",
    });

    expect(order.id).toBe(42);
    expect(calls[0].url).toBe("https://5sim.net/v1/user/buy/activation/hongkong/any/codebuddy");
    expect(calls[0].init.headers.Authorization).toBe("Bearer five-token");
    expect(calls[0].init.headers.Accept).toBe("application/json");
  });

  it("extracts OTP code from activation order checks", async () => {
    const client = new FiveSimClient({
      token: "five-token",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            id: 42,
            sms: [{ code: "864209", text: "CodeBuddy code 864209" }],
          };
        },
      }),
    });

    const result = await client.checkOrder(42);

    expect(result.code).toBe("864209");
  });
});

describe("CodeBuddy CN phone import", () => {
  it("generates natural CN-style key names instead of router automation tags", () => {
    const names = Array.from({ length: 20 }, () => generateCodeBuddyCnKeyName());

    expect(names.every((name) => /^[a-z]+-[a-z]+-[0-9]{4}$/.test(name))).toBe(true);
    expect(names.some((name) => name.includes("china") || name.includes("hoshi"))).toBe(true);
    expect(names.every((name) => !/router|automation|9router/i.test(name))).toBe(true);
  });

  it("saves a generated CodeBuddy CN API key connection", async () => {
    const saved = [];
    const manager = new CodeBuddyCnPhoneImportManager({
      browserLauncher: async () => ({
        async newContext() {
          return {
            async newPage() {
              return {};
            },
            async close() {},
          };
        },
        async close() {},
      }),
      fiveSimClientFactory: () => ({
        buyActivation: vi.fn(async () => ({ id: 7, phone: "+85251234567" })),
        waitForCode: vi.fn(async () => ({ code: "123456" })),
        finishOrder: vi.fn(async () => ({ ok: true })),
        cancelOrder: vi.fn(async () => ({ ok: true })),
      }),
      phoneLoginFn: vi.fn(async () => ({
        phone: "+85251234567",
        webEmail: "phone:+85251234567",
      })),
      createApiKeyFn: vi.fn(async () => ({
        key: "ck_cn_generated",
        id: "key-id-1",
        name: "china-hoshi-1234",
        expiresAt: "2027-01-01T00:00:00.000Z",
      })),
      saveConnection: async ({ apiKey, keyMeta, label, phone }) => {
        saved.push({ apiKey, keyMeta, label, phone });
        return { connection: { id: "conn-cn-1" } };
      },
    });

    const started = await manager.startJob({
      fiveSimToken: "five-token",
      count: 1,
      concurrency: 1,
    });

    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const tick = () => {
        const job = manager.getJob(started.jobId);
        if (job?.status === "completed") return resolve(job);
        if (Date.now() - startedAt > 3000) return reject(new Error("Timed out"));
        setTimeout(tick, 20);
      };
      tick();
    });

    expect(saved).toHaveLength(1);
    expect(saved[0].apiKey).toBe("ck_cn_generated");
    expect(saved[0].keyMeta.name).toBe("china-hoshi-1234");
    expect(saved[0].phone).toBe("+85251234567");
  });
});
