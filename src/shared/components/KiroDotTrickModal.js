"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Badge from "./Badge";
import Button from "./Button";
import Input from "./Input";
import Modal from "./Modal";
import { readJsonResponse } from "@/shared/utils/httpResponse.js";

const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);

function formatElapsed(startedAt) {
  if (!startedAt) return "0s";
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function getJobStatusVariant(status) {
  if (status === "completed") return "success";
  if (status === "running" || status === "queued") return "info";
  if (status === "cancelled") return "default";
  return "error";
}

function StepIndicator({ step }) {
  const steps = [
    { num: 1, label: "Gmail Setup" },
    { num: 2, label: "Configuration" },
    { num: 3, label: "Progress" },
  ];
  return (
    <div className="flex items-center mb-6">
      {steps.map((s, i) => {
        const isDone = step > s.num;
        const isActive = step === s.num;
        return (
          <div key={s.num} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={[
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all",
                  isDone
                    ? "bg-green-500 border-green-500 text-white"
                    : isActive
                    ? "bg-brand-500 border-brand-500 text-white"
                    : "bg-surface-2 border-border text-text-muted",
                ].join(" ")}
              >
                {isDone ? "✓" : s.num}
              </div>
              <span
                className={[
                  "text-[10px] font-medium whitespace-nowrap",
                  isActive ? "text-brand-500" : isDone ? "text-green-500" : "text-text-muted",
                ].join(" ")}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={[
                  "flex-1 border-t-2 mb-4 mx-2",
                  step > s.num ? "border-green-500" : "border-border",
                ].join(" ")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SectionCard({ title, hint, children }) {
  return (
    <div className="rounded-xl border border-border bg-sidebar/70 mb-4">
      <div className="px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-text-main">{title}</span>
        {hint && <p className="text-xs text-text-muted mt-0.5">{hint}</p>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
export default function KiroDotTrickModal({ isOpen, onClose, onSuccess }) {
  const [step, setStep] = useState(1);

  // Step 1 — Credentials
  const [credJson, setCredJson] = useState("");
  const [credLabel, setCredLabel] = useState("");
  const [credJsonError, setCredJsonError] = useState("");
  const [savingCred, setSavingCred] = useState(false);
  const [credentials, setCredentials] = useState([]);
  const [deletingCredId, setDeletingCredId] = useState(null);

  // Step 1 — Gmail accounts
  const [gmailAccounts, setGmailAccounts] = useState([]);
  const [showAuthorizeRow, setShowAuthorizeRow] = useState(false);
  const [selectedCredId, setSelectedCredId] = useState("");
  const [authorizingGmail, setAuthorizingGmail] = useState(false);
  const [revokingEmail, setRevokingEmail] = useState(null);

  // Step 2 — Config
  const [mode, setMode] = useState("merge");
  const [accountsJsonText, setAccountsJsonText] = useState("");
  const [accountsJsonError, setAccountsJsonError] = useState("");
  const [accountsJsonParsed, setAccountsJsonParsed] = useState(null);
  const [selectedEmails, setSelectedEmails] = useState([]);
  const [count, setCount] = useState("0");
  const [concurrency, setConcurrency] = useState(2);
  const [loginCooldown, setLoginCooldown] = useState("60");
  const [headless, setHeadless] = useState(true);
  const [proxyUrls, setProxyUrls] = useState("");
  const [startError, setStartError] = useState("");
  const [starting, setStarting] = useState(false);

  // Step 3 — Job
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [elapsed, setElapsed] = useState("0s");

  const logContainerRef = useRef(null);
  const popupRef = useRef(null);
  const pollAccountsRef = useRef(null);
  const pollJobRef = useRef(null);
  const elapsedRef = useRef(null);

  // ─── helpers ───────────────────────────────────────────────────────────────

  const isActiveJob = job && ACTIVE_JOB_STATUSES.has(job.status);
  const isTerminalJob = job && TERMINAL_JOB_STATUSES.has(job.status);
  const validAccounts = gmailAccounts.filter((a) => a.isValid);
  const totalVariants = gmailAccounts.reduce((s, a) => s + (a.dotVariantCount || 0), 0);

  const stopAccountsPoll = useCallback(() => {
    if (pollAccountsRef.current) {
      clearInterval(pollAccountsRef.current);
      pollAccountsRef.current = null;
    }
  }, []);

  const stopJobPoll = useCallback(() => {
    if (pollJobRef.current) {
      clearInterval(pollJobRef.current);
      pollJobRef.current = null;
    }
  }, []);

  // ─── fetch credentials ──────────────────────────────────────────────────────

  const fetchCredentials = useCallback(async () => {
    try {
      const res = await fetch("/api/oauth/kiro/gmail-credentials", { cache: "no-store" });
      const data = await readJsonResponse(res, "Failed to fetch credentials");
      setCredentials(data.credentials || []);
    } catch {
      // silently ignore
    }
  }, []);

  // ─── fetch gmail accounts ───────────────────────────────────────────────────

  const fetchGmailAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/oauth/kiro/gmail-accounts", { cache: "no-store" });
      const data = await readJsonResponse(res, "Failed to fetch gmail accounts");
      const accounts = data.accounts || [];
      setGmailAccounts(accounts);
      setSelectedEmails(accounts.filter((a) => a.isValid).map((a) => a.email));
    } catch {
      // silently ignore
    }
  }, []);

  // ─── on open: check for existing job ───────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const init = async () => {
      await Promise.all([fetchCredentials(), fetchGmailAccounts()]);
      if (cancelled) return;

      try {
        const res = await fetch("/api/oauth/kiro/dot-trick", { cache: "no-store" });
        const data = await readJsonResponse(res, "Failed to check existing job");
        if (cancelled) return;
        if (data.found && data.job && ACTIVE_JOB_STATUSES.has(data.job.status)) {
          setJob(data.job);
          setJobId(data.job.jobId);
          setStep(3);
        }
      } catch {
        // ignore — no job running
      }
    };

    init();
    return () => { cancelled = true; };
  }, [isOpen, fetchCredentials, fetchGmailAccounts]);

  // Derive selectedEmails directly — all valid accounts are selected by default
  const selectedEmailsDefault = validAccounts.map((a) => a.email);

  // ─── poll job ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!jobId || step !== 3) return;
    if (job && TERMINAL_JOB_STATUSES.has(job.status)) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/oauth/kiro/dot-trick/${jobId}`, { cache: "no-store" });
        const data = await readJsonResponse(res, "Failed to poll job");
        if (data.found && data.job) setJob(data.job);
      } catch {
        // ignore transient errors
      }
    };

    poll();
    pollJobRef.current = setInterval(poll, 2000);
    return () => stopJobPoll();
  }, [jobId, step, stopJobPoll]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── stop job poll when terminal ──────────────────────────────────────────

  useEffect(() => {
    if (job && TERMINAL_JOB_STATUSES.has(job.status)) {
      stopJobPoll();
    }
  }, [job, stopJobPoll]);

  // ─── elapsed timer ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!job || !ACTIVE_JOB_STATUSES.has(job.status)) return;
    elapsedRef.current = setInterval(() => {
      setElapsed(formatElapsed(job.startedAt));
    }, 1000);
    return () => clearInterval(elapsedRef.current);
  }, [job?.status, job?.startedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── auto-scroll log ───────────────────────────────────────────────────────

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [job?.logs?.length]);

  // ─── cleanup on close ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) {
      stopJobPoll();
      stopAccountsPoll();
      if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
      clearInterval(elapsedRef.current);
    }
  }, [isOpen, stopJobPoll, stopAccountsPoll]);

  // ─── actions ───────────────────────────────────────────────────────────────

  const handleSaveCredential = useCallback(async () => {
    setCredJsonError("");
    let parsed;
    try {
      parsed = JSON.parse(credJson);
    } catch {
      setCredJsonError("Invalid JSON — paste the full contents of client_secret.json");
      return;
    }
    if (!parsed) return;
    setSavingCred(true);
    try {
      const res = await fetch("/api/oauth/kiro/gmail-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: credJson, label: credLabel || undefined }),
      });
      await readJsonResponse(res, "Failed to save credential");
      setCredJson("");
      setCredLabel("");
      await fetchCredentials();
    } catch (e) {
      setCredJsonError(e.message || "Failed to save credential");
    } finally {
      setSavingCred(false);
    }
  }, [credJson, credLabel, fetchCredentials]);

  const handleDeleteCredential = useCallback(async (id) => {
    setDeletingCredId(id);
    try {
      const res = await fetch(`/api/oauth/kiro/gmail-credentials/${id}`, { method: "DELETE" });
      await readJsonResponse(res, "Failed to delete credential");
      await fetchCredentials();
    } catch {
      // ignore
    } finally {
      setDeletingCredId(null);
    }
  }, [fetchCredentials]);

  const handleRevokeAccount = useCallback(async (email) => {
    setRevokingEmail(email);
    try {
      const res = await fetch(`/api/oauth/kiro/gmail-accounts/${encodeURIComponent(email)}`, { method: "DELETE" });
      await readJsonResponse(res, "Failed to revoke account");
      await fetchGmailAccounts();
    } catch {
      // ignore
    } finally {
      setRevokingEmail(null);
    }
  }, [fetchGmailAccounts]);

  const handleAuthorizeGmail = useCallback(async (credId, reauth = false) => {
    if (!credId) return;
    setAuthorizingGmail(true);
    try {
      const url = `/api/oauth/kiro/gmail-authorize?credential_id=${encodeURIComponent(credId)}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await readJsonResponse(res, "Failed to get auth URL");
      const popup = window.open(data.authUrl, "_blank", "width=520,height=640");
      popupRef.current = popup;

      // Poll accounts every 3s while popup is open
      const existingEmails = new Set(gmailAccounts.map((a) => a.email));
      pollAccountsRef.current = setInterval(async () => {
        if (!popup || popup.closed) {
          stopAccountsPoll();
          setAuthorizingGmail(false);
          return;
        }
        await fetchGmailAccounts();
        // Check if new account appeared
        const refreshed = await fetch("/api/oauth/kiro/gmail-accounts", { cache: "no-store" });
        const d = await refreshed.json();
        const newAccounts = (d.accounts || []).filter((a) => !existingEmails.has(a.email));
        if (newAccounts.length > 0) {
          stopAccountsPoll();
          setAuthorizingGmail(false);
          await fetchGmailAccounts();
        }
      }, 3000);
    } catch (e) {
      setAuthorizingGmail(false);
    }
  }, [gmailAccounts, fetchGmailAccounts, stopAccountsPoll]);

  const handleStartJob = useCallback(async () => {
    setStartError("");
    // Validate
    if (mode !== "login-only" && selectedEmails.length === 0) {
      setStartError("Select at least one Gmail account");
      return;
    }
    if (mode === "login-only" && !accountsJsonParsed) {
      setStartError("Upload and parse a valid accounts.json file");
      return;
    }

    const parsedProxies = proxyUrls
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const body = {
      mode,
      gmailAccounts: mode !== "login-only" ? selectedEmails : [],
      count: parseInt(count, 10) || 0,
      concurrency,
      headless,
      loginCooldownMs: parseInt(loginCooldown, 10) * 1000 || 60000,
      proxyUrls: parsedProxies,
    };
    if (mode === "login-only") body.accountsJson = accountsJsonParsed;

    setStarting(true);
    try {
      const res = await fetch("/api/oauth/kiro/dot-trick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJsonResponse(res, "Failed to start job");
      setJob(data.job);
      setJobId(data.job.jobId);
      setStep(3);
    } catch (e) {
      setStartError(e.message || "Failed to start job");
    } finally {
      setStarting(false);
    }
  }, [mode, selectedEmails, accountsJsonParsed, proxyUrls, count, concurrency, headless, loginCooldown]);

  const handleCancelJob = useCallback(async () => {
    if (!jobId) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/oauth/kiro/dot-trick/${jobId}/cancel`, { method: "POST" });
      await readJsonResponse(res, "Failed to cancel job");
    } catch {
      // ignore
    } finally {
      setCancelling(false);
    }
  }, [jobId]);

  const handleDownload = useCallback(() => {
    if (!jobId) return;
    window.location.href = `/api/oauth/kiro/dot-trick/${jobId}/download`;
  }, [jobId]);

  const handleReset = useCallback(() => {
    setStep(1);
    setJob(null);
    setJobId(null);
    setStartError("");
    stopJobPoll();
  }, [stopJobPoll]);

  const handleClose = useCallback(() => {
    stopJobPoll();
    stopAccountsPoll();
    onClose();
  }, [onClose, stopJobPoll, stopAccountsPoll]);

  // ─── render step 1 ─────────────────────────────────────────────────────────

  const renderStep1 = () => (
    <div>
      {/* Panel A — GCP Credentials */}
      <SectionCard
        title="GCP OAuth Credentials"
        hint="Download client_secret.json from Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs → Download JSON. Scope required: gmail.readonly"
      >
        <div className="space-y-3">
          <div>
            <label className="mb-2 block text-sm font-medium">Paste client_secret.json contents</label>
            <textarea
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              rows={5}
              value={credJson}
              onChange={(e) => { setCredJson(e.target.value); setCredJsonError(""); }}
              placeholder='{"installed":{"client_id":"...","client_secret":"..."}}'
            />
            {credJsonError && <p className="text-xs text-red-500 mt-1">{credJsonError}</p>}
          </div>
          <Input
            label="Label (optional)"
            placeholder="e.g. My GCP Project"
            value={credLabel}
            onChange={(e) => setCredLabel(e.target.value)}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={savingCred}
            onClick={handleSaveCredential}
            disabled={!credJson.trim() || savingCred}
          >
            Save Credential
          </Button>
        </div>

        {credentials.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-text-muted font-medium uppercase tracking-wide">Saved Credentials</p>
            {credentials.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-border/70 bg-background/80 px-3 py-2">
                <span className="text-sm text-text-main">
                  {c.label || "Unnamed"}{" "}
                  <span className="text-xs text-text-muted">(client_id: {String(c.clientId || "").slice(0, 20)}…)</span>
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  loading={deletingCredId === c.id}
                  onClick={() => handleDeleteCredential(c.id)}
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Panel B — Gmail Accounts */}
      <SectionCard
        title="Gmail Accounts"
        hint="Gmail dot trick: Google treats na.me@gmail.com and name@gmail.com as the same inbox. Each dot variant registers as a separate Kiro account."
      >
        <div className="space-y-3">
          {gmailAccounts.length === 0 ? (
            <p className="text-xs text-text-muted">No Gmail accounts linked yet.</p>
          ) : (
            <div className="space-y-2">
              {gmailAccounts.map((acc) => (
                <div key={acc.email} className="flex items-center justify-between rounded-lg border border-border/70 bg-background/80 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-text-main truncate">{acc.email}</span>
                    {acc.isValid ? (
                      <Badge variant="success" size="sm">✓ valid</Badge>
                    ) : (
                      <Badge variant="warning" size="sm">⚠ expired</Badge>
                    )}
                    <span className="text-xs text-text-muted whitespace-nowrap">~{acc.dotVariantCount || 0} variants</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      loading={authorizingGmail}
                      onClick={() => {
                        const cred = credentials.find((c) => c.id === acc.credentialId) || credentials[0];
                        if (cred) handleAuthorizeGmail(cred.id, true);
                      }}
                      disabled={credentials.length === 0}
                    >
                      Re-auth
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={revokingEmail === acc.email}
                      onClick={() => handleRevokeAccount(acc.email)}
                    >
                      Revoke
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Authorize new account row */}
          {!showAuthorizeRow ? (
            <Button
              variant="secondary"
              size="sm"
              icon="add"
              onClick={() => setShowAuthorizeRow(true)}
              disabled={credentials.length === 0}
            >
              Authorize Gmail Account
            </Button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={selectedCredId}
                onChange={(e) => setSelectedCredId(e.target.value)}
              >
                <option value="">— Select credential —</option>
                {credentials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label || "Unnamed"} ({String(c.clientId || "").slice(0, 20)}…)
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={authorizingGmail}
                  onClick={() => handleAuthorizeGmail(selectedCredId)}
                  disabled={!selectedCredId || authorizingGmail}
                >
                  Authorize
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowAuthorizeRow(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {totalVariants > 0 && (
            <p className="text-xs text-text-muted mt-2">
              ~{totalVariants} combinations from {gmailAccounts.length} account{gmailAccounts.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </SectionCard>

      <div className="flex justify-end mt-4">
        <Button
          variant="primary"
          onClick={() => setStep(2)}
          disabled={validAccounts.length === 0}
          iconRight="arrow_forward"
        >
          Next
        </Button>
      </div>
    </div>
  );

  // ─── render step 2 ─────────────────────────────────────────────────────────

  const renderStep2 = () => {
    const eligibleAccounts = accountsJsonParsed
      ? (Array.isArray(accountsJsonParsed) ? accountsJsonParsed : Object.values(accountsJsonParsed).flat())
          .filter((a) => !a.suspended)
      : [];

    return (
      <div>
        <SectionCard title="Job Configuration">
          <div className="space-y-4">
            {/* Mode radio */}
            <div>
              <label className="mb-2 block text-sm font-medium">Mode</label>
              <div className="flex flex-col gap-2">
                {[
                  { value: "merge", label: "Register + Login", desc: "Register new accounts, then log in" },
                  { value: "register-only", label: "Register Only", desc: "Only register, no login" },
                  { value: "login-only", label: "Login Only", desc: "Login to existing accounts from accounts.json" },
                ].map((opt) => (
                  <label key={opt.value} className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="radio"
                      name="mode"
                      value={opt.value}
                      checked={mode === opt.value}
                      onChange={() => setMode(opt.value)}
                      className="mt-0.5 accent-brand-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-text-main">{opt.label}</span>
                      <p className="text-xs text-text-muted">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* accounts.json drop zone — login-only mode */}
            {mode === "login-only" && (
              <div>
                <label className="mb-2 block text-sm font-medium">accounts.json</label>
                <div
                  className="rounded-lg border-2 border-dashed border-border px-4 py-6 text-center cursor-pointer hover:border-brand-500/50 transition-colors"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      try {
                        const parsed = JSON.parse(ev.target.result);
                        setAccountsJsonParsed(parsed);
                        setAccountsJsonText(ev.target.result);
                        setAccountsJsonError("");
                      } catch {
                        setAccountsJsonError("Invalid JSON in accounts.json");
                        setAccountsJsonParsed(null);
                      }
                    };
                    reader.readAsText(file);
                  }}
                  onClick={() => document.getElementById("accounts-json-input").click()}
                >
                  <input
                    id="accounts-json-input"
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        try {
                          const parsed = JSON.parse(ev.target.result);
                          setAccountsJsonParsed(parsed);
                          setAccountsJsonText(ev.target.result);
                          setAccountsJsonError("");
                        } catch {
                          setAccountsJsonError("Invalid JSON in accounts.json");
                          setAccountsJsonParsed(null);
                        }
                      };
                      reader.readAsText(file);
                    }}
                  />
                  {accountsJsonParsed ? (
                    <p className="text-sm text-green-500">
                      ✓ {eligibleAccounts.length} accounts eligible
                      {accountsJsonParsed && (Array.isArray(accountsJsonParsed) ? accountsJsonParsed : Object.values(accountsJsonParsed).flat()).filter((a) => a.suspended).length > 0 &&
                        `, ${(Array.isArray(accountsJsonParsed) ? accountsJsonParsed : Object.values(accountsJsonParsed).flat()).filter((a) => a.suspended).length} suspended filtered out`}
                    </p>
                  ) : (
                    <p className="text-sm text-text-muted">Drop accounts.json here or click to browse</p>
                  )}
                </div>
                {accountsJsonError && <p className="text-xs text-red-500 mt-1">{accountsJsonError}</p>}
              </div>
            )}

            {/* Gmail accounts checkboxes */}
            {mode !== "login-only" && (
              <div>
                <label className="mb-2 block text-sm font-medium">Gmail Accounts</label>
                <div className="space-y-1.5 max-h-48 overflow-y-auto rounded-lg border border-border p-2">
                  {validAccounts.length === 0 ? (
                    <p className="text-xs text-text-muted p-2">No valid Gmail accounts. Go back and authorize one.</p>
                  ) : (
                    validAccounts.map((acc) => (
                      <label key={acc.email} className="flex items-center gap-2 cursor-pointer px-2 py-1 rounded hover:bg-surface-2">
                        <input
                          type="checkbox"
                          checked={selectedEmails.includes(acc.email)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedEmails((prev) => [...prev, acc.email]);
                            } else {
                              setSelectedEmails((prev) => prev.filter((em) => em !== acc.email));
                            }
                          }}
                          className="accent-brand-500"
                        />
                        <span className="text-sm text-text-main">{acc.email}</span>
                        <span className="text-xs text-text-muted">~{acc.dotVariantCount || 0} variants</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Count */}
            <div>
              <label className="mb-2 block text-sm font-medium">Number of Accounts</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="0"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  className="w-32 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <span className="text-xs text-text-muted">
                  0 = use full pool (~{totalVariants} accounts)
                </span>
              </div>
            </div>

            {/* Concurrency */}
            <div>
              <label className="mb-2 block text-sm font-medium">
                Concurrent Workers: <span className="text-brand-500 font-bold">{concurrency}</span>
              </label>
              <input
                type="range"
                min="1"
                max="8"
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                className="w-full accent-brand-500"
              />
              <div className="flex justify-between text-xs text-text-muted mt-1">
                <span>1</span><span>8</span>
              </div>
            </div>

            {/* Login cooldown */}
            {mode !== "register-only" && (
              <Input
                label="Login Cooldown (seconds)"
                type="number"
                min="0"
                value={loginCooldown}
                onChange={(e) => setLoginCooldown(e.target.value)}
                hint="Delay between login attempts per worker"
              />
            )}

            {/* Headless */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={headless}
                  onChange={(e) => setHeadless(e.target.checked)}
                  className="accent-brand-500"
                />
                <span className="text-sm font-medium text-text-main">Headless mode</span>
                <span className="text-xs text-text-muted">(no browser window)</span>
              </label>
            </div>

            {/* Proxy URLs */}
            <div>
              <label className="mb-2 block text-sm font-medium">Proxy URLs (optional)</label>
              <textarea
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                rows={3}
                value={proxyUrls}
                onChange={(e) => setProxyUrls(e.target.value)}
                placeholder={"http://user:pass@host:port (one per line)"}
              />
            </div>
          </div>
        </SectionCard>

        {startError && <p className="text-xs text-red-500 mb-3">{startError}</p>}

        <div className="flex items-center justify-between mt-4">
          <Button variant="secondary" icon="arrow_back" onClick={() => setStep(1)}>
            Back
          </Button>
          <Button
            variant="primary"
            loading={starting}
            onClick={handleStartJob}
            iconRight="play_arrow"
            disabled={starting}
          >
            Start Job
          </Button>
        </div>
      </div>
    );
  };

  // ─── render step 3 ─────────────────────────────────────────────────────────

  const renderStep3 = () => {
    if (!job) {
      return (
        <div className="flex items-center justify-center py-16">
          <span className="material-symbols-outlined animate-spin text-[32px] text-brand-500">progress_activity</span>
        </div>
      );
    }

    const completed = job.completedCount || 0;
    const total = job.totalCount || 0;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const stats = job.stats || {};
    const logs = (job.logs || []).filter((e) => {
      const msg = (e.message || "").toLowerCase();
      return !msg.includes("password");
    });
    const canDownload =
      (job.mode === "register-only" || job.mode === "merge") &&
      ((stats.regAndLogin || 0) + (stats.regOnly || 0) > 0 || completed > 0);

    return (
      <div>
        {/* Job header */}
        <div className="rounded-xl border border-border bg-sidebar/70 mb-4">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-text-main">Job Progress</span>
              <Badge variant={getJobStatusVariant(job.status)} size="sm" dot>
                {job.status}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {isActiveJob && (
                <Button
                  variant="danger"
                  size="sm"
                  loading={cancelling}
                  onClick={handleCancelJob}
                >
                  Cancel Job
                </Button>
              )}
              {canDownload && (
                <Button
                  variant="success"
                  size="sm"
                  icon="download"
                  onClick={handleDownload}
                >
                  Download accounts.json
                </Button>
              )}
            </div>
          </div>
          <div className="p-4 space-y-4">
            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-xs text-text-muted mb-1.5">
                <span>{completed} / {total} accounts</span>
                <span>{pct}%</span>
              </div>
              <div className="w-full h-2.5 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "✓ Reg+Login", value: stats.regAndLogin || 0, color: "text-green-500" },
                { label: "✓ Reg Only", value: stats.regOnly || 0, color: "text-blue-500" },
                { label: "⚠ Suspended", value: stats.suspended || 0, color: "text-yellow-500" },
                { label: "✗ Failed", value: stats.failed || 0, color: "text-red-500" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-center">
                  <div className={`text-xl font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="text-xs text-text-muted mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Job info */}
            <div className="flex flex-wrap gap-4 text-xs text-text-muted">
              <span>Mode: <span className="text-text-main font-medium">{job.mode || "—"}</span></span>
              <span>Workers: <span className="text-text-main font-medium">{job.concurrency || "—"}</span></span>
              <span>Elapsed: <span className="text-text-main font-medium">{isActiveJob ? elapsed : formatElapsed(job.startedAt)}</span></span>
            </div>
          </div>
        </div>

        {/* Worker log */}
        <div className="rounded-xl border border-border bg-sidebar/70 mb-4">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-text-main">Worker Log</span>
            <span className="ml-2 text-xs text-text-muted">({logs.length} entries)</span>
          </div>
          <div
            ref={logContainerRef}
            className="max-h-[400px] overflow-y-auto p-4 space-y-1 font-mono text-xs"
          >
            {logs.length === 0 ? (
              <p className="text-text-muted">No log entries yet…</p>
            ) : (
              logs.map((entry, i) => (
                <div key={i} className="flex gap-2 leading-relaxed">
                  <span className="text-text-muted shrink-0">
                    {entry.ts ? new Date(entry.ts).toLocaleTimeString() : ""}
                  </span>
                  <span className="text-brand-500 shrink-0">[{entry.worker || "?"}]</span>
                  <span className="text-text-main break-all">{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Terminal actions */}
        {isTerminalJob && (
          <div className="flex items-center justify-end gap-3 mt-4">
            <Button variant="secondary" onClick={handleReset}>
              Run Again
            </Button>
            <Button variant="primary" onClick={handleClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    );
  };

  // ─── main render ───────────────────────────────────────────────────────────

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Kiro Dot Trick"
      size="full"
    >
      <div className="p-6 max-h-[80vh] overflow-y-auto">
        <StepIndicator step={step} />
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
      </div>
    </Modal>
  );
}
