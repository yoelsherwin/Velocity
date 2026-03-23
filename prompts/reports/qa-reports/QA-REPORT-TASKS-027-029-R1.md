# QA Report: TASK-027, TASK-028, TASK-029 (Round 1)

**Date**: 2026-03-23
**Commit range**: `30a14be..c9c747e`
**Reviewer**: QA Agent (Claude)

## Test Results

| Suite | Result |
|-------|--------|
| Frontend (Vitest) | 397 passed, 0 failed (37 test files) |
| Rust (cargo test) | 113 unit + 11 integration passed, 0 failed |

All tests pass.

---

## TASK-027: Block Navigation (Ctrl+Up/Down)

**Files reviewed**: `Terminal.tsx`, `BlockView.tsx`, `App.css`, `commands.ts`, `blockNavigation.test.tsx`

### Verdict: PASS (with minor findings)

### Findings

**BUG-027-1 (Medium): Block navigation fires during alt-screen mode**
The document-level `keydown` handler at Terminal.tsx:621-646 does not check `altScreenActive`. When a full-screen terminal app (e.g., vim, htop) is running, Ctrl+Up/Down should be forwarded to the PTY via `encodeKey()`, not consumed by block navigation. Currently, the block navigation handler calls `e.preventDefault()` on the document before the alt-screen `handleGridKeyDown` handler on the `TerminalGrid` element can process it. This will silently swallow Ctrl+Up/Down in alt-screen apps.

**Recommendation**: Add `if (altScreenActive) return;` guard. Since `altScreenActive` is React state and the handler is registered in a `useEffect` with `[]` deps, this requires either adding `altScreenActive` to the dependency array or using a ref.

**BUG-027-2 (Low): No Escape key to clear block focus**
Once a block is focused via Ctrl+Up/Down, the only way to clear focus is to type in the input editor. There is no Escape key handler to dismiss block focus, which breaks the expected keyboard-driven UX pattern (Escape typically dismisses overlays/focus states). The search bar supports Escape to close; block navigation should too.

**BUG-027-3 (Low): focusedBlockIndex can go stale when blocks are removed**
If blocks are cleared (e.g., via `terminal.clear` command) while `focusedBlockIndex` is positive, the state is not reset. The `terminal.clear` handler at Terminal.tsx:716-717 sets `blocks` to `[]` but does not reset `focusedBlockIndex`. On the next render, `index === focusedBlockIndex` will never match (since there are no blocks), so there is no visible bug, but the stale index means the next Ctrl+Down press will try to navigate from the old index rather than starting fresh at 0.

**Recommendation**: Add `setFocusedBlockIndex(-1)` alongside `setBlocks([])` in the `terminal.clear` handler.

**BUG-027-4 (Low): Duplicate navigation logic between keyboard handler and command palette handler**
The block.prev/block.next logic is duplicated between the `useEffect` at Terminal.tsx:621-646 and the `velocity:command` handler at Terminal.tsx:732-747. If the navigation logic ever changes, both sites must be updated. Consider extracting to a shared function.

### Test Coverage Assessment
7 tests covering: first/last focus, advance, previous, boundary clamping, input reset, CSS class application. **Missing**: alt-screen interaction, Escape to clear, empty blocks array.

---

## TASK-028: Desktop Notifications for Long Commands

**Files reviewed**: `notifications.ts`, `Terminal.tsx` (integration), `commands.ts`, `notifications.test.ts`

### Verdict: PASS (with minor findings)

### Findings

**BUG-028-1 (Medium): Notification fires for welcome block completion**
When the initial welcome block (empty command `""`) transitions, `completedBlockInfo` will be populated with `{ command: '', exitCode, timestamp }`. The `showCommandNotification` function does not filter out empty commands. If the shell startup takes >10 seconds on a slow machine and the window is unfocused, a notification will fire for an empty command saying "Command completed" with an empty body. This is confusing.

**Recommendation**: Add `if (!command.trim()) return;` early in `showCommandNotification`, or filter in Terminal.tsx before calling.

**BUG-028-2 (Low): Notification not dismissed/cleaned up**
The `Notification` object created in `showCommandNotification` is never closed. While browsers auto-close notifications after a timeout, explicitly closing them after a few seconds (e.g., `setTimeout(() => notification.close(), 5000)`) would provide a more polished experience and prevent notification pile-up when many long commands finish simultaneously.

