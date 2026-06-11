import { getProviderConnections, getSettings } from "@/lib/localDb";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";

export const CODEX_GATEWAY_DEFAULT_MODEL = "gpt-5.5";
export const CODEX_GATEWAY_ACCOUNT_LIMIT = 5000;

function cleanSegment(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

function stripCodexPrefix(model) {
  const value = cleanSegment(model);
  if (value.startsWith("cx/")) return value.slice(3);
  if (value.startsWith("codex/")) return value.slice(6);
  return value || CODEX_GATEWAY_DEFAULT_MODEL;
}

function normalizeRouterTarget(value) {
  const target = cleanSegment(value) || CODEX_GATEWAY_DEFAULT_MODEL;
  if (!target.includes("/")) return `cx/${target}`;
  return target;
}

function normalizeCodexTarget(value) {
  return `cx/${stripCodexPrefix(value)}`;
}

export function parseCodexGatewayModel(modelStr) {
  const value = cleanSegment(modelStr);
  if (!value) return null;

  if (value === "auto-codex") {
    return {
      mode: "router",
      modelString: `cx/${CODEX_GATEWAY_DEFAULT_MODEL}`,
      strictAccount: false,
      label: "Auto Codex",
    };
  }

  if (value.startsWith("router/")) {
    return {
      mode: "router",
      modelString: normalizeRouterTarget(value.slice("router/".length)),
      strictAccount: false,
      label: "Router Pool",
    };
  }

  if (value.startsWith("original/")) {
    return {
      mode: "original",
      modelString: normalizeCodexTarget(value.slice("original/".length)),
      strictAccount: true,
      label: "Original Codex",
    };
  }

  if (value === "original") {
    return {
      mode: "original",
      modelString: `cx/${CODEX_GATEWAY_DEFAULT_MODEL}`,
      strictAccount: true,
      label: "Original Codex",
    };
  }

  const accountPrefix = value.startsWith("account/")
    ? "account/"
    : (value.startsWith("codex-account/") ? "codex-account/" : null);
  if (accountPrefix) {
    const rest = value.slice(accountPrefix.length);
    const slash = rest.indexOf("/");
    const accountRef = slash === -1 ? rest : rest.slice(0, slash);
    const model = slash === -1 ? CODEX_GATEWAY_DEFAULT_MODEL : rest.slice(slash + 1);
    if (!accountRef) return null;
    return {
      mode: "account",
      accountRef,
      modelString: normalizeCodexTarget(model),
      strictAccount: true,
      label: "Pinned Codex Account",
    };
  }

  return null;
}

export function getCodexConnectionLabel(connection) {
  return (
    connection?.displayName ||
    connection?.name ||
    connection?.email ||
    connection?.id ||
    "Codex account"
  );
}

export function slugifyCodexAccount(connection) {
  const raw = getCodexConnectionLabel(connection);
  const base = String(raw)
    .toLowerCase()
    .replace(/@/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "account";
  return `${base}-${String(connection?.id || "").slice(0, 8)}`;
}

function normalizeRef(value) {
  return String(value || "").trim().toLowerCase();
}

function isImportedGptJson(connection) {
  const data = connection?.providerSpecificData || {};
  return data.importedFrom === "GPTJson" || String(data.tokenSource || "").startsWith("ChatGPT_team");
}

export async function listCodexGatewayAccounts(limit = CODEX_GATEWAY_ACCOUNT_LIMIT) {
  const connections = await getProviderConnections({ provider: "codex", isActive: true });
  const accounts = connections.slice(0, limit).map((connection) => ({
    id: connection.id,
    slug: slugifyCodexAccount(connection),
    label: getCodexConnectionLabel(connection),
    email: connection.email || null,
    imported: isImportedGptJson(connection),
    priority: connection.priority || null,
  }));

  const original = findOriginalCodexConnection(connections);
  return {
    accounts,
    original: original ? {
      id: original.id,
      slug: slugifyCodexAccount(original),
      label: getCodexConnectionLabel(original),
      email: original.email || null,
      imported: isImportedGptJson(original),
      priority: original.priority || null,
    } : null,
  };
}

export function findOriginalCodexConnection(connections) {
  if (!Array.isArray(connections) || connections.length === 0) return null;
  return connections.find((connection) => !isImportedGptJson(connection)) || connections[0];
}

export async function resolveCodexConnectionRef(ref) {
  const target = normalizeRef(ref);
  if (!target) return null;
  const connections = await getProviderConnections({ provider: "codex", isActive: true });

  const exact = connections.find((connection) => (
    normalizeRef(connection.id) === target ||
    slugifyCodexAccount(connection) === target ||
    normalizeRef(connection.email) === target ||
    normalizeRef(connection.name) === target ||
    normalizeRef(connection.displayName) === target
  ));
  if (exact) return exact;

  const prefixMatches = connections.filter((connection) => (
    normalizeRef(connection.id).startsWith(target) ||
    slugifyCodexAccount(connection).startsWith(target)
  ));
  if (prefixMatches.length === 1) return prefixMatches[0];

  return null;
}

export async function resolveCodexGatewayConnection(gateway) {
  if (!gateway || (gateway.mode !== "original" && gateway.mode !== "account")) return null;

  if (gateway.mode === "account") {
    return resolveCodexConnectionRef(gateway.accountRef);
  }

  const settings = await getSettings();
  const configuredId = settings.codexGatewayOriginalConnectionId || settings.codexOriginalConnectionId || "";
  if (configuredId) {
    const configured = await resolveCodexConnectionRef(configuredId);
    if (configured) return configured;
  }

  const connections = await getProviderConnections({ provider: "codex", isActive: true });
  return findOriginalCodexConnection(connections);
}

export function buildCodexGatewayModelEntries(connections = []) {
  const hasCodex = connections.some((connection) => connection.provider === "codex" && connection.isActive !== false);
  if (!hasCodex) return [];

  const codexModels = (PROVIDER_MODELS.cx || [])
    .filter((model) => !model.type || model.type === "llm")
    .map((model) => model.id);

  const entries = [
    { id: "auto-codex", object: "model", owned_by: "9router-codex-gateway" },
    ...codexModels.flatMap((model) => [
      { id: `router/${model}`, object: "model", owned_by: "9router-codex-gateway" },
      { id: `original/${model}`, object: "model", owned_by: "9router-codex-gateway" },
    ]),
  ];

  for (const connection of connections.filter((conn) => conn.provider === "codex" && conn.isActive !== false)) {
    entries.push({
      id: `account/${slugifyCodexAccount(connection)}`,
      object: "model",
      owned_by: "9router-codex-account",
    });
  }

  return entries;
}
