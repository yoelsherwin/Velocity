# QA Report: TASK-012 (Exit Codes), TASK-013 (Pane Resize), TASK-014 (Per-Tab Focus) -- Round 1

**Date**: 2026-03-14
**Tasks**: TASK-012, TASK-013, TASK-014
**Branch**: `main`
**Verdict**: PASS WITH FINDINGS (4 bugs: 1 medium, 3 low)

---

## 1. Automated Test Results

### Frontend (Vitest): ALL PASS
```
16 test files | 153 tests | 0 failures
Duration: 8.90s
```

New/updated test files for these tasks:
- `src/__tests__/exit-code-parser.test.ts` -- 13 tests (all pass)
- `src/__tests__/BlockView.test.tsx` -- 11 tests (4 new exit code display tests, all pass)
- `src/__tests__/Terminal.test.tsx` -- 27 tests (4 new exit code marker tests, all pass)
- `src/__tests__/pane-utils.test.ts` -- 13 tests (4 new `updatePaneRatio` tests, all pass)
- `src/__tests__/PaneContainer.test.tsx` -- 9 tests (4 new divider drag tests, all pass)
- `src/__tests__/TabManager.test.tsx` -- 15 tests (3 new per-tab focus tests, all pass)

### Backend (Rust): ALL PASS
```
37 unit tests: 36 passed, 1 ignored
9 integration tests: all passed
0 doc-tests
```

No backend changes were required for TASK-012/013/014; all existing Rust tests remain green.

### TypeScript Type Checking: 6 ERRORS
```
npx tsc --noEmit
```
- **TS2322** in `src/__tests__/TabBar.test.tsx:7` -- `makeTabs()` missing `focusedPaneId` (BUG-001)
- **TS6133** in `src/__tests__/TabManager.test.tsx:432` -- Unused variable `tab1PanesAfter` (BUG-002)
- **TS6133** in `src/components/layout/TabManager.tsx:60` -- Unused function `updateFocusedPaneId` (BUG-003)
- **TS6133** in `src/__tests__/shell-tokenizer.test.ts:2` -- Unused import `Token` (pre-existing)
- **TS6133** in `src/__tests__/TabBar.test.tsx:76` -- Unused variable `closeButtons` (pre-existing)
- **TS6133** in `src/components/Terminal.tsx:32` -- Unused variable `sessionId` (pre-existing)

---

## 2. Bugs Found

### BUG-001 (Medium): `TabBar.test.tsx` `makeTabs()` missing required `focusedPaneId` field

**File**: `C:\Velocity\src\__tests__\TabBar.test.tsx`, line 6-12

The `makeTabs()` helper now includes `paneRoot` (fixed from prior QA round) but is missing the `focusedPaneId` field added to the `Tab` interface by TASK-014:

```typescript
const makeTabs = (count: number): Tab[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `tab-${i + 1}`,
    title: `Terminal ${i + 1}`,
    shellType: 'powershell' as const,
    paneRoot: { type: 'leaf' as const, id: `pane-${i + 1}` },
    // MISSING: focusedPaneId: `pane-${i + 1}`
  }));
```

The `Tab` interface now requires:
```typescript
export interface Tab {
  id: string;
  title: string;
  shellType: ShellType;
  paneRoot: PaneNode;
  focusedPaneId: string | null;  // <-- required, added by TASK-014
}
```

**Impact**: `tsc --noEmit` reports TS2322. The test passes at runtime because `TabBar` never accesses `focusedPaneId`, but this is a type-safety violation.

**Fix**: Add `focusedPaneId: \`pane-${i + 1}\`` to `makeTabs`.

---

### BUG-002 (Low): Unused variable `tab1PanesAfter` in TabManager test

**File**: `C:\Velocity\src\__tests__\TabManager.test.tsx`, line 432

In `test_focus_preserved_across_tab_switch`:
```typescript
const tab1PanesAfter = document.querySelectorAll(
  `[data-testid^="tab-panel-"]:not([style*="display: none"]) [data-testid^="pane-"]`,
);
```

The variable `tab1PanesAfter` is queried but never used. The subsequent assertion uses a separate `document.querySelector('.pane-focused')` call instead.

**Impact**: Unused variable triggers TS6133. Harmless but untidy.

**Fix**: Either remove the unused variable or use it in the assertion.

---

### BUG-003 (Low): Unused `updateFocusedPaneId` function in TabManager

