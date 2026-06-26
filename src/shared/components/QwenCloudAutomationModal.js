"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import PropTypes from "prop-types";
import Badge from "./Badge";
import Button from "./Button";
import Input from "./Input";
import Modal from "./Modal";
import {
  formatBrowserProxyPoolOption,
  getBrowserProxyPools,
} from "@/lib/oauth/services/bulkImportProxyOptions.js";
import { readJsonResponse } from "@/shared/utils/httpResponse.js";

const DEFAULT_CONCURRENCY = 4;
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "needs_manual"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);
const DEFAULT_ENGINE = "chromium";
const ENGINE_OPTIONS = [
  { value: "chromium", label: "Chromium (default, fast)" },
  { value: "camoufox", label: "Camoufox (stealth Firefox, slower)" },
];

// --- Dot trick logic ---
const MAX_VARIANTS = 500;

function generateDotTrickVariants(email) {
  const lower = String(email || "").toLowerCase().trim();
  const atIdx = lower.indexOf("@");
  if (atIdx < 1) return [];
  const username = lower.slice(0, atIdx);
  const domain = lower.slice(atIdx);
  // Only works for Gmail (dots are ignored)
  if (!domain.includes("gmail.com")) return [];
  const clean = username.replace(/\./g, "");
  if (clean.length < 2) return [lower];
  const n = clean.length;
  const positions = n - 1;
  const total = 1 << positions;
  const indices = [];
  if (total <= MAX_VARIANTS) {
    for (let i = 0; i < total; i++) indices.push(i);
  } else {
    const seen = new Set([0, total - 1]);
    indices.push(0, total - 1);
    while (indices.length < MAX_VARIANTS) {
      const r = Math.floor(Math.random() * total);
      if (!seen.has(r)) { seen.add(r); indices.push(r); }
    }
    indices.sort((a, b) => a - b);
  }
  return indices.map((mask) => {
    let result = clean[0];
    for (let i = 0; i < positions; i++) {
      if (mask & (1 << i)) result += ".";
      result += clean[i + 1];
    }
    return result + domain;
  });
}

function parseBulkLines(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((line) => {
      let email = "", password = "";
      if (line.includes("|")) {
        const [e, ...rest] = line.split("|");
        email = e.trim(); password = rest.join("|").trim();
      } else if (line.includes("\t")) {
        const idx = line.indexOf("\t");
        email = line.slice(0, idx).trim(); password = line.slice(idx + 1).trim();
      } else if (line.includes(":")) {
        const idx = line.indexOf(":");
        const before = line.slice(0, idx).trim();
        if (before.includes("@")) { email = before; password = line.slice(idx + 1).trim(); }
      }
      return email && password ? { email, password } : null;
    })
    .filter(Boolean);
}

function buildDotTrickLines(parsed) {
  const lines = [];
  for (const { email, password } of parsed) {
    const variants = generateDotTrickVariants(email);
    if (variants.length === 0) {
      lines.push(`${email}|${password}`);
    } else {
      for (const variant of variants) {
        lines.push(`${variant}|${password}`);
      }
    }
  }
  return lines;
}

// --- Shared helpers ---
function describeWorkerLimit(limitedBy) {
  if (limitedBy === "ram") return "RAM";
  if (limitedBy === "cpu") return "CPU";
  return "default";
}

function formatStepLabel(value) {
  return String(value || "waiting").replaceAll("_", " ");
}

function formatClock(value) {
  if (!value) return "now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "now";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getStatusVariant(status) {
  if (status === "success" || status === "completed") return "success";
  if (status === "needs_manual") return "warning";
  if (status === "running" || status === "queued") return "info";
  if (status === "cancelled") return "default";
  return "danger";
}

function AccountStatusBadge({ status }) {
  return (
    <Badge variant={getStatusVariant(status)} size="sm">
      {formatStepLabel(status)}
    </Badge>
  );
}

AccountStatusBadge.propTypes = { status: PropTypes.string };

async function fetchJob(jobId) {
  const res = await fetch(`/api/oauth/qwen-cloud/bulk-import/${jobId}`, { cache: "no-store" });
  const data = await readJsonResponse(res, "Failed to fetch bulk login job");
  return { res, data };
}

async function fetchLatestJob(scope = "recoverable") {
  const res = await fetch(`/api/oauth/qwen-cloud/bulk-import/latest?scope=${encodeURIComponent(scope)}`, { cache: "no-store" });
  const data = await readJsonResponse(res, "Failed to fetch latest bulk login job");
  return { res, data };
}

