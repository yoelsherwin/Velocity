# Task 029: Quit Warning for Running Processes (P1-U7)

## Context

When the user closes the app (or closes a tab/pane) while commands are still running, the processes are killed silently. Users can accidentally lose long-running operations. This task adds a confirmation dialog before closing when processes are active.

### What exists now

- **TabManager.tsx**: `handleCloseTab()` and keyboard handler for Ctrl+W. Calls `closeSession` on the Rust side.
- **PaneContainer.tsx**: Close pane button calls `onClosePane`.
- **Terminal.tsx**: Tracks `closed` state. Has `activeBlockIdRef` — when non-null, a command is running.
- **Block type**: `status: 'running' | 'completed'`.

## Requirements

### Frontend only — no Rust changes.

1. **Window close (app quit)**: Listen for `beforeunload` event. If any terminal has a running command, show the browser's built-in "Leave page?" confirmation dialog.

2. **Tab close (Ctrl+W)**: Before closing a tab, check if any pane in that tab has a running command. If so, show a custom confirmation dialog: "A command is still running in this tab. Close anyway?"

3. **Pane close (Ctrl+Shift+W)**: Same check for the specific pane being closed.

4. **Running process detection**: A terminal has a running process if any block has `status === 'running'`. Expose this via a callback or ref from Terminal to TabManager.

5. **Custom confirmation dialog**: A simple modal (reuse SettingsModal pattern — overlay + dialog). Title: "Close with running process?" Body: Shows the running command text. Buttons: "Cancel" and "Close anyway".

6. **Implementation approach**:
   - Add a `beforeunload` listener in TabManager (or App) that checks for running processes across all tabs/panes.
   - For tab/pane close, add confirmation logic before executing the close.
   - Terminal needs to expose whether it has running processes. Use a callback ref pattern: Terminal calls `onRunningStateChange(paneId, isRunning)` whenever its running state changes. TabManager tracks running panes in a `Set<string>`.

7. **Behavior**: If the user confirms "Close anyway", proceed with the close as normal. If they cancel, do nothing.

## Tests

- [ ] `test_beforeunload_fires_when_process_running`: When a block is running, beforeunload event is not prevented (browser handles this).
- [ ] `test_beforeunload_not_set_when_idle`: No running blocks → no beforeunload handler.
- [ ] `test_tab_close_shows_confirmation_when_running`: Closing a tab with running process shows the dialog.
- [ ] `test_tab_close_no_confirmation_when_idle`: Closing a tab with no running process proceeds immediately.
- [ ] `test_confirmation_cancel_keeps_tab_open`: Clicking Cancel in the dialog does NOT close the tab.
- [ ] `test_confirmation_close_anyway_closes_tab`: Clicking "Close anyway" closes the tab.
- [ ] `test_pane_close_shows_confirmation_when_running`: Same for pane close.

## Acceptance Criteria
- [ ] Browser "Leave page?" dialog on window close when processes running
- [ ] Custom confirmation on tab close when process running
- [ ] Custom confirmation on pane close when process running
- [ ] No confirmation when no processes running
- [ ] Cancel keeps the tab/pane open
- [ ] "Close anyway" proceeds with close
- [ ] Dialog shows the running command text
- [ ] All tests pass
- [ ] Commit: `feat: add quit warning for running processes`

## Files to Read First
- `src/components/layout/TabManager.tsx` — tab/pane close handlers, state management
- `src/components/Terminal.tsx` — activeBlockIdRef, blocks status tracking
- `src/components/layout/PaneContainer.tsx` — pane close flow
- `src/components/SettingsModal.tsx` — modal dialog pattern
- `src/lib/types.ts` — Block type, Tab type
- `src/App.css` — modal overlay styles