**File**: `C:\Velocity\src\components\layout\TabManager.tsx`, lines 60-66

```typescript
const updateFocusedPaneId = useCallback((paneId: string | null) => {
  setTabs((prev) =>
    prev.map((t) =>
      t.id === activeTabIdRef.current ? { ...t, focusedPaneId: paneId } : t,
    ),
  );
}, []);
```

This function was likely intended to be used but `handleFocusPane` (lines 105-113) does the same thing inline. The result is dead code that `tsc` flags as TS6133.

**Impact**: Dead code. No functional impact, but confusing for future developers.

**Fix**: Remove `updateFocusedPaneId` and its `useCallback` wrapper.

---

### BUG-004 (Low): `updatePaneRatio` in `pane-utils.ts` does not clamp ratio

**File**: `C:\Velocity\src\lib\pane-utils.ts`, lines 118-133

The `updatePaneRatio` function accepts any `number` for `newRatio` without clamping:

```typescript
export function updatePaneRatio(root: PaneNode, splitId: string, newRatio: number): PaneNode {
  if (root.type === 'leaf') return root;
  if (root.id === splitId) {
    return { ...root, ratio: newRatio };  // No clamping!
  }
  // ...
}
```

The clamping to 0.1-0.9 is currently only done in the `usePaneDrag` hook (PaneContainer.tsx line 37):
```typescript
ratio = Math.max(0.1, Math.min(0.9, ratio));
```

This means if any future caller of `updatePaneRatio` passes an out-of-bounds ratio (e.g., from deserialization, keyboard shortcuts, or programmatic resize), the pane could become invisible (ratio 0 or 1) or negative.

**Impact**: Currently harmless because the only call path goes through `usePaneDrag` which clamps. However, this violates defense-in-depth -- the utility function should enforce its own invariants.

**Fix**: Add clamping in `updatePaneRatio`:
```typescript
const clampedRatio = Math.max(0.1, Math.min(0.9, newRatio));
return { ...root, ratio: clampedRatio };
```

---

## 3. Code Review: TASK-012 (Exit Codes)

### Acceptance Criteria Checklist

| Criterion | Status | Notes |
|---|---|---|
| Shell marker injection for PowerShell | PASS | `; if ($?) { Write-Output "VELOCITY_EXIT:0" } else { Write-Output "VELOCITY_EXIT:1" }` |
| Shell marker injection for CMD | PASS | `& echo VELOCITY_EXIT:%ERRORLEVEL%` |
| Shell marker injection for WSL | PASS | `; echo "VELOCITY_EXIT:$?"` |
| Marker regex matches `^VELOCITY_EXIT:(-?\d+)\r?$` on its own line | PASS | Anchored with `^...$m` multiline flag |
| Marker stripped from displayed output | PASS | Uses global regex `EXIT_CODE_STRIP_REGEX` |
| Exit code parsed and stored on block | PASS | `extractExitCode()` returns `{ cleanOutput, exitCode }` |
| Success indicator (checkmark) for exit code 0 | PASS | `\u2713` with `.exit-success` class |
| Failure indicator (X + code) for nonzero exit | PASS | `\u2717 ${exitCode}` with `.exit-failure` class |
| No indicator when exit code is undefined or null | PASS | Guard: `exitCode !== undefined && exitCode !== null` |
| Block status set to 'completed' when exit code detected | PASS | Line 99 in Terminal.tsx |
| Handles marker split across output chunks | PASS | Tested in `test_exit_code_extracted_when_marker_split_across_chunks` |
| Handles multiple marker occurrences | PASS | `EXIT_CODE_STRIP_REGEX` is global, strips all |
| Handles negative exit codes | PASS | Regex includes `-?\d+` |
| Ignores marker not at line start | PASS | `^` anchor in multiline mode, tested |

### Design Analysis

**Marker Injection (GOOD)**: The marker is appended as a suffix to the command string in `submitCommand()`. This is clean -- a single append point, no string interpolation of user input into the marker. The marker syntax is deterministic per shell type.

**PowerShell Marker Limitation (ACCEPTABLE)**: The PowerShell marker uses `$?` which is a boolean (True/False), meaning it can only report exit code 0 or 1. The actual `$LASTEXITCODE` value (e.g., 2, 127, 255) is not captured. This is acceptable for MVP -- `$?` is the most reliable cross-command indicator in PowerShell. A future enhancement could use `$LASTEXITCODE` for native executables.

