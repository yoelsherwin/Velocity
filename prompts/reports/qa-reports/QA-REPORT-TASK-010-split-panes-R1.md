# QA Report: TASK-010 Split Panes -- Round 1

**Date**: 2026-03-14
**Task**: TASK-010 -- Split Panes (Vertical and Horizontal Splitting)
**Branch**: `main`
**Verdict**: PASS WITH FINDINGS (3 bugs, 2 low-severity, 1 medium-severity)

---

## 1. Automated Test Results

### Frontend (Vitest): ALL PASS
```
13 test files | 101 tests | 0 failures
Duration: 6.03s
```

New TASK-010 test files:
- `src/__tests__/pane-utils.test.ts` -- 9 tests (all pass)
- `src/__tests__/PaneContainer.test.tsx` -- 5 tests (all pass)
- `src/__tests__/TabManager.test.tsx` -- 12 tests (includes 4 new split pane integration tests, all pass)

### Backend (Rust): ALL PASS
```
37 unit tests: 36 passed, 1 ignored
9 integration tests: all passed
0 doc-tests
```

No backend changes were required for TASK-010; all existing Rust tests remain green.

### TypeScript Type Checking: 4 ERRORS
```
npx tsc --noEmit
```
- **TS2322** in `src/__tests__/TabBar.test.tsx:7` -- Missing `paneRoot` in test's `makeTabs()` (BUG-001)
- **TS6133** in `src/__tests__/shell-tokenizer.test.ts:2` -- Unused import `Token` (pre-existing, not TASK-010)
- **TS6133** in `src/__tests__/TabBar.test.tsx:75` -- Unused variable `closeButtons` (pre-existing, not TASK-010)
- **TS6133** in `src/components/Terminal.tsx:29` -- Unused variable `sessionId` (pre-existing, not TASK-010)

---

## 2. Bugs Found

### BUG-001 (Medium): `TabBar.test.tsx` creates `Tab` objects missing required `paneRoot` field

**File**: `C:\Velocity\src\__tests__\TabBar.test.tsx`, line 6-11

The `makeTabs()` helper creates `Tab` objects that lack the `paneRoot` property, which was added to the `Tab` interface by TASK-010:

```typescript
const makeTabs = (count: number): Tab[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `tab-${i + 1}`,
    title: `Terminal ${i + 1}`,
    shellType: 'powershell' as const,
    // MISSING: paneRoot: { type: 'leaf', id: `pane-${i + 1}` }
  }));
```

The `Tab` interface now requires:
```typescript
export interface Tab {
  id: string;
  title: string;
  shellType: ShellType;
  paneRoot: PaneNode;  // <-- required
}
```

**Impact**: TypeScript compiler reports `TS2322` error. The test still passes at runtime because `TabBar` never accesses `paneRoot` (it only uses `id`, `title`, and `shellType`), but this is a type-safety violation. If `TabBar` is later updated to use `paneRoot`, the test will silently pass incorrect data.

**Fix**: Add `paneRoot` to `makeTabs`:
```typescript
const makeTabs = (count: number): Tab[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `tab-${i + 1}`,
    title: `Terminal ${i + 1}`,
    shellType: 'powershell' as const,
    paneRoot: { type: 'leaf' as const, id: `pane-${i + 1}` },
  }));
```

### BUG-002 (Low): `focusedPaneId` is global across tabs, not per-tab

**File**: `C:\Velocity\src\components\layout\TabManager.tsx`, lines 24-28

There is a single `focusedPaneId` state that is shared across all tabs. When you:
1. Have Tab 1 with panes A and B, focus on pane B
2. Switch to Tab 2
3. Switch back to Tab 1

The `handleSelectTab` correctly restores focus to the first leaf of the re-activated tab (line 141), but this means the user's focus choice (pane B) is lost. The user always returns to the first pane in the tab, not the last-focused pane.

**Impact**: Minor UX annoyance. The user's pane focus choice is not preserved when switching between tabs. This matches the current task spec (which says "update focused pane to first leaf of the new active tab" at line 134-146), but the task spec note on this is intentional.

**Mitigation**: Not a code bug per se -- the behavior matches the spec. However, a future enhancement could store `focusedPaneId` per-tab (e.g., in the `Tab` object) to preserve focus across tab switches.

