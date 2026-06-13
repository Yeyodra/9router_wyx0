# Task 1: TDD RED Phase - CodeBuddy CLI Spoofing Headers Test

## Status: ✅ COMPLETE - RED PHASE CONFIRMED

### Test Files Created
1. **tests/unit/codebuddy-headers.test.js** - Full comprehensive test suite (18 tests)
2. **tests/unit/codebuddy-headers-simple.test.js** - Simplified test focusing on 5 required headers (5 tests)

### Test Results: FAILING (as expected for RED phase)

#### Full Test Suite (codebuddy-headers.test.js)
- **Total Tests**: 18
- **Passed**: 17 (existing CodeBuddy headers)
- **Failed**: 1 (new CLI spoofing headers)
- **Status**: RED ✅

#### Simple Test Suite (codebuddy-headers-simple.test.js)
- **Total Tests**: 5
- **Passed**: 0
- **Failed**: 5 (all 5 required CLI spoofing headers)
- **Status**: RED ✅

### 5 Required CLI Spoofing Headers Being Tested

All tests verify these headers are **NOT** currently present (undefined):

1. ✗ `X-App: cli` - Expected: "cli", Received: undefined
2. ✗ `X-Stainless-Runtime: node` - Expected: "node", Received: undefined
3. ✗ `X-Stainless-Lang: js` - Expected: "js", Received: undefined
4. ✗ `X-Stainless-Helper-Method: stream` - Expected: "stream", Received: undefined
5. ✗ `X-Stainless-Retry-Count: 0` - Expected: "0", Received: undefined

### Test Coverage

The comprehensive test suite also verifies:
- ✅ Bearer Authorization with accessToken
- ✅ Bearer Authorization with apiKey
- ✅ Accept: text/event-stream header
- ✅ Content-Type: application/json; charset=utf-8
- ✅ User-Agent header
- ✅ X-Requested-With: XMLHttpRequest
- ✅ X-IDE-Type: CLI
- ✅ X-IDE-Name: CLI
- ✅ X-IDE-Version: 2.105.2
- ✅ X-Private-Data: false
- ✅ X-Domain with default and custom values
- ✅ X-Request-ID generation
- ✅ X-Conversation-ID generation
- ✅ X-Conversation-Request-ID header
- ✅ X-Conversation-Message-ID header
- ✅ X-Agent-Intent: craft

### Evidence Files

1. **task-1-test-fails.txt** - Simple test suite output showing all 5 headers failing
2. **task-1-full-test-fails.txt** - Full test suite output showing 1 failure among 18 tests

### Next Steps (Task 2 - GREEN Phase)

Implementation will add the 5 CLI spoofing headers to the CodeBuddy provider's buildHeaders() method in:
- **File**: `open-sse/executors/default.js`
- **Location**: Lines 276-293 (CodeBuddy case)
- **Headers to Add**:
  - `X-App: cli`
  - `X-Stainless-Runtime: node`
  - `X-Stainless-Lang: js`
  - `X-Stainless-Helper-Method: stream`
  - `X-Stainless-Retry-Count: 0`

### TDD Workflow Status

- ✅ **RED Phase**: Tests written and failing
- ⏳ **GREEN Phase**: Implementation pending (Task 2)
- ⏳ **REFACTOR Phase**: Code cleanup pending (Task 3)

---

**Test Framework**: Vitest with Bun test runner
**Test Pattern**: Follows existing claude-header-forwarding.test.js pattern
**Provider Tested**: CodeBuddy only (not other providers)
