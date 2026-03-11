# Task 002: PTY Engine — Spawn and Stream

## Context

The project was bootstrapped (TASK-001) and code review fixes applied (FIX-001). Current state:

- **HEAD**: `cb37ed6` on `main`
- **`src-tauri/src/lib.rs`**: Bare Tauri builder with `tauri_plugin_opener`. No custom commands or state.
- **`src-tauri/Cargo.toml`**: Dependencies are `tauri`, `tauri-plugin-opener`, `serde`, `serde_json`.
- **`src/App.tsx`**: Renders "Velocity" / "Modern Terminal for Windows" splash screen.
- **`src-tauri/capabilities/default.json`**: Permissions are `core:default` and `opener:default`.
- **`src-tauri/tauri.conf.json`**: CSP is `"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"`.
- **Rust module directories exist** (with `.gitkeep`): `commands/`, `pty/`, `ansi/`, `session/`.
- **Frontend directories exist** (with `.gitkeep`): `components/blocks/`, `components/editor/`, `components/layout/`, `hooks/`, `lib/`, `styles/`.
- **Vitest** configured with `@testing-library/react`, `jest-dom`, jsdom. Setup file at `src/__tests__/setup.ts`.

This task implements the foundation of the terminal: spawning a shell process via a pseudo-terminal (PTY), streaming its output to the frontend in real-time, and accepting user input.

### Architecture Decision: `portable-pty`

