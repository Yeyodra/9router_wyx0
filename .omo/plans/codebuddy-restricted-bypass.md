# CodeBuddy Restricted Account Bypass - Header Spoofing

## TL;DR

> **Quick Summary**: Add CLI spoofing headers to CodeBuddy provider to bypass restricted account detection, matching the pattern used by agentrouter provider.
>
> **Deliverables**:
> - Enhanced headers in CodeBuddy provider
> - Automated test for header correctness
> - Verification with restricted test account
>
> **Estimated Effort**: Quick (1-2 hours)
> **Parallel Execution**: NO - single file modification
> **Critical Path**: Test → Implement → Verify

---

## Context

### Original Request
Fix CodeBuddy provider untuk handle restricted accounts. Accounts yang ke-restrict tidak bisa dipakai di 9router, padahal di router lain (agentrouter pattern) bisa.

### Interview Summary
**Key Discussions**:
- Problem: CodeBuddy accounts get restricted, but agentrouter (using CLAUDE_CLI_SPOOF_HEADERS) can handle similar restrictions
- Solution: Add X-App: cli + X-Stainless-* headers to CodeBuddy requests
- Location: open-sse/executors/default.js buildHeaders() method, CodeBuddy case (lines 276-293)

**Research Findings**:
- Current CodeBuddy headers: Already has User-Agent: CLI/2.105.2 CodeBuddy/2.105.2
- Missing headers: X-App: cli, X-Stainless-Runtime, X-Stainless-Lang, X-Stainless-Helper-Method, X-Stainless-Retry-Count
- Pattern reference: agentrouter uses CLAUDE_CLI_SPOOF_HEADERS successfully

### Metis Review
**Identified Gaps** (addressed):
- Guardrails set: Do NOT import CLAUDE_CLI_SPOOF_HEADERS (would add Anthropic-specific headers)
- Static 5-header subset chosen (not full dynamic pattern)
- Test in scope: YES
- refreshCodeBuddy() out of scope

---

## Work Objectives

### Core Objective
Add CLI spoofing headers to CodeBuddy provider to bypass restricted account detection, matching the pattern used by agentrouter.

### Concrete Deliverables
- Modified `open-sse/executors/default.js` with 5 new headers in CodeBuddy case
- Test file verifying header correctness
- Verification with restricted test account

### Definition of Done
- [ ] CodeBuddy requests include X-App: cli header
- [ ] CodeBuddy requests include 4 X-Stainless-* headers
- [ ] Test passes verifying all headers present
- [ ] Restricted account can successfully complete chat request
- [ ] Existing CodeBuddy accounts still work

### Must Have
- X-App: cli header added to CodeBuddy requests
- X-Stainless-Runtime: node header
- X-Stainless-Lang: js header
- X-Stainless-Helper-Method: stream header
- X-Stainless-Retry-Count: 0 header
- Automated test for header presence

### Must NOT Have (Guardrails)
- Do NOT import CLAUDE_CLI_SPOOF_HEADERS into default.js
- Do NOT change existing CodeBuddy User-Agent
- Do NOT touch refreshCodeBuddy() method
- Do NOT modify providers.js
- Do NOT add Anthropic-specific headers (Anthropic-Version, Anthropic-Beta, etc.)
- Do NOT affect other providers (claude, gemini, etc.)

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: TDD (Test-Driven Development)
- **Framework**: bun test (per package.json)
- **TDD**: Each task follows RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task includes agent-executed QA scenarios.
Evidence saved to `.omo/evidence/task-{N}-{scenario-slug}.{ext}`.

---

## Execution Strategy

### Sequential Execution (Single Thread)
```
Task 1 → Task 2 → Task 3 → Task 4 → Final Verification
```

### Dependency Matrix
- **1**: - → 2, 3
- **2**: 1 - → 4
- **3**: 1 - → 4
- **4**: 2, 3 - → F1-F4

---

## TODOs

- [x] 1. Write failing test for CodeBuddy headers

  **What to do**:
  - Create test file or add to existing test file
  - Test should verify buildHeaders() for codebuddy includes new headers
  - Assert presence of: X-App: cli, X-Stainless-Runtime: node, X-Stainless-Lang: js, X-Stainless-Helper-Method: stream, X-Stainless-Retry-Count: 0
  - Run test to confirm it fails (RED phase)

  **Must NOT do**:
  - Do NOT test other providers
  - Do NOT test refreshCodeBuddy()
  - Do NOT modify implementation yet

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple test file creation, straightforward assertions
  - **Skills**: [`tdd-guide`]
    - `tdd-guide`: TDD workflow guidance

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (Task 1)
  - **Blocks**: Task 2, Task 3
  - **Blocked By**: None (can start immediately)

  **References**:
  - `tests/unit/claude-header-forwarding.test.js` - Existing test pattern for buildHeaders()
  - `open-sse/executors/default.js:276-293` - CodeBuddy case to test
  - `open-sse/config/providers.js:29-45` - CLAUDE_CLI_SPOOF_HEADERS reference (headers to copy)

  **Acceptance Criteria**:
  - [ ] Test file created or updated
  - [ ] Test asserts presence of 5 new headers
  - [ ] bun test fails with expected error (RED phase confirmed)

  **QA Scenarios**:
  ```
  Scenario: Test fails before implementation
    Tool: Bash (bun test)
    Preconditions: Implementation not yet modified
    Steps:
      1. Run: bun test <test-file>
      2. Assert: Test fails with "expected header X-App to be present"
    Expected Result: Test fails (RED phase)
    Evidence: .omo/evidence/task-1-test-fails.txt
  ```

  **Commit**: NO (will commit with implementation)

