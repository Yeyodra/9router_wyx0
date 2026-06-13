# Draft: CodeBuddy Restricted Account Bypass

## Requirements (confirmed)
- Fix CodeBuddy provider untuk handle restricted accounts
- Implementasi harus kombinasi: header spoofing + existing OAuth flow
- Scope: CodeBuddy provider saja (tidak touch provider lain)
- Baseline: Enow berhasil handle restricted accounts dengan CLI spoofing headers

## Technical Decisions
- **Approach**: Header spoofing enhancement (from enow pattern)
- **File target**: `open-sse/executors/default.js` - buildHeaders() method
- **Headers to add**: `X-App: cli`, `X-Stainless-*` headers pattern
- **No new files**: Just modify existing CodeBuddy case in buildHeaders()

## Research Findings
- **Current CodeBuddy headers** (default.js:276-293): Already has basic CLI spoofing
- **Enow working pattern** (providers.js:29-45): `CLAUDE_CLI_SPOOF_HEADERS` with full CLI fingerprint
- **Key difference**: Enow has `X-App: cli` + `X-Stainless-*` headers that CodeBuddy lacks
- **OAuth flow**: Already implemented in codebuddyBulkImportManager.js - working correctly
- **Request flow**: BaseExecutor.execute() → buildHeaders() → fetch()

## Metis Review Findings (Critical Gaps Identified)

### Questions That Need Answers:
1. **Which specific headers does CodeBuddy's backend actually gate on?**
   - We're adding Anthropic/Stainless SDK headers to a Tencent CodeBuddy endpoint
   - Unverified if CodeBuddy's backend checks these headers
   - Restriction might be IP-based, account-tier-based, or something else

2. **What does "restricted" actually mean?**
   - What error response? (401? 403? 200 with error body?)
   - Specific error code/message?
   - Need this for acceptance criteria

3. **Does CodeBuddy's endpoint parse X-Stainless-* headers?**
   - These are Anthropic SDK headers
   - CodeBuddy is Tencent product with its own backend
   - No evidence CodeBuddy's API reads these

4. **Has this been tested with a restricted account?**
   - Need known-restricted account to validate fix

5. **Should refreshCodeBuddy() also get these headers?**
   - Refresh call (line 426-450) uses separate header set
   - If restriction applies to all API calls, refresh might need updating too

### Guardrails (Explicitly Set):
- **GUARDRAIL A**: Do NOT touch `CLAUDE_CLI_SPOOF_HEADERS` or `providers.js` constants
- **GUARDRAIL B**: Do NOT import `CLAUDE_CLI_SPOOF_HEADERS` into `default.js` (would break CodeBuddy with Anthropic-specific headers)
- **GUARDRAIL C**: Do NOT change existing CodeBuddy `User-Agent` (CLI/2.105.2 CodeBuddy/2.105.2 must stay)
- **GUARDRAIL D**: Do NOT touch `refreshCodeBuddy()` unless explicitly scoped in
- **GUARDRAIL E**: No changes to `codebuddy` entry in `providers.js`

### Scope Creep Risks to Lock Down:
1. ❌ "Fix refresh headers too" - OUT OF SCOPE (refresh uses CLI/2.63.2 vs chat 2.105.2)
2. ❌ "Add test for CodeBuddy headers" - OUT OF SCOPE (unless explicitly added)
3. ⚠️ "Add X-Stainless-Arch and X-Stainless-Os" - DECIDE: static subset only or full dynamic pattern?
4. ❌ "Update CODEBUDDY_SYSTEM_PROMPT" - OUT OF SCOPE

### Assumptions Needing Validation:
| Assumption | Risk if Wrong |
|------------|---------------|
| CodeBuddy's backend reads X-App: cli | Headers ignored, fix does nothing |
| X-Stainless-* headers meaningful to Tencent backend | CodeBuddy may not parse them |
| Restriction is header-based, not IP/tier/quota-based | Fix irrelevant to actual cause |
| Adding headers won't cause rejection | Unknown - some backends reject unknown headers |
| X-App: cli won't conflict with X-IDE-Type: CLI | Both claim CLI identity |

## User Answers (from interview)
1. ✅ **Restricted test account**: YES - User has a restricted CodeBuddy account available for testing
2. ✅ **Test scope**: YES - Add automated test (recommended)
3. ⏳ **Error response**: Need to confirm (likely 403 Forbidden or 200 with error body)
4. ⏳ **"Enow" reference**: Need to clarify - Metis found no "enow" provider in codebase
5. ⏳ **Header approach**: Static 5-header subset vs full dynamic pattern - need decision

## Clearance Checklist Status
- [x] Core objective defined
- [x] Scope boundaries established
- [x] Test strategy confirmed: TDD with automated test
- [x] Technical approach: Header spoofing (pattern from agentrouter/CLAUDE_CLI_SPOOF_HEADERS)
- [x] Test account available: YES

## Decisions Made
1. **Test Account**: Available for validation
2. **Automated Test**: YES - Add test for CodeBuddy headers
3. **Header Approach**: Static 5-header subset (X-App, X-Stainless-Runtime, X-Stainless-Lang, X-Stainless-Helper-Method, X-Stainless-Retry-Count)
4. **Pattern Reference**: Use `agentrouter` provider as reference (it uses CLAUDE_CLI_SPOOF_HEADERS in providers.js)

## Ready for Plan Generation
All critical requirements clear. Proceeding to generate work plan.

## Scope Boundaries
- INCLUDE: CodeBuddy header enhancement in default.js
- INCLUDE: Test with restricted account scenario
- EXCLUDE: Other providers (claude, gemini, etc.)
- EXCLUDE: OAuth flow changes (already working)
- EXCLUDE: New file creation

## Implementation Location
- **File**: `open-sse/executors/default.js`
- **Method**: `buildHeaders()` 
- **Lines**: 276-293 (CodeBuddy case)
- **Injection point**: After line 282 (after existing headers)

## Verification Strategy
- Test with restricted account (if available)
- Verify existing CodeBuddy accounts still work
- Check no regression in other providers