**Parsing Strategy (GOOD)**: The parser accumulates output in the block and runs `extractExitCode()` on each chunk arrival. This handles markers split across chunks correctly, as demonstrated by the test. The regex is anchored to line start, preventing false positives from commands that echo the marker text (e.g., `echo VELOCITY_EXIT:42`).

**Marker Visibility Concern (MINOR)**: Between the time the marker text arrives and the next output event triggers `extractExitCode()`, the marker could briefly flash in the output. In practice, this is imperceptible because `extractExitCode` runs synchronously within the same `setBlocks` update that appends the output. The marker is stripped before React renders.

---

## 4. Code Review: TASK-013 (Pane Resize)

### Acceptance Criteria Checklist

| Criterion | Status | Notes |
|---|---|---|
| Draggable divider between split panes | PASS | `.pane-divider` with `onMouseDown` handler |
| Horizontal drag uses `clientX` / container width | PASS | Lines 31-32 in PaneContainer.tsx |
| Vertical drag uses `clientY` / container height | PASS | Lines 33-34 in PaneContainer.tsx |
| Ratio clamped to 0.1-0.9 | PASS | `Math.max(0.1, Math.min(0.9, ratio))` in usePaneDrag |
| `updatePaneRatio` utility function works | PASS | Updates specific split node by ID, immutable |
| `updatePaneRatio` handles nested splits | PASS | Recursion through children, tested |
| Mouse cursor changes during drag | PASS | `document.body.style.cursor` set to `col-resize` or `row-resize` |
| User-select disabled during drag | PASS | `document.body.style.userSelect = 'none'` |
| Event listeners cleaned up on mouse up | PASS | `removeEventListener` in `handleMouseUp` |
| Divider has hover/active visual feedback | PASS | CSS: `.pane-divider:hover` and `.pane-divider:active` |
| `onResizePane` prop flows from TabManager through PaneContainer | PASS | Prop drilling through `handleResizePane` |

### Design Analysis

**usePaneDrag Hook (GOOD)**: Clean separation of drag logic into a custom hook. The hook captures `getBoundingClientRect()` at mousedown time and calculates ratio from mouse position during mousemove. This avoids layout thrashing from re-querying the rect on every move.

**Event Listener Cleanup (GOOD)**: The `handleMouseUp` function removes both `mousemove` and `mouseup` listeners and resets body styles. This prevents listener leaks.

**Potential Issue -- Rect Stale During Drag (LOW RISK)**: The bounding rect is captured once at mousedown. If the browser window is resized during a drag, the ratio calculation will be off. In practice, users rarely resize the window while dragging a pane divider, so this is acceptable.

**No Keyboard Resize (NOTED)**: There is no keyboard-based pane resize (e.g., Ctrl+Shift+Left/Right to adjust ratio). This is fine for MVP but worth noting as a future accessibility enhancement.

**noopResize Fallback (GOOD)**: When `onResizePane` is not provided, a `noopResize` constant is used instead of creating a new function on each render. This avoids unnecessary re-renders.

---

## 5. Code Review: TASK-014 (Per-Tab Focus)

### Acceptance Criteria Checklist

| Criterion | Status | Notes |
|---|---|---|
| `focusedPaneId` stored per-tab in `Tab` interface | PASS | `focusedPaneId: string \| null` in `Tab` type |
| Each tab remembers its focused pane independently | PASS | Stored in `Tab` object, not global state |
| Tab switch restores correct focus | PASS | `activeTab?.focusedPaneId` derived from active tab |
| Split auto-focuses the new pane | PASS | `findNewPaneId()` detects new leaf, sets focusedPaneId |
| Close pane focuses first remaining leaf | PASS | `getLeafIds(newRoot)[0]` fallback in handleClosePane |
| Clicking a pane updates focusedPaneId for active tab only | PASS | `handleFocusPane` checks `activeTabIdRef.current` |
| Non-active tab panels pass their own focusedPaneId | PASS | Line 248: `tab.id === activeTabId ? focusedPaneId : tab.focusedPaneId` |
| Initial tab has focusedPaneId set to its sole pane | PASS | Line 31: `focusedPaneId: initialPaneId` |
| New tab gets focusedPaneId set to its initial pane | PASS | Line 76: `focusedPaneId: initialPaneId` |

### Design Analysis

**Per-Tab Focus (GOOD -- MAJOR IMPROVEMENT)**: This addresses BUG-002 from the TASK-010 QA report. Focus is now stored directly in the `Tab` object rather than as a global state variable. Switching tabs correctly preserves and restores each tab's focused pane.

