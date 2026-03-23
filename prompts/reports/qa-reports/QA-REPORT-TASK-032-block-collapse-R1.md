# QA Report: TASK-032 Block Collapse/Expand (R1)

**Tester**: Claude QA Agent
**Date**: 2026-03-23
**Commit**: `589da48` (feat: add block collapse and expand)
**Verdict**: NEEDS FIXES

---

## Test Execution

| Suite | Result |
|-------|--------|
| Vitest (frontend) | 431 passed, 0 failed |
| Cargo test (unit) | 117 passed, 0 failed, 1 ignored |
| Cargo test (integration) | 9 passed, 2 failed (pre-existing) |

All new collapse-specific tests (10 tests in `blockCollapse.test.tsx`) pass. All pre-existing tests (421) continue to pass, confirming no regressions.

The 2 integration test failures (`test_real_echo_command`, `test_real_ansi_filter_on_live_output`) are pre-existing timing-dependent PTY tests unrelated to this task.

---

## Feature Verification

| Scenario | Status |
|----------|--------|
| Click collapse toggle hides output | PASS (unit tested) |
| Click expand toggle shows output | PASS (unit tested) |
| Collapsed block shows header (command, exit code, timestamp) | PASS (unit tested) |
| Collapsed block hides action buttons (Copy, Rerun) | PASS (unit tested) |
| Toggle icon changes (down-arrow / right-arrow) | PASS (unit tested) |
| Collapsed block has `.block-collapsed` CSS class | PASS (unit tested) |
| Welcome block has no collapse toggle | PASS (unit tested) |
| Collapse All via command palette | PASS (code path verified) |
| Expand All via command palette | PASS (code path verified) |
| Toggle Collapse via command palette (focused block) | PASS (code path verified) |
| Enter/Space toggles collapse on focused block | PASS (code path verified) |
| Running block is never collapsed | PASS (code verified, Terminal.tsx line 968) |
| New running block auto-expands if previously collapsed | PASS (code verified, Terminal.tsx lines 441-448) |
| CollapseAll skips welcome blocks and running blocks | PASS (code verified, Terminal.tsx line 489) |

---

## Bugs Found

### BUG-001 [HIGH] Search navigates to matches inside collapsed blocks with no visible highlight

**Repro**:
1. Run several commands that produce output containing a common word (e.g., "file")
2. Collapse one or more blocks containing that word
3. Open search (Ctrl+Shift+F), search for the word
4. Navigate matches with Enter/F3

**Expected**: Each match is visible when navigated to.
**Actual**: Matches inside collapsed blocks are counted in the "N/M" indicator but navigating to them shows no highlight. The block remains collapsed and the output is not rendered, so the highlight DOM element does not exist. The scroll-to-match logic falls through silently.

**Impact**: Users cannot find text in collapsed blocks. Search match counter becomes misleading.

**Severity**: High

### BUG-002 [MEDIUM] Space key triggers both block collapse toggle and text input simultaneously

**Repro**:
1. Run a command (creates a block)
2. Press Ctrl+Up to focus the block (focusedBlockIndex becomes >= 0)
3. Press Space

**Expected**: Either toggle collapse OR insert a space, not both.
**Actual**: The textarea receives the Space keypress first (inserting a space and triggering `handleInputChange` which resets `focusedBlockIndex`), then the document-level handler fires `toggleBlockCollapse` because it reads the stale `focusedBlockIndex` captured in the closure at event registration time.

Note: The same issue applies to Enter, which would trigger both a form submit and a collapse toggle.

**Impact**: Unintended collapse/expand behavior when user interacts with input after block navigation.

**Severity**: Medium

### BUG-003 [LOW] Collapsed block IDs accumulate without cleanup

**Repro**:
1. Run 600+ commands (exceeding MAX_BLOCKS = 500)
2. Collapse several early blocks before they are evicted
3. Evicted block IDs remain in `collapsedBlocks` Set indefinitely

**Expected**: Stale IDs are pruned when blocks are evicted.
**Actual**: The Set grows without bound over long sessions. Functional impact is negligible (Set.has on non-existent IDs returns false correctly), but it is a memory leak.

**Impact**: Minor memory leak in long-running sessions.

**Severity**: Low

---

## Edge Cases Analyzed

| Edge Case | Result |
|-----------|--------|
| Collapse during active output (running block) | SAFE -- Terminal forces `isCollapsed=false` for running blocks |
| Collapse + block navigation focus | WORKS -- focused block can be collapsed/expanded with Enter/Space |
| Collapse + Rerun | N/A -- Rerun button is hidden when collapsed (correct) |
| Collapse + Copy Output | N/A -- Copy Output button is hidden when collapsed (correct) |
| CollapseAll with no blocks | SAFE -- produces empty Set |
| CollapseAll with only welcome block | SAFE -- filters out `command === ''` |
| ExpandAll when nothing is collapsed | SAFE -- replaces with empty Set (no-op) |
| Toggle on welcome block via keyboard | SAFE -- guard checks `block.command !== ''` |
| Collapse + block visibility (IntersectionObserver) | OK -- collapsed blocks have smaller height, observer still tracks container |
| Theme switch while blocks are collapsed | OK -- CSS classes are theme-agnostic |

---

## Missing Test Coverage

1. **No integration test for search + collapse interaction** -- The most impactful bug (BUG-001) has no test coverage.
2. **No test for Enter/Space on focused block while editor has focus** -- BUG-002 is untested.
3. **No test for collapse state persistence across shell restart** -- `resetAndStart` calls `setBlocks([])` but does not clear `collapsedBlocks`, meaning stale IDs survive a restart (no functional impact but unnecessary state).

---

## Verdict: NEEDS FIXES

BUG-001 (search + collapsed blocks) is a high-severity UX issue that breaks search usability when blocks are collapsed. BUG-002 (Enter/Space double-fire) creates confusing behavior. Both should be fixed before merge.
