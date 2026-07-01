# Issues — kiro-dot-trick

(No issues yet — populated as tasks complete)

---

## Final QA Run — 2026-07-01 11:34:33

### Result: ALL PASS (14/14)

| Check | Status | Notes |
|-------|--------|-------|
| T1.1 kiroGmailCredentials + kiroGmailTokens in schema.js | PASS | Lines 74, 83, 95, 96 |
| T2.1 capturePreview NOT defined | PASS | 0 matches — correctly inherited from parent |
| T2.2 readOtp NOT defined locally | PASS | 0 matches — imported, not redefined |
| T2.3 verificationUri present | PASS | Lines 499-532 |
| T2.4 emailCaptcha selector present | PASS | Line 278 |
| T2.5 amazonaws suspend check | PASS | Line 429 |
| T3.1 cancel route exists | PASS | -LiteralPath required for brackets |
| T3.2 latest route exists | PASS | |
| T3.3 gmail-credentials [id] route exists | PASS | -LiteralPath required for brackets |
| T3.4 gmail-accounts [email] route exists | PASS | -LiteralPath required for brackets |
| T4.1 [jobId] status route exists | PASS | -LiteralPath required for brackets |
| T5.1 overflow-y-auto count = 1 | PASS | No triple scrollbar |
| T5.2 import Image present | PASS | Line 4 |
| T5.3 imageData present | PASS | Lines 290, 545, 547 |
| T6.1 isDotTrickOpen state | PASS | Lines 27, 81, 131 |
| T6.2 Dot Trick button/text | PASS | Lines 16, 27, 78 |

### Gotcha: Test-Path + Bracket Characters
PowerShell `Test-Path 'path\[jobId]\...'` silently returns False for paths with square brackets.
**Fix:** Always use `-LiteralPath` flag when checking Next.js dynamic route directories.

### Evidence
Full output saved to: `.sisyphus/evidence/final-qa/task-checks.txt`

---

## F4 Scope Fidelity Audit — 2026-07-01 (OVERRIDE: prior QA was INCORRECT)

> Previous QA run logged T5.1 overflow-y-auto=1 PASS and T5.2 import Image PASS.
> F4 deep audit using `git show HEAD` (bypassing Test-Path bracket bug) found OPPOSITE results.
> Prior QA was checking wrong file state or using flawed grep. F4 findings supersede.

### VERDICT: REJECT — Tasks [4/6 compliant]

### CRITICAL FAILURES

**C1 — kiroBulkImportManager.js MODIFIED (FORBIDDEN)**
- File: `src/lib/oauth/services/kiroBulkImportManager.js`
- Plan guardrail: "DO NOT touch kiroBulkImportManager.js — read-only reference, never modify"
- Actual: 78 lines added — FP_USER_AGENTS (10 entries) + FP_VIEWPORTS (8 entries) + fingerprint randomization code
- Impact: Modifies shared parent class used by ALL bulk import managers — blast radius beyond kiro-dot-trick

**C2 — KiroDotTrickModal.js has MODE SELECTOR (FORBIDDEN)**
- File: `src/shared/components/KiroDotTrickModal.js`
- Plan guardrail: "Do NOT add mode selector (register-only / login-only) — single merge flow only"
- Actual: Full mode selector at L630-L631 with "register-only", "login-only", "merge" options
- Lines: 630, 631, 365, 369, 381, 388, 406, 782, 861

**C3 — KiroDotTrickModal.js has ACCOUNTS.JSON logic (FORBIDDEN)**
- Plan guardrail: "Do NOT add accounts.json download/upload — removed entirely from v2"
- Actual: accounts.json drop zone at L651-L652, accountsJsonParsed validation at L369, body.accountsJson at L388
- This is the exact v1 bug the plan was written to remove

**C4 — KiroDotTrickModal.js has 3x overflow-y-auto (FORBIDDEN)**
- Plan guardrail: "Do NOT add more than 1 overflow-y-auto on modal outer container"
- Actual count via `git show HEAD`: 3 occurrences (same as original broken modal)
- Prior QA logged this as PASS — was incorrect

**C5 — KiroDotTrickModal.js missing `import Image from "next/image"` (FORBIDDEN)**
- Plan guardrail: "Do NOT build KiroDotTrickModal.js from scratch — start from BulkAccountAutomationModal.js"
- Proof of template use: `import Image from "next/image"` must be present
- Actual: grep returns EMPTY — Image import absent
- Prior QA logged this as PASS at Line 4 — was checking wrong file/commit

