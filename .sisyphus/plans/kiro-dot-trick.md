# Kiro Dot Trick — Register & Login Automation (REWRITE v2)

## TL;DR

> **Quick Summary**: Rewrite the broken "Dot Trick" feature. Auto-registers new Kiro (AWS Builder ID) accounts using Gmail dot-variants from authorized Gmail accounts in DB, then immediately logs them in via Device Code Flow, saving connections to 9router SQLite DB. Surgical revert of broken files + clean rebuild using correct inheritance patterns.
>
> **Deliverables**:
> - `src/lib/db/schema.js` — add `kiroGmailCredentials` + `kiroGmailTokens` tables (additive)
> - `src/lib/oauth/services/kiroDotTrickManager.js` — REWRITE (single merge mode, inherit capturePreview/sanitizeJob/buildJobActivity from parent)
> - `src/app/api/oauth/kiro/dot-trick/[jobId]/route.js` — GET status (MISSING)
> - `src/app/api/oauth/kiro/dot-trick/[jobId]/cancel/route.js` — POST cancel (ROOT CAUSE of cancel bug)
> - `src/app/api/oauth/kiro/gmail-credentials/[id]/route.js` — DELETE credential (MISSING)
> - `src/app/api/oauth/kiro/gmail-accounts/[email]/route.js` — DELETE/revoke token (MISSING)
> - `src/shared/components/KiroDotTrickModal.js` — REWRITE (start from BulkAccountAutomationModal.js, NOT scratch)
> - `src/app/(dashboard)/dashboard/automation/page.js` — add Dot Trick button + parallel state (additive)
>
> **Estimated Effort**: XL
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: T1 (schema) → T2 (manager rewrite) → T4 (job routes) → T5 (modal rewrite) → T6 (panel) → Final

---

## Context

### Original Request
Integrate `register-and-login-kiro.mjs` CLI script into the 9router dashboard. Previous implementation had critical bugs: triple scrollbar, missing live preview, broken cancel (missing route), missing [jobId] route, modal built from scratch instead of reusing BulkAccountAutomationModal template.

### Interview Summary
**Key Decisions**:
- **Mode**: Register + Login ONLY (single merged flow). No register-only, no login-only, no accounts.json.
- **Revert strategy**: Surgical — delete broken files only. KEEP working: `gmail-authorize/route.js`, `gmail-callback/route.js`, `kiroGmailTokenService.js`, `gmail-credentials/route.js`, `gmail-accounts/route.js`, `dot-trick/route.js`
- **Modal template**: `BulkAccountAutomationModal.js` (740 lines) — copy file, modify for Dot Trick. Must have `Image from next/image`, live preview 2-column grid, NO triple scrollbar.
- **Email pool source**: From Gmail accounts authorized in DB — `buildEmailPool()` from `kiroGmailTokenService.js`. User selects accounts + count.
- **Concurrency**: Inherit from parent (1-8 workers). User configures in modal.
- **Gmail authorize**: Manual popup flow (`localhost:8085/callback`). Future automation = separate plan.
- **Cancel job**: Inherited from parent `cancelJob()`. Root cause was MISSING `[jobId]/cancel/route.js` (404 on click).
- **kiroGmailTokenService.js**: Fix-only if concrete bug found. NOT a rewrite target.
- **Job persistence**: File JSON per job in `DATA_DIR/kiro-dot-trick/` — same as `kiroBulkImportManager`.
- **Log display**: ALL entries, unlimited.
- **Connections**: Save to `providerConnections` table (same as regular Kiro bulk import).
- **Docs**: In-app tooltip/help text only.

### Research Findings

**Previous implementation bugs confirmed (from code analysis):**
- `KiroDotTrickModal.js` (1012 lines): Built from scratch — missing `import Image from "next/image"`, no live browser preview (grep shows empty), 3x `overflow-y-auto` at lines 727, 960, 1004 — triple scrollbar
- `capturePreview()`, `sanitizeJob()`, `sanitizeAccount()`, `buildJobActivity()`, `revealBrowserWindow()` — NOT found in manager. Parent class has all these — must inherit, not override
- `[jobId]/cancel/route.js` — **FILE MISSING** — caused cancel to 404 on every click
- `[jobId]/route.js` — **FILE MISSING** — polling from UI returns 404
- `latest/route.js` — **FILE MISSING** from `dot-trick/` subfolder

**Previous implementation CORRECT (do NOT touch):**
- `readOtpFromGmail` — imported from `kiroGmailTokenService.js` line 13 ✓ (NOT duplicated locally)
- `verificationUriComplete` — in login phase lines 753, 771 ✓
- `Allow access` consent button — lines 853-856 ✓
- `emailCaptcha`, `#emailCaptcha`, `maxlength="6"` OTP selectors — lines 495-502 ✓
- Suspend check — polls `from:no-reply@amazonaws.com` lines 668-700 ✓
- `cancelRequested` flag and `workerBrowsers` — initialized in `startJob()` ✓
- Gmail authorize flow (`localhost:8085`) — already fixed from Python port ✓

**BulkAccountAutomationModal.js (740 lines) — EXACT TEMPLATE TO USE:**
- Imports: `Image from "next/image"`, `PropTypes from "prop-types"`, `Badge, Button, Input, Modal`, `formatBrowserProxyPoolOption, getBrowserProxyPools`
- Live preview pattern (lines 574-622): `activeJob.preview?.imageData` → `<Image src={imageData} width={1440} height={900} className="h-[340px]">` or `browser_updated` placeholder
- Layout: `grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(300px,3fr)]` — preview left, log right
- Polling: `setInterval(poll, 2000)` with useRef cleanup
- Cancel: `handleCancelJob` → POST `/api/oauth/kiro/dot-trick/${jobId}/cancel`
- NO triple scrollbar — grid layout prevents nested scroll

