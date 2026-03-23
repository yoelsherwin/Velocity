# QA Report: TASK-038 Session Restoration (R1)

**Tester**: Claude QA Agent
**Date**: 2026-03-23
**Commit**: 454d392 `feat: add session restoration on restart`

## Test Results: ALL PASS

### Automated Tests

| Suite | Tests | Status |
|-------|-------|--------|
| Frontend (Vitest) | 519 passed, 0 failed | PASS |
| Rust unit tests | 127 passed, 1 ignored, 0 failed | PASS |
| Rust integration | 11 passed, 0 failed | PASS |

All pre-existing tests continue to pass. No regressions detected.

---

### New Test Coverage

**Rust unit tests -- `src-tauri/src/session/mod.rs` (5 tests)**:

- `test_save_session_writes_file` -- verifies atomic write (tmp + rename) produces correct file content
- `test_load_session_reads_file` -- verifies read and JSON parse of valid session data
- `test_load_session_missing_file` -- verifies `load_session()` returns `Ok(None)` when no file exists
- `test_load_session_invalid_json` -- verifies corrupt JSON is detected and rejected
- `test_save_and_load_roundtrip` -- end-to-end save then load with realistic session data

**Frontend unit tests -- `src/__tests__/session.test.ts` (12 tests)**:

- `test_session_saved_on_tab_create` -- save includes correct number of tabs after creation
- `test_session_saved_on_tab_close` -- save reflects reduced tab count after close
- `test_session_restore_creates_tabs` -- loadSessionState parses 3 tabs with correct activeTabId
- `test_session_restore_creates_panes` -- split pane tree structure preserved through save/load
- `test_session_restore_fallback` -- null from backend returns null (no crash)
- `test_session_restore_fallback_invalid_json` -- invalid JSON string returns null
- `test_session_restore_fallback_wrong_version` -- version !== 1 returns null
- `test_save_debounced` -- 3 rapid requestSave calls produce only 1 invoke after 2s
- `test_saveNow_saves_immediately` -- saveNow fires invoke without waiting for debounce
- `test_saveNow_cancels_pending_debounce` -- saveNow cancels a pending requestSave timer
- `test_pane_data_included_in_save` -- cwd and history from updatePaneData appear in saved state
- `test_history_capped_at_100` -- 150-entry history is trimmed to last 100 on save

---

### Bug Hunt

#### BUG-001: CWD Restoration Sends Unescaped Shell Command (MEDIUM)

**File**: `src/components/Terminal.tsx` (~line 430)
**Reproduction**: Corrupt session file with CWD containing shell metacharacters (`;`, `|`, `` ` ``).
**Impact**: The `cd "${initialCwd}"` string interpolation could execute arbitrary commands if the session file is tampered with. See code review S-1 for details.
**Verdict**: Security finding -- recommend fix in R2.

#### BUG-002: `beforeunload` Save May Not Complete (LOW)

**File**: `src/components/layout/TabManager.tsx` (lines 144-148)
**Reproduction**: Close the window during a long-running command. The async `invoke('save_session')` may be dropped by the browser before the IPC reaches Rust.
**Impact**: Last ~2 seconds of session state may be lost on window close. The debounced save at 2-second intervals limits the data loss window.
**Verdict**: Acceptable for pre-alpha. The debounced save provides a reasonable safety net.

#### BUG-003: Session Save During Alt Screen (NOT A BUG)

**Investigated**: Whether session save captures incorrect state when an alt-screen application (vim, less, htop) is running.
**Finding**: The session saves shell type, CWD, and command history -- none of which are affected by alt-screen mode. The alt-screen buffer is not persisted. On restore, the shell starts fresh (not inside the alt-screen app), which is correct behavior.
**Verdict**: Not a bug. Behavior is correct.

#### BUG-004: Rapid Tab Open/Close Save Thrashing (NOT A BUG)

**Investigated**: Opening and closing 10 tabs in quick succession.
**Finding**: The 2-second debounce in `useSessionPersistence` coalesces all changes. The `requestSave` updates `pendingRef` on each call, and the timer fires once with the latest state. Only 1 disk write occurs per 2-second window regardless of how many tab changes happen.
**Verdict**: Not a bug. Debounce correctly prevents thrashing.

#### BUG-005: Corrupt Session File Handling (NOT A BUG)

**Investigated**: What happens when `session.json` contains truncated JSON, empty string, binary data, or extremely large content.
**Finding**:
- Truncated JSON: Rust `serde_json::from_str` fails, `load_session()` returns `Ok(None)`, app starts with fresh tab.
- Empty file: Same path -- empty string is invalid JSON.
- Binary data: Same path -- not valid UTF-8 or JSON, `read_to_string` or `serde_json` fails.
- Large file: No size limit enforced in Rust `read_to_string`. A multi-GB session file could cause OOM. However, this requires intentional file replacement since the app caps history at 100 entries per pane and only saves tab metadata. A realistic session file with 20 tabs and 20 panes each would be ~200KB. Not a practical concern.
**Verdict**: Not a bug for realistic scenarios.

#### BUG-006: CWD Restoration Failure When Directory Deleted (LOW)

**File**: `src/components/Terminal.tsx` (~line 430)
**Reproduction**: Save session with CWD `C:\MyProject`. Delete `C:\MyProject`. Restart Velocity.
**Impact**: The `cd "C:\MyProject"` command will print an error in the terminal ("The system cannot find the path specified"). The shell remains in its default directory. The error is visible to the user as a first command output in the restored session.
**Recommendation**: Before sending the `cd` command, validate that the directory exists using a Rust command. If it doesn't exist, skip the `cd` silently.
**Verdict**: Minor UX issue, not blocking.

---

### Test Gap Analysis

| Area | Coverage | Notes |
|------|----------|-------|
| Atomic write (Rust) | Covered | Roundtrip test exercises real save/load |
| JSON validation (Rust) | Partial | Invalid JSON tested, but via manual parse not `load_session()` |
| Version validation (TS) | Covered | Wrong version returns null |
| Debounce behavior | Covered | Single save after rapid calls verified |
| Immediate save | Covered | `saveNow` fires immediately, cancels pending |
| History cap | Covered | 150 entries trimmed to 100, keeps latest |
| Pane data collection | Covered | CWD and history appear in saved state |
| Split pane restore | Covered | Horizontal split tree structure preserved |
| Multi-tab restore | Covered | 3 tabs with correct activeTabId |
| Missing file fallback | Covered | Both Rust and TS return null/None |
| Corrupt file fallback | Partial | Rust validates JSON; TS test uses mock |

### Missing Test Coverage

1. **No test for `useCommandHistory` with `initialHistory` parameter** -- The hook now accepts `initialHistory` but no dedicated test verifies that restored history is navigable with up/down arrows.
2. **No test for `SessionContext` provider/consumer** -- The context wiring between TabManager and Terminal is only tested indirectly through the session persistence tests.
3. **No test for `beforeunload` handler** -- The window close save path is untested.
4. **No test for CWD restoration `cd` command** -- The shell command sent on restore is not verified.

---

## Summary

| ID | Severity | Type | Description |
|----|----------|------|-------------|
| BUG-001 | MEDIUM | Security | CWD path interpolated into shell command without sanitization |
| BUG-002 | LOW | Reliability | beforeunload async save may not complete |
| BUG-006 | LOW | UX | Deleted CWD produces visible error on restore |

**Overall**: The session restoration feature is well-implemented with proper debouncing, atomic writes, and graceful degradation. Test coverage is good at 12 frontend + 5 Rust tests. The primary concern is BUG-001 (CWD injection), which should be addressed in R2.