### BUG-003 (Low): `Ctrl+\` shortcut does not check for `!e.shiftKey`

**File**: `C:\Velocity\src\components\layout\TabManager.tsx`, lines 161-169

```typescript
if (
  (e.ctrlKey && e.shiftKey && e.key === 'ArrowRight') ||
  (e.ctrlKey && e.key === '\\')
) {
```

The `Ctrl+\` branch does not guard against `e.shiftKey`. This means `Ctrl+Shift+\` would also trigger a horizontal split, which may collide with other shortcuts or produce unexpected behavior.

**Impact**: Low. `Ctrl+Shift+\` is not a common shortcut and the behavior (horizontal split) is still valid. But for defensive correctness, the check should include `!e.shiftKey` on the `Ctrl+\` branch.

---

## 3. Code Review: Acceptance Criteria Checklist

| Criterion | Status | Notes |
|---|---|---|
| `PaneNode` type and utility functions in `pane-utils.ts` | PASS | Clean types in `types.ts`, 5 utility functions in `pane-utils.ts` |
| `PaneContainer` component recursively renders pane tree | PASS | Correct recursive rendering for leaf and split nodes |
| Split pane creates a new terminal in the new pane | PASS | `splitPane()` correctly creates a split node with original + new leaf |
| Close pane removes the pane and collapses the split | PASS | `closePane()` correctly collapses parent split |
| Focused pane has visual indicator (blue left border) | PASS | `.pane-focused { border-left: 2px solid #89b4fa; }` |
| Pane action buttons visible on hover | PASS | CSS `.pane-leaf:hover .pane-actions { display: flex; }` |
| Can't close the last pane in a tab | PASS | Guard in `handleClosePane` + `isOnlyPane` prop hides close button |
| Keyboard: Ctrl+Shift+Right (split h) | PASS | Tested |
| Keyboard: Ctrl+Shift+Down (split v) | PASS | Tested |
| Keyboard: Ctrl+Shift+W (close pane) | PASS | Tested, distinct from Ctrl+W (close tab) via `!e.shiftKey` guard |
| Each pane's Terminal is independent | PASS | Each leaf renders `<Terminal key={node.id} />`, gets its own session |
| MAX_PANES_TOTAL = 20 enforced | PASS | Global count across all tabs checked before split |
| Existing tab tests still pass | PASS | All 12 TabManager tests pass |
| `npm run test` passes | PASS | 101/101 |
| `cargo test` passes | PASS | 45/45 + 1 ignored |

---

## 4. Architecture Review

### Pane Tree Design (GOOD)
The pane tree is a clean binary tree using discriminated unions (`type: 'leaf' | 'split'`). Utility functions are pure, immutable, and well-tested. No mutations -- each operation returns a new tree.

### Terminal Lifecycle (GOOD)
Each leaf pane renders `<Terminal key={node.id} />`. The `key` prop ensures React treats each pane as a distinct component instance. When a pane is created, its Terminal mounts and creates a new PTY session. When a pane is closed, its Terminal unmounts and the useEffect cleanup closes the session. This lifecycle is correct.

### Immutability (GOOD)
`splitPane()` and `closePane()` return new tree structures. The comparison `newFirst === root.first` uses reference equality for short-circuiting, which works correctly with the immutable approach.

### Focus Management (ADEQUATE)
- Click on pane sets focus -- correct.
- Split preserves focus on original pane -- correct per comment on line 104.
- Close pane refocuses to first remaining leaf -- correct.
- Tab switch focuses first leaf of new tab -- intentional (see BUG-002).

### CSS Layout (GOOD)
- Flex-based layout with `node.ratio` correctly distributes space.
- `minWidth: 0` and `minHeight: 0` on flex children prevent overflow (common flex pitfall, correctly avoided).
- Pane dividers have appropriate cursor styles for future drag-to-resize.

### Security (GOOD)
- No new IPC surface. Panes reuse existing PTY commands.
- Pane IDs use `crypto.randomUUID()`.
- `MAX_PANES_TOTAL` limits total resource consumption.
- Backend `MAX_SESSIONS = 20` independently enforces the session limit on the Rust side, providing defense in depth.

---

## 5. Test Coverage Analysis

### Well-Tested
- Pane tree operations: split, close, find, count, getLeafIds (9 unit tests)
- PaneContainer rendering: single leaf, split, focus indicator, click focus, split button (5 tests)
- Integration: split creates 2 terminals, close pane removes split, vertical split, keyboard shortcuts (4 tests in TabManager)

### Test Gaps (Suggestions for Future)
1. **No test for MAX_PANES_TOTAL enforcement** -- The frontend limit of 20 panes is not tested. A test could repeatedly split panes and verify the 21st split is rejected.
2. **No test for deeply nested pane trees** -- Could test a tree with 4+ levels of splits.
3. **No test for close pane in deeply nested tree** -- Only tests the simple 2-leaf case.
4. **No test for focus preservation after split** -- The code comments say focus stays on original pane, but no test verifies this.
5. **No test for focus transfer when non-focused pane is closed** -- What happens if pane A is focused and pane B is closed? Focus should stay on A.
6. **No test for interaction between panes across tabs** -- Split in tab 1, create tab 2, switch back to tab 1, verify panes still there.

---

## 6. Manual Test Plan

### Test 1: Basic Horizontal Split
1. Launch app with `npm run tauri dev`
2. Observe single terminal with PowerShell session
3. Press Ctrl+Shift+Right
4. Verify: two terminals appear side by side
5. Type `echo "left"` in left pane, `echo "right"` in right pane
6. Verify: each pane shows its own output independently

### Test 2: Basic Vertical Split
1. Start with a single terminal pane
2. Press Ctrl+Shift+Down
3. Verify: two terminals stacked top/bottom
4. Both work independently

### Test 3: Nested Splits
1. Start with single pane
2. Ctrl+Shift+Right (now left|right)
3. Click on right pane to focus it
4. Ctrl+Shift+Down (now left | right-top/right-bottom)
5. Verify: 3 panes visible, all independent

### Test 4: Close Pane
1. From 2-pane split, focus one pane
2. Press Ctrl+Shift+W
3. Verify: back to single pane, remaining terminal still works

### Test 5: Cannot Close Last Pane
1. With single pane, press Ctrl+Shift+W
2. Verify: nothing happens, pane remains
3. Verify: hover over pane -- close button not visible

### Test 6: Focus Indicator
1. With 2+ panes, click different panes
2. Verify: blue left border moves to clicked pane

### Test 7: Pane Action Buttons
1. Hover over a pane
2. Verify: split right (|), split down (-), and close (x) buttons appear
3. Click each button, verify correct action

### Test 8: Tab + Pane Interaction
1. Create Tab 1, split into 2 panes
2. Create Tab 2 (Ctrl+T)
3. Switch back to Tab 1
4. Verify: both panes still exist and are functional

### Test 9: MAX_PANES_TOTAL (20)
1. Repeatedly split panes until 20 total leaf panes exist
2. Try to split again
3. Verify: split silently fails, no error

### Test 10: Close Tab With Panes
1. Create Tab 1 with 3 panes
2. Create Tab 2
3. Close Tab 1
4. Verify: all 3 PTY sessions are cleaned up (no zombie processes)

---

## 7. Summary

TASK-010 is a solid implementation of split panes. The pane tree data structure is clean, the recursive rendering works correctly, the Terminal lifecycle (mount/unmount = session create/close) is properly handled, and keyboard shortcuts are correctly differentiated from tab shortcuts.

**Blocking Issues**: None.

**Must-Fix Before Merge (Medium)**:
- **BUG-001**: Fix `TabBar.test.tsx` `makeTabs()` to include `paneRoot` field. This is a type violation caught by `tsc --noEmit`.

**Nice-to-Fix (Low)**:
- **BUG-002**: Consider storing `focusedPaneId` per-tab in a future task (current behavior matches spec).
- **BUG-003**: Add `!e.shiftKey` guard to the `Ctrl+\` shortcut branch for defensive correctness.

**Recommended for next round**: Fix BUG-001 (type-safety) and optionally BUG-003 (shortcut guard), then re-run `tsc --noEmit` to verify zero TS errors on the new code.