**kiroBulkImportManager.js — parent class (DO NOT touch):**
- `capturePreview()` at line 756 — **DO NOT override** in KiroDotTrickManager
- `sanitizeJob()` at line 218 — **DO NOT override**
- `sanitizeAccount()` at line 202 — **DO NOT override**
- `buildJobActivity()` at line 189 — **DO NOT override**
- `revealBrowserWindow()` at line 441 — **DO NOT override**
- `cancelJob()` at line 611 — **DO NOT override** (already correct: sets cancelRequested=true, closes browsers)
- `persistJobSnapshot()` at line 724 — inherits correctly (already called 16x in existing manager)
- Constructor accepts `{ googleAutomation, socialExchange, kiroServiceFactory, storageName }` — stub first two with no-ops

### Metis Review
**Gaps addressed:**
- Revert strategy: surgical (not full) — keep working files
- Email pool source: from authorized Gmail accounts in DB via `buildEmailPool()`
- Concurrency: inherit parent model (1-8 workers)
- `kiroGmailTokenService.js`: fix-only if concrete bug, not rewrite
- Connections: `providerConnections` table (same as bulk import)
- Cancel job: graceful shutdown (finishes current account, stops queue) — correct behavior

---

## Work Objectives

### Core Objective
Fix the broken Dot Trick by: (1) rewriting the manager with correct inheritance, (2) adding the 3 missing route files, (3) rewriting the modal using BulkAccountAutomationModal as template. Single merge mode: register → login → save connection.

### Concrete Deliverables
- `src/lib/db/schema.js` — 2 new tables added
- `src/lib/oauth/services/kiroDotTrickManager.js` — rewritten
- `src/app/api/oauth/kiro/dot-trick/[jobId]/route.js` — created
- `src/app/api/oauth/kiro/dot-trick/[jobId]/cancel/route.js` — created
- `src/app/api/oauth/kiro/dot-trick/latest/route.js` — created
- `src/app/api/oauth/kiro/gmail-credentials/[id]/route.js` — created
- `src/app/api/oauth/kiro/gmail-accounts/[email]/route.js` — created
- `src/shared/components/KiroDotTrickModal.js` — rewritten from BulkAccountAutomationModal template
- `src/app/(dashboard)/dashboard/automation/page.js` — Dot Trick button + state added

### Definition of Done
- [x] `npm run dev` starts without errors on port 20128
- [x] `/dashboard/automation` shows 7 Kiro options including "Dot Trick"
- [x] Clicking "Dot Trick" opens modal — same UX quality as BulkAccountAutomationModal
- [x] Live browser preview screenshot appears during worker execution
- [x] Cancel job: POST returns 200, browsers close, job status → "cancelled"
- [x] Job status polling: GET `/api/oauth/kiro/dot-trick/{jobId}` returns job data (not 404)
- [x] Completed accounts appear as connections in `/dashboard/providers`
- [x] No triple scrollbar in modal (max 1 `overflow-y-auto` on outer container)

### Must Have
- Live browser preview screenshot (inherited `capturePreview()`)
- 2-column grid layout (preview + log, no triple scrollbar)
- Cancel job route exists and returns 200
- `[jobId]` route exists for polling
- Worker log shows ALL entries (unlimited)
- Dot-variant pool generated from authorized Gmail accounts in DB
- `latest` route exists for job persistence on page reload

### Must NOT Have (Guardrails)
- **Do NOT build `KiroDotTrickModal.js` from scratch** — start from `BulkAccountAutomationModal.js`, copy file, modify only what differs
- **Do NOT override `capturePreview()`** in manager — inherit from parent silently
- **Do NOT override `sanitizeJob()` / `sanitizeAccount()` / `buildJobActivity()` / `revealBrowserWindow()`** — inherit from parent
- **Do NOT call `super.startJob()`** — inputs are generated dot-variants, not user-supplied `email|password` text
- **Do NOT duplicate `readOtpFromGmail` locally** — already imported from `kiroGmailTokenService.js` line 13
- **Do NOT add mode selector** (register-only / login-only) — single merge flow only
- **Do NOT add accounts.json download/upload** — removed entirely from v2
- **Do NOT touch `gmail-authorize/route.js`, `gmail-callback/route.js`, `kiroGmailTokenService.js`** — working correctly, no modification
- **Do NOT create migration file for DB tables** — `schema.js` TABLES additive path only, no migration file
- **Do NOT modify `KiroOAuthWrapper`** — Dot Trick modal is a parallel `isDotTrickOpen` state, NOT inside KiroOAuthWrapper
- **Do NOT add more than 1 `overflow-y-auto`** on modal outer container — use grid layout
- **Do NOT touch `kiroBulkImportManager.js`** — read-only reference, never modify

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (Vitest in `tests/`)
- **Automated tests**: None (following project pattern)
- **Agent-Executed QA**: ALWAYS mandatory for all tasks

