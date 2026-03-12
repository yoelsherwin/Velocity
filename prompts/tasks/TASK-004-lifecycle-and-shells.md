# Task 004: Process Lifecycle + Shell Selection + Input Validation

## Context

Pillar 1 (Process Interfacing) is nearly complete. Current state:

- **HEAD**: `cc00770` on `main`
- **`src-tauri/src/pty/mod.rs`**: `SessionManager` with `create_session`, `write_to_session`, `resize_session`, `close_session`. Shell types validated: `"powershell"`, `"cmd"`, `"wsl"`. `MAX_SESSIONS = 20`. Reader thread with persistent `vte::Parser` and `AnsiFilter`.
- **`src-tauri/src/commands/mod.rs`**: 4 Tauri commands using `spawn_blocking`. `rows`/`cols` default to 24/80 when not provided.
- **`src/components/Terminal.tsx`**: Creates a PowerShell session on mount. Listens for `pty:output`, `pty:error`, `pty:closed` events. Shows `[Process exited]` when closed. Input field at the bottom.
- **`src/lib/pty.ts`**: Typed IPC wrappers for all 4 commands.
- **`src/lib/types.ts`**: `SessionInfo` interface.

### What's missing to complete Pillar 1:

1. **Restart** — When a shell process exits (naturally or via `close_session`), user should be able to restart it. Currently the `[Process exited]` message is final.
2. **Shell selection** — User can't choose between PowerShell, CMD, and WSL. Hardcoded to PowerShell.
3. **Input validation** — `rows`/`cols` accept 0 or extreme values (QA BUG-006). Need bounds checking.
4. **Natural exit detection** — The `pty:closed` event fires, but there's no exit code information passed to the frontend.

## Requirements

### Backend (Rust)

#### 1. Input validation for rows/cols

In `SessionManager::create_session` and `SessionManager::resize_session`, validate `rows` and `cols`:
- Minimum: 1
- Maximum: 500 (reasonable upper bound — no terminal needs more)
- If out of range, return `Err` with a descriptive message

```rust
fn validate_dimensions(rows: u16, cols: u16) -> Result<(), String> {
    if rows < 1 || rows > 500 {
        return Err(format!("Invalid rows: {}. Must be between 1 and 500.", rows));
    }
    if cols < 1 || cols > 500 {
        return Err(format!("Invalid cols: {}. Must be between 1 and 500.", cols));
    }
    Ok(())
}
```

Call this at the top of `create_session` and `resize_session`.

#### 2. Exit code in `pty:closed` event

Currently the reader thread emits `pty:closed:{id}` with an empty payload `()`. Change the payload to include the exit code if available.

After the reader loop ends, try to get the exit code from the child process. This is tricky because the `child` is in the `SessionManager` behind a mutex, and the reader thread doesn't have access to it.

**Approach**: Store a clone of the `shutdown` flag and the `app_handle` in the reader thread. When the reader detects EOF/error, emit `pty:closed:{id}` with a payload that just signals closure. Then, separately, add a **new Tauri command** `get_session_status` that the frontend can call to check if a session's process has exited and get the exit code.

Actually, a simpler approach: share the `Child` exit status via an `Arc<Mutex<Option<ExitStatus>>>` that both the reader thread and `close_session` can update. But this adds complexity.

**Simplest approach for MVP**: Just emit the `pty:closed` event as-is (no exit code). The frontend shows "[Process exited]" and a restart button. The user doesn't strictly need the exit code for Pillar 1 — that's a Block Model feature (Pillar 2). Keep it simple.

#### 3. Restart support — no new Rust code needed

Restart is a frontend concern: close the old session, create a new one with the same shell type. The Rust backend already supports this — `close_session` + `create_session`. No new Rust commands needed.

### Frontend (React/TypeScript)

#### 1. Shell selector

Add a simple shell selector to the Terminal component. When no session is active (initial load or after process exit), show a small dropdown/button group to pick the shell:

```
┌──────────────────────────────────────────┐
│  Shell: [PowerShell ▼]  [CMD] [WSL]     │
│                                          │
│  [output area]                           │
│                                          │
├──────────────────────────────────────────┤
│ > [input field]                          │
└──────────────────────────────────────────┘
```

- Show shell selector buttons at the top of the Terminal
- Three buttons: PowerShell, CMD, WSL
- Highlight the currently active shell
- Clicking a different shell while a session is running: close the current session and start a new one with the selected shell
- Default: PowerShell (same as current)
- Store the selected shell type in component state

Styling:
- Small buttons, same dark theme
- Active shell button gets a subtle highlight (e.g., slightly lighter background `#313244` or a bottom border accent `#89b4fa`)
- Inactive buttons: same as background, lighter text

#### 2. Restart button

When the process exits (`closed` state is true):
- Show a "Restart" button (or "Press Enter to restart") in the output area or replacing the input field
- Clicking restart: calls `closeSession` (cleanup), then `createSession` with the same shell type
- Reset the output buffer on restart (fresh terminal)
- Re-enable the input field

#### 3. Update Terminal component state