export default function QwenCloudAutomationModal({ isOpen, onClose, onSuccess }) {
  const serviceName = "Qwen Cloud";
  const storageKey = "qwen-cloud-bulk-import-active-job";
  const completedRefreshJobsRef = useRef(new Set());
  const [bulkText, setBulkText] = useState("");
  const [concurrency, setConcurrency] = useState(String(DEFAULT_CONCURRENCY));
  const [autoConcurrency, setAutoConcurrency] = useState(true);
  const [systemSpecInfo, setSystemSpecInfo] = useState(null);
  const [systemSpecLoading, setSystemSpecLoading] = useState(false);
  const [engine, setEngine] = useState(DEFAULT_ENGINE);
  const [proxyPoolId, setProxyPoolId] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyPools, setProxyPools] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [jobRestoreNotice, setJobRestoreNotice] = useState(null);
  const [maxAccounts, setMaxAccounts] = useState("");
  const [existingEmails, setExistingEmails] = useState(new Set());

  const runningJob = activeJob && ACTIVE_JOB_STATUSES.has(activeJob.status);
  const finishedJob = activeJob && TERMINAL_JOB_STATUSES.has(activeJob.status);

  const parsedCredentials = useMemo(() => {
    const all = parseBulkLines(bulkText);
    return all.filter((c) => !existingEmails.has(c.email.toLowerCase()));
  }, [bulkText, existingEmails]);
  const dotTrickLines = useMemo(() => buildDotTrickLines(parsedCredentials), [parsedCredentials]);
  const slicedDotTrickLines = useMemo(() => {
    const limit = Number.parseInt(maxAccounts, 10);
    return Number.isFinite(limit) && limit > 0 ? dotTrickLines.slice(0, limit) : dotTrickLines;
  }, [dotTrickLines, maxAccounts]);
  const dotTrickStats = useMemo(() => {
    const gmailCount = parsedCredentials.filter((c) => c.email.toLowerCase().includes("gmail.com")).length;
    const nonGmailCount = parsedCredentials.length - gmailCount;
    return { total: dotTrickLines.length, sliced: slicedDotTrickLines.length, gmailCount, nonGmailCount, credCount: parsedCredentials.length };
  }, [parsedCredentials, dotTrickLines, slicedDotTrickLines]);

  const groupedAccounts = useMemo(() => {
    const groups = new Map();
    for (const account of activeJob?.accounts || []) {
      const key = account.status || "unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(account);
    }
    return [...groups.entries()].map(([status, accounts]) => ({ status, accounts }));
  }, [activeJob]);

  const activityItems = useMemo(() => (
    [...(activeJob?.activity || [])].reverse()
  ), [activeJob]);

  const resetState = useCallback(() => {
    setBulkText("");
    setConcurrency(String(DEFAULT_CONCURRENCY));
    setAutoConcurrency(true);
    setProxyPoolId("");
    setProxyUrl("");
    setActiveJob(null);
    setError(null);
    setImporting(false);
    setJobRestoreNotice(null);
    setMaxAccounts("");
    setExistingEmails(new Set());
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!isOpen) return;
    if (systemSpecInfo) return;
    let cancelled = false;
    const run = async () => {
      setSystemSpecLoading(true);
      try {
        const res = await fetch("/api/system/specs", { cache: "no-store" });
        const data = await readJsonResponse(res, "Failed to detect system specs");
        if (cancelled || !data?.success) return;
        setSystemSpecInfo(data);
        setConcurrency((current) => {
          const parsed = Number.parseInt(current, 10);
          return Number.isFinite(parsed) ? current : String(data.recommended);
        });
      } catch {
        // noop
      } finally {
        if (!cancelled) setSystemSpecLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [isOpen, systemSpecInfo]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const loadPools = async () => {
      try {
        const res = await fetch("/api/proxy-pools?isActive=true", { cache: "no-store" });
        if (!res.ok) return;
        const data = await readJsonResponse(res, "Failed to fetch proxy pools");
        if (cancelled) return;
        setProxyPools(getBrowserProxyPools(data));
      } catch {
        // noop
      }
    };
    void loadPools();
    return () => { cancelled = true; };
  }, [isOpen]);

  // Fetch existing qwen-cloud connections to skip already-imported emails
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const loadExisting = async () => {
      try {
        const res = await fetch("/api/providers?provider=qwen-cloud", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await readJsonResponse(res, "Failed to fetch existing connections");
        if (cancelled) return;
        const emails = new Set(
          (data?.connections || data || [])
            .map((c) => String(c.email || "").toLowerCase())
            .filter(Boolean)
        );
        setExistingEmails(emails);
      } catch {
        // noop — dedup is best-effort
      }
    };
    void loadExisting();
    return () => { cancelled = true; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const restore = async () => {
      setError(null);
      setJobRestoreNotice(null);
      try {
        const storedJobId = typeof window !== "undefined"
          ? window.localStorage.getItem(storageKey)
          : null;
        if (storedJobId) {
          const { res, data } = await fetchJob(storedJobId);
          if (!cancelled && res.ok && data?.job && data.recoverable) {
            setActiveJob(data.job);
            setJobRestoreNotice("Restored the active bulk login job.");
            return;
          }
        }
        const latest = await fetchLatestJob();
        if (!cancelled && latest.res.ok && latest.data?.job) {
          setActiveJob(latest.data.job);
          setJobRestoreNotice("Restored the latest recoverable bulk login job.");
          if (typeof window !== "undefined") {
            window.localStorage.setItem(storageKey, latest.data.job.jobId);
          }
        }
      } catch {
        if (!cancelled) setJobRestoreNotice(null);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, [isOpen, storageKey]);

  useEffect(() => {
    if (!isOpen || !activeJob?.jobId || finishedJob) return undefined;
    const interval = window.setInterval(async () => {
      try {
        const { res, data } = await fetchJob(activeJob.jobId);
        if (res.ok && data?.job) {
          setActiveJob(data.job);
          if (typeof window !== "undefined") {
            window.localStorage.setItem(storageKey, data.job.jobId);
          }
          if (TERMINAL_JOB_STATUSES.has(data.job.status) && !completedRefreshJobsRef.current.has(data.job.jobId)) {
            completedRefreshJobsRef.current.add(data.job.jobId);
            onSuccess?.();
          }
        }
      } catch {
        // noop
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [activeJob?.jobId, finishedJob, isOpen, onSuccess, storageKey]);

  const handleStartBulk = async () => {
    if (!slicedDotTrickLines.length) {
      setError("Please enter at least one email:password or email|password line");
      return;
    }
    setImporting(true);
    setError(null);
    setJobRestoreNotice(null);
    try {
      const postBody = {
        accounts: slicedDotTrickLines,
        concurrency: autoConcurrency
          ? "auto"
          : Number.parseInt(concurrency, 10) || DEFAULT_CONCURRENCY,
        engine,
      };
      if (proxyPoolId) {
        postBody.proxyPoolId = proxyPoolId;
      } else if (proxyUrl.trim()) {
        postBody.proxyUrl = proxyUrl.trim();
      }
      const res = await fetch("/api/oauth/qwen-cloud/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody),
      });
      const data = await readJsonResponse(res, "Bulk account import failed");
      if (!res.ok || data.error) {
        const invalidHint = Array.isArray(data.invalidLines) && data.invalidLines.length > 0
          ? ` Invalid lines: ${data.invalidLines.join(", ")}`
          : "";
        throw new Error((data.error || "Bulk account import failed") + invalidHint);
      }
      setActiveJob(data.job || null);
      if (data.job?.jobId) {
        completedRefreshJobsRef.current.delete(data.job.jobId);
        if (typeof window !== "undefined") window.localStorage.setItem(storageKey, data.job.jobId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleCancelJob = async () => {
    if (!activeJob?.jobId) return;
    try {
      const res = await fetch(`/api/oauth/qwen-cloud/bulk-import/${activeJob.jobId}/cancel`, {
        method: "POST",
      });
      const data = await readJsonResponse(res, "Failed to cancel job");
      if (!res.ok || data.error) throw new Error(data.error || "Failed to cancel job");
      if (data.job) setActiveJob(data.job);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleOpenManualSession = async (workerId) => {
    if (!activeJob?.jobId || !workerId) return;
    try {
      const res = await fetch(`/api/oauth/qwen-cloud/bulk-import/${activeJob.jobId}/manual/${workerId}`, {
        method: "POST",
      });
      const data = await readJsonResponse(res, "Failed to open manual session");
      if (!res.ok || data.error) throw new Error(data.error || "Failed to open manual session");
      if (data.job) setActiveJob(data.job);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDoneRefresh = () => {
    resetState();
    onSuccess?.();
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Qwen Cloud Bulk GSuite Auto Login"
      onClose={onClose}
      size="full"
      className="max-w-[min(96vw,1320px)]"
    >
      <div className="flex flex-col gap-4">
        {!activeJob && (
          <>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Bulk {serviceName} login runs browser workers in the background. Use Gmail accounts for dot trick multiplication. One account per line: <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">email:password</code> or <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">email|password</code>. Lines starting with <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">#</code> are skipped. Accounts that hit CAPTCHA, 2FA, or recovery prompts move to manual assist.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Bulk Accounts <span className="text-red-500">*</span>
              </label>
              <textarea
                value={bulkText}
                onChange={(event) => setBulkText(event.target.value)}
                placeholder={"gmail1@gmail.com:password1\ngmail2@gmail.com|password2\n# comment lines are skipped"}
                className="min-h-[180px] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-text-muted">
                One account per line. Supported formats: email:password, email|password, or tab-separated. Gmail recommended for dot trick.
              </p>
              {(() => {
                const allParsed = parseBulkLines(bulkText);
                const skipped = allParsed.filter((c) => existingEmails.has(c.email.toLowerCase()));
                if (!skipped.length) return null;
                return (
                  <p className="mt-1 text-xs text-amber-500">
                    {skipped.length} account{skipped.length > 1 ? "s" : ""} already in pool — skipped: {skipped.slice(0, 3).map((c) => c.email).join(", ")}{skipped.length > 3 ? ` +${skipped.length - 3} more` : ""}
                  </p>
                );
              })()}
            </div>

            {parsedCredentials.length > 0 && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-primary">auto_fix_high</span>
                  <span className="text-sm font-semibold text-text-main">Gmail Dot Trick</span>
                  <Badge variant="info" size="sm">{dotTrickStats.total} total</Badge>
                  {dotTrickStats.sliced < dotTrickStats.total && (
                    <Badge variant="warning" size="sm">{dotTrickStats.sliced} will run</Badge>
                  )}
                </div>
                <p className="mb-3 text-xs text-text-muted">
                  Gmail ignores dots in usernames — <code className="rounded bg-border/50 px-1">a.b.c@gmail.com</code> = <code className="rounded bg-border/50 px-1">abc@gmail.com</code>.
                  Each Gmail credential generates multiple dot variants, multiplying your account pool.
                </p>
                <div className="grid gap-2 text-xs sm:grid-cols-3">
                  <div className="rounded-lg border border-border bg-surface px-3 py-2 text-center">
                    <div className="text-lg font-bold text-primary">{dotTrickStats.credCount}</div>
                    <div className="text-text-muted">Input credentials</div>
                  </div>
                  <div className="rounded-lg border border-border bg-surface px-3 py-2 text-center">
                    <div className="text-lg font-bold text-green-400">{dotTrickStats.gmailCount}</div>
                    <div className="text-text-muted">Gmail (dot trick)</div>
                  </div>
                  <div className="rounded-lg border border-border bg-surface px-3 py-2 text-center">
                    <div className="text-lg font-bold text-text-main">{dotTrickStats.sliced}</div>
                    <div className="text-text-muted">Will run</div>
                  </div>
                </div>
                <div className="mt-3">
                  <label className="mb-1 block text-xs font-medium text-text-muted">
                    Max accounts to run <span className="text-text-muted/60">(leave empty to run all {dotTrickStats.total})</span>
                  </label>
                  <Input
                    type="number"
                    min="1"
                    max={dotTrickStats.total}
                    value={maxAccounts}
                    onChange={(event) => setMaxAccounts(event.target.value)}
                    placeholder={`Up to ${dotTrickStats.total}`}
                  />
                </div>
                {dotTrickLines.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1 text-xs font-medium text-text-muted">Preview (first 8 variants):</p>
                    <div className="max-h-[120px] overflow-y-auto rounded border border-border bg-background p-2 font-mono text-xs text-text-muted">
                      {slicedDotTrickLines.slice(0, 8).map((line, i) => (
                        <div key={i} className="truncate">{line.split("|")[0]}</div>
                      ))}
                      {slicedDotTrickLines.length > 8 && (
                        <div className="text-primary">...and {slicedDotTrickLines.length - 8} more</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="block text-sm font-medium">Concurrent Workers</label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-text-muted">
                    <input
                      type="checkbox"
                      checked={autoConcurrency}
                      onChange={(event) => {
                        const next = event.target.checked;
                        setAutoConcurrency(next);
                        if (next && systemSpecInfo?.recommended) {
                          setConcurrency(String(systemSpecInfo.recommended));
                        }
                      }}
                    />
                    Auto-detect by system spec
                  </label>
                </div>
                <Input
                  type="number"
                  min="1"
                  max="8"
                  value={autoConcurrency ? String(systemSpecInfo?.recommended ?? concurrency) : concurrency}
                  onChange={(event) => setConcurrency(event.target.value)}
                  disabled={autoConcurrency}
                  placeholder="4"
                />
                <p className="mt-1 text-xs text-text-muted">
                  {autoConcurrency
                    ? systemSpecLoading
                      ? "Detecting system specs..."
                      : systemSpecInfo
                        ? `Recommended ${systemSpecInfo.recommended} workers for this machine (${systemSpecInfo.specs.cpuCount}-core CPU, ${systemSpecInfo.specs.totalMemGb} GB RAM, limited by ${describeWorkerLimit(systemSpecInfo.limitedBy)}).`
                        : `Falling back to default ${DEFAULT_CONCURRENCY} workers.`
                    : "Manual mode. Allowed range: 1 to 8 workers."}
                </p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Browser Engine</label>
                <select
                  value={engine}
                  onChange={(event) => setEngine(event.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {ENGINE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-text-muted">
                  Camoufox is a stealth Firefox; first run downloads ~150MB.
                </p>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Network Proxy (optional)</label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Proxy Pool</label>
                  <select
                    value={proxyPoolId}
                    onChange={(event) => {
                      setProxyPoolId(event.target.value);
                      if (event.target.value) setProxyUrl("");
                    }}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">None</option>
                    {proxyPools.map((pool) => (
                      <option key={pool.id} value={pool.id} disabled={!pool.browserCompatible}>
                        {formatBrowserProxyPoolOption(pool)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Custom Proxy URL</label>
                  <Input
                    type="text"
                    value={proxyUrl}
                    onChange={(event) => setProxyUrl(event.target.value)}
                    disabled={Boolean(proxyPoolId)}
                    placeholder="http://user:pass@host:port"
                  />
                </div>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Browsers will route login traffic through the chosen proxy. Multiple URLs in a pool or custom field rotate round-robin across workers. Relay-style pools (Vercel, Cloudflare, Deno) are excluded because they only rewrite API URLs.
              </p>
            </div>
          </>
        )}

        {activeJob && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold">{serviceName} Bulk Login Job</h3>
                <p className="text-xs text-text-muted">
                  Job ID: <span className="font-mono">{activeJob.jobId}</span>
                </p>
                <p className="text-xs text-text-muted">
                  Status: <span className="font-medium">{activeJob.status}</span> | Workers: {activeJob.concurrency}
                </p>
              </div>
              <div className="flex gap-2">
                {runningJob && (
                  <Button size="sm" variant="secondary" onClick={handleCancelJob}>
                    Cancel Job
                  </Button>
                )}
                {finishedJob && (
                  <Button size="sm" onClick={handleDoneRefresh}>
                    Done & Refresh
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(activeJob.summary || {}).map(([label, value]) => (
                <div key={label} className="rounded-lg bg-sidebar px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-text-muted">{formatStepLabel(label)}</p>
                  <p className="text-lg font-semibold">{value}</p>
                </div>
              ))}
            </div>

            {activeJob.error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {activeJob.error}
              </div>
            )}

            {activeJob.summary?.needs_manual > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                Some accounts need manual assist. Open the worker session, finish the Google or {serviceName} prompts, and the job will keep polling.
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(300px,3fr)]">
              <div className="space-y-4">
                <div className="overflow-hidden rounded-xl border border-border bg-sidebar">
                  <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold">Live Browser Preview</p>
                      <p className="text-xs text-text-muted">
                        {activeJob.preview?.email || "Waiting for worker"}
                        {activeJob.preview?.workerId ? ` | Worker ${activeJob.preview.workerId}` : ""}
                      </p>
                    </div>
                    <div className="text-right text-xs text-text-muted">
                      <p>{formatStepLabel(activeJob.preview?.step)}</p>
                      <p>Updated {formatClock(activeJob.preview?.updatedAt)}</p>
                    </div>
                  </div>
                  <div className="relative bg-black/90">
                    {activeJob.preview?.imageData ? (
                      <Image
                        src={activeJob.preview.imageData}
                        alt={`Live worker preview for ${activeJob.preview.email || serviceName}`}
                        width={1440}
                        height={900}
                        unoptimized
                        className="h-[340px] w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-[340px] flex-col items-center justify-center gap-3 px-6 text-center text-slate-200">
                        <span className="material-symbols-outlined text-5xl text-primary/80">browser_updated</span>
                        <div>
                          <p className="text-base font-medium">Preview will appear when a worker opens Google or {serviceName}</p>
                          <p className="mt-1 text-sm text-slate-400">The job keeps running even when a screenshot is not available yet.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {groupedAccounts.map((group) => (
                  <div key={group.status} className="rounded-xl border border-border p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <AccountStatusBadge status={group.status} />
                        <p className="text-sm font-semibold capitalize">{formatStepLabel(group.status)}</p>
                      </div>
                      <p className="text-xs text-text-muted">{group.accounts.length} account{group.accounts.length === 1 ? "" : "s"}</p>
                    </div>
                    <div className="grid gap-3 xl:grid-cols-2">
                      {group.accounts.map((account) => (
                        <div key={`${account.email}-${account.line}`} className="rounded-xl border border-border bg-background/80 p-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{account.email}</p>
                              <p className="text-[11px] text-text-muted">
                                Line {account.line}{account.workerId ? ` | Worker ${account.workerId}` : ""} | {formatClock(account.updatedAt)}
                              </p>
                            </div>
                            <AccountStatusBadge status={account.status} />
                          </div>
                          <div className="mt-3 rounded-lg border border-border/70 bg-sidebar/70 px-3 py-2">
                            <p className="text-[11px] uppercase tracking-wide text-text-muted">Current Step</p>
                            <p className="mt-1 text-sm font-medium capitalize">{formatStepLabel(account.currentStep)}</p>
                          </div>
                          {account.error && (
                            <p className="mt-3 text-xs text-red-500">{account.error}</p>
                          )}
                          {account.manualSessionAvailable && account.workerId ? (
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                              <Button
                                size="sm"
                                variant={account.manualSessionOpened ? "secondary" : "primary"}
                                onClick={() => handleOpenManualSession(account.workerId)}
                              >
                                {account.manualSessionOpened ? "Re-open Manual Session" : "Open Manual Session"}
                              </Button>
                              <p className="text-[11px] text-text-muted">
                                Use this only for CAPTCHA, 2FA, or recovery prompts.
                              </p>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-sidebar/70">
                <div className="border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold">Live Activity Log</p>
                  <p className="text-xs text-text-muted">Worker steps update in near real time.</p>
                </div>
                <div className="max-h-[640px] space-y-3 overflow-y-auto p-4">
                  {activityItems.length === 0 && (
                    <div className="rounded-lg bg-background/70 px-3 py-4 text-sm text-text-muted">
                      Waiting for the first worker event...
                    </div>
                  )}
                  {activityItems.map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-border/70 bg-background/80 px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{entry.email}</p>
                          <p className="text-[11px] text-text-muted">
                            {entry.workerId ? `Worker ${entry.workerId}` : "Waiting"} | {formatStepLabel(entry.step)}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] text-text-muted">{formatClock(entry.at)}</span>
                      </div>
                      <p className="mt-2 text-xs text-text-muted">{entry.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {jobRestoreNotice && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
            <p className="text-sm text-amber-700 dark:text-amber-300">{jobRestoreNotice}</p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="flex gap-2">
          {!activeJob && (
            <Button onClick={handleStartBulk} fullWidth disabled={importing || !parsedCredentials.length}>
              {importing ? "Starting..." : `Start Automation (${dotTrickStats.sliced} accounts${dotTrickStats.sliced < dotTrickStats.total ? ` of ${dotTrickStats.total}` : ""})`}
            </Button>
          )}
          {activeJob && !finishedJob && (
            <Button onClick={handleCancelJob} fullWidth variant="secondary" disabled={!runningJob}>
              {runningJob ? "Cancel Running Job" : "Job Stopped"}
            </Button>
          )}
          {finishedJob && (
            <Button onClick={handleDoneRefresh} fullWidth>
              Done & Refresh Connections
            </Button>
          )}
          <Button onClick={activeJob ? resetState : onClose} variant="ghost" fullWidth>
            {activeJob ? "Clear" : "Cancel"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

QwenCloudAutomationModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