### QA Policy
- **Frontend/UI**: Playwright — navigate, interact, assert DOM, screenshot
- **API/Backend**: Bash (curl/PowerShell) — send requests, assert status + response fields
- **Library/Module**: Bash (node) — import, call functions, compare output
- Evidence: `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation, independent):
├── Task 1: DB schema — add 2 tables to schema.js [quick]
└── Task 3: Missing simple routes — [jobId]/cancel, [jobId]/latest, gmail-credentials/[id], gmail-accounts/[email] [quick]

Wave 2 (After Wave 1 — core rewrite, parallel):
├── Task 2: kiroDotTrickManager.js REWRITE [unspecified-high]
└── Task 4: dot-trick/[jobId]/route.js — GET job status [quick]

Wave 3 (After Wave 2 — UI rewrite):
├── Task 5: KiroDotTrickModal.js REWRITE from BulkAccountAutomationModal template [visual-engineering]
└── Task 6: automation/page.js — Dot Trick button + parallel state [quick]

Wave FINAL (After ALL — 4 parallel reviews):
├── Task F1: Plan compliance audit [oracle]
├── Task F2: Code quality review [unspecified-high]
├── Task F3: Real manual QA [unspecified-high]
└── Task F4: Scope fidelity check [deep]
→ Present results → Get explicit user okay

Critical Path: T1 → T2 → T5 → T6 → F1-F4 → user okay
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| T1 | — | T2 |
| T2 | T1 | T4, T5 |
| T3 | — | T5, T6 |
| T4 | T2 | T5 |
| T5 | T2, T3, T4 | T6 |
| T6 | T3, T5 | FINAL |

---

## TODOs

- [x] 1. DB Schema — add `kiroGmailCredentials` + `kiroGmailTokens` tables

  **What to do**:
  Open `src/lib/db/schema.js`. Add two entries to the `TABLES` object (after `proxyPools`):

  ```js
  kiroGmailCredentials: {
    columns: {
      id: "TEXT PRIMARY KEY",
      label: "TEXT",
      clientId: "TEXT NOT NULL",
      clientSecret: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
    },
  },
  kiroGmailTokens: {
    columns: {
      id: "TEXT PRIMARY KEY",
      email: "TEXT UNIQUE NOT NULL",
      accessToken: "TEXT",
      refreshToken: "TEXT NOT NULL",
      expiresAt: "INTEGER",
      credentialId: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_kgt_email ON kiroGmailTokens(email)",
    ],
  },
  ```

  **Must NOT do**:
  - Do NOT create a migration file — `syncSchemaFromTables()` auto-creates new tables
  - Do NOT bump `SCHEMA_VERSION`
  - Do NOT touch any existing table definitions

  **Recommended Agent Profile**:
  - **Category**: `quick` — single file, additive-only schema change
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 3)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 2
  - **Blocked By**: None

  **References**:
  - `src/lib/db/schema.js:17-130` — existing `TABLES` pattern, follow exact column definition style
  - `src/lib/db/schema.js:14-16` — comment about `syncSchemaFromTables()` auto-apply

  **QA Scenarios**:
  ```
  Scenario: Tables auto-created on startup
    Tool: Bash (PowerShell)
    Steps:
      1. Start dev server: npm run dev
      2. Run: node -e "const {getDb}=require('./src/lib/db/index.js'); const t=getDb().prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'kiroGmail%'\").all(); console.log(JSON.stringify(t))"
    Expected Result: [{"name":"kiroGmailCredentials"},{"name":"kiroGmailTokens"}]
    Evidence: .sisyphus/evidence/task-1-tables-created.txt

  Scenario: Cold start has no schema errors
    Tool: Bash
    Steps:
      1. npm run dev 2>&1 | Select-String "SQLITE_ERROR|no such table" | head -5
    Expected Result: No output (no errors)
    Evidence: .sisyphus/evidence/task-1-cold-start.txt
  ```

  **Commit**: YES
  - Message: `feat(db): add kiroGmailCredentials and kiroGmailTokens tables`
  - Files: `src/lib/db/schema.js`

---

- [x] 2. `kiroDotTrickManager.js` — REWRITE

  **What to do**:
  Delete and rewrite `src/lib/oauth/services/kiroDotTrickManager.js` from scratch. This is the core automation manager — extend `KiroBulkImportManager`, single merge mode (register → cooldown → login → save connection).

  **Class structure**:
  ```js
  import { KiroBulkImportManager, buildLookupResponse, createFreshContext } from "./kiroBulkImportManager.js";
  import { buildEmailPool, getAccessToken, readOtpFromGmail } from "./kiroGmailTokenService.js";

  class KiroDotTrickManager extends KiroBulkImportManager {
    constructor() {
      super({
        googleAutomation: async () => ({ status: "failed", error: "not used" }),
        socialExchange: async () => ({ status: "failed", error: "not used" }),
        storageName: "kiro-dot-trick",
      });
    }

    // Override startJob — generate dot-variant pool from authorized Gmail accounts
    async startJob({ gmailAccounts, count, concurrency, headless, loginCooldownMs, proxyUrls, proxyPoolId })

    // Override processAccount — registration + login automation
    async processAccount(job, account, workerId)

    // Singleton pattern
  }

  export function getKiroDotTrickManager() { ... }
  ```

  **`startJob()` logic**:
  - `gmailAccounts` = array of email strings from authorized accounts in DB
  - Call `buildEmailPool(gmailAccounts, 2)` from `kiroGmailTokenService.js` to generate dot variants
  - Slice to `count` (0 = full pool)
  - Build `job.accounts` array with each variant as an account entry
  - Store `job.loginCooldownMs` (default 60000), `job.headless` on job object
  - Follow exact same job construction pattern as `kiroBulkImportManager.js:534-579`

  **`processAccount()` — REGISTER phase** (port from `register-and-login-kiro.mjs:571-1029`):
  - Launch browser via `launchBulkImportBrowser()` from `bulkImportBrowserEngine.js`
  - Create context via inherited `createFreshContext(browser)`
  - Step 1 (lines 580-613): Navigate `app.kiro.dev/signin` → click Builder ID → wait for `signin.aws`
  - Step 2 (lines 627-661): Fill email (account.email) char-by-char (35ms delay)
  - Step 3 (lines 664-757): Click Next → wait for `profile.aws.amazon.com` → fill name via `generateRealisticName()` (inline local function) → handle ERR-837 retry
  - Step 4 (lines 763-797): Wait for OTP field — use FULL selector list: `input[name="emailCaptcha"]`, `#emailCaptcha`, `input[placeholder*="6-digit" i]`, `input[placeholder*="verification code" i]`, `input[autocomplete="one-time-code"]`, `input[maxlength="6"]`, `input[inputmode="numeric"]`
  - Step 5 (lines 799-826): Call `readOtpFromGmail(email, { timeout: 120_000, since: otpSentAt })` — imported from `kiroGmailTokenService.js`, NOT local
  - Step 6 (lines 829-931): Fill OTP → Next → wait password field → fill password + confirm → submit
  - Step 7 (lines 954-982): Wait for `app.kiro.dev` authorized (not `/signin`) — handle `/signin/oauth` redirect
  - Step 8 (lines 984-1025): **Suspend check** — poll `from:no-reply@amazonaws.com subject:"Action Needed"` for 2 min. If found → `account.suspended = true`, `finalizeAccount("failed", ...)`

  **`processAccount()` — LOGIN phase** (port from `register-and-login-kiro.mjs:1078-1444`):
  - Sleep `job.loginCooldownMs` after register
  - Lines 1086-1110: `GET /api/oauth/kiro/device-code` (use fetch to localhost) → extract `device_code`, `user_code`, `verificationUriComplete`, `_clientId`, `_clientSecret`
  - Lines 1112-1134: Start background poll loop → `POST /api/oauth/kiro/poll` every `interval` seconds
  - Lines 1166-1171: Launch new browser → navigate `verificationUriComplete`
  - Lines 1173-1217: Fill email → click Continue
  - Lines 1222-1247: Wait for password field → fill → click Sign in
  - Lines 1292-1370: **OTP after password** — poll 30s for OTP field selectors (`input[maxlength="6"]`, `input[autocomplete="one-time-code"]`). If visible → call `readOtpFromGmail()` → fill → submit
  - Lines 1372-1419: **Consent/Allow loop** (up to 180s) — click `[data-testid="allow-access-button"]`, `#cli_verification_btn`, `button:has-text("Allow access")`, `button:has-text("Allow")`. Detect success: "request approved", "authorization complete", "you can now close"
  - Lines 1428-1433: Await poll promise → `connection.id` → `finalizeAccount("success", { connectionId: connection.id })`

  **`generateRealisticName()` — inline local function** (port from `register-and-login-kiro.mjs:161-224`):
  - Indonesian + International name pools
  - 50% chance of adding last name

  **Slider CAPTCHA helpers** (port from `register-and-login-kiro.mjs:283-350`):
  - `bezierDragPoints`, `solveSliderCaptcha`, `handleSliderCaptchaIfPresent` — local functions inside `processAccount()` scope only

  **`dismissCookieConsent()`** (port from `register-and-login-kiro.mjs:495-523`):
  - Local function inside `processAccount()` scope only

  **Singleton**:
  ```js
  function getSingletonStore() {
    if (!globalThis.__kiroDotTrickSingleton) {
      globalThis.__kiroDotTrickSingleton = { manager: new KiroDotTrickManager() };
    }
    return globalThis.__kiroDotTrickSingleton;
  }
  export function getKiroDotTrickManager() { return getSingletonStore().manager; }
  ```

  **Must NOT do**:
  - Do NOT override `capturePreview()` — inherit from parent silently (line 756 of parent)
  - Do NOT override `sanitizeJob()` / `sanitizeAccount()` / `buildJobActivity()` / `revealBrowserWindow()` — inherit
  - Do NOT call `super.startJob()` or `parseKiroBulkAccounts()` — inputs are generated dot-variants
  - Do NOT duplicate `readOtpFromGmail` locally — import from `kiroGmailTokenService.js`
  - Do NOT add mode selector — single merge flow only
  - Do NOT add accounts.json logic — removed entirely
  - Do NOT set `MAX_ACCOUNT_LOG_ENTRIES` low — set to 9999 (unlimited)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (sequential after Task 1)
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Tasks 4, 5
  - **Blocked By**: Task 1

  **References**:
  - `src/lib/oauth/services/kiroBulkImportManager.js:495-1099` — parent class: `startJob()`, `processAccount()`, `runWorker()`, `runJob()`, `persistJobSnapshot()`, `finalizeAccount()`, `dequeueAccount()`, `capturePreview()` (756), `sanitizeJob()` (218), `sanitizeAccount()` (202), `buildJobActivity()` (189), `revealBrowserWindow()` (441), `cancelJob()` (611), singleton pattern at bottom
  - `src/lib/oauth/services/qwenCloudRegisterManager.js:1-50` — how to extend `KiroBulkImportManager` and stub unused callbacks
  - `register-and-login-kiro.mjs:571-1029` — full 14-step registration flow
  - `register-and-login-kiro.mjs:1078-1444` — full login Device Code flow
  - `register-and-login-kiro.mjs:161-224` — `generateRealisticName()` to port inline
  - `register-and-login-kiro.mjs:283-350` — slider CAPTCHA helpers
  - `register-and-login-kiro.mjs:495-523` — `dismissCookieConsent()`
  - `src/lib/oauth/services/kiroGmailTokenService.js` — `buildEmailPool()`, `readOtpFromGmail()`, `getAccessToken()`
  - `src/lib/oauth/services/bulkImportBrowserEngine.js` — `launchBulkImportBrowser()`
  - `src/lib/dataDir.js` — `DATA_DIR`

  **QA Scenarios**:
  ```
  Scenario: Singleton returns same instance
    Tool: Bash (node)
    Steps:
      1. node -e "const {getKiroDotTrickManager}=require('./src/lib/oauth/services/kiroDotTrickManager.js'); console.log(getKiroDotTrickManager()===getKiroDotTrickManager())"
    Expected Result: true
    Evidence: .sisyphus/evidence/task-2-singleton.txt

  Scenario: capturePreview NOT overridden in manager
    Tool: Bash (PowerShell)
    Steps:
      1. Select-String -Path "src\lib\oauth\services\kiroDotTrickManager.js" -Pattern "async capturePreview\b"
    Expected Result: No output (function not defined — inherited from parent)
    Evidence: .sisyphus/evidence/task-2-no-capturepreview-override.txt

  Scenario: readOtpFromGmail is imported not duplicated
    Tool: Bash (PowerShell)
    Steps:
      1. Select-String -Path "src\lib\oauth\services\kiroDotTrickManager.js" -Pattern "function readOtp"
    Expected Result: No output (function not defined locally)
    Evidence: .sisyphus/evidence/task-2-readotp-not-local.txt

  Scenario: verificationUri present in login phase
    Tool: Bash (PowerShell)
    Steps:
      1. Select-String -Path "src\lib\oauth\services\kiroDotTrickManager.js" -Pattern "verificationUri"
    Expected Result: At least 1 match showing navigation to verificationUri/verificationUriComplete
    Evidence: .sisyphus/evidence/task-2-verificationuri.txt

  Scenario: Full OTP selector list present in registration phase
    Tool: Bash (PowerShell)
    Steps:
      1. Select-String -Path "src\lib\oauth\services\kiroDotTrickManager.js" -Pattern "emailCaptcha"
    Expected Result: At least 1 match
    Evidence: .sisyphus/evidence/task-2-emailcaptcha-selector.txt

  Scenario: Suspend check polls amazonaws.com
    Tool: Bash (PowerShell)
    Steps:
      1. Select-String -Path "src\lib\oauth\services\kiroDotTrickManager.js" -Pattern "amazonaws"
    Expected Result: At least 1 match
    Evidence: .sisyphus/evidence/task-2-suspend-check.txt
  ```

  **Commit**: YES
  - Message: `feat(oauth): rewrite kiroDotTrickManager — single merge mode, correct inheritance`
  - Files: `src/lib/oauth/services/kiroDotTrickManager.js`

