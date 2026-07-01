# Qwen Cloud JS Bulk Import Manager

## TL;DR

> **Quick Summary**: Implement `qwenCloudBulkImportManager.js` — a JS/Playwright bulk account registration automation for Qwen Cloud (home.qwencloud.com), following the existing KiroBulkImportManager pattern. Flow is fully reverse-engineered from a live HAR capture.
>
> **Deliverables**:
> - `src/lib/oauth/services/qwenCloudBulkImportManager.js` (main manager, ~400 lines)
> - `src/app/api/oauth/qwen-cloud/bulk-import/route.js` (POST start)
> - `src/app/api/oauth/qwen-cloud/bulk-import/latest/route.js` (GET latest)
> - `src/app/api/oauth/qwen-cloud/bulk-import/[jobId]/route.js` (GET by id)
> - `src/app/api/oauth/qwen-cloud/bulk-import/[jobId]/cancel/route.js` (POST cancel)
> - `QWEN_CLOUD_HANDOFF.md` updated with HAR-corrected Phase 6 params
> - `src/shared/constants/providers.js` updated with qwen_cloud automation flag
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 2 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4

---

## Context

### Original Request
Implement JS version of Qwen Cloud auto-registration (Python working reference exists). Flow fully traced from live HAR (401 entries, 2026-06-25).

### Interview Summary
**Key Discussions**:
- Full flow confirmed from HAR: Phase 1–6 working
- Key corrections vs old HANDOFF doc found in HAR analysis
- Existing pattern: extend KiroBulkImportManager, follow qoderBulkImportManager structure

**Research Findings**:
- `qwenCloudBulkImportManager.js` does NOT exist yet — create from scratch
- Base class: `src/lib/oauth/services/kiroBulkImportManager.js` (1013 lines)
- Closest analog: `src/lib/oauth/services/qoderBulkImportManager.js` (335 lines)
- DB: `connectionsRepo.js` — apiKey/workspaceId/tenantId/userId go into `data` JSON blob
- Provider registry: `open-sse/providers/registry/qwen_cloud.js` exists for inference routing

### Metis Review
**Identified Gaps** (addressed):
- `reqDTO.relatedUserId` required (= `login_aliyunid_pk` cookie) — added to plan
- `cornerstoneParam.switchAgent` = numeric tenantId from listWorkspaces — corrected
- `switchAgentType` field removed — corrected
- `V: "1.0"` required in params wrapper — added
- initSpace + listWorkspaces steps required before createApiKey — added
- `saveConnection` must use `authType: "apikey"`, not `accessToken` — noted
- API route set: 4 routes needed (no `manual/` route since Phase 6 is pure HTTP)

---

## Work Objectives

### Core Objective
Create a fully working JS bulk import manager for Qwen Cloud that registers Gmail dot-trick variants via Playwright, extracts session cookies, makes pure HTTP calls to get/create API keys, and stores them in the DB following the existing bulk import manager pattern.

### Concrete Deliverables
- Manager file with full 6-phase flow
- 4 API route files
- HANDOFF doc updated
- providers.js UI flag added

### Definition of Done
- [ ] `npm run build` passes with no errors
- [ ] Manager can be instantiated via `getQwenCloudBulkImportManager()`
- [ ] A job can be started via POST `/api/oauth/qwen-cloud/bulk-import`
- [ ] API key `sk-ws-H.*` stored in DB after successful run

### Must Have
- Full Phase 1–6 flow matching HAR
- `bx-ua` submitted via browser click (not plain HTTP)
- `relatedUserId` in createApiKey reqDTO
- `switchAgent` = numeric tenantId from listWorkspaces
- `V: "1.0"` in params wrapper
- initSpace + listWorkspaces before createApiKey
- Singleton pattern via `globalThis.__qwenCloudBulkImportSingleton`
- Cookie extraction: `login_qwencloud_ticket` + `login_aliyunid_pk`