**BUG-028-3 (Low): `completedBlockInfo.exitCode` is typed as `number` but extractExitCode can return non-number**
At Terminal.tsx:150, `completedBlockInfo` is typed as `{ command: string; exitCode: number; timestamp: number }`, but `extractExitCode` returns `number | null`. Since the assignment only happens when `exitCode !== null`, this is safe at runtime, but the narrow typing relies on the control flow rather than the type system. Minor TypeScript concern.

**BUG-028-4 (Informational): No notification integration test in Terminal.test.tsx**
The notification module has 19 unit tests, which is thorough. However, there is no integration test verifying that Terminal.tsx actually calls `showCommandNotification` when a command completes after the threshold. The wiring at Terminal.tsx:166-169 is untested.

### Test Coverage Assessment
19 tests covering: shouldNotify (threshold, focus, exact boundary), title generation, body generation/truncation, end-to-end show/skip/permission. Good coverage. **Missing**: empty command edge case, integration with Terminal.tsx.

---

## TASK-029: Quit Warning for Running Processes

**Files reviewed**: `useQuitWarning.ts`, `Terminal.tsx` (integration), `useQuitWarning.test.ts`

### Verdict: PASS (with minor findings)

### Findings

**BUG-029-1 (Medium): Welcome block with status "running" excluded correctly, but edge case with rapid shell restarts**
The `hasRunningProcesses` memo at Terminal.tsx:85-88 correctly filters out the welcome block via `b.command !== ''`. However, during `resetAndStart` (Terminal.tsx:354-373), `setBlocks([])` is called and then `startSession` creates a new welcome block. Between the `setBlocks([])` call and the new blocks being set, `hasRunningProcesses` will briefly be `false`, which removes the `beforeunload` handler. If a user tries to close during this brief window while a shell restart is in progress, the warning won't fire. This is a very narrow race and unlikely to matter in practice.

**BUG-029-2 (Low): `beforeunload` dialog text is browser-controlled, no customization**
The `e.returnValue = ''` approach triggers the browser's native dialog, which says something generic like "Changes you made may not be lost." Tauri's WebView2 may handle this differently from standard browsers. There is no Tauri-specific quit interception (e.g., via `tauri::WindowEvent::CloseRequested`). If WebView2 does not honor `beforeunload`, the warning will silently fail. This should be verified in manual testing.

**BUG-029-3 (Informational): No multi-pane awareness**
The quit warning is per-Terminal component. In a multi-pane layout, each pane independently registers its own `beforeunload` handler. Multiple handlers on the same event is fine (all will fire), so this works correctly. However, the user sees the same generic dialog regardless of how many panes have running processes. A future enhancement could show "N processes still running" via a Tauri dialog.

### Test Coverage Assessment
6 tests covering: register/unregister lifecycle, preventDefault/returnValue, toggle across rerenders, unmount cleanup. Good coverage for the hook itself. **Missing**: integration test verifying `hasRunningProcesses` computation in Terminal.tsx (the `b.command !== ''` filter).

---

## Keyboard Conflict Analysis

**Ctrl+Up/Down vs. InputEditor ArrowUp/ArrowDown**: No conflict. InputEditor handles plain ArrowUp/Down (without Ctrl) for history navigation. The block navigation handler checks `e.ctrlKey` and rejects events with Shift/Alt/Meta. These are orthogonal.

**Ctrl+Up/Down vs. TabManager Ctrl+Shift+Down**: No conflict. TabManager uses Ctrl+**Shift**+Down for split-pane. Block navigation explicitly rejects `e.shiftKey`.

**Ctrl+Up/Down vs. Alt-screen key-encoder**: **Conflict** (see BUG-027-1). The document-level block navigation handler fires before the TerminalGrid's `onKeyDown`, consuming the event. In alt-screen apps, Ctrl+Up/Down should produce `\x1b[1;5A` / `\x1b[1;5B`.

**Ctrl+Up/Down vs. Ctrl+Shift+F (search)**: No conflict. Different modifier combo.

---

## Summary

| Task | Verdict | Blockers | Bugs | Info |
|------|---------|----------|------|------|
| TASK-027 Block Navigation | PASS | 0 | 1 medium, 3 low | 0 |
| TASK-028 Notifications | PASS | 0 | 1 medium, 2 low | 1 |
| TASK-029 Quit Warning | PASS | 0 | 1 medium, 1 low | 1 |

**Overall**: All three features pass QA. No blockers. Three medium-severity bugs should be addressed before next milestone:
1. Block navigation swallows Ctrl+Up/Down in alt-screen mode (BUG-027-1)
2. Notifications fire for empty welcome block commands (BUG-028-1)
3. Verify `beforeunload` works in Tauri WebView2 (BUG-029-2)