**Derivation Pattern (GOOD)**: `focusedPaneId` is derived from the active tab on each render (line 41: `activeTab?.focusedPaneId ?? null`), rather than maintained as a separate synchronized state. This eliminates consistency bugs.

**Ref Sync Pattern (GOOD)**: `focusedPaneIdRef` is kept in sync with the derived value via `useEffect` so that keyboard shortcut handlers (which close over the ref) always have the current value.

**Tab Panel Focus Prop (SUBTLE, CORRECT)**: Line 248 uses a conditional: active tab gets the derived `focusedPaneId` (which is always in sync), while non-active tabs get `tab.focusedPaneId` directly. This ensures non-active tabs display their stored focus correctly even though they are hidden.

---

## 6. Cross-Feature Integration Analysis

### Exit Codes in Split Panes
Each pane creates an independent `Terminal` component, which manages its own blocks and exit code parsing. There is no shared state between panes for exit codes. This is correct -- exit codes are per-command, per-terminal.

### Resize + Focus Interaction
Dragging a pane divider does not change pane focus. The `onMouseDown` on the divider does not propagate to the pane's `onClick` handler because the divider is a separate element. Correct behavior.

### Focus + Tab Switch + Resize
Resizing a pane in Tab 1, switching to Tab 2, then switching back to Tab 1 preserves both the resize ratio (stored in `paneRoot`) and the focus (stored in `focusedPaneId`). Both are per-tab. Correct.

### Tab Close Cleanup
When a tab is closed, its `PaneContainer` unmounts, which unmounts all `Terminal` components, which trigger their `useEffect` cleanup to close PTY sessions. The resize ratios and focus state are garbage-collected with the tab. Clean lifecycle.

---

## 7. Test Coverage Analysis

### Well-Tested
- Exit code parser: 13 unit tests covering zero, nonzero, negative, missing, carriage return, no trailing newline, multiple markers, marker not at line start
- Exit code display: 4 BlockView tests for success indicator, failure indicator, undefined, null
- Exit code integration: 4 Terminal tests for marker injection, PowerShell syntax, output parsing, split-across-chunks
- Pane ratio update: 4 unit tests for basic, nested, leaf unchanged, not found
- Divider drag: 4 component tests for mousedown handler, drag ratio, clamping, vertical axis
- Per-tab focus: 3 integration tests for preservation across tab switch, auto-focus on split, sibling focus on close

### Test Gaps (Suggestions for Future)

1. **No test for CMD or WSL exit marker integration** -- Terminal tests only exercise the PowerShell path. A test should switch to CMD shell and verify the CMD-specific marker (`& echo VELOCITY_EXIT:%ERRORLEVEL%`) is appended.

2. **No test for exit code display on nonzero values > 1** -- BlockView tests cover 0 and 1, but not larger codes like 127 or 255 which should show the numeric value.

3. **No test for rapid successive resize events** -- The drag handler fires on every mousemove. A test should verify rapid resize calls do not cause state corruption or performance issues.

4. **No test for concurrent drag + pane close** -- What happens if the user starts dragging a divider and then a keyboard shortcut closes one of the panes?

5. **No test for focus behavior when all panes in a tab are removed** -- The guard `countLeaves <= 1` prevents this, but an edge case test would strengthen confidence.

6. **No test for `updatePaneRatio` with out-of-bounds values** -- Since the utility does not clamp, a test should verify behavior with ratio=0, ratio=1, or ratio=-0.5 (see BUG-004).

---

## 8. Manual Test Plan

### Test 1: Exit Code -- Success
1. Launch app with `npm run tauri dev`
2. Type `echo "hello"` and press Enter
3. Wait for output to appear
4. **Verify**: Green checkmark appears in the block header next to the timestamp

### Test 2: Exit Code -- Failure
1. Type `Get-Item nonexistent-file-xyz` and press Enter
2. Wait for error output
3. **Verify**: Red X with exit code number appears in the block header

### Test 3: Exit Code -- Marker Not Visible
1. Run any command
2. Inspect the output area carefully
3. **Verify**: The text `VELOCITY_EXIT` does not appear anywhere in the visible output

### Test 4: Exit Code -- CMD Shell
1. Switch to CMD shell using the shell selector
2. Type `echo hello` and press Enter
3. **Verify**: Exit code indicator appears
4. Type `exit /b 42` or a command that fails
5. **Verify**: Non-zero exit code appears

