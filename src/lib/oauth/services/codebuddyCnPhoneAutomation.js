import { randomInt } from "crypto";

const CODEBUDDY_CN_HOME_URL = "https://www.codebuddy.cn/home";
const CODEBUDDY_CN_KEYS_URL = "https://copilot.tencent.com/profile/keys";
const CODEBUDDY_CN_API_KEY_ENDPOINT = "https://copilot.tencent.com/console/api/client/v1/api-keys";
const CODEBUDDY_CN_PERSONAL_ENTERPRISE_ID = "personal-edition-user-id";
const PHONE_SUBMIT_SELECTORS = [
  "button:has-text('获取验证码')",
  "button:has-text('发送验证码')",
  "button:has-text('Get code')",
  "button:has-text('Send code')",
  "button:has-text('Continue')",
  "button:has-text('登录')",
  "button:has-text('Login')",
  "[role='button']:has-text('获取验证码')",
  "[role='button']:has-text('发送验证码')",
  "[role='button']:has-text('Send code')",
];
const OTP_SUBMIT_SELECTORS = [
  "button:has-text('登录')",
  "button:has-text('确认')",
  "button:has-text('完成')",
  "button:has-text('Continue')",
  "button:has-text('Login')",
  "button[type='submit']",
  "[role='button']:has-text('登录')",
  "[role='button']:has-text('确认')",
];

function randomChoice(items) {
  return items[randomInt(0, items.length)];
}

export function generateCodeBuddyCnKeyName() {
  const left = ["china", "hoshi", "longma", "yulan", "meihua", "tianhe", "baihu", "yunhai"];
  const right = ["hoshi", "macan", "long", "mei", "shan", "hua", "yue", "xing"];
  return `${randomChoice(left)}-${randomChoice(right)}-${String(randomInt(0, 10_000)).padStart(4, "0")}`;
}

function normalizePhoneForInput(phone) {
  return String(phone || "").replace(/[^\d+]/g, "");
}

async function clickFirst(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator?.(selector)?.first?.();
    if (!locator) continue;
    const visible = await locator.isVisible?.({ timeout: 1_000 }).catch(() => false);
    if (!visible) continue;
    await locator.click({ timeout: 3_000 }).catch(() => null);
    return true;
  }
  return false;
}

async function fillFirst(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator?.(selector)?.first?.();
    if (!locator) continue;
    const visible = await locator.isVisible?.({ timeout: 1_000 }).catch(() => false);
    if (!visible) continue;
    await locator.fill(String(value), { timeout: 3_000 });
    return true;
  }
  return false;
}

async function waitForCodeBuddyCnSession(page) {
  await page.waitForFunction?.(() => {
    const text = document.body?.innerText || "";
    return /profile|keys|工作台|首页|退出|账号|控制台|dashboard/i.test(text)
      || Boolean(document.cookie && document.cookie.length > 10);
  }, { timeout: 45_000 }).catch(() => null);
}

function manualError(message, step) {
  const error = new Error(message);
  error.status = "needs_manual";
  error.step = step;
  return error;
}

export async function runCodeBuddyCnPhoneLogin({ page, phone, codeProvider, onStep }) {
  onStep?.("opening_codebuddy_cn", "Opening CodeBuddy CN phone login");
  await page.goto(CODEBUDDY_CN_HOME_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout?.(2_000);

  await clickFirst(page, [
    "text=手机号",
    "text=短信登录",
    "text=验证码登录",
    "text=Phone",
    "text=SMS",
    "[role='tab']:has-text('手机')",
    "[role='button']:has-text('手机')",
  ]);

  onStep?.("entering_phone", "Entering 5sim phone number");
  const phoneFilled = await fillFirst(page, [
    "input[type='tel']",
    "input[name*='phone' i]",
    "input[placeholder*='手机']",
    "input[placeholder*='手机号']",
    "input[placeholder*='phone' i]",
  ], normalizePhoneForInput(phone));
  if (!phoneFilled) throw manualError("CodeBuddy CN phone input not found", "phone_input_not_found");

  onStep?.("requesting_otp", "Requesting CodeBuddy CN SMS code");
  const requested = await clickFirst(page, PHONE_SUBMIT_SELECTORS);
  if (!requested) throw manualError("CodeBuddy CN send-code button not found", "otp_button_not_found");

  onStep?.("waiting_5sim_otp", "Waiting for 5sim OTP");
  const { code } = await codeProvider();
  if (!code) throw new Error("5sim returned no OTP code");

  onStep?.("entering_otp", "Entering CodeBuddy CN OTP");
  const otpFilled = await fillFirst(page, [
    "input[autocomplete='one-time-code']",
    "input[name*='code' i]",
    "input[placeholder*='验证码']",
    "input[placeholder*='code' i]",
    "input[maxlength='6']",
  ], code);
  if (!otpFilled) throw manualError("CodeBuddy CN OTP input not found", "otp_input_not_found");

  await clickFirst(page, OTP_SUBMIT_SELECTORS);
  await waitForCodeBuddyCnSession(page);
  return { phone, webEmail: `phone:${phone}` };
}

async function postCodeBuddyCnApiKeyFromPage(page, keyName) {
  return page.evaluate(async ({ endpoint, name, userEnterpriseId }) => {
    const response = await fetch(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        "x-domain": window.location.hostname || "copilot.tencent.com",
      },
      body: JSON.stringify({
        name,
        expire_in_days: 365,
        user_enterprise_id: userEnterpriseId,
      }),
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }
    return { ok: response.ok, status: response.status, payload, text };
  }, {
    endpoint: CODEBUDDY_CN_API_KEY_ENDPOINT,
    name: keyName,
    userEnterpriseId: CODEBUDDY_CN_PERSONAL_ENTERPRISE_ID,
  });
}

function parseApiKeyPayload(payload, fallbackName) {
  const data = payload?.data || payload || {};
  const key = data.key || data.api_key || data.apiKey;
  if (!key) return null;
  const item = data.item || data.apiKeyItem || data;
  return {
    key,
    id: item?.key_id || item?.id || item?.keyId || null,
    name: item?.name || data.name || fallbackName,
    expiresAt: data.expires_at || data.expiresAt || item?.expires_at || item?.expiresAt || null,
    createdAt: item?.created_at || item?.createdAt || null,
  };
}

export async function createCodeBuddyCnApiKey(page, onStep) {
  onStep?.("opening_codebuddy_cn_keys", "Opening CodeBuddy CN API keys page");
  await page.goto(CODEBUDDY_CN_KEYS_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout?.(1_500);

  const names = [generateCodeBuddyCnKeyName(), generateCodeBuddyCnKeyName()];
  let lastMessage = "";
  for (const name of names) {
    onStep?.("creating_codebuddy_cn_api_key", `Creating CodeBuddy CN API key ${name}`);
    const result = await postCodeBuddyCnApiKeyFromPage(page, name);
    if (result.ok && (result.payload?.code === 0 || result.payload?.code === 200 || result.payload?.code === undefined)) {
      const key = parseApiKeyPayload(result.payload, name);
      if (key?.key) return key;
      lastMessage = "CodeBuddy CN API key created but secret was not returned";
      continue;
    }
    lastMessage = result.payload?.msg || result.payload?.message || result.text || `HTTP ${result.status}`;
  }
  throw new Error(lastMessage || "CodeBuddy CN API key creation failed");
}
