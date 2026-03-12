# Velocity Testing Strategy

## The Problem

Unit tests mock all integration points. The actual PTY spawning, IPC round-trips,
and event streaming have never been tested. Bugs slip through because mocks say
"yes" when the real system says "no."

## Three Layers

```
Layer 3: Full E2E (Playwright + running app)        ← slowest, most realistic
Layer 2: Tauri command integration (real state, mock runtime) ← medium speed
Layer 1: Rust integration (real PTY, no UI)          ← fastest, highest value
         ─────────────────────────────────────────
         Existing unit tests (mocked, fast)          ← keep these
```

---

## Layer 1: Rust Integration Tests (Priority: HIGHEST)

**What**: Test the real Rust backend with real shell processes. No UI, no mocks.

**Why**: This is where the bugs live. The PTY reader thread, ANSI filtering on
real output, process lifecycle, concurrent sessions — none of this is tested today.

**Where**: `src-tauri/tests/integration/` (separate from unit tests)

**How to run**: `cd src-tauri && cargo test --test '*'` (integration tests)
or `cargo test -- --ignored` (for the existing ignored test)

### What to test:

**Real PTY spawning and output:**
```rust
#[tokio::test]
async fn test_real_powershell_echo() {
    // Create a real SessionManager
    // Spawn a real PowerShell process
    // Write "echo hello\r\n" to the PTY
    // Read from the PTY reader
    // Assert output contains "hello"
    // Close the session
    // Assert process is cleaned up
}
```

**Real ANSI filtering on live output:**
```rust
#[tokio::test]
async fn test_real_ansi_output_filtered() {
    // Spawn PowerShell
    // Run a command that produces colored output (e.g., Get-ChildItem)
    // Verify ANSI SGR codes are preserved (colors)
    // Verify dangerous sequences are stripped (OSC title, etc.)
}
```

**Process lifecycle:**
```rust
#[tokio::test]
async fn test_kill_session_terminates_process() {
    // Spawn a long-running command (e.g., ping -t localhost)
    // Kill the session
    // Verify the process is no longer running
    // Verify no zombie processes
}

#[tokio::test]
async fn test_process_exit_detected() {
    // Spawn PowerShell
    // Write "exit\r\n"
    // Verify the reader thread terminates
    // Verify session cleanup
}
```

**Concurrent sessions:**
```rust
#[tokio::test]
async fn test_multiple_sessions_independent() {
    // Spawn 3 sessions (powershell, cmd, powershell)
    // Write different commands to each
    // Verify outputs don't cross-contaminate
    // Close one, verify others still work
}
```

**Edge cases:**
```rust
#[tokio::test]
async fn test_large_output_streaming() {
    // Run: 1..1000 | ForEach-Object { "line $_" }
    // Verify all 1000 lines arrive
    // Verify no truncation or corruption
}

#[tokio::test]
async fn test_binary_output_handling() {
    // Run a command that produces non-UTF8 output
    // Verify no crash, output is handled gracefully
}

#[tokio::test]
async fn test_rapid_input_while_streaming() {
    // Start a long-running output command
    // Simultaneously write input
    // Verify no deadlock or data corruption
}
```

### Implementation pattern:

The challenge is that the current PTY code emits events via `AppHandle`, which
doesn't exist in tests. Solution: **extract the core PTY logic into testable
functions that return output via a channel instead of emitting events.**

```rust
// In production: reader thread → app_handle.emit()
// In tests:      reader thread → mpsc::channel → test asserts

pub struct PtySession {
    writer: Box<dyn Write + Send>,
    output_rx: mpsc::Receiver<String>,  // Tests read from this
    // ...
}
```

This refactor makes the PTY testable WITHOUT mocking AppHandle. The Tauri
command layer is a thin wrapper that reads from the channel and emits events.

---

## Layer 2: Tauri Command Integration Tests (Priority: MEDIUM)

**What**: Test the Tauri command handlers with real SessionManager state but
mock Tauri runtime.

**Why**: Catches bugs in the command layer — parameter validation, state locking,
error propagation. Currently has ZERO tests.

**Where**: `src-tauri/src/commands/mod.rs` (inline tests) or
`src-tauri/tests/commands/`

**How**: Use `tauri::test` utilities from Tauri v2.

### What to test:

```rust
#[cfg(test)]
mod tests {
    use tauri::test::{mock_builder, MockRuntime};

    #[test]
    fn test_create_session_validates_shell_type() {
        // Build mock app with real SessionManager state
        // Call create_session with invalid shell type
        // Assert error returned (not panic)
    }

    #[test]
    fn test_create_session_validates_dimensions() {
        // Call with rows=0, cols=0
        // Assert error (not PTY crash)
    }

    #[test]
    fn test_close_session_nonexistent_returns_error() {
        // Call close_session with fake ID
        // Assert clean error message
    }

    #[test]
    fn test_concurrent_command_access() {
        // Spawn multiple async commands accessing same state
        // Assert no deadlock, no panic
    }
}
```