Use the [`portable-pty`](https://crates.io/crates/portable-pty) crate (from the wezterm project). **Do NOT use `tauri-plugin-pty`.**

Rationale: We need Rust-side control over the PTY read loop. Future features (ANSI parsing, block model command boundaries, security filtering) require intercepting output in Rust before it reaches the frontend. `tauri-plugin-pty` would bypass our Rust layer entirely.

Key `portable-pty` concepts:
- `native_pty_system()` → returns `ConPtySystem` on Windows (uses Windows ConPTY API)
- `pty_system.openpty(PtySize { rows, cols, .. })` → returns a `PtyPair { master, slave }`
- `pair.slave.spawn_command(cmd)` → spawns the shell process
- `pair.master.try_clone_reader()` → cloneable reader for output (blocking `std::io::Read`)
- `pair.master.take_writer()` → writer for input (called once, `std::io::Write`)
- `pair.master.resize(PtySize { .. })` → resize the terminal

## Requirements

### Backend (Rust)

#### 1. Dependencies

Add to `src-tauri/Cargo.toml`:
```toml
[dependencies]
portable-pty = "0.9"
uuid = { version = "1", features = ["v4"] }
```

`uuid` is for generating unique session IDs.

#### 2. Module: `src-tauri/src/pty/mod.rs`

Create a `ShellSession` struct and `SessionManager`:

```rust
pub struct ShellSession {
    pub id: String,
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn std::io::Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    pub shell_type: String,  // "powershell", "cmd", or "wsl"
}
```

`SessionManager` is the registry:
```rust
pub struct SessionManager {
    sessions: std::collections::HashMap<String, ShellSession>,
}
```

Methods on `SessionManager`:
- `new() -> Self`
- `create_session(shell_type, rows, cols, app_handle) -> Result<String, String>` — spawns the PTY, starts the reader thread, returns session ID
- `write_to_session(session_id, data) -> Result<(), String>` — writes bytes to the PTY
- `resize_session(session_id, rows, cols) -> Result<(), String>` — resizes the PTY
- `close_session(session_id) -> Result<(), String>` — kills the child process and cleans up
- `get_session_ids() -> Vec<String>` — list active sessions

#### 3. Shell Spawning Logic

In `create_session`:

1. Create the PTY system: `portable_pty::native_pty_system()`
2. Open a PTY pair with the given size
3. Build the command based on `shell_type`:
   - `"powershell"` → `CommandBuilder::new("powershell.exe")` with args `["-NoLogo", "-NoProfile"]`
   - `"cmd"` → `CommandBuilder::new("cmd.exe")`
   - `"wsl"` → `CommandBuilder::new("wsl.exe")`
   - Default to `"powershell"` if not specified
   - **Reject any other value** — return `Err("Invalid shell type: ...")`
4. Spawn the command on the slave PTY
5. Clone the reader from the master
6. Take the writer from the master
7. Generate a UUID for the session ID
8. Spawn a **`std::thread`** (NOT tokio — the reader is blocking I/O) for the output loop:

```rust
std::thread::spawn(move || {
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let output = String::from_utf8_lossy(&buf[..n]).to_string();
                let _ = app_handle.emit(
                    &format!("pty:output:{}", session_id),
                    output,
                );
            }
            Err(e) => {
                let _ = app_handle.emit(
                    &format!("pty:error:{}", session_id),
                    e.to_string(),
                );
                break;
            }
        }
    }
    let _ = app_handle.emit(&format!("pty:closed:{}", session_id), ());
});
```

9. Store the `ShellSession` in the registry
10. Return the session ID

#### 4. Module: `src-tauri/src/commands/mod.rs`

Tauri command handlers — thin wrappers around `SessionManager` methods. See IPC Contract below.

#### 5. Wire into `lib.rs`

- Register `SessionManager` as Tauri managed state (wrapped in `std::sync::Mutex`)
- Register all Tauri commands with `.invoke_handler(tauri::generate_handler![...])`

#### 6. Module files

- `src-tauri/src/pty/mod.rs` — ShellSession + SessionManager
- `src-tauri/src/commands/mod.rs` — Tauri command handlers
- Wire both into `lib.rs` with `mod pty; mod commands;`
- Remove `.gitkeep` files from directories that now have real files

#### 7. Capabilities

Add `"event:default"` to `src-tauri/capabilities/default.json` permissions array so the frontend can listen for events. If `invoke` calls fail with CSP errors, add `connect-src 'self' ipc: http://ipc.localhost` to the CSP in `tauri.conf.json`.

### Frontend (React/TypeScript)

#### 1. Terminal View Component

Create `src/components/Terminal.tsx`:

```
┌──────────────────────────────────────────┐
│ [output area - scrollable, monospace]    │
│ PS C:\> dir                              │
│ ...output lines...                       │
│                                          │
├──────────────────────────────────────────┤
│ > [input field]                     [⏎]  │
└──────────────────────────────────────────┘
```

Behavior:
- On mount: call `create_session` (default PowerShell), store the session ID in state
- Listen for `pty:output:{sessionId}` events → append text to output buffer state
- Listen for `pty:closed:{sessionId}` events → show "[Process exited]" message
- Output area: `<pre>` element, monospace font, auto-scrolls to bottom on new output, scrollable via overflow
- Input field: text input at the bottom, on Enter → call `write_to_session` with input text + `"\r"`, then clear input
- On unmount: call `close_session` to clean up
- **Output buffer limit**: Cap stored output at 100,000 characters. When exceeded, trim from the front. This prevents unbounded memory growth from long-running commands.

Styling:
- Dark background consistent with existing theme (#1e1e2e)
- Monospace font: `'Cascadia Code', 'Consolas', 'Courier New', monospace`
- Output text: #cdd6f4
- Keep it simple — no ANSI color rendering yet, plain text only

#### 2. Type Definitions

Create `src/lib/types.ts`:
```typescript
export interface SessionInfo {
  sessionId: string;
  shellType: string;
}
```

#### 3. IPC Wrapper

Create `src/lib/pty.ts` — typed wrappers around Tauri invoke calls:
```typescript
import { invoke } from '@tauri-apps/api/core';

export async function createSession(shellType?: string, rows?: number, cols?: number): Promise<string> { ... }
export async function writeToSession(sessionId: string, data: string): Promise<void> { ... }
export async function resizeSession(sessionId: string, rows: number, cols: number): Promise<void> { ... }
export async function closeSession(sessionId: string): Promise<void> { ... }
```

#### 4. Update App.tsx

Replace the "Velocity" splash screen with the Terminal component.

### IPC Contract

#### Commands (Frontend → Rust)

```
create_session(shell_type: Option<String>, rows: Option<u16>, cols: Option<u16>) -> Result<String, String>
```
- `shell_type`: `"powershell"` (default), `"cmd"`, or `"wsl"`. Anything else → error.
- `rows`/`cols`: initial terminal size, defaults to 24/80
- Returns: session ID (UUID string)

```
write_to_session(session_id: String, data: String) -> Result<(), String>
```
- `data`: raw string to write (including `\r` for Enter)

```
resize_session(session_id: String, rows: u16, cols: u16) -> Result<(), String>
```

```
close_session(session_id: String) -> Result<(), String>
```

#### Events (Rust → Frontend)

```
pty:output:{session_id} — payload: String
```
Raw text output from the PTY (may contain ANSI escape sequences — render as plain text for now).

```
pty:error:{session_id} — payload: String
```
Emitted on PTY read errors.

```
pty:closed:{session_id} — payload: ()
```
Emitted when the PTY reader loop ends (process exited or PTY closed).

## Tests (Write These FIRST)

The dev agent MUST write all tests below before writing any implementation code. Tests will initially fail (red). Then implement to make them pass (green).

### Rust Tests (`src-tauri/src/pty/mod.rs`)

These test the `SessionManager` in isolation (no Tauri runtime needed).

- [ ] **`test_session_manager_starts_empty`**: Call `SessionManager::new()`, then `get_session_ids()`. Assert the returned vec is empty.

- [ ] **`test_validate_shell_type_accepts_valid`**: Create a helper function `validate_shell_type(shell_type: &str) -> Result<(), String>` that validates the shell type. Test that `"powershell"`, `"cmd"`, and `"wsl"` all return `Ok(())`.

- [ ] **`test_validate_shell_type_rejects_invalid`**: Call `validate_shell_type("bash")`, `validate_shell_type("")`, `validate_shell_type("rm -rf /")`. All must return `Err(...)`.

- [ ] **`test_close_nonexistent_session_returns_error`**: Call `close_session("nonexistent-id")` on an empty SessionManager. Assert it returns `Err` containing "not found" (case-insensitive).

- [ ] **`test_write_to_nonexistent_session_returns_error`**: Call `write_to_session("nonexistent-id", "hello")` on an empty SessionManager. Assert it returns `Err` containing "not found".

- [ ] **`test_resize_nonexistent_session_returns_error`**: Call `resize_session("nonexistent-id", 24, 80)` on an empty SessionManager. Assert it returns `Err` containing "not found".

Integration tests (require a real shell — mark with `#[ignore]` for CI):

- [ ] **`test_spawn_powershell_session`** (`#[ignore]`): Spawn a PowerShell session via `create_session`. Assert the returned session ID is a valid UUID. Assert `get_session_ids()` contains the ID. Then call `close_session` to clean up.

### Frontend Tests (`src/__tests__/Terminal.test.tsx`)

Mock `@tauri-apps/api/core` (`invoke`) and `@tauri-apps/api/event` (`listen`) before each test.

- [ ] **`test_terminal_renders_without_crashing`**: Render `<Terminal />`. Assert the component mounts (no errors thrown).

- [ ] **`test_terminal_has_output_area`**: Render `<Terminal />`. Assert an element with `data-testid="terminal-output"` (or role) exists.

- [ ] **`test_terminal_has_input_field`**: Render `<Terminal />`. Assert an input element exists.

- [ ] **`test_creates_session_on_mount`**: Render `<Terminal />`. Assert `invoke` was called with `'create_session'` and default parameters.

- [ ] **`test_sends_input_on_enter`**: Mock `invoke('create_session')` to resolve with `"test-session-id"`. Render `<Terminal />`, wait for mount. Type `"echo hello"` into the input, press Enter. Assert `invoke` was called with `'write_to_session'` and `{ session_id: "test-session-id", data: "echo hello\r" }`.

- [ ] **`test_clears_input_after_enter`**: Same setup as above. After pressing Enter, assert the input field value is empty.

### IPC Wrapper Tests (`src/__tests__/pty.test.ts`)

- [ ] **`test_createSession_calls_invoke_correctly`**: Mock `invoke`. Call `createSession("powershell", 24, 80)`. Assert `invoke` was called with `"create_session"` and `{ shell_type: "powershell", rows: 24, cols: 80 }`.

- [ ] **`test_writeToSession_calls_invoke_correctly`**: Mock `invoke`. Call `writeToSession("abc-123", "dir\r")`. Assert `invoke` was called with `"write_to_session"` and `{ session_id: "abc-123", data: "dir\r" }`.

- [ ] **`test_createSession_defaults`**: Mock `invoke`. Call `createSession()` with no args. Assert `invoke` was called with `"create_session"` and `{ shell_type: undefined, rows: undefined, cols: undefined }` (or the args are omitted).

## Acceptance Criteria

- [ ] All tests above are written and passing
- [ ] `portable-pty` and `uuid` added as Rust dependencies
- [ ] `ShellSession` and `SessionManager` implemented in `src-tauri/src/pty/mod.rs`
- [ ] Shell type validation rejects anything other than `"powershell"`, `"cmd"`, `"wsl"`
- [ ] Tauri commands implemented and registered: `create_session`, `write_to_session`, `resize_session`, `close_session`
- [ ] Reader thread spawns per session, emits `pty:output:{id}` events
- [ ] Frontend `Terminal` component displays streamed output in real-time
- [ ] Frontend input field sends commands to the PTY on Enter
- [ ] Frontend output buffer capped at 100,000 characters
- [ ] IPC wrapper functions in `src/lib/pty.ts` with proper types
- [ ] `npm run test` passes (all frontend tests)
- [ ] `cargo test` passes in `src-tauri/` (all Rust unit tests; `#[ignore]` integration tests pass locally)
- [ ] Manual test: `npm run tauri dev` → type commands → see output stream in real-time
- [ ] No `unwrap()` on user-derived data — all errors handled with `Result`
- [ ] Capabilities updated if needed for events/IPC
- [ ] Clean commit: `feat: implement PTY engine with shell spawning and output streaming`

## Security Notes

- **Do NOT** interpolate user input into shell command strings. The PTY receives raw bytes — the user types directly into the shell.
- **Validate `shell_type`** — only allow `"powershell"`, `"cmd"`, and `"wsl"`. Reject anything else.
- **No `unwrap()`** on anything derived from IPC inputs or PTY reads. Use `Result` and `?` or match.
- The reader thread must handle read errors gracefully (emit error event and break, don't panic).
- Output buffer on frontend is capped to prevent memory exhaustion from malicious/infinite output.

## Files to Read First

- `src-tauri/src/lib.rs` — Current Tauri setup, where to register commands and state
- `src-tauri/src/main.rs` — Entry point
- `src-tauri/Cargo.toml` — Current dependencies
- `src-tauri/tauri.conf.json` — CSP config (may need `connect-src` for IPC)
- `src-tauri/capabilities/default.json` — Current permissions (may need `event:default`)
- `src/App.tsx` — Will be replaced with Terminal component
- `src/App.css` — Current styles (extend for Terminal)
- `vitest.config.ts` — Test config with setup file
- `src/__tests__/setup.ts` — jest-dom setup
