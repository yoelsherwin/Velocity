# Task 028: Desktop Notifications for Long-Running Commands (P1-U5)

## Context

When a command takes a long time (e.g., `npm install`, `cargo build`, `docker pull`), the user often switches to another window. They have no way to know when the command finishes without manually checking back. This task adds a desktop notification when a long-running command completes.

### What exists now

- **Terminal.tsx**: Detects command completion via exit code extraction. Blocks transition from `status: 'running'` to `status: 'completed'` with an `exitCode`.
- **Block type**: `{ id, command, output, timestamp, status, exitCode, shellType }`.
- **Tauri**: Supports the Web Notification API in its WebView2 (Chromium-based).

## Requirements

### Frontend only — no Rust changes.

1. **Threshold**: Only notify for commands that ran for 10+ seconds. Calculate from `block.timestamp` (when submitted) to completion time.

2. **Notification content**:
   - Title: `"Command completed"` (success) or `"Command failed"` (non-zero exit code)
   - Body: The command text (truncated to 80 chars if longer)
   - Optionally include exit code for failures

3. **Condition**: Only notify when the app window is NOT focused (`!document.hasFocus()`). Don't notify if the user is already looking at the terminal.

4. **Permission**: Use the Web Notification API (`new Notification(...)`). Request permission on first long-running command completion. If denied, silently skip.

5. **Implementation**: In Terminal.tsx, when a block transitions to `completed`:
   - Check if `Date.now() - block.timestamp >= 10000` (10 seconds)
   - Check if `!document.hasFocus()`
   - If both true, show a notification
   - Click on notification focuses the app window

6. **Settings**: No settings for MVP. Hardcode the 10-second threshold. Notifications can be disabled via browser/OS notification settings.

7. **Register in command palette**: Add `notifications.test` command that sends a test notification.

## Tests

- [ ] `test_notification_shown_for_long_command`: Command running 10+ seconds with window unfocused triggers notification.
- [ ] `test_no_notification_for_short_command`: Command completing in <10 seconds does NOT trigger notification.
- [ ] `test_no_notification_when_focused`: Long command completing while window IS focused does NOT trigger notification.
- [ ] `test_notification_title_success`: Exit code 0 → "Command completed".
- [ ] `test_notification_title_failure`: Non-zero exit code → "Command failed".
- [ ] `test_notification_body_truncated`: Command longer than 80 chars is truncated in body.

## Acceptance Criteria
- [ ] Notifications fire for commands running 10+ seconds when window unfocused
- [ ] No notification for short commands or focused window
- [ ] Notification shows command text and success/failure
- [ ] Click notification focuses the app
- [ ] Permission requested gracefully
- [ ] All tests pass
- [ ] Commit: `feat: add desktop notifications for long-running commands`

## Files to Read First
- `src/components/Terminal.tsx` — block completion detection, exit code handling
- `src/lib/types.ts` — Block type with timestamp
- `src/lib/commands.ts` — command palette registry
