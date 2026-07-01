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
const DEFAULT_COOLDOWN_SECONDS = 60;
const DEFAULT_ENGINE = "camoufox";
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "needs_manual"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);
const ENGINE_OPTIONS = [
  { value: "chromium", label: "Chromium (default, fast)" },
  { value: "camoufox", label: "Camoufox (stealth Firefox, slower)" },
];

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

AccountStatusBadge.propTypes = {
  status: PropTypes.string,
};

export default function KiroDotTrickModal({ isOpen, onClose, onSuccess }) {
  // Step: 1 = Gmail Setup, 2 = Configure, 3 = Running/Results
  const [step, setStep] = useState(1);

  // Step 1 — Gmail accounts
  const [gmailAccounts, setGmailAccounts] = useState([]);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState(new Set());

  // Step 1 — Gmail credentials (for OAuth authorize)
  const [credentials, setCredentials] = useState([]);
  const [selectedCredentialId, setSelectedCredentialId] = useState("");
  const [authorizing, setAuthorizing] = useState(false);

  // Step 2 — Configuration
  const [engine, setEngine] = useState(DEFAULT_ENGINE);
  const [count, setCount] = useState("0");
  const [concurrency, setConcurrency] = useState(String(DEFAULT_CONCURRENCY));
  const [cooldown, setCooldown] = useState(String(DEFAULT_COOLDOWN_SECONDS));
  const [proxyPoolId, setProxyPoolId] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyPools, setProxyPools] = useState([]);
  const [starting, setStarting] = useState(false);
  const [headless, setHeadless] = useState(true);

  // Step 3 — Active job
  const [activeJob, setActiveJob] = useState(null);

  // Shared
  const [error, setError] = useState(null);
  const completedJobsRef = useRef(new Set());
  const pollRef = useRef(null);

  const runningJob = activeJob && ACTIVE_JOB_STATUSES.has(activeJob.status);
  const finishedJob = activeJob && TERMINAL_JOB_STATUSES.has(activeJob.status);

  const activityItems = useMemo(
    () => [...(activeJob?.activity || [])].reverse(),
    [activeJob]
  );

  const accountSummary = useMemo(() => {
    const s = activeJob?.summary || {};
    return [
      { label: "Queued", value: s.queued ?? 0 },
      { label: "Running", value: s.running ?? 0 },
      { label: "Success", value: s.success ?? 0 },
      { label: "Failed", value: s.failed ?? 0 },
      { label: "Cancelled", value: s.cancelled ?? 0 },
      { label: "Total", value: s.total ?? 0 },
    ];
  }, [activeJob]);

  // --- Reset ---
  const resetState = useCallback(() => {
    setStep(1);
    setGmailAccounts([]);
    setSelectedEmails(new Set());
    setCredentials([]);
    setSelectedCredentialId("");
    setCount("0");
    setConcurrency(String(DEFAULT_CONCURRENCY));
    setCooldown(String(DEFAULT_COOLDOWN_SECONDS));
    setEngine(DEFAULT_ENGINE);
    setProxyPoolId("");
    setProxyUrl("");
    setHeadless(true);
    setActiveJob(null);
    setError(null);
    setStarting(false);
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  // --- Load gmail accounts ---
  const loadGmailAccounts = useCallback(async () => {
    setGmailLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/oauth/kiro/gmail-accounts", { cache: "no-store" });
      const data = await readJsonResponse(res, "Failed to fetch Gmail accounts");
      if (!res.ok) throw new Error(data.error || "Failed to fetch Gmail accounts");
      const accounts = Array.isArray(data.accounts) ? data.accounts : [];
      setGmailAccounts(accounts);
      // Auto-select all valid accounts
      setSelectedEmails(new Set(accounts.filter((a) => a.isValid).map((a) => a.email)));
    } catch (err) {
      setError(err.message);
    } finally {
      setGmailLoading(false);
    }
  }, []);

  // --- Load credentials ---
  const loadCredentials = useCallback(async () => {
    try {
      const res = await fetch("/api/oauth/kiro/gmail-credentials", { cache: "no-store" });
      if (!res.ok) return;
      const data = await readJsonResponse(res, "Failed to fetch credentials");
      const creds = Array.isArray(data.credentials) ? data.credentials : [];
      setCredentials(creds);
      if (creds.length > 0 && !selectedCredentialId) {
        setSelectedCredentialId(creds[0].id);
      }
    } catch {
      // noop
    }
  }, [selectedCredentialId]);

  // --- Load proxy pools ---
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
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
    void load();
    return () => { cancelled = true; };
  }, [isOpen]);

  // --- On open: restore latest active job or load gmail accounts ---
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const restore = async () => {
      setError(null);
      try {
        const res = await fetch("/api/oauth/kiro/dot-trick", { cache: "no-store" });
        const data = await readJsonResponse(res, "Failed to check latest job");
        if (cancelled) return;
        const ACTIVE_STATUSES = ["running", "queued", "needs_manual"];
        if (res.ok && data.found && data.job && ACTIVE_STATUSES.includes(data.job.status)) {
          setActiveJob(data.job);
          setStep(3);
          return;
        }
      } catch {
        // noop — fall through to gmail accounts
      }
      if (!cancelled) {
        void loadGmailAccounts();
        void loadCredentials();
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, [isOpen, loadGmailAccounts, loadCredentials]);

  // --- Polling (Step 3) ---
  useEffect(() => {
    if (!isOpen || !activeJob?.jobId || finishedJob) return undefined;

    const interval = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/oauth/kiro/dot-trick/${activeJob.jobId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await readJsonResponse(res, "Poll failed");
        if (data?.job) {
          setActiveJob(data.job);
          if (
            TERMINAL_JOB_STATUSES.has(data.job.status) &&
            !completedJobsRef.current.has(data.job.jobId)
          ) {
            completedJobsRef.current.add(data.job.jobId);
            onSuccess?.();
          }
        }
      } catch {
        // Keep current snapshot; next interval can recover
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, [activeJob?.jobId, finishedJob, isOpen, onSuccess]);

  // --- Handlers ---
  const toggleEmail = (email) => {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const handleAuthorizeGmail = async () => {
    if (!selectedCredentialId) {
      setError("No Gmail credentials configured. Add a credential first.");
      return;
    }
    setAuthorizing(true);
    setError(null);
    try {
      const res = await fetch(`/api/oauth/kiro/gmail-authorize?credential_id=${selectedCredentialId}`, { cache: "no-store" });
      const data = await readJsonResponse(res, "Failed to start Gmail authorization");
      if (!res.ok || !data.authUrl) {
        throw new Error(data.error || "Failed to get authorization URL");
      }
      const popup = window.open(data.authUrl, "_blank", "noopener,noreferrer,width=600,height=700");
      // Refresh gmail accounts after popup closes or after 6s
      const checkClosed = setInterval(() => {
        if (!popup || popup.closed) {
          clearInterval(checkClosed);
          void loadGmailAccounts();
        }
      }, 1000);
      setTimeout(() => {
        clearInterval(checkClosed);
        void loadGmailAccounts();
      }, 6000);
    } catch (err) {
      setError(err.message);
    } finally {
      setAuthorizing(false);
    }
  };

  const handleStartJob = async () => {
    if (selectedEmails.size === 0) {
      setError("Select at least one Gmail account.");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const selectedProxyUrls = [];
      if (proxyUrl.trim()) {
        selectedProxyUrls.push(proxyUrl.trim());
      } else if (proxyPoolId) {
        const pool = proxyPools.find((p) => p.id === proxyPoolId);
        if (pool?.urls) selectedProxyUrls.push(...pool.urls);
      }

      const body = {
        mode: "merge",
        gmailAccounts: [...selectedEmails],
        count: Number.parseInt(count, 10) || 0,
        concurrency: Number.parseInt(concurrency, 10) || DEFAULT_CONCURRENCY,
        loginCooldownMs: (Number.parseInt(cooldown, 10) || DEFAULT_COOLDOWN_SECONDS) * 1000,
        proxyUrls: selectedProxyUrls,
        engine,
        headless,
      };

      const res = await fetch("/api/oauth/kiro/dot-trick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJsonResponse(res, "Failed to start dot-trick job");
      if (!res.ok || data.error) {
        // 409 = already running, auto-attach
        if (res.status === 409 && data.job) {
          setActiveJob(data.job);
          setStep(3);
          return;
        }
        throw new Error(data.error || "Failed to start job");
      }
      if (data.job) {
        completedJobsRef.current.delete(data.job.jobId);
        setActiveJob(data.job);
        setStep(3);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  const handleCancelJob = async () => {
    if (!activeJob?.jobId) return;
    try {
      const res = await fetch(`/api/oauth/kiro/dot-trick/${activeJob.jobId}/cancel`, {
        method: "POST",
      });
      const data = await readJsonResponse(res, "Failed to cancel job");
      if (!res.ok || data.error) throw new Error(data.error || "Failed to cancel job");
      if (data.job) setActiveJob(data.job);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDoneRefresh = () => {
    onSuccess?.();
    onClose?.();
  };

  const imageData = activeJob?.preview?.imageData;

  return (
    <Modal
      isOpen={isOpen}
      title="Kiro Dot Trick"
      onClose={onClose}
      size="full"
      className="max-w-[min(96vw,1320px)]"
    >
      <div className="flex flex-col gap-4">

        {/* Step indicator */}
        {step < 3 && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className={step === 1 ? "font-semibold text-primary" : ""}>1. Gmail Setup</span>
            <span>→</span>
            <span className={step === 2 ? "font-semibold text-primary" : ""}>2. Configure</span>
            <span>→</span>
            <span>3. Running</span>
          </div>
        )}

        {/* ───── STEP 1: Gmail Setup ───── */}
        {step === 1 && (
          <>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                The Dot Trick generates multiple Kiro accounts from a single Gmail by inserting dots
                into the address. Select which authorized Gmail accounts to use, then configure the
                job.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Authorized Gmail Accounts</p>
              <div className="flex items-center gap-2">
                {credentials.length > 1 && (
                  <select
                    value={selectedCredentialId}
                    onChange={(e) => setSelectedCredentialId(e.target.value)}
                    className="rounded border border-border bg-background px-2 py-1 text-sm"
                  >
                    {credentials.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label || c.clientId.slice(0, 20) + "..."}
                      </option>
                    ))}
                  </select>
                )}
                <Button size="sm" variant="ghost" onClick={loadGmailAccounts} disabled={gmailLoading}>
                  {gmailLoading ? "Loading..." : "Refresh"}
                </Button>
                <Button size="sm" variant="secondary" onClick={handleAuthorizeGmail} disabled={authorizing || !selectedCredentialId}>
                  <span className="material-symbols-outlined text-base">add</span>
                  {authorizing ? "Authorizing..." : "Authorize Gmail Account"}
                </Button>
              </div>
            </div>

            {credentials.length === 0 && (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                No GCP credential configured. Add one via{" "}
                <span className="font-medium">Settings → Gmail Credentials</span>{" "}
                before authorizing.
              </div>
            )}

            {gmailAccounts.length === 0 && !gmailLoading && (
              <div className="rounded-lg border border-border bg-sidebar/70 px-4 py-6 text-center">
                <span className="material-symbols-outlined text-4xl text-text-muted">mail</span>
                <p className="mt-2 text-sm text-text-muted">No Gmail accounts authorized yet.</p>
                <p className="mt-1 text-xs text-text-muted">
                  Click &quot;Authorize Gmail Account&quot; to open the OAuth flow.
                </p>
              </div>
            )}

            {gmailAccounts.length > 0 && (
              <div className="space-y-2">
                {gmailAccounts.map((acc) => (
                  <label
                    key={acc.email}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-background/80 px-4 py-3 transition-colors hover:bg-sidebar/60"
                  >
                    <input
                      type="checkbox"
                      checked={selectedEmails.has(acc.email)}
                      onChange={() => toggleEmail(acc.email)}
                      className="h-4 w-4 rounded accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{acc.email}</p>
                      {acc.credentialLabel && (
                        <p className="text-xs text-text-muted">{acc.credentialLabel}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {acc.dotVariantCount != null && (
                        <Badge variant="info" size="sm">
                          {acc.dotVariantCount} variants
                        </Badge>
                      )}
                      <Badge variant={acc.isValid ? "success" : "danger"} size="sm">
                        {acc.isValid ? "Valid" : "Invalid"}
                      </Badge>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {selectedEmails.size > 0 && (
              <p className="text-xs text-text-muted">
                {selectedEmails.size} account{selectedEmails.size !== 1 ? "s" : ""} selected
              </p>
            )}
          </>
        )}

        {/* ───── STEP 2: Configure ───── */}
        {step === 2 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Accounts to Generate
                </label>
                <Input
                  type="number"
                  min="0"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  placeholder="0"
                />
                <p className="mt-1 text-xs text-text-muted">0 = use full dot-variant pool</p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Concurrent Workers (1–8)
                </label>
                <Input
                  type="number"
                  min="1"
                  max="8"
                  value={concurrency}
                  onChange={(e) => setConcurrency(e.target.value)}
                  placeholder="4"
                />
                <p className="mt-1 text-xs text-text-muted">
                  Default {DEFAULT_CONCURRENCY}. Max 8 simultaneous browser workers.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Login Cooldown (seconds)
                </label>
                <Input
                  type="number"
                  min="0"
                  value={cooldown}
                  onChange={(e) => setCooldown(e.target.value)}
                  placeholder="60"
                />
                <p className="mt-1 text-xs text-text-muted">
                  Wait between consecutive logins per worker. Default 60 s.
                </p>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Browser Engine</label>
              <select
                value={engine}
                onChange={(event) => setEngine(event.target.value)}
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                disabled={starting}
              >
                {ENGINE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Network Proxy (optional)</label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Proxy Pool</label>
                  <select
                    value={proxyPoolId}
                    onChange={(e) => {
                      setProxyPoolId(e.target.value);
                      if (e.target.value) setProxyUrl("");
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
                    onChange={(e) => setProxyUrl(e.target.value)}
                    disabled={Boolean(proxyPoolId)}
                    placeholder="http://user:pass@host:port"
                  />
                </div>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Browsers route login traffic through the chosen proxy. Relay-style pools (Vercel,
                Cloudflare, Deno) are excluded.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="headless"
                checked={headless}
                onChange={(e) => setHeadless(e.target.checked)}
                className="h-4 w-4 rounded accent-primary"
                disabled={starting}
              />
              <label htmlFor="headless" className="text-sm">
                Headless mode (uncheck to see browser)
              </label>
            </div>
          </>
        )}

        {/* ───── STEP 3: Running / Results ───── */}
        {step === 3 && activeJob && (
          <div className="space-y-4">
            {/* Job header */}
            <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold">Kiro Dot Trick Job</h3>
                <p className="text-xs text-text-muted">
                  Job ID: <span className="font-mono">{activeJob.jobId}</span>
                </p>
                <p className="text-xs text-text-muted">
                  Status:{" "}
                  <span className="font-medium">{activeJob.status}</span>
                  {activeJob.concurrency ? ` | Workers: ${activeJob.concurrency}` : ""}
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
                    Done &amp; Refresh
                  </Button>
                )}
              </div>
            </div>

            {/* Summary counts */}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {accountSummary.map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-sidebar px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p>
                  <p className="text-lg font-semibold">{value}</p>
                </div>
              ))}
            </div>

            {activeJob.error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {activeJob.error}
              </div>
            )}

            {/* 2-column grid: preview left, log right */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(300px,3fr)]">
              {/* Left: live browser preview */}
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
                  {imageData ? (
                    <Image
                      src={imageData}
                      width={1440}
                      height={900}
                      unoptimized
                      className="h-[340px] w-full object-cover rounded-lg"
                      alt="Live preview"
                    />
                  ) : (
                    <div className="flex h-[340px] flex-col items-center justify-center gap-3 px-6 text-center text-slate-200">
                      <span className="material-symbols-outlined text-6xl text-primary/80">
                        browser_updated
                      </span>
                      <div>
                        <p className="text-base font-medium">
                          Preview will appear when a worker opens a browser
                        </p>
                        <p className="mt-1 text-sm text-slate-400">
                          The job keeps running even when no screenshot is available yet.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: activity log */}
              <div className="rounded-xl border border-border bg-sidebar/70">
                <div className="border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold">Live Activity Log</p>
                  <p className="text-xs text-text-muted">Worker steps update in near real time.</p>
                </div>
                <div className="max-h-[380px] space-y-3 overflow-y-auto p-4">
                  {activityItems.length === 0 && (
                    <div className="rounded-lg bg-background/70 px-3 py-4 text-sm text-text-muted">
                      Waiting for the first worker event...
                    </div>
                  )}
                  {activityItems.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-border/70 bg-background/80 px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{entry.email}</p>
                          <p className="text-[11px] text-text-muted">
                            {entry.workerId ? `Worker ${entry.workerId}` : "Waiting"}{" "}
                            | {formatStepLabel(entry.step)}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] text-text-muted">
                          {formatClock(entry.at)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-text-muted">{entry.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex gap-2">
          {step === 1 && (
            <>
              <Button
                onClick={() => {
                  if (selectedEmails.size === 0) {
                    setError("Select at least one Gmail account to continue.");
                    return;
                  }
                  setError(null);
                  setStep(2);
                }}
                fullWidth
                disabled={gmailLoading}
              >
                Next: Configure
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </>
          )}

          {step === 2 && (
            <>
              <Button onClick={() => { setError(null); setStep(1); }} variant="ghost" fullWidth>
                Back
              </Button>
              <Button onClick={handleStartJob} fullWidth disabled={starting}>
                {starting ? "Starting..." : "Start Job"}
              </Button>
            </>
          )}

          {step === 3 && activeJob && (
            <>
              {finishedJob ? (
                <Button onClick={handleDoneRefresh} fullWidth>
                  Done &amp; Refresh Connections
                </Button>
              ) : (
                <Button onClick={handleCancelJob} fullWidth variant="secondary" disabled={!runningJob}>
                  {runningJob ? "Cancel Running Job" : "Job Stopped"}
                </Button>
              )}
              <Button onClick={resetState} variant="ghost" fullWidth>
                Clear
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

KiroDotTrickModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