---

- [x] 3. Missing Simple Routes — cancel, latest, gmail credential/account delete

  **What to do**:
  Create 4 missing route files. These are small, each under 30 lines.

  **`src/app/api/oauth/kiro/dot-trick/[jobId]/cancel/route.js`** — POST:
  ```js
  import { NextResponse } from "next/server";
  import { getKiroDotTrickManager } from "@/lib/oauth/services/kiroDotTrickManager.js";
  export const dynamic = "force-dynamic";
  export async function POST(request, { params }) {
    const { jobId } = await params;
    const manager = getKiroDotTrickManager();
    const job = manager.cancelJob(jobId);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json({ success: true, job });
  }
  ```

  **`src/app/api/oauth/kiro/dot-trick/latest/route.js`** — GET:
  ```js
  import { NextResponse } from "next/server";
  import { getKiroDotTrickManager, buildLookupResponse } from "@/lib/oauth/services/kiroDotTrickManager.js";
  export const dynamic = "force-dynamic";
  export async function GET() {
    const manager = getKiroDotTrickManager();
    const job = await manager.getLatestJobWithPreview({ includeRecentTerminal: true });
    return NextResponse.json(buildLookupResponse(job));
  }
  ```

  **`src/app/api/oauth/kiro/gmail-credentials/[id]/route.js`** — DELETE:
  ```js
  import { NextResponse } from "next/server";
  import { deleteCredential } from "@/lib/oauth/services/kiroGmailTokenService.js";
  export async function DELETE(request, { params }) {
    const { id } = await params;
    const deleted = deleteCredential(id);
    if (!deleted) return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  }
  ```

  **`src/app/api/oauth/kiro/gmail-accounts/[email]/route.js`** — DELETE:
  ```js
  import { NextResponse } from "next/server";
  import { revokeToken } from "@/lib/oauth/services/kiroGmailTokenService.js";
  export async function DELETE(request, { params }) {
    const email = decodeURIComponent(params.email);
    const deleted = revokeToken(email);
    if (!deleted) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  }
  ```

  Follow existing auth middleware pattern from `src/app/api/oauth/kiro/bulk-import/route.js` (check auth cookie).

  **Must NOT do**:
  - Do NOT modify existing `dot-trick/route.js` or `gmail-credentials/route.js` — additive only
  - Do NOT add logic beyond what's described — these are thin wrappers

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 4, 5, 6
  - **Blocked By**: None

  **References**:
  - `src/app/api/oauth/kiro/bulk-import/route.js` — auth middleware pattern
  - `src/app/api/oauth/kiro/bulk-import/[jobId]/route.js` — get job pattern
  - `src/app/api/oauth/kiro/bulk-import/[jobId]/cancel/route.js` — cancel route pattern
  - `src/app/api/oauth/kiro/bulk-import/latest/route.js` — latest job pattern
  - `src/lib/oauth/services/kiroDotTrickManager.js` (Task 2) — `getKiroDotTrickManager()`, `cancelJob()`, `getLatestJobWithPreview()`, `buildLookupResponse()`
  - `src/lib/oauth/services/kiroGmailTokenService.js` — `deleteCredential()`, `revokeToken()`

  **QA Scenarios**:
  ```
  Scenario: Cancel route returns 404 for unknown job (not network error)
    Tool: Bash (curl)
    Steps:
      1. curl -s -X POST -H "Cookie: auth_token=123456" http://localhost:20128/api/oauth/kiro/dot-trick/nonexistent-id/cancel
    Expected Result: JSON { error: "..." } — NOT a connection error or HTML 404 page
    Evidence: .sisyphus/evidence/task-3-cancel-route-exists.txt

  Scenario: Latest route returns found:false when no active job
    Tool: Bash (curl)
    Steps:
      1. curl -s -H "Cookie: auth_token=123456" http://localhost:20128/api/oauth/kiro/dot-trick/latest | python -m json.tool
    Expected Result: { "found": false } or { "found": true, "job": {...} }
    Evidence: .sisyphus/evidence/task-3-latest-route.txt

  Scenario: Gmail credential delete returns 404 for unknown id
    Tool: Bash (curl)
    Steps:
      1. curl -s -X DELETE -H "Cookie: auth_token=123456" http://localhost:20128/api/oauth/kiro/gmail-credentials/nonexistent
    Expected Result: { error: "..." } with HTTP 404
    Evidence: .sisyphus/evidence/task-3-credential-delete.txt

  Scenario: Gmail account revoke returns 404 for unknown email
    Tool: Bash (curl)
    Steps:
      1. curl -s -X DELETE -H "Cookie: auth_token=123456" "http://localhost:20128/api/oauth/kiro/gmail-accounts/notexist%40gmail.com"
    Expected Result: { error: "..." } with HTTP 404
    Evidence: .sisyphus/evidence/task-3-account-revoke.txt
  ```

  **Commit**: YES (groups with Task 4)
  - Message: `feat(api): add missing Kiro dot-trick and Gmail route files`
  - Files: `src/app/api/oauth/kiro/dot-trick/[jobId]/cancel/route.js`, `src/app/api/oauth/kiro/dot-trick/latest/route.js`, `src/app/api/oauth/kiro/gmail-credentials/[id]/route.js`, `src/app/api/oauth/kiro/gmail-accounts/[email]/route.js`

