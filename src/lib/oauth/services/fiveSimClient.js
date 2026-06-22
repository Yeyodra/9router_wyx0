const FIVE_SIM_API_BASE = "https://5sim.net/v1";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_OTP_TIMEOUT_MS = 120_000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractOtpCode(payload) {
  const sms = Array.isArray(payload?.sms) ? payload.sms : [];
  for (const item of sms) {
    if (item?.code) return String(item.code).trim();
    const text = String(item?.text || "");
    const match = text.match(/\b(\d{4,8})\b/);
    if (match) return match[1];
  }
  return "";
}

function normalizeOrder(payload) {
  return {
    ...payload,
    code: extractOtpCode(payload),
  };
}

export class FiveSimClient {
  constructor({ token, fetchImpl = fetch, baseUrl = FIVE_SIM_API_BASE } = {}) {
    this.token = String(token || "").trim();
    this.fetchImpl = fetchImpl;
    this.baseUrl = String(baseUrl || FIVE_SIM_API_BASE).replace(/\/$/, "");
  }

  async request(path, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!this.token) {
      throw new Error("5sim token is required");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      const text = await response.text?.() ?? "";
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : await response.json();
      } catch {
        payload = { message: text };
      }
      if (!response.ok) {
        const msg = payload?.message || payload?.error || text || `5sim HTTP ${response.status}`;
        throw new Error(msg);
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  async getProfile() {
    return this.request("/user/profile");
  }

  async buyActivation({ country = "hongkong", operator = "any", product = "codebuddy" } = {}) {
    const cleanCountry = encodeURIComponent(String(country || "hongkong").trim().toLowerCase());
    const cleanOperator = encodeURIComponent(String(operator || "any").trim().toLowerCase());
    const cleanProduct = encodeURIComponent(String(product || "codebuddy").trim().toLowerCase());
    return this.request(`/user/buy/activation/${cleanCountry}/${cleanOperator}/${cleanProduct}`);
  }

  async checkOrder(orderId) {
    const id = encodeURIComponent(String(orderId || "").trim());
    if (!id) throw new Error("5sim order id is required");
    return normalizeOrder(await this.request(`/user/check/${id}`));
  }

  async finishOrder(orderId) {
    const id = encodeURIComponent(String(orderId || "").trim());
    if (!id) throw new Error("5sim order id is required");
    return this.request(`/user/finish/${id}`);
  }

  async cancelOrder(orderId) {
    const id = encodeURIComponent(String(orderId || "").trim());
    if (!id) throw new Error("5sim order id is required");
    return this.request(`/user/cancel/${id}`);
  }

  async waitForCode(orderId, {
    timeoutMs = DEFAULT_OTP_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  } = {}) {
    const startedAt = Date.now();
    let lastOrder = null;
    while (Date.now() - startedAt < timeoutMs) {
      lastOrder = await this.checkOrder(orderId);
      if (lastOrder.code) return lastOrder;
      await wait(pollIntervalMs);
    }
    const error = new Error("Timed out waiting for 5sim OTP code");
    error.order = lastOrder;
    throw error;
  }
}

export function createFiveSimClient(options) {
  return new FiveSimClient(options);
}