The Terminal component needs to track:
- `shellType: string` — currently selected shell (default `"powershell"`)
- `sessionId: string | null` — current session
- `output: string` — output buffer
- `closed: boolean` — whether the process has exited
- `input: string` — current input value

When switching shells or restarting:
1. If a session exists, call `closeSession`
2. Clear the output buffer
3. Call `createSession` with the new shell type
4. Set up new event listeners for the new session ID
5. Update state

#### 4. Update IPC wrapper

No changes needed to `src/lib/pty.ts` — `createSession` already accepts `shellType`.

#### 5. Update types

Add shell type constants to `src/lib/types.ts`:
```typescript
export const SHELL_TYPES = ['powershell', 'cmd', 'wsl'] as const;
export type ShellType = typeof SHELL_TYPES[number];

export interface SessionInfo {
  sessionId: string;
  shellType: ShellType;
}
```

### IPC Contract

No new commands. Existing commands are sufficient:
- `create_session(shell_type, rows, cols)` — already supports all shell types
- `close_session(session_id)` — already works
- `write_to_session(session_id, data)` — unchanged
- `resize_session(session_id, rows, cols)` — now with validation

Events unchanged:
- `pty:output:{id}`, `pty:error:{id}`, `pty:closed:{id}`

## Tests (Write These FIRST)

### Rust Tests (`src-tauri/src/pty/mod.rs`)

- [ ] **`test_validate_dimensions_valid`**: `validate_dimensions(24, 80)` returns `Ok(())`. Also test `(1, 1)` and `(500, 500)`.

- [ ] **`test_validate_dimensions_zero_rows`**: `validate_dimensions(0, 80)` returns `Err` containing "Invalid rows".

- [ ] **`test_validate_dimensions_zero_cols`**: `validate_dimensions(24, 0)` returns `Err` containing "Invalid cols".

- [ ] **`test_validate_dimensions_overflow_rows`**: `validate_dimensions(501, 80)` returns `Err` containing "Invalid rows".

- [ ] **`test_validate_dimensions_overflow_cols`**: `validate_dimensions(24, 501)` returns `Err` containing "Invalid cols".

- [ ] **`test_create_session_rejects_zero_rows`**: Call `create_session` with `rows=0` on a `SessionManager` (requires AppHandle — if not possible, test `validate_dimensions` in isolation).

### Frontend Tests (Vitest)

- [ ] **`test_shell_selector_renders`**: Render `<Terminal />`. Assert three shell buttons exist (PowerShell, CMD, WSL).

- [ ] **`test_powershell_selected_by_default`**: Render `<Terminal />`. Assert the PowerShell button has the active/selected style or aria attribute.

- [ ] **`test_creates_session_with_default_shell`**: Render `<Terminal />`. Assert `createSession` was called with `'powershell'`.

- [ ] **`test_shell_switch_creates_new_session`**: Render `<Terminal />`, wait for mount. Click the CMD button. Assert `closeSession` was called for the old session, then `createSession` was called with `'cmd'`.

- [ ] **`test_restart_button_appears_on_exit`**: Render `<Terminal />`, simulate `pty:closed` event. Assert a restart button is visible.

- [ ] **`test_restart_creates_new_session`**: Render `<Terminal />`, simulate exit, click restart. Assert `createSession` is called again with the same shell type.

- [ ] **`test_output_clears_on_restart`**: After restart, assert the output area is empty (no stale output from previous session).

## Acceptance Criteria

- [ ] All tests above are written and passing
- [ ] `rows`/`cols` validated: min 1, max 500, with descriptive error messages
- [ ] Shell selector with PowerShell, CMD, WSL buttons at the top of Terminal
- [ ] Active shell visually highlighted
- [ ] Switching shells closes current session and opens new one
- [ ] Restart button appears when process exits
- [ ] Restart clears output and creates a fresh session with same shell type
- [ ] Shell type constants defined in `src/lib/types.ts`
- [ ] `npm run test` passes
- [ ] `cargo test` passes
- [ ] Manual test: switch between PowerShell and CMD, run commands in each
- [ ] Manual test: type `exit` in PowerShell, see restart button, click it, get fresh session
- [ ] No `unwrap()` on user-derived data
- [ ] Clean commit: `feat: add shell selection, restart support, and input validation`

## Security Notes

- `rows`/`cols` validation prevents potential undefined behavior in the PTY layer from extreme values.
- Shell switching reuses the existing `close_session` + `create_session` path — no new security surface.
- Shell type is still validated by the existing allowlist (`"powershell"`, `"cmd"`, `"wsl"`).

## Files to Read First

- `src-tauri/src/pty/mod.rs` — SessionManager, create_session, resize_session (add validation)
- `src-tauri/src/commands/mod.rs` — Tauri command wrappers (unchanged but read for context)
- `src/components/Terminal.tsx` — Main component to modify (shell selector, restart)
- `src/lib/pty.ts` — IPC wrappers (unchanged)
- `src/lib/types.ts` — Add ShellType constants
- `src/App.css` — Add styles for shell selector and restart button