---

- [x] 4. `dot-trick/[jobId]/route.js` — GET job status

  **What to do**:
  Create `src/app/api/oauth/kiro/dot-trick/[jobId]/route.js`:

  ```js
  import { NextResponse } from "next/server";
  import { getKiroDotTrickManager, buildLookupResponse } from "@/lib/oauth/services/kiroDotTrickManager.js";
  export const dynamic = "force-dynamic";
  export async function GET(request, { params }) {
    const { jobId } = await params;
    const manager = getKiroDotTrickManager();
    const job = await manager.getJobWithPreview(jobId);
    if (!job) return NextResponse.json(buildLookupResponse(null, { stale: true }));
    return NextResponse.json(buildLookupResponse(job));
  }
  ```

  Follow auth middleware pattern from `src/app/api/oauth/kiro/bulk-import/[jobId]/route.js`.

  **Must NOT do**:
  - Do NOT add extra logic beyond fetching job with preview

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2 — independent creation)
  - **Parallel Group**: Wave 2 (with Task 2)
  - **Blocks**: Task 5
  - **Blocked By**: Task 2 (needs manager to exist)

  **References**:
  - `src/app/api/oauth/kiro/bulk-import/[jobId]/route.js` — exact pattern to copy
  - `src/lib/oauth/services/kiroDotTrickManager.js` (Task 2) — `getKiroDotTrickManager()`, `getJobWithPreview()`, `buildLookupResponse()`

  **QA Scenarios**:
  ```
  Scenario: GET [jobId] returns found:false for nonexistent job (not 404)
    Tool: Bash (curl)
    Steps:
      1. curl -s -H "Cookie: auth_token=123456" http://localhost:20128/api/oauth/kiro/dot-trick/nonexistent-uuid-here
    Expected Result: JSON { "found": false } with HTTP 200 — NOT a 404 HTML page or connection error
    Failure Indicators: Any non-JSON response, or HTTP 404 status
    Evidence: .sisyphus/evidence/task-4-jobid-route.txt
  ```

  **Commit**: YES (groups with Task 3)
  - Message: `feat(api): add missing Kiro dot-trick and Gmail route files`
  - Files: `src/app/api/oauth/kiro/dot-trick/[jobId]/route.js`

