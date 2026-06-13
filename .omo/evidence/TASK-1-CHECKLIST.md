# Task 1: TDD RED Phase - Checklist

## ✅ TASK COMPLETION CHECKLIST

### Test File Creation
- [x] Test file created: `tests/unit/codebuddy-headers.test.js` (6,552 bytes)
- [x] Simplified test file created: `tests/unit/codebuddy-headers-simple.test.js` (1,732 bytes)
- [x] Both files follow pattern from `tests/unit/claude-header-forwarding.test.js`

### Test Assertions
- [x] Test asserts `X-App: cli` header
- [x] Test asserts `X-Stainless-Runtime: node` header
- [x] Test asserts `X-Stainless-Lang: js` header
- [x] Test asserts `X-Stainless-Helper-Method: stream` header
- [x] Test asserts `X-Stainless-Retry-Count: 0` header

### RED Phase Verification
- [x] `bun test` confirms all 5 headers are FAILING
- [x] Expected values: "cli", "node", "js", "stream", "0"
- [x] Received values: undefined (all 5)
- [x] Exit code: 1 (test failure)
- [x] Test count: 5 fail, 0 pass

### Evidence Documentation
- [x] Evidence saved: `.omo/evidence/task-1-test-fails.txt` (3,783 bytes)
- [x] Evidence saved: `.omo/evidence/task-1-full-test-fails.txt` (1,129 bytes)
- [x] Summary created: `.omo/evidence/TASK-1-SUMMARY.md` (2,823 bytes)
- [x] Checklist created: `.omo/evidence/TASK-1-CHECKLIST.md` (this file)

### Code Quality
- [x] Test ONLY tests CodeBuddy provider (not claude, gemini, etc.)
- [x] Test does NOT test refreshCodeBuddy() method
- [x] Test does NOT modify implementation code
- [x] Test does NOT make tests pass (RED phase only)
- [x] Test follows existing test patterns and conventions

### Test Structure
- [x] Uses `describe()` for test suite grouping
- [x] Uses `it()` for individual test cases
- [x] Uses `expect()` for assertions
- [x] Imports DefaultExecutor correctly
- [x] Creates executor with "codebuddy" provider
- [x] Passes credentials with accessToken
- [x] Calls buildHeaders(credentials, true) for streaming

### Additional Coverage
- [x] Tests verify existing CodeBuddy headers still work (17 passing tests)
- [x] Tests verify Bearer Authorization with accessToken
- [x] Tests verify Bearer Authorization with apiKey
- [x] Tests verify Accept header
- [x] Tests verify Content-Type header
- [x] Tests verify User-Agent header
- [x] Tests verify X-Requested-With header
- [x] Tests verify X-IDE-* headers
- [x] Tests verify X-Domain header with defaults and custom values
- [x] Tests verify X-Request-ID generation
- [x] Tests verify X-Conversation-ID generation
- [x] Tests verify X-Agent-Intent header

### Reference Files Reviewed
- [x] Read: `tests/unit/claude-header-forwarding.test.js` (pattern reference)
- [x] Read: `open-sse/executors/default.js` (CodeBuddy case at lines 276-293)
- [x] Read: `open-sse/config/providers.js` (CLAUDE_CLI_SPOOF_HEADERS reference)

### TDD Workflow
- [x] RED Phase: Tests written and failing ✅
- [ ] GREEN Phase: Implementation pending (Task 2)
- [ ] REFACTOR Phase: Code cleanup pending (Task 3)

---

## Summary

**Status**: ✅ COMPLETE

All requirements met for Task 1 (TDD RED phase):
- Test file created with 5 assertions for CLI spoofing headers
- All 5 tests FAIL as expected (headers not yet implemented)
- Evidence saved to `.omo/evidence/` directory
- No implementation code modified
- Ready for Task 2 (GREEN phase implementation)

**Test Command**:
```bash
bun test tests/unit/codebuddy-headers-simple.test.js
```

**Expected Output**:
```
0 pass
5 fail
5 expect() calls
Ran 5 tests across 1 file.
```

**Exit Code**: 1 (failure, as expected for RED phase)