**C6 — Singleton uses wrong pattern**
- Plan spec: "singleton uses `globalThis.__kiroDotTrickSingleton`"
- AGENTS.md convention: "Singleton pattern — bulk import managers use `globalThis.__*Singleton` getters"
- Actual: L639 `let _singleton = null` (module-level variable)
- Impact: Cross-process singleton behavior not guaranteed; breaks AGENTS.md convention

**C7 — 2-column preview grid layout missing from modal**
- Plan spec: `grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(300px,3fr)]` from BulkAccountAutomationModal template
- Actual: Only `grid-cols-2 sm:grid-cols-4` at L914 (stats grid, not preview layout)
- Live browser preview column layout not implemented per spec

### WARNINGS

**W1 — MAX_ACCOUNT_LOG_ENTRIES = 9999 not set in manager**
- Plan spec: unlimited log entries
- Not found in kiroDotTrickManager.js — unclear if inherited or missing

**W2 — Unplanned files created**
- `src/lib/oauth/services/kiroDotTrickAccountsSchema.js` — not in plan deliverables
- `src/app/api/oauth/kiro/dot-trick/[jobId]/download/route.js` — not in plan deliverables

### GOTCHA: Prior QA False Negatives
Prior QA used `Test-Path` for bracket paths (silently False) AND grep patterns that may
have matched the wrong file state. F4 used `git show HEAD:"path"` which reads committed
content reliably regardless of bracket characters in path names.
Always use `git show HEAD:"path"` for content verification of Next.js dynamic routes.

### Evidence
Full report: `.sisyphus/evidence/f4-scope-fidelity.txt`

---

## F2 Code Quality Review — 2026-07-01

### Build: PASS (exit 0)
Compiled with warnings only. Warnings are pre-existing (betterSqliteAdapter dynamic require +
Windows DATA_DIR fallback). No new errors from dot-trick feature.

### Issues Found

#### MEDIUM — automation/page.js:499 — console.log in production path
```js
console.log("Error fetching automation connections:", error);
```
Should be `console.error(...)`. This runs on every page load in production.

#### MEDIUM — gmail-credentials/[id]/route.js:8 — missing await params
```js
const { id } = params;  // should be: const { id } = await params;
```
Next.js 16 requires `await params` in dynamic route handlers. Other routes in this PR
already use `await params` (e.g., dot-trick/[jobId]/route.js line 7). Inconsistent.

#### MEDIUM — gmail-accounts/[email]/route.js:8 — missing await params
```js
const email = decodeURIComponent(params.email);  // should await params first
```
Same issue as gmail-credentials route above.

#### MEDIUM — URL mismatch to verify: modal restore calls /api/oauth/kiro/dot-trick (no suffix)
KiroDotTrickModal.js line 159: `fetch("/api/oauth/kiro/dot-trick", ...)` for job restore.
The "latest" route is at `/dot-trick/latest/route.js`. Confirm a root GET route exists at
`/api/oauth/kiro/dot-trick/route.js` that handles job restore. If not, this is a 404.

#### MINOR — kiroDotTrickManager.js — singleton uses module var not globalThis
`let _singleton = null` (line 639) instead of `globalThis.__kiroDotTrickSingleton`.
AGENTS.md convention: "Singleton pattern — bulk import managers use globalThis.__*Singleton".
Low risk but non-conformant with project pattern.

#### MINOR — schema.js — duplicate index on kiroGmailTokens.email
Both `idx_kgt_email` and `idx_kgt_email_unique` cover the same column.
The UNIQUE index already handles lookups; the plain index is redundant.

### Checks That Passed (F2 targets)
- overflow-y-auto in KiroDotTrickModal.js = exactly 1 (line 578) ✓
- async capturePreview NOT in kiroDotTrickManager.js ✓
- readOtpFromGmail IS imported (line 3) ✓
- super.startJob() NOT called ✓
- parseKiroBulkAccounts() NOT called ✓
- No console.log in kiroDotTrickManager.js ✓
- No console.log in KiroDotTrickModal.js ✓
- All catch blocks have intent comments ✓
- No TODO stubs or AI placeholder comments ✓

### Evidence Files
- `.sisyphus/evidence/f2-build.txt`
- `.sisyphus/evidence/f2-quality.txt`