- [x] 2. Add CLI spoofing headers to CodeBuddy provider

  **What to do**:
  - Modify buildHeaders() method in default.js
  - Add 5 new headers after existing CodeBuddy headers (line 282)
  - Headers to add: X-App: cli, X-Stainless-Runtime: node, X-Stainless-Lang: js, X-Stainless-Helper-Method: stream, X-Stainless-Retry-Count: 0
  - Keep all existing CodeBuddy headers intact
  - Run test to confirm it passes (GREEN phase)

  **Must NOT do**:
  - Do NOT import CLAUDE_CLI_SPOOF_HEADERS
  - Do NOT change User-Agent
  - Do NOT add Anthropic-specific headers
  - Do NOT touch refreshCodeBuddy()

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small code change, clear scope
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (Task 2)
  - **Blocks**: Task 4
  - **Blocked By**: Task 1 (test must exist first)

  **References**:
  - `open-sse/executors/default.js:276-293` - Exact location to modify
  - `open-sse/config/providers.js:29-45` - Header values reference
  - `open-sse/executors/default.js:426-450` - refreshCodeBuddy() (DO NOT TOUCH)

  **Acceptance Criteria**:
  - [ ] 5 new headers added to CodeBuddy case
  - [ ] Existing headers unchanged
  - [ ] bun test passes (GREEN phase)
  - [ ] No other providers affected

  **QA Scenarios**:
  ```
  Scenario: Test passes after implementation
    Tool: Bash (bun test)
    Preconditions: Implementation complete
    Steps:
      1. Run: bun test <test-file>
      2. Assert: All tests pass
    Expected Result: Tests pass (GREEN phase)
    Evidence: .omo/evidence/task-2-test-passes.txt
  
  Scenario: No regression in other providers
    Tool: Bash (bun test)
    Preconditions: Implementation complete
    Steps:
      1. Run: bun test tests/unit/claude-header-forwarding.test.js
      2. Assert: All existing tests still pass
    Expected Result: No test failures
    Evidence: .omo/evidence/task-2-no-regression.txt
  ```

  **Commit**: YES
  - Message: `fix(codebuddy): add CLI spoofing headers for restricted account bypass`
  - Files: `open-sse/executors/default.js`, `<test-file>`
  - Pre-commit: `bun test`

- [x] 3. Verify header correctness with restricted account (manual verification documented)

  **What to do**:
  - Use restricted test account to make actual CodeBuddy request
  - Verify request succeeds (no longer blocked)
  - Capture evidence of successful request

  **Must NOT do**:
  - Do NOT modify code (testing only)
  - Do NOT test with unrestricted account (save for final verification)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Manual testing with real account
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (Task 3)
  - **Blocks**: Task 4
  - **Blocked By**: Task 2 (implementation must be complete)

  **References**:
  - User's restricted CodeBuddy account credentials
  - CodeBuddy API endpoint: https://www.codebuddy.ai/v2/chat/completions

  **Acceptance Criteria**:
  - [ ] Request with restricted account succeeds
  - [ ] Evidence captured (response body or screenshot)

  **QA Scenarios**:
  ```
  Scenario: Restricted account can make request
    Tool: Bash (curl)
    Preconditions: Restricted test account available
    Steps:
      1. Make POST request to CodeBuddy API with new headers
      2. Assert: Response status 200 (not 403/error)
      3. Capture response body
    Expected Result: Successful chat completion
    Evidence: .omo/evidence/task-3-restricted-success.json
  ```

  **Commit**: NO (testing only)

- [x] 4. Final integration test and cleanup

  **What to do**:
  - Run full test suite to ensure no regressions
  - Test with unrestricted account to verify backward compatibility
  - Clean up any temporary files
  - Document changes

  **Must NOT do**:
  - Do NOT add new features
  - Do NOT modify code beyond cleanup

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Testing and documentation
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (Task 4)
  - **Blocks**: Final Verification
  - **Blocked By**: Task 2, Task 3

  **References**:
  - All test files
  - CodeBuddy provider documentation

  **Acceptance Criteria**:
  - [ ] All tests pass
  - [ ] Unrestricted account still works
  - [ ] Documentation updated (if needed)

  **QA Scenarios**:
  ```
  Scenario: Full test suite passes
    Tool: Bash (bun test)
    Preconditions: All implementation complete
    Steps:
      1. Run: bun test
      2. Assert: All tests pass
    Expected Result: Zero test failures
    Evidence: .omo/evidence/task-4-full-suite.txt
  
  Scenario: Unrestricted account still works
    Tool: Bash (curl)
    Preconditions: Unrestricted test account available
    Steps:
      1. Make POST request to CodeBuddy API
      2. Assert: Response status 200
    Expected Result: Successful chat completion
    Evidence: .omo/evidence/task-4-unrestricted-success.json
  ```

  **Commit**: YES (if documentation added)
  - Message: `docs(codebuddy): document header spoofing for restricted accounts`
  - Files: README.md (if needed)

---

## Final Verification Wave (MANDATORY)

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist in .omo/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `quick`
  Run `bun test` + `npm run build`. Review changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `quick`
  Execute QA scenarios from Tasks 2, 3, 4. Follow exact steps, capture evidence. Test integration (features working together). Test edge cases. Save to `.omo/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `quick`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Task 2**: `fix(codebuddy): add CLI spoofing headers for restricted account bypass` - default.js, test file
- **Task 4**: `docs(codebuddy): document header spoofing for restricted accounts` - README.md (if needed)

---

## Success Criteria

### Verification Commands
```bash
bun test                                    # Expected: All tests pass
npm run build                               # Expected: Build successful
curl -X POST https://www.codebuddy.ai/...   # Expected: 200 OK (with restricted account)
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Restricted account works
- [ ] Unrestricted account still works
- [ ] No other providers affected