---

## Layer 3: Full E2E with Playwright (Priority: LOWER, add after Layers 1-2)

**What**: Drive the real Tauri app with Playwright. Type commands, verify blocks.

**Why**: Tests the complete user experience. Catches UI rendering bugs, event
listener issues, React state management problems.

**Where**: `e2e/` directory (already has Playwright config)

**How**: Build the app, launch it, connect Playwright to the WebView.

### Setup:

```typescript
// e2e/fixtures.ts
import { test as base } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';

export const test = base.extend<{ app: ChildProcess }>({
    app: async ({}, use) => {
        // Build the app first: npm run tauri build -- --debug
        // Launch the built app
        const app = spawn('src-tauri/target/debug/velocity.exe');

        // Wait for app to be ready (poll for window)
        await waitForApp();

        await use(app);

        // Cleanup
        app.kill();
    },
});
```

For connecting to the WebView, Tauri v2 options:
1. **tauri-driver** — provides WebDriver protocol, use with WebdriverIO
2. **CDP** — if the webview exposes Chrome DevTools Protocol (enable via
   `WEBKIT_INSPECTOR_SERVER` env var on Windows)
3. **Accessibility APIs** — for native-feeling tests

### What to test (critical flows only):

```typescript
test('type command and see output in block', async ({ page }) => {
    // Wait for terminal to load
    await page.waitForSelector('[data-testid="terminal-input"]');

    // Type a command
    await page.fill('[data-testid="terminal-input"]', 'echo hello');
    await page.keyboard.press('Enter');

    // Wait for block to appear
    const block = await page.waitForSelector('[data-testid="block"]');
    const output = await block.textContent();
    expect(output).toContain('hello');
});

test('block shows exit code', async ({ page }) => {
    await page.fill('[data-testid="terminal-input"]', 'exit 1');
    await page.keyboard.press('Enter');

    const exitCode = await page.waitForSelector('[data-testid="exit-code"]');
    expect(await exitCode.textContent()).toContain('1');
});

test('close pane kills process', async ({ page }) => {
    // Start a long-running command
    await page.fill('[data-testid="terminal-input"]', 'ping -t localhost');
    await page.keyboard.press('Enter');

    // Close the pane
    await page.click('[data-testid="close-pane"]');

    // Verify no orphaned process (check via tasklist or similar)
});
```

### E2E test scope — keep it small:
- 5-10 critical user flows, not 100 fine-grained tests
- Focus on integration points that unit tests can't cover
- Each test should take < 30 seconds

---

## Test Commands (Updated)

```bash
npm run test              # Vitest unit tests (frontend, fast, mocked)
npm run test:rust         # cargo test (Rust unit + integration)
npm run test:e2e          # Playwright E2E (slow, needs built app)
npm run test:all          # All of the above
```

---

## What Each Layer Catches

| Bug Class | Unit Tests | Layer 1 (Rust) | Layer 2 (Commands) | Layer 3 (E2E) |
|-----------|-----------|----------------|-------------------|---------------|
| React rendering bugs | ✓ | | | ✓ |
| IPC parameter shape | ✓ | | ✓ | ✓ |
| PTY spawn failures | | ✓ | | ✓ |
| ANSI filtering on real output | | ✓ | | ✓ |
| Process lifecycle (kill, exit) | | ✓ | | ✓ |
| Concurrent session bugs | | ✓ | ✓ | |
| Event streaming issues | | ✓ | | ✓ |
| Input validation gaps | ✓ | | ✓ | |
| State locking deadlocks | | | ✓ | ✓ |
| UI + backend integration | | | | ✓ |
| Resource leaks | | ✓ | | |
| Large output handling | | ✓ | | ✓ |

---

## Refactoring Required for Testability

The current PTY code emits events directly via `AppHandle`, making it impossible
to test without a running Tauri app. The fix:

### Before (untestable):
```rust
// Reader thread emits directly to frontend
let _ = app_handle.emit(&format!("pty:output:{}", sid), output);
```

### After (testable):
```rust
// Reader thread sends to a channel
// Production: a Tauri bridge reads the channel and emits
// Tests: test code reads the channel and asserts

pub struct PtySession {
    pub output_rx: mpsc::UnboundedReceiver<PtyEvent>,
    writer: OwnedWritePty,
    child: Child,
}

pub enum PtyEvent {
    Output(String),
    Exit(i32),
    Error(String),
}
```

This is the **one architectural change** needed to make Layers 1 and 2 work.
The Tauri event emission moves to a thin bridge layer that's trivial to test
separately.

---

## Implementation Order

1. **Refactor PTY to use channels** (prerequisite for everything else)
2. **Layer 1: Rust integration tests** (highest value, fastest to write)
3. **Layer 2: Command integration tests** (fills the command handler gap)
4. **Layer 3: Playwright E2E** (after Pillar 2 — Block Model — gives UI to test)