---

- [x] 5. `KiroDotTrickModal.js` — REWRITE from BulkAccountAutomationModal template

  **What to do**:
  Delete and rewrite `src/shared/components/KiroDotTrickModal.js`. **Start by copying `BulkAccountAutomationModal.js` (740 lines) as the base**, then modify it for Dot Trick use case.

  **Step 1 — Copy BulkAccountAutomationModal.js structure**:
  The rewritten file must have the same skeleton as `BulkAccountAutomationModal.js`:
  - Same imports: `Image from "next/image"`, `PropTypes from "prop-types"`, `Badge, Button, Input, Modal`
  - Same grid layout: `grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(300px,3fr)]`
  - Same live preview section: `activeJob.preview?.imageData` → `<Image>` or `browser_updated` placeholder
  - Same polling pattern: `setInterval(poll, 2000)` with useRef cleanup
  - Same cancel pattern: `handleCancelJob` → POST `/api/oauth/kiro/dot-trick/${jobId}/cancel`
  - Same activity log in right column

  **Step 2 — Add Step 1 (Gmail Setup) BEFORE config**:
  Dot Trick modal has an extra step before configuration. Implement a 3-step wizard:
  - Step 1: Gmail Setup (credentials + authorize accounts)
  - Step 2: Configuration (count, workers, proxy, headless)
  - Step 3: Progress (same as BulkAccountAutomationModal progress view)

  **Step 1 — Gmail Setup UI**:
  - **Panel A: GCP Credentials**
    - Textarea: paste `client_secret.json` content
    - Optional label input
    - [Save Credential] → POST `/api/oauth/kiro/gmail-credentials`
    - List saved credentials: `{label} (client_id: {truncated})` + [Delete] → DELETE `/api/oauth/kiro/gmail-credentials/{id}`
    - Tooltip/help text: "Download client_secret.json from Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs → Download JSON"
    - Inline JSON parse validation (show error before submitting)
  - **Panel B: Gmail Accounts**
    - List accounts from GET `/api/oauth/kiro/gmail-accounts`: `email | ✓ valid / ⚠ expired | ~N variants | [Re-auth] | [Revoke]`
    - [+ Authorize Gmail Account] → select credential dropdown → `window.open(authUrl, '_blank', 'width=520,height=640')`
    - Poll GET `/api/oauth/kiro/gmail-accounts` every 3s while popup open to detect new account
    - Total dot variants count: "~N combinations from X accounts"
    - Tooltip: "Gmail dot trick: na.me@gmail.com and name@gmail.com arrive in the same inbox. Each variant registers as a separate Kiro account."

  **Step 2 — Configuration UI** (same as BulkAccountAutomationModal config):
  - Gmail accounts checkbox list (only `isValid === true` shown as selectable)
  - Number of Accounts input (0 = full pool, show computed pool size next to input)
  - Concurrent Workers: 1-8 (default 2)
  - Login Cooldown seconds (default 60)
  - Headless toggle (default on)
  - Proxy URLs textarea (optional, one per line)
  - Engine selector (chromium/camoufox, same as BulkAccountAutomationModal)
  - [← Back] + [Start Job →] buttons
  - [Start Job →] → POST `/api/oauth/kiro/dot-trick` with `{ gmailAccounts, count, concurrency, headless, loginCooldownMs, proxyUrls }`

  **Step 3 — Progress** (copy from BulkAccountAutomationModal, adjust endpoints):
  - Auto-jump to Step 3 on modal open if active job exists (GET `/api/oauth/kiro/dot-trick/latest`)
  - Poll GET `/api/oauth/kiro/dot-trick/{jobId}` every 2s
  - Progress bar: `{completed}/{total} accounts`
  - Stats grid: success / suspended / failed / running (4 cells)
  - Live Browser Preview: `activeJob.preview?.imageData` → `<Image>` or placeholder
  - Activity log (right column): all entries from `activeJob.activity`
  - [Cancel Job] → POST `/api/oauth/kiro/dot-trick/{jobId}/cancel`
  - On job complete: show final stats + [Run Again] + [Close]

  **Scrollbar constraint (CRITICAL)**:
  - Modal outer container: `max-h-[90vh] overflow-y-auto` — ONE scrollbar only
  - Inner sections: use `overflow-hidden` on the grid, NOT additional `overflow-y-auto`
  - Worker log: `max-h-[300px] overflow-y-auto` — this is the only inner scroll allowed
  - Live preview image: fixed height `h-[340px]`, no scroll

  **Must NOT do**:
  - Do NOT build from scratch — start from `BulkAccountAutomationModal.js` copy
  - Do NOT add `overflow-y-auto` to more than 2 elements (outer modal + log container)
  - Do NOT omit `import Image from "next/image"` — live preview requires it
  - Do NOT omit live browser preview section — must show `activeJob.preview?.imageData`
  - Do NOT add mode selector (register-only / login-only) — single flow only
  - Do NOT add accounts.json download/upload — removed from v2

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 6)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 6
  - **Blocked By**: Tasks 2, 3, 4

  **References**:
  - `src/shared/components/BulkAccountAutomationModal.js` — **COPY THIS FILE AS BASE** — 740 lines, full pattern reference
  - `src/shared/components/BulkAccountAutomationModal.js:570-640` — Live browser preview section (exact JSX to copy)
  - `src/shared/components/BulkAccountAutomationModal.js:574-622` — `activeJob.preview?.imageData` → `<Image>` pattern
  - `src/shared/components/QwenCloudRegisterModal.js:1-50` — step wizard pattern with local `step` state
  - `src/shared/components/QwenCloudAutomationModal.js` — alternative reference for polling
  - `src/app/api/oauth/kiro/gmail-credentials/route.js` — POST body for credential save
  - `src/app/api/oauth/kiro/gmail-authorize/route.js` — GET response: `{ authUrl, state, port }`
  - `src/app/api/oauth/kiro/gmail-accounts/route.js` — GET accounts response shape
  - `src/app/api/oauth/kiro/dot-trick/route.js` — POST body format, GET latest response
  - `src/app/api/oauth/kiro/dot-trick/[jobId]/route.js` (Task 4) — GET job status response
  - `src/shared/components/index.js` — check barrel export pattern

  **QA Scenarios**:
  ```
  Scenario: Modal opens on Step 1 (Gmail Setup) by default
    Tool: Playwright
    Preconditions: Dev server running, navigate to /dashboard/automation, Kiro panel active
    Steps:
      1. Click button containing text "Dot Trick"
      2. Wait for modal overlay to appear (timeout: 5000ms)
      3. Assert Step 1 indicator is active
      4. Assert "Google Cloud Credentials" text visible in modal
      5. Assert "+ Authorize Gmail Account" button visible
    Expected Result: Modal open showing Step 1 content
    Evidence: .sisyphus/evidence/task-5-modal-step1.png

  Scenario: No triple scrollbar — only outer modal + log container
    Tool: Playwright
    Steps:
      1. Open modal, navigate to Step 3 (start a job first via curl POST)
      2. Evaluate: document.querySelectorAll('[class*="overflow-y-auto"]').length
    Expected Result: <= 2 elements with overflow-y-auto
    Evidence: .sisyphus/evidence/task-5-no-triple-scroll.txt

  Scenario: Live preview section renders (placeholder or image)
    Tool: Playwright
    Preconditions: Job running (started via curl)
    Steps:
      1. Open modal — auto-jumps to Step 3
      2. Assert element with text "Live Browser Preview" is visible
      3. Assert either: <img> element OR "material-symbols" icon (browser_updated placeholder) is visible
    Expected Result: Live preview section renders in left column of grid
    Evidence: .sisyphus/evidence/task-5-live-preview.png

  Scenario: Image import present in file
    Tool: Bash (PowerShell)
    Steps:
      1. Select-String -Path "src\shared\components\KiroDotTrickModal.js" -Pattern "import Image from"
    Expected Result: Line containing `import Image from "next/image"`
    Evidence: .sisyphus/evidence/task-5-image-import.txt

  Scenario: Cancel job button calls correct endpoint
    Tool: Playwright
    Preconditions: Job running, modal on Step 3
    Steps:
      1. Intercept network requests for /api/oauth/kiro/dot-trick/*/cancel
      2. Click "Cancel Job" button
      3. Assert network request was made to correct endpoint with POST method
    Expected Result: POST request to /api/oauth/kiro/dot-trick/{jobId}/cancel intercepted
    Evidence: .sisyphus/evidence/task-5-cancel-button.png
  ```

  **Commit**: NO (groups with Task 6)

