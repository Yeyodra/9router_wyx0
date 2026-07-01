# Kiro Email+Password Bulk Import

## TL;DR

> **Quick Summary**: Port email+password PKCE login automation from etteum-pool (Python) into 9router's existing `kiroBulkImportManager.js` as a new `authMethod: "email"` option alongside the existing Google OAuth flow.
>
> **Deliverables**:
> - `src/lib/oauth/services/kiroEmailAutomation.js` — Playwright automation for email+password PKCE login
> - `src/lib/oauth/services/kiro.js` — add `buildEmailPasswordLoginUrl()` method
> - `src/lib/oauth/services/kiroBulkImportManager.js` — add `authMethod: "email"` branch in `processAccount()`
> - `src/app/api/oauth/kiro/bulk-import/route.js` — accept `authMethod` param
> - Dashboard UI update — add "Email/Password" option in BulkAccountAutomationModal
>
> **Estimated Effort**: Medium (2-3 days)
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → F1-F4

---

## Context

### Original Request
Port the email+password Kiro bulk login automation from etteum-pool (Python/Bun stack) into 9router (JS-only, Next.js). The feature allows bulk importing Kiro accounts using email+password credentials via automated PKCE OAuth browser flow.

### Research Findings
**From etteum-pool (source)**:
- Python PKCE flow: generate code_verifier + SHA256 code_challenge → open browser → fill email+password form → intercept `kiro://` redirect → extract `?code=` → POST to token endpoint → save access_token + refresh_token + profile_arn + quota
- Auth endpoints: `https://prod.us-east-1.auth.desktop.kiro.dev/login` and `/oauth/token`
- Redirect URI: `kiro://kiro.kiroAgent/authenticate-success`
- Quota endpoint: `https://q.us-east-1.amazonaws.com/getUsageLimits?origin=AI_EDITOR&resourceType=AGENTIC_REQUEST&profileArn=...`
- Error codes: INVALID_CREDENTIALS (non-retry), BROWSER_CRASH/NETWORK_ERROR (retry)

**From 9router (target)**:
- `kiroBulkImportManager.js` (990 lines) — job-based architecture, concurrency 1-8, file-persisted jobs in `DATA_DIR/kiro-bulk-import/`
- `kiro.js` — `KiroService` class with `buildSocialLoginUrl()`, `exchangeSocialCode()`, `refreshToken()` — PKCE infrastructure already exists
- `kiroGoogleAutomation.js` — `createKiroCallbackMonitor()` intercepts `kiro://` redirects — REUSABLE
- `bulkImportBrowserEngine.js` — supports chromium + camoufox engines
- `parseKiroBulkAccounts()` already parses `email|password`, `email:password`, tab-separated formats
- Account statuses: queued → running → success/failed/failed_invalid_credentials/failed_exchange/failed_timeout/cancelled/needs_manual
- Tokens stored in `connections` table via `exchangeAndSaveKiroSocialConnection()`
- JS-only project — NO Python, NO subprocess spawning

### Metis Review
**Identified Gaps (addressed)**:
- Login page selectors must be verified against live page (DOM inspection required in Task 1)
- Headless bot detection on `auth.desktop.kiro.dev` — camoufox recommended as default engine
- State param: email flow doesn't need CSRF state (no social provider), skip validation
- Token expiry: same refresh endpoint works for email auth (confirmed via etteum-pool)
- MFA/CAPTCHA → `needs_manual` status (same as Google flow, no new status needed)
- Quota fetching: happens during import (match etteum-pool behavior)
- Isolation: email flow must NOT touch existing Google flow code paths

---

## Work Objectives

### Core Objective
Add `authMethod: "email"` to Kiro bulk import, enabling users to paste `email:password` credentials and have them automatically authenticated via PKCE browser automation.

### Concrete Deliverables
- `kiroEmailAutomation.js` — standalone Playwright automation module
- `kiro.js` updated — `buildEmailPasswordLoginUrl(codeChallenge)` method
- `kiroBulkImportManager.js` updated — email branch in `processAccount()`
- API route updated — `authMethod` param accepted
- Dashboard modal updated — email/password option