### Test 5: Exit Code -- WSL Shell
1. Switch to WSL shell using the shell selector
2. Type `ls` and press Enter
3. **Verify**: Green checkmark appears
4. Type `ls /nonexistent-dir-xyz` and press Enter
5. **Verify**: Red X with exit code appears

### Test 6: Pane Resize -- Horizontal Drag
1. Split a pane horizontally (Ctrl+Shift+Right)
2. Hover over the divider between the two panes
3. **Verify**: Cursor changes to col-resize
4. Click and drag the divider left and right
5. **Verify**: Panes resize smoothly following the mouse

### Test 7: Pane Resize -- Clamp Boundaries
1. From a horizontal split, drag the divider all the way to the left
2. **Verify**: Left pane does not shrink below ~10% of the container
3. Drag all the way to the right
4. **Verify**: Right pane does not shrink below ~10% of the container

### Test 8: Pane Resize -- Vertical Drag
1. Split a pane vertically (Ctrl+Shift+Down)
2. Drag the horizontal divider up and down
3. **Verify**: Panes resize vertically following the mouse

### Test 9: Pane Resize -- Nested Splits
1. Create a horizontal split, then split the right pane vertically (3 panes total)
2. Drag the horizontal divider
3. **Verify**: Only the horizontal split ratio changes; the vertical split is unaffected
4. Drag the vertical divider in the right column
5. **Verify**: Only the vertical split ratio changes

### Test 10: Pane Resize -- Drag Release Outside Window
1. Start dragging a divider
2. Move the mouse outside the application window
3. Release the mouse button
4. Move mouse back into the window
5. **Verify**: Drag is no longer active; no stuck cursor or continued resizing

### Test 11: Per-Tab Focus -- Preserved Across Tab Switch
1. In Tab 1, split into 2 panes
2. Click the second pane to focus it (blue left border appears)
3. Create Tab 2 (Ctrl+T)
4. Switch back to Tab 1
5. **Verify**: The second pane still has the blue focus indicator

### Test 12: Per-Tab Focus -- Independent Across Tabs
1. In Tab 1, split into 2 panes, focus pane 2
2. In Tab 2, split into 2 panes, focus pane 1
3. Switch between tabs
4. **Verify**: Each tab shows its own focused pane independently

### Test 13: Per-Tab Focus -- Auto-Focus on Split
1. Start with a single pane
2. Split it (Ctrl+Shift+Right)
3. **Verify**: The new pane (right side) receives focus (blue border)

### Test 14: Per-Tab Focus -- Focus Transfer on Close
1. From a 2-pane split, the new pane should be focused
2. Close the focused pane (Ctrl+Shift+W)
3. **Verify**: The remaining pane receives focus

### Test 15: Integration -- Exit Code in Split Pane
1. Split into 2 panes
2. Run a successful command in the left pane
3. Run a failing command in the right pane
4. **Verify**: Left pane shows green checkmark, right pane shows red X
5. Each pane's exit codes are independent

### Test 16: Integration -- Resize Preserves Content
1. Split into 2 panes, run commands in both
2. Drag the divider to resize
3. **Verify**: Output content in both panes is preserved during resize

---

## 9. Summary

TASK-012 (Exit Codes), TASK-013 (Pane Resize), and TASK-014 (Per-Tab Focus) are well-implemented with clean architecture and thorough test coverage. The exit code marker system correctly handles cross-chunk parsing, the drag resize uses proper event lifecycle management, and per-tab focus is a significant improvement over the prior global focus approach.

**Blocking Issues**: None.

**Must-Fix Before Merge (Medium)**:
- **BUG-001**: Add `focusedPaneId` to `TabBar.test.tsx` `makeTabs()`. TypeScript type violation caught by `tsc --noEmit`.

**Nice-to-Fix (Low)**:
- **BUG-002**: Remove unused `tab1PanesAfter` variable in TabManager test (TS6133).
- **BUG-003**: Remove unused `updateFocusedPaneId` function in TabManager (TS6133 + dead code).
- **BUG-004**: Add ratio clamping inside `updatePaneRatio()` for defense-in-depth.

**Recommended for next round**: Fix BUG-001 (blocking type error), then re-run `tsc --noEmit` to verify the new-code TS errors are resolved. Optionally address BUG-002/003/004 for cleanliness.
