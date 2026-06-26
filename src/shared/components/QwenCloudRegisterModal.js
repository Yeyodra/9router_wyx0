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

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_COUNT = 10;
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "needs_manual"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);
const DEFAULT_ENGINE = "chromium";
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
AccountStatusBadge.propTypes = { status: PropTypes.string };

async function fetchJob(jobId) {
  const res = await fetch(`/api/oauth/qwen-cloud/bulk-register/${jobId}`, { cache: "no-store" });
  const data = await readJsonResponse(res, "Failed to fetch registration job");
  return { res, data };
}

async function fetchLatestJob(scope = "recoverable") {
  const res = await fetch(`/api/oauth/qwen-cloud/bulk-register?scope=${encodeURIComponent(scope)}`, { cache: "no-store" });
  const data = await readJsonResponse(res, "Failed to fetch latest registration job");
  return { res, data };
}

export default function QwenCloudRegisterModal({ isOpen, onClose, onSuccess }) {
  const serviceName = "Qwen Cloud Registration";
  const storageKey = "qwen-cloud-register-active-job";
  const completedRefreshJobsRef = useRef(new Set());

  const [imapUser, setImapUser] = useState("");
  const [imapPass, setImapPass] = useState("");
  const [imapHost, setImapHost] = useState("imap.gmail.com");
  const [imapPort, setImapPort] = useState("993");
  const [emailDomain, setEmailDomain] = useState("nzr.web.id");
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  const [count, setCount] = useState(String(DEFAULT_COUNT));
  const [concurrency, setConcurrency] = useState(String(DEFAULT_CONCURRENCY));
  const [engine, setEngine] = useState(DEFAULT_ENGINE);
  const [proxyPoolId, setProxyPoolId] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyPools, setProxyPools] = useState([]);

  const [activeJob, setActiveJob] = useState(null);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [jobRestoreNotice, setJobRestoreNotice] = useState(null);

  const runningJob = activeJob && ACTIVE_JOB_STATUSES.has(activeJob.status);
  const finishedJob = activeJob && TERMINAL_JOB_STATUSES.has(activeJob.status);

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
    setActiveJob(null);
    setError(null);
    setImporting(false);
    setJobRestoreNotice(null);
    if (typeof window !== "undefined") window.localStorage.removeItem(storageKey);
  }, [storageKey]);

  // Load IMAP config on open
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/oauth/qwen-cloud/register-config", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        const cfg = data.config || {};
        if (cfg.qwen_register_imap_user) setImapUser(cfg.qwen_register_imap_user);
        if (cfg.qwen_register_imap_pass) setImapPass(cfg.qwen_register_imap_pass);
        if (cfg.qwen_register_imap_host) setImapHost(cfg.qwen_register_imap_host);
        if (cfg.qwen_register_imap_port) setImapPort(cfg.qwen_register_imap_port);
        if (cfg.qwen_register_email_domain) setEmailDomain(cfg.qwen_register_email_domain);
      } catch { /* noop */ }
    };
    void load();
    return () => { cancelled = true; };
  }, [isOpen]);

  // Load proxy pools on open
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
      } catch { /* noop */ }
    };
    void loadPools();
    return () => { cancelled = true; };
  }, [isOpen]);

  // Restore active job on open
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const restore = async () => {
      setError(null);
      setJobRestoreNotice(null);
      try {
        const storedJobId = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
        if (storedJobId) {
          const { res, data } = await fetchJob(storedJobId);
          if (!cancelled && res.ok && data?.job && data.recoverable) {
            setActiveJob(data.job);
            setJobRestoreNotice("Restored the active registration job.");
            return;
          }
        }
        const latest = await fetchLatestJob();
        if (!cancelled && latest.res.ok && latest.data?.job) {
          setActiveJob(latest.data.job);
          setJobRestoreNotice("Restored the latest recoverable registration job.");
          if (typeof window !== "undefined") window.localStorage.setItem(storageKey, latest.data.job.jobId);
        }
      } catch {
        if (!cancelled) setJobRestoreNotice(null);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, [isOpen, storageKey]);

  // Poll active job
  useEffect(() => {
    if (!isOpen || !activeJob?.jobId || finishedJob) return undefined;
    const interval = window.setInterval(async () => {
      try {
        const { res, data } = await fetchJob(activeJob.jobId);
        if (res.ok && data?.job) {
          setActiveJob(data.job);
          if (typeof window !== "undefined") window.localStorage.setItem(storageKey, data.job.jobId);
          if (TERMINAL_JOB_STATUSES.has(data.job.status) && !completedRefreshJobsRef.current.has(data.job.jobId)) {
            completedRefreshJobsRef.current.add(data.job.jobId);
            onSuccess?.();
          }
        }
      } catch { /* noop */ }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [activeJob?.jobId, finishedJob, isOpen, onSuccess, storageKey]);

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    setConfigSaved(false);
    try {
      const res = await fetch("/api/oauth/qwen-cloud/register-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qwen_register_imap_user: imapUser,
          qwen_register_imap_pass: imapPass,
          qwen_register_imap_host: imapHost,
          qwen_register_imap_port: imapPort,
          qwen_register_email_domain: emailDomain,
        }),
      });
      if (!res.ok) throw new Error("Failed to save config");
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleStartRegistration = async () => {
    const parsedCount = Number.parseInt(count, 10);
    if (!Number.isFinite(parsedCount) || parsedCount < 1) { setError("Count must be a positive integer"); return; }
    if (parsedCount > 100) { setError("Count must not exceed 100"); return; }
    setImporting(true);
    setError(null);
    setJobRestoreNotice(null);
    try {
      const postBody = {
        count: parsedCount,
        concurrency: Number.parseInt(concurrency, 10) || DEFAULT_CONCURRENCY,
        engine,
      };
      if (proxyPoolId) postBody.proxyPoolId = proxyPoolId;
      else if (proxyUrl.trim()) postBody.proxyUrl = proxyUrl.trim();
      const res = await fetch("/api/oauth/qwen-cloud/bulk-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody),
      });
      const data = await readJsonResponse(res, "Registration job failed to start");
      if (!res.ok || data.error) throw new Error(data.error || "Registration job failed to start");
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
      const res = await fetch(`/api/oauth/qwen-cloud/bulk-register/${activeJob.jobId}/cancel`, { method: "POST" });
      const data = await readJsonResponse(res, "Failed to cancel job");
      if (!res.ok || data.error) throw new Error(data.error || "Failed to cancel job");
      if (data.job) setActiveJob(data.job);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDoneRefresh = () => { resetState(); onSuccess?.(); };

  return (
    <Modal isOpen={isOpen} title="Qwen Cloud — Register New Accounts" onClose={onClose} size="full" className="max-w-[min(96vw,1320px)]">
      <div className="flex flex-col gap-4">
        {!activeJob && (
          <>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Automatically registers brand-new Alibaba Cloud accounts using random email addresses on your domain,
                verifies via IMAP OTP, then extracts Qwen Cloud API keys. Save your IMAP config before starting.
              </p>
            </div>

            <div className="rounded-xl border border-border p-4">
              <h3 className="mb-3 text-sm font-semibold">IMAP Configuration</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-muted">Email Domain</label>
                  <Input type="text" value={emailDomain} onChange={(e) => setEmailDomain(e.target.value)} placeholder="nzr.web.id" />
                  <p className="mt-1 text-xs text-text-muted">Accounts will use random10chars@{emailDomain || "yourdomain.com"}</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-muted">IMAP User</label>
                  <Input type="text" value={imapUser} onChange={(e) => setImapUser(e.target.value)} placeholder="user@gmail.com" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-muted">IMAP Password (App Password)</label>
                  <Input type="password" value={imapPass} onChange={(e) => setImapPass(e.target.value)} placeholder="xxxx xxxx xxxx xxxx" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-muted">IMAP Host</label>
                  <Input type="text" value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.gmail.com" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-muted">IMAP Port</label>
                  <Input type="number" value={imapPort} onChange={(e) => setImapPort(e.target.value)} placeholder="993" />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" variant={configSaved ? "success" : "secondary"} onClick={handleSaveConfig} disabled={configSaving}>
                  {configSaving ? "Saving..." : configSaved ? "Saved!" : "Save Config"}
                </Button>
                <p className="text-xs text-text-muted">Persisted in settings and used as default for all registration jobs.</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium">Number of Accounts <span className="text-red-500">*</span></label>
                <Input type="number" min="1" max="100" value={count} onChange={(e) => setCount(e.target.value)} placeholder="10" />
                <p className="mt-1 text-xs text-text-muted">Min 1, max 100. Each uses a fresh random email on your domain.</p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Concurrent Workers</label>
                <Input type="number" min="1" max="8" value={concurrency} onChange={(e) => setConcurrency(e.target.value)} placeholder="2" />
                <p className="mt-1 text-xs text-text-muted">Keep low (1-3) — each registration takes ~3 min including OTP wait.</p>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Browser Engine</label>
              <select value={engine} onChange={(e) => setEngine(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                {ENGINE_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Network Proxy (optional)</label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Proxy Pool</label>
                  <select value={proxyPoolId} onChange={(e) => { setProxyPoolId(e.target.value); if (e.target.value) setProxyUrl(""); }} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                    <option value="">None</option>
                    {proxyPools.map((pool) => (<option key={pool.id} value={pool.id} disabled={!pool.browserCompatible}>{formatBrowserProxyPoolOption(pool)}</option>))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Custom Proxy URL</label>
                  <Input type="text" value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} disabled={Boolean(proxyPoolId)} placeholder="http://user:pass@host:port" />
                </div>
              </div>
            </div>
          </>
        )}

        {activeJob && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold">{serviceName} Job</h3>
                <p className="text-xs text-text-muted">Job ID: <span className="font-mono">{activeJob.jobId}</span></p>
                <p className="text-xs text-text-muted">Status: <span className="font-medium">{activeJob.status}</span> | Workers: {activeJob.concurrency}</p>
              </div>
              <div className="flex gap-2">
                {runningJob && (<Button size="sm" variant="secondary" onClick={handleCancelJob}>Cancel Job</Button>)}
                {finishedJob && (<Button size="sm" onClick={handleDoneRefresh}>Done & Refresh</Button>)}
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
                      <Image src={activeJob.preview.imageData} alt={`Live worker preview`} width={1440} height={900} unoptimized className="h-[340px] w-full object-contain" />
                    ) : (
                      <div className="flex h-[340px] flex-col items-center justify-center gap-3 px-6 text-center text-slate-200">
                        <span className="material-symbols-outlined text-5xl text-primary/80">browser_updated</span>
                        <div>
                          <p className="text-base font-medium">Preview will appear when a worker opens the registration page</p>
                          <p className="mt-1 text-sm text-slate-400">The job keeps running even when no screenshot is available.</p>
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
                          {account.error && (<p className="mt-3 text-xs text-red-500">{account.error}</p>)}
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
                    <div className="rounded-lg bg-background/70 px-3 py-4 text-sm text-text-muted">Waiting for the first worker event...</div>
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
            <Button onClick={handleStartRegistration} fullWidth disabled={importing}>
              {importing ? "Starting..." : `Register ${count || DEFAULT_COUNT} Accounts`}
            </Button>
          )}
          {activeJob && !finishedJob && (
            <Button onClick={handleCancelJob} fullWidth variant="secondary" disabled={!runningJob}>
              {runningJob ? "Cancel Running Job" : "Job Stopped"}
            </Button>
          )}
          {finishedJob && (
            <Button onClick={handleDoneRefresh} fullWidth>Done & Refresh Connections</Button>
          )}
          <Button onClick={activeJob ? resetState : onClose} variant="ghost" fullWidth>
            {activeJob ? "Clear" : "Cancel"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

QwenCloudRegisterModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