### Definition of Done
- [ ] POST `/api/oauth/kiro/bulk-import` with `authMethod: "email"` and valid credentials → job created, accounts reach `success` status
- [ ] Tokens saved to `connections` table (same schema as Google OAuth)
- [ ] `needs_manual` fallback fires on CAPTCHA/MFA detection
- [ ] `failed_invalid_credentials` fires on wrong password
- [ ] Existing Google OAuth flow unchanged (zero regression)

### Must Have
- PKCE code_verifier/code_challenge generated per account
- Browser intercepts `kiro://` redirect (reuse `createKiroCallbackMonitor`)
- Token exchange via `kiro.js:exchangeSocialCode()` (reuse existing)
- Quota fetched during import and stored
- `needs_manual` fallback for CAPTCHA/MFA detection
- camoufox as default engine for email flow (bot detection risk)

### Must NOT Have (Guardrails)
- NO modification to existing Google/GitHub OAuth code paths
- NO Python subprocess spawning — pure JS Playwright only
- NO new account status values — reuse existing status set
- NO changes to `parseKiroBulkAccounts()` — already handles all formats
- NO separate DB table — reuse `connections` table
- NO changes to token refresh flow — works same for email auth
- NO UI changes beyond adding `authMethod` selector to existing modal

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (Vitest at `tests/vitest.config.js`)
- **Automated tests**: Tests-after (unit tests for `kiroEmailAutomation.js` helpers)
- **Framework**: Vitest
- **Agent-Executed QA**: MANDATORY for all tasks

### QA Policy
Every task includes agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario}.{ext}`.
- **API**: Bash (curl) — POST to bulk-import route, assert job created
- **Browser automation**: Playwright — navigate to Kiro login, fill form, assert redirect
- **Integration**: Bash (curl) — full end-to-end with real credentials

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation):
├── Task 1: DOM inspection + kiroEmailAutomation.js skeleton [deep]
├── Task 2: kiro.js — add buildEmailPasswordLoginUrl() [quick]
└── Task 3: kiroBulkImportManager.js — add authMethod param + processAccount() email branch [unspecified-high]

Wave 2 (After Wave 1):
├── Task 4: API route — accept authMethod param [quick]
└── Task 5: Dashboard UI — add email/password authMethod option [visual-engineering]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── F1: Plan Compliance Audit (oracle)
├── F2: Code Quality Review (unspecified-high)
├── F3: Real Manual QA (unspecified-high)
└── F4: Scope Fidelity Check (deep)
→ Present results → Get explicit user okay
```

### Dependency Matrix
- **T1**: None → blocks T3
- **T2**: None → blocks T3
- **T3**: T1, T2 → blocks T4, F1-F4
- **T4**: T3 → blocks T5, F1-F4
- **T5**: T4 → blocks F1-F4