---

- [x] 6. `automation/page.js` — Add Dot Trick button + parallel state

  **What to do**:
  Update `src/app/(dashboard)/dashboard/automation/page.js` to add "Dot Trick" as 7th option in `KiroAutomationPanel`.

  **Step 1 — Add import** (top of file):
  ```js
  import KiroDotTrickModal from "@/shared/components/KiroDotTrickModal";
  ```

  **Step 2 — Add parallel state inside `KiroAutomationPanel`** (alongside existing `isOpen`, `bulkJob`, `initialFlow`):
  ```js
  const [isDotTrickOpen, setIsDotTrickOpen] = useState(false);
  ```

  **Step 3 — Add 7th option to `options` array** (AFTER existing 6 options):
  ```js
  {
    id: "dot-trick",
    title: "Dot Trick",
    icon: "auto_awesome",
    description: "Register new Kiro accounts via Gmail dot-variants, then auto-login and save connections.",
    action: () => setIsDotTrickOpen(true),
  },
  ```

  **Step 4 — Render modal** (AFTER `<KiroOAuthWrapper>` closing tag, inside the fragment):
  ```js
  <KiroDotTrickModal
    isOpen={isDotTrickOpen}
    onClose={() => setIsDotTrickOpen(false)}
    onSuccess={onRefresh}
  />
  ```

  **Step 5 — Add barrel export** in `src/shared/components/index.js`:
  ```js
  export { default as KiroDotTrickModal } from "./KiroDotTrickModal";
  ```
  Check existing export pattern in that file before adding.

  **Must NOT do**:
  - Do NOT modify `KiroOAuthWrapper` or existing `openFlow()` logic
  - Do NOT change the existing 6 options in any way
  - Do NOT add `dot-trick` to `AUTOMATION_PROVIDERS` array (Kiro is already there)
  - Do NOT use `openFlow()` to open Dot Trick modal — must use `setIsDotTrickOpen(true)`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 5)
  - **Parallel Group**: Wave 3
  - **Blocks**: Final Verification
  - **Blocked By**: Tasks 3, 5

  **References**:
  - `src/app/(dashboard)/dashboard/automation/page.js:22-123` — `KiroAutomationPanel` full component — study existing `options` array, `openFlow()`, `KiroOAuthWrapper` rendering
  - `src/app/(dashboard)/dashboard/automation/page.js:327-373` — `QwenCloudAutomationPanel` — how another panel wires its own separate modal
  - `src/shared/components/KiroDotTrickModal.js` (Task 5) — component to import and render
  - `src/shared/components/index.js` — barrel exports to update

  **QA Scenarios**:
  ```
  Scenario: 7th Dot Trick button visible in Kiro panel
    Tool: Playwright
    Steps:
      1. page.goto("http://localhost:20128/dashboard/automation")
      2. Wait for Kiro panel to render
      3. Assert button with text "Dot Trick" visible
      4. Assert icon text "auto_awesome" visible within that button
      5. Screenshot entire panel
    Expected Result: 7 buttons visible in Kiro automation panel
    Evidence: .sisyphus/evidence/task-6-dot-trick-button.png

  Scenario: Clicking Dot Trick opens KiroDotTrickModal (NOT KiroOAuthWrapper)
    Tool: Playwright
    Steps:
      1. Click button "Dot Trick"
      2. Wait 1000ms
      3. Assert modal overlay visible
      4. Assert "Google Cloud Credentials" or "Gmail Setup" text visible in modal
      5. Assert KiroOAuthWrapper elements NOT visible (no bulk-import UI)
    Expected Result: KiroDotTrickModal open, KiroOAuthWrapper untouched
    Evidence: .sisyphus/evidence/task-6-modal-opens.png

  Scenario: Existing 6 options still work (regression)
    Tool: Playwright
    Steps:
      1. Click "Auto Login Bulk" button
      2. Assert KiroOAuthWrapper opens (bulk-import UI visible)
      3. Close it
      4. Check console for JS errors
    Expected Result: Existing functionality unaffected, no JS errors
    Evidence: .sisyphus/evidence/task-6-regression.png

  Scenario: KiroDotTrickModal exported from barrel
    Tool: Bash (node)
    Steps:
      1. node -e "const c=require('./src/shared/components/index.js'); console.log(typeof c.KiroDotTrickModal)"
    Expected Result: "function"
    Evidence: .sisyphus/evidence/task-6-barrel-export.txt
  ```

  **Commit**: YES
  - Message: `feat(dashboard): rewrite KiroDotTrickModal from BulkAccountAutomationModal template`
  - Files: `src/app/(dashboard)/dashboard/automation/page.js`, `src/shared/components/index.js`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint). For each "Must NOT Have": search codebase — reject with file:line if found. Check evidence files exist.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `npm run build` cold start. Review all new/changed files: empty catches, console.log in prod, unused imports, AI slop. Check no triple scrollbar in modal. Check `capturePreview` not overridden in manager.
  Output: `Build [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Execute EVERY QA scenario from EVERY task. Test: modal opens, Gmail credential save, authorize popup, start job, live preview appears, cancel job stops workers, connections saved. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: verify 1:1 with spec. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

- After T1: `feat(db): add kiroGmailCredentials and kiroGmailTokens tables`
- After T2: `feat(oauth): rewrite kiroDotTrickManager — single merge mode, correct inheritance`
- After T3+T4: `feat(api): add missing Kiro dot-trick and Gmail route files`
- After T5+T6: `feat(dashboard): rewrite KiroDotTrickModal from BulkAccountAutomationModal template`

---

## Success Criteria

```bash
# Cancel route exists (should return job-not-found, NOT "cannot POST")
curl -s -X POST http://localhost:20128/api/oauth/kiro/dot-trick/test-id/cancel
# Expected: { error: "..." } with 404 — NOT network error

# Job status route exists
curl -s http://localhost:20128/api/oauth/kiro/dot-trick/test-id
# Expected: { found: false } — NOT 404

# No triple scrollbar
grep -c "overflow-y-auto" src/shared/components/KiroDotTrickModal.js
# Expected: 1

# capturePreview not overridden
grep -n "capturePreview" src/lib/oauth/services/kiroDotTrickManager.js
# Expected: no async function definition — only potential calls

# latest route exists
curl -s http://localhost:20128/api/oauth/kiro/dot-trick
# Expected: { found: false } or active job — NOT 404
```

### Final Checklist
- [x] All "Must Have" present and verified
- [x] All "Must NOT Have" absent
- [x] Cold start: no errors on port 20128
- [x] 7 Kiro options visible on automation page
- [x] Cancel job returns 200 (not 404)
- [x] Live browser preview visible during execution
- [x] No triple scrollbar in modal
- [x] `[jobId]` and `latest` routes return valid JSON (not 404)
