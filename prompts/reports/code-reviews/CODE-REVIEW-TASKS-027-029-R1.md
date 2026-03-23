# Code Review: TASK-027, TASK-028, TASK-029 (Batch) — R1

**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-23
**Commits**: `66f9534` (TASK-027), `7d6b546` / `e84f825` (TASK-029), `c9c747e` (TASK-028)
**Diff range**: `30a14be..HEAD`

---

## Summary

Three small features reviewed as a batch:

| Task | Feature | Files touched |
|------|---------|---------------|
| TASK-027 | Block navigation (Ctrl+Up/Down) | Terminal.tsx, BlockView.tsx, App.css, commands.ts, blockNavigation.test.tsx |
| TASK-029 | Quit warning for running processes | useQuitWarning.ts, Terminal.tsx, useQuitWarning.test.ts |
| TASK-028 | Desktop notifications | notifications.ts, Terminal.tsx, commands.ts, notifications.test.ts |

---

## TASK-027: Block Navigation

### Positive
- Clean state management: `focusedBlockIndex` resets on input change and command submit — prevents stale focus.
- Uses `blocksRef.current` inside the `setFocusedBlockIndex` updater and the `useEffect` keydown handler to avoid stale closure over `blocks`.
- No-wrap boundary behavior (clamps at 0 and maxIndex) is correct and tested.
- `scrollIntoView({ block: 'nearest', behavior: 'smooth' })` is a good UX choice.
- Command palette integration (`block.prev`, `block.next`) mirrors the keyboard behavior exactly.
- Tests are thorough: covers forward, backward, boundary clamping, focus reset on input, CSS class application.

### Issues

**[LOW] DOM query in scroll effect is fragile**
File: `src/components/Terminal.tsx`, lines 651-654

The scroll-into-view effect uses `document.querySelectorAll('[data-testid="block-container"]')` and indexes by `focusedBlockIndex`. This couples the effect to DOM ordering matching the React render order, which is fine today but could break if any filtering or virtualization is added later. A ref-based approach (e.g., a `Map<number, HTMLElement>`) would be more robust, but this is acceptable for MVP.

**[LOW] `block-focused` and `block-active` share identical CSS rules**
File: `src/App.css`, lines 119-127

Both `.block-container.block-active` and `.block-container.block-focused` have the exact same styles. Consider combining them into a single rule (e.g., `.block-container.block-active, .block-container.block-focused { ... }`). This is a style nit, not a functional issue.

---

## TASK-029: Quit Warning

### Positive
- `useQuitWarning` is a clean, minimal custom hook — exactly the right abstraction level.
- `useCallback` on the handler ensures referential stability, so `addEventListener`/`removeEventListener` pair correctly.
- The `useEffect` correctly returns a cleanup function only when the listener is added (when `hasRunningProcesses` is true).
- `useMemo` in Terminal.tsx for `hasRunningProcesses` avoids unnecessary re-registrations.
- The filter `b.command !== '' && b.status === 'running'` correctly excludes the welcome block (which has an empty command string).
- Tests cover: registration, non-registration, handler behavior (preventDefault + returnValue), removal on toggle, removal on unmount, and multi-rerender toggling. Excellent coverage.

### Issues

**No issues found.** This hook is well-implemented.

---

## TASK-028: Desktop Notifications

### Positive
- Uses the Web Notification API (not a Tauri plugin), keeping the dependency footprint small.
- `shouldNotify` separates the decision logic from side effects — very testable.
- Sensible defaults: 10-second threshold, only fires when window is unfocused.
- `ensureNotificationPermission` gracefully handles all three permission states (granted, denied, default).
- `showCommandNotification` accepts injectable `completionTime` and `windowFocused` params with sensible defaults — excellent for testing without mocking globals.
- `truncateCommand` prevents excessively long notification bodies.
- `notification.onclick` focuses the window — good UX.
- Test notification command in the palette is a nice touch for user verification.
- Tests mock the Notification constructor cleanly and cover the full matrix: long/short commands, focused/unfocused, permission granted/denied, click handler.

### Issues

**[LOW] Notification objects are not closed/dismissed**
File: `src/lib/notifications.ts`, lines 86-89

The `Notification` object created in `showCommandNotification` (and `sendTestNotification`) is never explicitly closed. Notifications will persist in the OS notification center until the user dismisses them manually. This is standard behavior and likely fine, but if rapid command completions pile up notifications, consider adding an auto-close timeout:
```ts
setTimeout(() => notification.close(), 10_000);
```
This is optional and not a blocker.

**[LOW] Duplicate notification trigger logic in two event handlers**
File: `src/components/Terminal.tsx`, lines 163-169 and 207-212

The notification trigger code is duplicated in both the `pty:output` and `pty:output-replace` listeners. The logic is identical. Consider extracting a small helper function (e.g., `handleCommandCompletion`) to reduce duplication. This is a maintainability nit — both paths must stay in sync if the notification logic changes.

---

## Cross-Cutting Observations

### Security
- No security concerns in any of the three features. No user input is interpolated into shell commands. The Notification API is a safe browser API. Event listeners are properly scoped and cleaned up.

### React Quality
- All hooks follow the rules of hooks. Dependencies are correctly specified.
- `useCallback` and `useMemo` are used appropriately — no missing or extraneous dependencies.
- The `useEffect` for block navigation keydown listener has an empty dependency array `[]`, which is correct because it reads from `blocksRef.current` (a ref) rather than `blocks` (state).

### Listener Cleanup
- `useQuitWarning`: cleanup via `useEffect` return — correct.
- Block navigation keydown: cleanup via `useEffect` return — correct.
- Command palette `velocity:command` listener: cleanup via `useEffect` return — correct.
- No leaked listeners detected.

### Test Quality
- All three features have dedicated test files with good coverage.
- Tests use proper async patterns (`waitFor`, `act`).
- Mock setup is thorough and doesn't leak between tests (vi.clearAllMocks in beforeEach).

---

## Verdict: **APPROVE**

All three features are clean, well-tested, and follow established project patterns. The issues identified are all LOW severity — style nits and optional improvements. No changes required before merge.