### Agent Dispatch Summary
- **Wave 1**: T1 → `deep`, T2 → `quick`, T3 → `unspecified-high`
- **Wave 2**: T4 → `quick`, T5 → `visual-engineering`
- **FINAL**: F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [ ] 1. **DOM Inspection + `kiroEmailAutomation.js` skeleton**

  **What to do**:
  - Navigate to `https://prod.us-east-1.auth.desktop.kiro.dev/login?redirect_uri=kiro%3A%2F%2Fkiro.kiroAgent%2Fauthenticate-success&code_challenge=test&code_challenge_method=S256` using Playwright (headless: false)
  - Inspect the DOM: find exact selectors for email input, "Next" button, password input, "Sign in" button
  - Record all selectors + any anti-bot signals (Cloudflare, reCAPTCHA, device fingerprint checks)
  - Create `src/lib/oauth/services/kiroEmailAutomation.js` with:
    - `runKiroEmailAutomation({ page, email, password, onProgress })` — main automation function
    - Steps: fill email → click next → wait for password field → fill password → click sign in → wait for `kiro://` redirect
    - Reuse `createKiroCallbackMonitor` from `kiroGoogleAutomation.js` to intercept `kiro://` URL
    - Detect CAPTCHA/MFA → throw `{ code: "NEEDS_MANUAL", message: "Manual intervention required" }`
    - Detect wrong password → throw `{ code: "INVALID_CREDENTIALS", message: "Invalid email or password" }`
    - `onProgress(step, message)` callback for per-step logging

  **Must NOT do**:
  - Do NOT modify `kiroGoogleAutomation.js`
  - Do NOT handle Google/GitHub OAuth — this file is email/password ONLY
  - Do NOT introduce new account status values

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`playwright`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1, with Task 2)
  - **Blocks**: Task 3
  - **Blocked By**: None

  **References**:
  - `src/lib/oauth/services/kiroGoogleAutomation.js` — `createKiroCallbackMonitor()` to reuse for `kiro://` intercept, `runKiroGoogleAutomation()` for structural pattern
  - `src/lib/oauth/services/bulkImportBrowserEngine.js` — how browser/context is launched
  - `scripts/auth/app/providers/kiro.py` (etteum-pool) — original Python selectors: `input[name='email']`, password field, sign-in button sequence

  **Acceptance Criteria**:
  - [ ] `src/lib/oauth/services/kiroEmailAutomation.js` created
  - [ ] `runKiroEmailAutomation` exported
  - [ ] Function accepts `{ page, email, password, onProgress }` params
  - [ ] Returns `{ code, codeVerifier }` on success (same shape as Google flow)
  - [ ] Throws `{ code: "NEEDS_MANUAL" }` on CAPTCHA detection
  - [ ] Throws `{ code: "INVALID_CREDENTIALS" }` on wrong password

  ```
  Scenario: Successful email/password form navigation
    Tool: Playwright (playwright skill)
    Steps:
      1. Launch Chromium headed, navigate to Kiro login URL with code_challenge param
      2. Assert email input exists: await page.waitForSelector('input[name="email"]', {timeout: 10000})
      3. Fill email: await page.fill('input[name="email"]', 'test@example.com')
      4. Click next button, assert password field appears within 5s
      5. Assert password input exists: await page.waitForSelector('input[name="password"]', {timeout: 5000})
    Expected Result: Form navigation works, DOM selectors confirmed, screenshot captured
    Evidence: .sisyphus/evidence/task-1-login-form-dom.png

  Scenario: CAPTCHA detection fires needs_manual
    Tool: Playwright
    Steps:
      1. Mock page.waitForURL to simulate CAPTCHA page (inject script blocking kiro:// redirect)
      2. Call runKiroEmailAutomation with valid email/password
      3. Assert thrown error has code === "NEEDS_MANUAL"
    Expected Result: Function throws { code: "NEEDS_MANUAL" } not unhandled error
    Evidence: .sisyphus/evidence/task-1-captcha-needs-manual.txt
  ```

  **Commit**: YES (with Task 2)
  - Message: `feat(kiro): add email/password PKCE automation module`
  - Files: `src/lib/oauth/services/kiroEmailAutomation.js`

---

