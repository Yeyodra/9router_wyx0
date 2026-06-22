"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import Badge from "./Badge";
import Button from "./Button";
import Input from "./Input";
import Modal from "./Modal";

const PROVIDER = "codebuddy-cn";
const DEFAULT_ENGINE = "chromium";
const ACTIVE_STATUSES = new Set(["queued", "running", "needs_manual"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function formatStep(value) {
  return String(value || "waiting").replaceAll("_", " ");
}

function statusVariant(status) {
  if (status === "success" || status === "completed") return "success";
  if (status === "needs_manual") return "warning";
  if (status === "running" || status === "queued") return "info";
  if (status === "cancelled") return "default";
  return "danger";
}

async function fetchJob(jobId) {
  const res = await fetch(`/api/oauth/${PROVIDER}/bulk-import/${jobId}`, { cache: "no-store" });
  return { res, data: await res.json() };
}

async function fetchLatestJob() {
  const res = await fetch(`/api/oauth/${PROVIDER}/bulk-import/latest?scope=recoverable`, { cache: "no-store" });
  return { res, data: await res.json() };
}

export default function CodeBuddyCnPhoneAutomationModal({ isOpen, onClose, onSuccess }) {
  const storageKey = `${PROVIDER}-phone-import-active-job`;
  const [fiveSimToken, setFiveSimToken] = useState("");
  const [count, setCount] = useState("1");
  const [country, setCountry] = useState("hongkong");
  const [operator, setOperator] = useState("any");
  const [product, setProduct] = useState("codebuddy");
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  const active = job && ACTIVE_STATUSES.has(job.status);
  const terminal = job && TERMINAL_STATUSES.has(job.status);
  const manualAccounts = useMemo(() => (
    (job?.accounts || []).filter((account) => account.manualSessionAvailable)
  ), [job]);

  const reset = useCallback(() => {
    setJob(null);
    setError("");
    if (typeof window !== "undefined") window.localStorage.removeItem(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const restore = async () => {
      try {
        const storedJobId = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
        if (storedJobId) {
          const { res, data } = await fetchJob(storedJobId);
          if (!cancelled && res.ok && data?.job && data.recoverable) {
            setJob(data.job);
            return;
          }
        }
        const latest = await fetchLatestJob();
        if (!cancelled && latest.res.ok && latest.data?.job) {
          setJob(latest.data.job);
          if (typeof window !== "undefined") window.localStorage.setItem(storageKey, latest.data.job.jobId);
        }
      } catch {
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [isOpen, storageKey]);

  useEffect(() => {
    if (!isOpen || !job?.jobId || terminal) return undefined;
    const interval = window.setInterval(async () => {
      try {
        const { res, data } = await fetchJob(job.jobId);
        if (res.ok && data?.job) {
          setJob(data.job);
          if (typeof window !== "undefined") window.localStorage.setItem(storageKey, data.job.jobId);
          if (TERMINAL_STATUSES.has(data.job.status)) onSuccess?.();
        }
      } catch {
      }
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [isOpen, job?.jobId, onSuccess, storageKey, terminal]);

  const startJob = async () => {
    setStarting(true);
    setError("");
    try {
      const res = await fetch(`/api/oauth/${PROVIDER}/bulk-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fiveSimToken,
          count,
          country,
          operator,
          product,
          concurrency: Math.min(Number.parseInt(count, 10) || 1, 4),
          engine: DEFAULT_ENGINE,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "CodeBuddy CN phone automation failed");
      setJob(data.job);
      if (data.job?.jobId && typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, data.job.jobId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  const cancelJob = async () => {
    if (!job?.jobId) return;
    const res = await fetch(`/api/oauth/${PROVIDER}/bulk-import/${job.jobId}/cancel`, { method: "POST" });
    const data = await res.json();
    if (res.ok && data?.job) setJob(data.job);
  };

  const openManual = async (workerId) => {
    if (!job?.jobId || !workerId) return;
    const res = await fetch(`/api/oauth/${PROVIDER}/bulk-import/${job.jobId}/manual/${workerId}`, { method: "POST" });
    const data = await res.json();
    if (res.ok && data?.job) setJob(data.job);
    if (!res.ok) setError(data.error || "Failed to open manual browser session");
  };

  return (
    <Modal isOpen={isOpen} title="CodeBuddy CN 5sim Phone OTP" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {!job && (
          <>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
              Uses 5sim product <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">codebuddy</code> with Hong Kong numbers, logs in to CodeBuddy CN, then creates a natural-looking CN API key name.
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">5sim API Token <span className="text-red-500">*</span></label>
              <Input
                type="password"
                value={fiveSimToken}
                onChange={(event) => setFiveSimToken(event.target.value)}
                placeholder="Paste 5sim bearer token"
              />
              <p className="mt-1 text-xs text-text-muted">Stored only for this runtime job; it is not written into the job snapshot.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium">Number Count</label>
                <Input type="number" min="1" max="8" value={count} onChange={(event) => setCount(event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Country</label>
                <Input value={country} onChange={(event) => setCountry(event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Operator</label>
                <Input value={operator} onChange={(event) => setOperator(event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Product</label>
                <Input value={product} onChange={(event) => setProduct(event.target.value)} />
              </div>
            </div>
          </>
        )}

        {job && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-sidebar p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(job.status)}>{formatStep(job.status)}</Badge>
                    <span className="text-sm font-semibold">Job {job.jobId}</span>
                  </div>
                  <p className="mt-2 text-xs text-text-muted">
                    Success {job.summary?.success || 0}/{job.summary?.total || 0}; failed {job.summary?.failed || 0}; manual {job.summary?.needs_manual || 0}.
                  </p>
                </div>
                <div className="flex gap-2">
                  {active && <Button size="sm" variant="secondary" onClick={cancelJob}>Cancel</Button>}
                  {terminal && <Button size="sm" onClick={() => { reset(); onSuccess?.(); }}>Done</Button>}
                </div>
              </div>
            </div>

            {manualAccounts.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                Manual assist is needed. Open the browser worker, finish the phone/CAPTCHA prompt, and the job will continue.
                <div className="mt-3 flex flex-wrap gap-2">
                  {manualAccounts.map((account) => (
                    <Button key={`${account.workerId}-${account.email}`} size="sm" variant="secondary" onClick={() => openManual(account.workerId)}>
                      Open Worker {account.workerId}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {(job.accounts || []).map((account) => (
                <div key={`${account.line}-${account.email}`} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs">{account.email}</span>
                    <Badge variant={statusVariant(account.status)} size="sm">{formatStep(account.status)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">{formatStep(account.currentStep)}</p>
                  {account.error && <p className="mt-1 text-xs text-red-400">{account.error}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

        {!job && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button onClick={startJob} disabled={starting || !fiveSimToken.trim()}>
              {starting ? "Starting..." : "Start Phone OTP Automation"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

CodeBuddyCnPhoneAutomationModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func,
  onSuccess: PropTypes.func,
};