### Must NOT Have (Guardrails)
- No `switchAgentType` field (removed in new API)
- No plain HTTP POST for snsEmailRegister (bx-ua bypass attempt)
- No `accessToken` field for storing API key — use `apiKey` in data blob
- No separate plan files — everything in this one plan
- Do not touch `open-sse/providers/registry/qwen_cloud.js` (inference routing, separate concern)
- Do not implement dashboard UI — out of scope
- Do not add Gmail dot-trick generation logic — use email as-is from input

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (Vitest at `tests/vitest.config.js`)
- **Automated tests**: NO (existing managers have no unit tests — match convention)
- **Agent-Executed QA**: YES (mandatory)

### QA Policy
- **API**: curl for route smoke tests
- **Manager**: Node REPL import test
- **Build**: `npm run build` for type/syntax check

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation):
├── Task 1: qwenCloudBulkImportManager.js (core manager)
└── Task 2: HANDOFF doc update + providers.js flag

Wave 2 (After Task 1 — API routes, all parallel):
├── Task 3a: bulk-import/route.js (POST start)
├── Task 3b: bulk-import/latest/route.js (GET latest)
├── Task 3c: bulk-import/[jobId]/route.js (GET by id)
└── Task 3d: bulk-import/[jobId]/cancel/route.js (POST cancel)

Wave FINAL (After ALL — verification):
└── Task 4: Build check + QA smoke tests
```

### Dependency Matrix
- **Task 1**: none → blocks Task 3a–3d
- **Task 2**: none → independent
- **Task 3a–3d**: depends on Task 1 (imports manager)
- **Task 4**: depends on all

---

## TODOs

- [x] 1. Create `src/lib/oauth/services/qwenCloudBulkImportManager.js`

  **What to do**:
  - Extend `KiroBulkImportManager` from `./kiroBulkImportManager.js`
  - Implement `async _runWorker(worker, account)` with full Phase 1–6 flow
  - Phase 1–2: `page.goto('https://home.qwencloud.com/api-keys')` → wait for alibabacloud → click Google button → fill email/password
  - Phase 3: `waitForURL('**/first_login.htm**')` → extract `snsToken` from URL via regex `token=(idc_[^&]+)`
  - Phase 4: Wait for form to appear → browser clicks submit (bx-ua auto-generated by browser)
  - Phase 5: `waitForURL('**/home.qwencloud.com/**', {timeout:60000})` → extract cookies
  - Phase 6a: `fetch('https://home.qwencloud.com/tool/user/info.json')` with cookie header → get `secToken`
  - Phase 6b: Extract `login_aliyunid_pk` from cookies → this is `userId`
  - Phase 6c: POST `initSpace` to `cs-data.qwencloud.com`
  - Phase 6d: POST `listWorkspaces4Agent` → extract `tenantId` from `data[0].tenantId`
  - Phase 6e: POST `listApiKeys4Agent` with `switchAgent: tenantId`
  - Phase 6f: POST `createApiKey4AgentV4` with `relatedUserId`, `switchAgent: tenantId`, `V: "1.0"`
  - Save via `this._saveConnection({provider:'qwen_cloud', email, authType:'apikey', apiKey: key, data:{workspaceId, keyId:id, tenantId, userId}})`
  - Singleton export: `getQwenCloudBulkImportManager()`

  **Must NOT do**:
  - No plain HTTP for snsEmailRegister
  - No `switchAgentType` field
  - No `accessToken` usage
  - No Gmail dot-trick generation (use email as-is)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Complex browser automation + HTTP orchestration, needs careful implementation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 3a–3d
  - **Blocked By**: None

  **References**:

  Pattern References:
  - `src/lib/oauth/services/qoderBulkImportManager.js:1-335` — closest analog: Google OAuth + token gen, same structure
  - `src/lib/oauth/services/kiroBulkImportManager.js:1-100` — base class constructor, `_runWorker` signature
  - `src/lib/oauth/services/codebuddyBulkImportManager.js` — Phase 6 pure HTTP pattern after cookie capture

  API/Type References:
  - `src/lib/db/repos/connectionsRepo.js` — `saveConnection` shape, `data` blob usage
  - HAR entry [213]: snsEmailRegister exact field names
  - HAR entry [273]: user/info.json response shape (`data.secToken`)
  - HAR entry [305]: initSpace exact params shape
  - HAR entry [316]: listWorkspaces4Agent response (`data[0].tenantId`)
  - HAR entry [382]: createApiKey4AgentV4 exact params (relatedUserId, switchAgent, V:"1.0")

  External References:
  - `QWEN_CLOUD_HANDOFF.md` in etteum-pool — full flow documentation

  **Acceptance Criteria**:
  - [ ] File exists at correct path
  - [ ] `import { getQwenCloudBulkImportManager } from './qwenCloudBulkImportManager.js'` resolves without error
  - [ ] Class extends KiroBulkImportManager
  - [ ] `_runWorker` method present with all 6 phases

  **QA Scenarios**:

  ```
  Scenario: Import resolves without syntax error
    Tool: Bash (node)
    Preconditions: File created
    Steps:
      1. cd C:\Users\Nazril\Documents\Projek\Github\9router_wyx0
      2. node --input-type=module <<< "import { getQwenCloudBulkImportManager } from './src/lib/oauth/services/qwenCloudBulkImportManager.js'; console.log('OK:', typeof getQwenCloudBulkImportManager)"
      3. Assert output contains "OK: function"
    Expected Result: "OK: function"
    Failure Indicators: SyntaxError, import error, "undefined"
    Evidence: .sisyphus/evidence/task-1-import-check.txt

  Scenario: createApiKey params shape matches HAR
    Tool: Bash (node REPL)
    Preconditions: File created
    Steps:
      1. Read file, grep for "relatedUserId" — must be present
      2. grep for "switchAgent" (not "switchAgentType") — must be present
      3. grep for '"V"' or "'V'" with value "1.0" — must be present
      4. grep for "switchAgentType" — must NOT be present
    Expected Result: relatedUserId ✅, switchAgent ✅, V:1.0 ✅, switchAgentType ❌
    Evidence: .sisyphus/evidence/task-1-params-check.txt
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `feat(oauth): add qwenCloudBulkImportManager`
  - Files: `src/lib/oauth/services/qwenCloudBulkImportManager.js`