- [ ] 2. **`kiro.js` — add `buildEmailPasswordLoginUrl()`**

  **What to do**:
  - Add method to `KiroService` class in `src/lib/oauth/services/kiro.js`:
    ```js
    buildEmailPasswordLoginUrl(codeChallenge) {
      const redirectUri = "kiro://kiro.kiroAgent/authenticate-success";
      return `${KIRO_AUTH_SERVICE}/login?redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    }
    ```
  - Note: NO `idp=` param (that's for Google/GitHub), NO `state=` param (not needed for email flow)
  - Verify `exchangeSocialCode(code, codeVerifier)` already handles the token exchange correctly — it should (same endpoint, same redirect_uri)

  **Must NOT do**:
  - Do NOT modify any existing methods in `kiro.js`
  - Do NOT add state/CSRF validation — email flow doesn't need it
  - Do NOT change `buildSocialLoginUrl()` signature

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1, with Task 1)
  - **Blocks**: Task 3
  - **Blocked By**: None

  **References**:
  - `src/lib/oauth/services/kiro.js:buildSocialLoginUrl()` — existing pattern to follow (same redirect_uri, same PKCE params, just no `idp=` param)
  - `scripts/auth/app/providers/kiro.py:_build_pkce_login_url()` (etteum-pool) — confirms no state param needed

  **Acceptance Criteria**:
  - [ ] `buildEmailPasswordLoginUrl(codeChallenge)` method added to `KiroService`
  - [ ] Returns URL with correct `redirect_uri`, `code_challenge`, `code_challenge_method=S256`
  - [ ] No `idp=` param in URL
  - [ ] Existing `buildSocialLoginUrl` unchanged (diff check)

  ```
  Scenario: URL built correctly
    Tool: Bash (node REPL)
    Steps:
      1. node -e "import('./src/lib/oauth/services/kiro.js').then(m => { const s = new m.KiroService(); const url = s.buildEmailPasswordLoginUrl('abc123'); console.log(url); })"
      2. Assert output contains: redirect_uri=kiro%3A%2F%2F
      3. Assert output contains: code_challenge=abc123
      4. Assert output does NOT contain: idp=
    Expected Result: Valid URL string with correct params
    Evidence: .sisyphus/evidence/task-2-url-build.txt
  ```

  **Commit**: YES (with Task 1)
  - Message: `feat(kiro): add email/password PKCE automation module`
  - Files: `src/lib/oauth/services/kiro.js`

---

- [ ] 3. **`kiroBulkImportManager.js` — add `authMethod: "email"` branch**

  **What to do**:
  - Add `authMethod` field to job object (default: `"google"`, new value: `"email"`)
  - In `startJob()`: accept `authMethod` param, validate it (`"google"` | `"email"`), store in job
  - In `processAccount()`: add branch:
    ```js
    if (job.authMethod === "email") {
      // Email/password PKCE flow
      const { generatePkcePair } = await import("./kiroConnections.js"); // or crypto module
      const { codeVerifier, codeChallenge } = generatePkcePair();
      const kiroService = this.kiroServiceFactory();
      const loginUrl = kiroService.buildEmailPasswordLoginUrl(codeChallenge);
      const { page, context } = await setupFingerprintedContext(browser, job);
      const callbackMonitor = createKiroCallbackMonitor({ page, codeVerifier });
      await page.goto(loginUrl);
      const { code } = await runKiroEmailAutomation({ page, email: account.email, password: account.password, onProgress: (step, msg) => appendAccountLog(account, step, msg) });
      const tokens = await kiroService.exchangeSocialCode(code, codeVerifier);
      // Save connection (reuse existing socialExchange pattern)
      const connectionId = await this.socialExchange({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, profileArn: tokens.profileArn, email: account.email });
      account.connectionId = connectionId;
      account.status = "success";
    }
    ```
  - Handle `NEEDS_MANUAL` → set `account.status = "needs_manual"` (same as Google flow)
  - Handle `INVALID_CREDENTIALS` → set `account.status = "failed_invalid_credentials"`
  - Handle timeout → set `account.status = "failed_timeout"`
  - Ensure `cancelRequested` check still fires during email flow

  **Must NOT do**:
  - Do NOT touch the existing Google flow code path
  - Do NOT add new account status values beyond existing set
  - Do NOT change `parseKiroBulkAccounts()` — already works

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 4, F1-F4
  - **Blocked By**: Task 1, Task 2

  **References**:
  - `src/lib/oauth/services/kiroBulkImportManager.js:processAccount()` — existing Google flow to follow as pattern (lines ~600-750)
  - `src/lib/oauth/services/kiroGoogleAutomation.js:createKiroCallbackMonitor()` — reuse for email flow
  - `src/lib/oauth/services/kiroConnections.js:exchangeAndSaveKiroSocialConnection()` — token save pattern
  - `src/lib/oauth/services/kiroEmailAutomation.js` (Task 1 output) — the automation to call

  **Acceptance Criteria**:
  - [ ] `startJob({ authMethod: "email", ... })` accepted without error
  - [ ] `job.authMethod` stored and persisted to JSON file
  - [ ] Email flow runs when `authMethod === "email"` and Google flow runs when `authMethod === "google"` or undefined
  - [ ] `failed_invalid_credentials` status set on wrong password
  - [ ] `needs_manual` status set on CAPTCHA
  - [ ] Tokens saved to connections table after success

  ```
  Scenario: Job created with authMethod email
    Tool: Bash (curl)
    Steps:
      1. curl -X POST http://localhost:20128/api/oauth/kiro/bulk-import \
           -H "Content-Type: application/json" \
           -d '{"accounts":["test@example.com:wrongpassword"],"authMethod":"email"}'
      2. Assert response: {"success":true,"job":{"jobId":"...","status":"running"}}
      3. curl http://localhost:20128/api/oauth/kiro/bulk-import/latest
      4. Assert job.accounts[0].status eventually reaches "failed_invalid_credentials" (poll 3x with 5s sleep)
    Expected Result: Job runs email flow, fails gracefully with correct status
    Evidence: .sisyphus/evidence/task-3-email-job-create.json

  Scenario: Google flow unaffected
    Tool: Bash (curl)
    Steps:
      1. POST bulk-import WITHOUT authMethod field
      2. Assert job.authMethod defaults to "google" or undefined
      3. Assert Google automation code path is called (check logs for "google" step labels)
    Expected Result: Existing Google flow unchanged
    Evidence: .sisyphus/evidence/task-3-google-unaffected.json
  ```

  **Commit**: YES
  - Message: `feat(kiro): integrate email/password flow into bulk import manager`
  - Files: `src/lib/oauth/services/kiroBulkImportManager.js`

---

- [ ] 4. **API route — accept `authMethod` param**

  **What to do**:
  - Edit `src/app/api/oauth/kiro/bulk-import/route.js` POST handler:
    - Extract `authMethod` from request body: `const authMethod = body?.authMethod || "google"`
    - Validate: must be `"google"` or `"email"`, else return 400
    - Pass to `manager.startJob({ ..., authMethod })`

  **Must NOT do**:
  - Do NOT change any other params or validation logic
  - Do NOT add authMethod to GET routes

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (sequential after Task 3)
  - **Blocks**: Task 5, F1-F4
  - **Blocked By**: Task 3

  **References**:
  - `src/app/api/oauth/kiro/bulk-import/route.js` — existing POST handler (add authMethod extraction after `engine` param)

  **Acceptance Criteria**:
  - [ ] `authMethod: "email"` accepted, passed to manager
  - [ ] `authMethod: "invalid"` returns 400 with error message
  - [ ] `authMethod` omitted → defaults to `"google"` (backward compatible)

  ```
  Scenario: Invalid authMethod rejected
    Tool: Bash (curl)
    Steps:
      1. curl -X POST http://localhost:20128/api/oauth/kiro/bulk-import \
           -H "Content-Type: application/json" \
           -d '{"accounts":["test@example.com:pass"],"authMethod":"invalid"}'
      2. Assert HTTP 400
      3. Assert response body contains "authMethod"
    Expected Result: 400 error with descriptive message
    Evidence: .sisyphus/evidence/task-4-invalid-authmethod.json
  ```

  **Commit**: YES (with Task 5)
  - Message: `feat(kiro): expose authMethod in bulk import API and dashboard UI`
  - Files: `src/app/api/oauth/kiro/bulk-import/route.js`

---

- [ ] 5. **Dashboard UI — add `authMethod` selector to bulk import modal**

  **What to do**:
  - Find the Kiro bulk import modal component (likely `BulkAccountAutomationModal` or similar in `src/shared/` or dashboard page)
  - Add `authMethod` radio/select with options: `"google"` (default, existing label) and `"email"` (new label: "Email / Password")
  - Pass `authMethod` in POST body to `/api/oauth/kiro/bulk-import`
  - Show email/password format hint when `authMethod === "email"`: `"Format: email@example.com:password (one per line)"`
  - Show Google format hint when `authMethod === "google"` (existing behavior)
  - Default: `"google"` (backward compatible)

  **Must NOT do**:
  - Do NOT remove or restyle the Google OAuth option
  - Do NOT add new fields beyond `authMethod` selector
  - Do NOT change the credentials textarea or parsing logic

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (needs Task 4 route to accept authMethod)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 4

  **References**:
  - Search `src/shared/` and `src/app/(dashboard)/` for `bulk-import` or `BulkAccount` components
  - `src/app/api/oauth/kiro/bulk-import/route.js` — POST body shape (authMethod field added in Task 4)
  - Existing provider selector patterns in dashboard (codebuddy modal for reference)

  **Acceptance Criteria**:
  - [ ] `authMethod` radio/select rendered in modal with "Google" and "Email / Password" options
  - [ ] Selecting "Email / Password" shows format hint text
  - [ ] POST body includes `authMethod` field when submitting
  - [ ] Default selection is "Google" (backward compatible)
  - [ ] Visual style matches existing modal UI

  ```
  Scenario: authMethod selector visible in modal
    Tool: Playwright
    Steps:
      1. Navigate to http://localhost:20128
      2. Go to Providers → Kiro page
      3. Click "Bulk Import" button
      4. Assert modal opens: await page.waitForSelector('[data-testid="bulk-import-modal"]', {timeout: 5000})
      5. Assert authMethod selector exists with at least 2 options
      6. Assert default selection is "google" or "Google"
      7. Select "Email / Password" option
      8. Assert format hint text appears containing "email@example.com:password"
      9. Screenshot: .sisyphus/evidence/task-5-authmethod-selector.png
    Expected Result: Selector renders, default is Google, hint text shows on email selection
    Evidence: .sisyphus/evidence/task-5-authmethod-selector.png

  Scenario: authMethod included in POST body
    Tool: Playwright + Network intercept
    Steps:
      1. Open modal, select "Email / Password"
      2. Paste "test@example.com:pass123" in textarea
      3. Intercept network: page.route('/api/oauth/kiro/bulk-import', ...)
      4. Click Submit
      5. Assert intercepted POST body contains: authMethod === "email"
    Expected Result: POST body has correct authMethod value
    Evidence: .sisyphus/evidence/task-5-post-body.json
  ```

  **Commit**: YES (with Task 4)
  - Message: `feat(kiro): expose authMethod in bulk import API and dashboard UI`
  - Files: dashboard modal component file(s)

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read plan end-to-end. Verify every Must Have is implemented. Search for forbidden patterns from Must NOT Have. Check evidence files exist. Compare deliverables vs plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `npm run build` + check for `console.log` in prod, empty catches, unused imports. Verify Google flow untouched (git diff shows only expected files changed).
  Output: `Build [PASS/FAIL] | Files [N clean/N issues] | Google flow [UNTOUCHED/MODIFIED] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Execute every QA scenario. Test email flow end-to-end. Verify Google flow still works. Save evidence to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  Verify 1:1 — everything in spec built, nothing beyond spec built. Check Must NOT do compliance. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

- **Wave 1+2**: `feat(kiro): add email/password bulk import automation`
  Files: `src/lib/oauth/services/kiroEmailAutomation.js`, `src/lib/oauth/services/kiro.js`, `src/lib/oauth/services/kiroBulkImportManager.js`, `src/app/api/oauth/kiro/bulk-import/route.js`
- **UI**: `feat(dashboard): add email/password option to kiro bulk import modal`
  Files: dashboard component

---

## Success Criteria

### Verification Commands
```bash
# Start job with email auth
curl -X POST http://localhost:20128/api/oauth/kiro/bulk-import \
  -H "Content-Type: application/json" \
  -d '{"accounts":["test@example.com:password123"],"authMethod":"email","engine":"camoufox"}'
# Expected: {"success":true,"job":{"jobId":"...","status":"running"}}

# Poll job status
curl http://localhost:20128/api/oauth/kiro/bulk-import/latest
# Expected: accounts[0].status eventually = "success" or "failed_invalid_credentials"
```

### Final Checklist
- [ ] Email+password bulk import works end-to-end
- [ ] Google OAuth flow unchanged
- [ ] Tokens in connections table after success
- [ ] needs_manual fires on CAPTCHA
- [ ] failed_invalid_credentials fires on wrong password
