export const CONNECTION_STATUS_KEYS = {
  active: "active",
  disabled: "disabled",
  connection_error: "connection_error",
  auth_error: "auth_error",
  quota_exhausted: "quota_exhausted",
  rate_limited: "rate_limited",
  banned: "banned",
  cooldown: "cooldown",
  unknown: "unknown",
};

export const CONNECTION_STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active", keys: ["active"] },
  {
    id: "errors",
    label: "Errors",
    keys: ["connection_error", "auth_error", "quota_exhausted", "rate_limited", "banned", "cooldown", "unknown"],
  },
  { id: "connection", label: "Connection", keys: ["connection_error"] },
  { id: "auth", label: "Auth", keys: ["auth_error"] },
  { id: "limit", label: "Limit", keys: ["rate_limited", "cooldown"] },
  { id: "exhausted", label: "Exhausted", keys: ["quota_exhausted"] },
  { id: "banned", label: "Banned", keys: ["banned"] },
  { id: "disabled", label: "Disabled", keys: ["disabled"] },
];

const STATUS_META = {
  active: { label: "active", severity: "success", terminal: false },
  disabled: { label: "disabled", severity: "default", terminal: false },
  connection_error: { label: "connection error", severity: "error", terminal: false },
  auth_error: { label: "auth error", severity: "error", terminal: true },
  quota_exhausted: { label: "exhausted", severity: "error", terminal: true },
  rate_limited: { label: "rate limited", severity: "warning", terminal: false },
  banned: { label: "banned", severity: "error", terminal: true },
  cooldown: { label: "cooldown", severity: "warning", terminal: false },
  unknown: { label: "unknown", severity: "default", terminal: false },
};

function normalizeText(value) {
  if (!value) return "";
  if (typeof value === "string") return value.toLowerCase();
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return String(value).toLowerCase();
  }
}

function hasActiveDate(value) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function hasActiveModelLock(connection = {}) {
  return Object.entries(connection).some(([key, value]) => (
    key.startsWith("modelLock_") && hasActiveDate(value)
  ));
}

function withMeta(key, reason = "") {
  const meta = STATUS_META[key] || STATUS_META.unknown;
  return { key, ...meta, reason };
}

export function classifyConnectionStatus(connection = {}) {
  if (connection.isActive === false) {
    return withMeta("disabled", "Connection is disabled");
  }

  if (hasActiveModelLock(connection)) {
    return withMeta("cooldown", "Model cooldown is active");
  }

  if (hasActiveDate(connection.rateLimitedUntil)) {
    return withMeta("rate_limited", "Rate limit cooldown is active");
  }

  const status = normalizeText(connection.testStatus || connection.status);
  const errorType = normalizeText(connection.lastErrorType || connection.errorType);
  const errorCode = normalizeText(connection.errorCode || connection.statusCode);
  const errorText = normalizeText(connection.lastError || connection.error);
  const combined = `${status} ${errorType} ${errorCode} ${errorText}`.trim();

  if (!combined || ["active", "success", "ok"].includes(status)) {
    return withMeta("active", "");
  }

  if (combined.includes("ban") || combined.includes("suspend") || combined.includes("restricted")) {
    return withMeta("banned", connection.lastError || "Account appears restricted");
  }

  if (
    combined.includes("exhaust") ||
    combined.includes("quota exceeded") ||
    combined.includes("insufficient_quota") ||
    combined.includes("payment required") ||
    errorCode === "402"
  ) {
    return withMeta("quota_exhausted", connection.lastError || "Quota exhausted");
  }

  if (
    errorType.includes("rate_limited") ||
    combined.includes("rate limit") ||
    combined.includes("too many requests") ||
    errorCode === "429"
  ) {
    return withMeta("rate_limited", connection.lastError || "Rate limited");
  }

  if (
    errorType.includes("auth") ||
    errorType.includes("token") ||
    combined.includes("unauthorized") ||
    combined.includes("invalid api key") ||
    combined.includes("token invalid") ||
    combined.includes("token expired") ||
    combined.includes("revoked") ||
    errorCode === "401" ||
    errorCode === "403"
  ) {
    return withMeta("auth_error", connection.lastError || "Authentication failed");
  }

  if (
    errorType.includes("network") ||
    combined.includes("network") ||
    combined.includes("timeout") ||
    combined.includes("fetch failed") ||
    combined.includes("econn") ||
    combined.includes("dns") ||
    combined.includes("proxy")
  ) {
    return withMeta("connection_error", connection.lastError || "Connection failed");
  }

  if (["error", "expired", "unavailable", "failed"].includes(status)) {
    return withMeta("connection_error", connection.lastError || connection.testStatus || "Connection failed");
  }

  return withMeta("unknown", connection.lastError || connection.testStatus || "");
}

export function filterConnectionByStatus(connection, filterId) {
  if (!filterId || filterId === "all") return true;
  const filter = CONNECTION_STATUS_FILTERS.find((item) => item.id === filterId);
  if (!filter) return true;
  return filter.keys.includes(classifyConnectionStatus(connection).key);
}

export function isTerminalConnectionStatus(connection) {
  return classifyConnectionStatus(connection).terminal === true;
}

export function getStatusBadgeVariant(classifiedStatus) {
  if (classifiedStatus?.severity === "success") return "success";
  if (classifiedStatus?.severity === "error") return "error";
  return "default";
}