---

- [x] 2. Update `QWEN_CLOUD_HANDOFF.md` + `src/shared/constants/providers.js`

  **What to do**:
  - Update `QWEN_CLOUD_HANDOFF.md` in `C:\Users\Nazril\Documents\Projek\Github\etteum-pool\`:
    - Fix Phase 6 createApiKey params: add `relatedUserId`, replace `switchAgentType:"1"` with `switchAgent:<tenantId>`, add `V:"1.0"`
    - Add Phase 6c initSpace step
    - Add Phase 6d listWorkspaces4Agent step (with tenantId extraction)
    - Update JS skeleton to match corrected params
    - Add note: "HAR Analysis 2026-06-25 corrections applied"
  - Update `src/shared/constants/providers.js` in 9router_wyx0:
    - Add `qwen_cloud` to automation-capable providers list (check how other providers like `qoder`, `codebuddy` are flagged)

  **Must NOT do**:
  - Do not change inference endpoint or model list in HANDOFF
  - Do not touch `open-sse/` files

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple text updates, known exact changes
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/shared/constants/providers.js` — existing automation flags pattern
  - HAR analysis findings (relatedUserId, switchAgent, V, initSpace, listWorkspaces)

  **Acceptance Criteria**:
  - [ ] HANDOFF doc contains `relatedUserId`
  - [ ] HANDOFF doc contains `switchAgent` (not `switchAgentType`)
  - [ ] HANDOFF doc contains `V: "1.0"`
  - [ ] HANDOFF doc documents initSpace and listWorkspaces4Agent steps
  - [ ] providers.js has qwen_cloud automation flag

  **QA Scenarios**:

  ```
  Scenario: HANDOFF doc has correct params
    Tool: Bash (grep)
    Steps:
      1. grep "relatedUserId" QWEN_CLOUD_HANDOFF.md → must match
      2. grep "switchAgent" QWEN_CLOUD_HANDOFF.md → must match
      3. grep "switchAgentType" QWEN_CLOUD_HANDOFF.md → must NOT match (removed)
      4. grep "initSpace" QWEN_CLOUD_HANDOFF.md → must match
      5. grep "listWorkspaces" QWEN_CLOUD_HANDOFF.md → must match
    Expected Result: All greps pass
    Evidence: .sisyphus/evidence/task-2-handoff-check.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `docs: update QWEN_CLOUD_HANDOFF with HAR corrections`
  - Files: `QWEN_CLOUD_HANDOFF.md`, `src/shared/constants/providers.js`

---

- [x] 3a. Create `src/app/api/oauth/qwen-cloud/bulk-import/route.js` (POST start)

  **What to do**:
  - POST handler: parse `{accounts:[{email,password}]}` from body
  - Call `getQwenCloudBulkImportManager().startJob(accounts)`
  - Return `{jobId, status}`
  - Follow exact pattern from `src/app/api/oauth/qoder/bulk-import/route.js`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 3b, 3c, 3d)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 4
  - **Blocked By**: Task 1

  **References**:
  - `src/app/api/oauth/qoder/bulk-import/route.js` — exact pattern to copy

  **Acceptance Criteria**:
  - [ ] File exists, exports `POST` handler
  - [ ] Calls `getQwenCloudBulkImportManager()`

  **QA Scenarios**:

  ```
  Scenario: Route file exports POST handler
    Tool: Bash (node)
    Steps:
      1. node --input-type=module <<< "import { POST } from './src/app/api/oauth/qwen-cloud/bulk-import/route.js'; console.log('POST:', typeof POST)"
      2. Assert output: "POST: function"
    Expected Result: "POST: function"
    Evidence: .sisyphus/evidence/task-3a-route-check.txt
  ```

  **Commit**: YES (groups with 3b, 3c, 3d)
  - Message: `feat(api): add qwen-cloud bulk-import routes`

---

- [x] 3b. Create `src/app/api/oauth/qwen-cloud/bulk-import/latest/route.js` (GET latest)

  **What to do**:
  - GET handler: return latest job status
  - Follow `src/app/api/oauth/qoder/bulk-import/latest/route.js`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 3a, 3c, 3d)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 4
  - **Blocked By**: Task 1

  **References**:
  - `src/app/api/oauth/qoder/bulk-import/latest/route.js`

  **Acceptance Criteria**:
  - [ ] File exists, exports `GET` handler

  **QA Scenarios**:

  ```
  Scenario: Route exports GET handler
    Tool: Bash (node)
    Steps:
      1. node --input-type=module <<< "import { GET } from './src/app/api/oauth/qwen-cloud/bulk-import/latest/route.js'; console.log('GET:', typeof GET)"
    Expected Result: "GET: function"
    Evidence: .sisyphus/evidence/task-3b-route-check.txt
  ```

  **Commit**: YES (groups with 3a, 3c, 3d)

---

- [x] 3c. Create `src/app/api/oauth/qwen-cloud/bulk-import/[jobId]/route.js` (GET by id)

  **What to do**:
  - GET handler: return job by `params.jobId`
  - Follow `src/app/api/oauth/qoder/bulk-import/[jobId]/route.js`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 3a, 3b, 3d)
  - **Parallel Group**: Wave 2
  - **Blocked By**: Task 1

  **References**:
  - `src/app/api/oauth/qoder/bulk-import/[jobId]/route.js`

  **Acceptance Criteria**:
  - [ ] File exists, exports `GET` handler

  **QA Scenarios**:

  ```
  Scenario: Route exports GET handler
    Tool: Bash (node)
    Steps:
      1. node --input-type=module <<< "import { GET } from './src/app/api/oauth/qwen-cloud/bulk-import/[jobId]/route.js'; console.log('GET:', typeof GET)"
    Expected Result: "GET: function"
    Evidence: .sisyphus/evidence/task-3c-route-check.txt
  ```

  **Commit**: YES (groups with 3a, 3b, 3d)

---

- [x] 3d. Create `src/app/api/oauth/qwen-cloud/bulk-import/[jobId]/cancel/route.js` (POST cancel)

  **What to do**:
  - POST handler: cancel job by `params.jobId`
  - Follow `src/app/api/oauth/qoder/bulk-import/[jobId]/cancel/route.js`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 3a, 3b, 3c)
  - **Parallel Group**: Wave 2
  - **Blocked By**: Task 1

  **References**:
  - `src/app/api/oauth/qoder/bulk-import/[jobId]/cancel/route.js`

  **Acceptance Criteria**:
  - [ ] File exists, exports `POST` handler

  **QA Scenarios**:

  ```
  Scenario: Route exports POST handler
    Tool: Bash (node)
    Steps:
      1. node --input-type=module <<< "import { POST } from './src/app/api/oauth/qwen-cloud/bulk-import/[jobId]/cancel/route.js'; console.log('POST:', typeof POST)"
    Expected Result: "POST: function"
    Evidence: .sisyphus/evidence/task-3d-route-check.txt
  ```

  **Commit**: YES (groups with 3a, 3b, 3c)
  - Message: `feat(api): add qwen-cloud bulk-import routes`
  - Files: all 4 route files

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read plan end-to-end. Verify all Must Have items present in implementation. Check Must NOT Have: grep for `switchAgentType`, `accessToken` usage for API key — reject if found. Check evidence files exist.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `npm run build` from project root. Check all new files for: unused imports, console.log in prod, hardcoded secrets. Verify singleton pattern is correct.
  Output: `Build [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Execute all QA scenarios from all tasks. Verify import chain resolves. Run param shape checks.
  Output: `Scenarios [N/N pass] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  Verify only the 6 planned files were created/modified. No extra files touched. No open-sse files modified.
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- Wave 1: `feat(oauth): add qwenCloudBulkImportManager` + `docs: update QWEN_CLOUD_HANDOFF with HAR corrections`
- Wave 2: `feat(api): add qwen-cloud bulk-import routes`

---

## Success Criteria

### Verification Commands
```bash
# Import check
node --input-type=module <<< "import { getQwenCloudBulkImportManager } from './src/lib/oauth/services/qwenCloudBulkImportManager.js'; console.log(typeof getQwenCloudBulkImportManager)"
# Expected: function

# Build check
npm run build
# Expected: exit 0, no errors

# Param shape check
grep -n "relatedUserId" src/lib/oauth/services/qwenCloudBulkImportManager.js
grep -n "switchAgent" src/lib/oauth/services/qwenCloudBulkImportManager.js
grep -n "switchAgentType" src/lib/oauth/services/qwenCloudBulkImportManager.js  # must be empty
```

### Final Checklist
- [ ] `qwenCloudBulkImportManager.js` created with full Phase 1–6
- [ ] `getQwenCloudBulkImportManager()` singleton export works
- [ ] All 4 API routes created
- [ ] `QWEN_CLOUD_HANDOFF.md` updated with HAR corrections
- [ ] `providers.js` has qwen_cloud automation flag
- [ ] `npm run build` passes
- [ ] No `switchAgentType` in codebase
- [ ] `relatedUserId` + `switchAgent` + `V:"1.0"` present in createApiKey call
