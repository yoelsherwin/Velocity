# Investigation: Test Coverage Gaps

**Date**: 2026-03-12
**Investigator**: Claude Opus 4.6 (Investigator Agent)
**Scope**: Full test suite analysis against TESTING.md 3-layer strategy
**Status**: Complete

---

## 1. Test Inventory

### Frontend Tests (Vitest) -- 7 files, 43 tests

| File | Tests | Category |
|------|-------|----------|
| `src/__tests__/App.test.tsx` | 2 | Component rendering (mocked) |
| `src/__tests__/ansi.test.ts` | 2 | Pure function unit tests |
| `src/__tests__/AnsiOutput.test.tsx` | 2 | Component rendering (mocked) |
| `src/__tests__/blocks.test.ts` | 4 | Data model + pure function |
| `src/__tests__/BlockView.test.tsx` | 7 | Component rendering + interaction |
| `src/__tests__/pty.test.ts` | 6 | IPC wrapper shape verification (mocked) |
| `src/__tests__/Terminal.test.tsx` | 20 | Component integration (all IPC/events mocked) |
| **Total** | **43** | |

### Rust Tests (cargo test) -- 2 modules, 34 tests (1 ignored)

| Module | Tests | Category |
|--------|-------|----------|
| `src-tauri/src/ansi/mod.rs` | 18 | Unit tests (synthetic input) |
| `src-tauri/src/pty/mod.rs` | 16 (1 ignored) | Unit tests (no real PTY, no AppHandle) |
| **Total** | **34 (1 ignored)** | |

### Rust Integration Tests -- 0

| Directory | Tests |
|-----------|-------|
| `src-tauri/tests/integration/` | Does not exist |

### E2E Tests (Playwright) -- 0

| Directory | Tests |
|-----------|-------|
| `e2e/` | Empty (contains only `.gitkeep`) |

### Command Layer Tests -- 0

| File | Tests |
|------|-------|
| `src-tauri/src/commands/mod.rs` | 0 (no `#[cfg(test)]` block) |

---

## 2. Detailed Test Analysis

### 2.1 Frontend: `App.test.tsx` (2 tests)

**Mocks**: `lib/pty` (all functions), `@tauri-apps/api/event` (listen)

| Test | Tests Real Behavior? | Code Path Exercised | Can Catch | Cannot Catch |
|------|---------------------|---------------------|-----------|-------------|
| `renders App with terminal` | No -- mocked IPC | App -> Terminal render path | React rendering crash | Real session creation failure, IPC errors |
| `renders terminal input` | No -- mocked IPC | App -> Terminal -> input field | Missing DOM element | Input field disabled states, real event flow |

**Assessment**: Smoke tests only. Verify the component tree renders without crashing. Zero integration value.

### 2.2 Frontend: `ansi.test.ts` (2 tests)

**Mocks**: None (pure functions)

| Test | Tests Real Behavior? | Code Path Exercised | Can Catch | Cannot Catch |
|------|---------------------|---------------------|-----------|-------------|
| `test_parseAnsi_plain_text` | Yes | `parseAnsi()` with plain text | Regression in plain text parsing | Handling of real ConPTY output |
| `test_parseAnsi_colored_text` | Yes | `parseAnsi()` with SGR red | Regression in color parsing | Complex multi-param SGR, edge cases |

**Assessment**: Good pure function tests, but only 2 cases. Missing: bold, italic, underline, dim, combined styles, 256-color, RGB color, empty input, multiline, partial SGR sequences.

### 2.3 Frontend: `AnsiOutput.test.tsx` (2 tests)

**Mocks**: `lib/pty`, `@tauri-apps/api/event` (unused but required by module graph)

| Test | Tests Real Behavior? | Code Path Exercised | Can Catch | Cannot Catch |
|------|---------------------|---------------------|-----------|-------------|
| `test_AnsiOutput_renders_plain_text` | Yes | AnsiOutput -> parseAnsi -> DOM | Missing text content | Performance (no stress test) |
| `test_AnsiOutput_renders_colored_span` | Yes | AnsiOutput -> parseAnsi -> colored span | Missing color style | Incorrect color mapping, style interactions |

**Assessment**: Minimal component coverage. Missing: bold rendering, background color, dim opacity, useMemo behavior, empty text, very long text.

### 2.4 Frontend: `blocks.test.ts` (4 tests)

**Mocks**: None (pure types and functions)

| Test | Tests Real Behavior? | Code Path Exercised | Can Catch | Cannot Catch |
|------|---------------------|---------------------|-----------|-------------|
| `test_block_has_required_fields` | Yes (type check) | Block interface shape | Type regression | Runtime behavior |
| `test_stripAnsi_removes_sgr` | Yes | `stripAnsi()` with SGR red | Broken SGR stripping | Non-SGR sequences leaking through |
| `test_stripAnsi_preserves_plain_text` | Yes | `stripAnsi()` with plain text | Plain text corruption | Edge cases |
| `test_stripAnsi_handles_empty` | Yes | `stripAnsi()` with empty string | Crash on empty input | N/A |

**Assessment**: Solid pure function tests. Missing: `stripAnsi` with multiple SGR params, nested SGR, non-SGR escape sequences (which should not be present given the Rust filter but defensive testing is valuable).

### 2.5 Frontend: `BlockView.test.tsx` (7 tests)

**Mocks**: Clipboard API

| Test | Tests Real Behavior? | Code Path Exercised | Can Catch | Cannot Catch |
|------|---------------------|---------------------|-----------|-------------|
| `test_BlockView_renders_command` | Yes | Command text rendering | Missing command display | Real ANSI output rendering |
| `test_BlockView_renders_output` | Yes | Output rendering via AnsiOutput | Missing output element | Real ConPTY output rendering |
| `test_BlockView_renders_timestamp` | Yes | Timestamp formatting | Wrong time display | Timezone issues |
| `test_BlockView_hides_header_for_welcome_block` | Yes | Welcome block (command === '') | Welcome block showing header | N/A |
| `test_BlockView_shows_running_indicator` | Yes | Running indicator conditional | Missing running indicator | Indicator with wrong styling |
| `test_BlockView_copy_command_button` | Yes | Copy Command -> clipboard | Broken clipboard write | N/A |
| `test_BlockView_rerun_calls_handler` | Yes | Rerun -> onRerun callback | Broken rerun handler | Rerun -> PTY integration |

**Assessment**: Good component coverage. Missing: Copy Output (with ANSI stripping), completed block styling, active vs inactive block states.

### 2.6 Frontend: `pty.test.ts` (6 tests)

**Mocks**: `@tauri-apps/api/core` (invoke)

| Test | Tests Real Behavior? | Code Path Exercised | Can Catch | Cannot Catch |
|------|---------------------|---------------------|-----------|-------------|
| `test_createSession_calls_invoke_correctly` | No -- mock only | IPC parameter shape | **camelCase mismatch** (parameter names) | Real IPC failure, Rust-side validation |
| `test_writeToSession_calls_invoke_correctly` | No -- mock only | IPC parameter shape | Parameter name typos | Write failures, PTY errors |
| `test_createSession_defaults` | No -- mock only | Default parameter handling | Missing defaults | Rust-side default handling |
| `test_resizeSession_calls_invoke_correctly` | No -- mock only | IPC parameter shape | Parameter name typos | Resize failures |
| `test_closeSession_calls_invoke_correctly` | No -- mock only | IPC parameter shape | Parameter name typos | Close failures, process cleanup |
| `test_startReading_calls_invoke_correctly` | No -- mock only | IPC parameter shape | Parameter name typos | Reader thread failures |

**Assessment**: These tests verify the SHAPE of IPC calls (command names, parameter names). They CAN catch camelCase mismatches between frontend parameter names and Rust command parameter names. They CANNOT catch any real IPC behavior. This is the one test category that COULD have caught the camelCase IPC mismatch bug -- IF the parameter names in the test assertions matched the Rust side. Currently they verify the frontend sends `shellType`/`sessionId`/`rows`/`cols`, which must match the Rust `shell_type`/`session_id`/`rows`/`cols` (Tauri auto-converts camelCase to snake_case).

### 2.7 Frontend: `Terminal.test.tsx` (20 tests)

**Mocks**: `lib/pty` (all functions), `@tauri-apps/api/event` (listen)

| Test | Tests Real Behavior? | Code Path Exercised | Can Catch | Cannot Catch |
|------|---------------------|---------------------|-----------|-------------|
| `test_terminal_renders_without_crashing` | No -- mocked | Component render | Render crash | Real PTY interaction |
| `test_terminal_has_output_area` | No -- mocked | DOM structure | Missing element | Real output display |
| `test_terminal_has_input_field` | No -- mocked | DOM structure | Missing element | Real input handling |
| `test_creates_session_on_mount` | No -- mocked | Mount -> createSession call | Missing createSession call | Real session creation failure |
| `test_sends_input_on_enter` | No -- mocked | Enter key -> writeToSession | Missing write call | Real PTY write failure |
| `test_clears_input_after_enter` | No -- mocked | Input cleared after Enter | Stale input | N/A |
| `test_displays_write_error_in_output` | No -- mocked | Write error -> block output | Missing error display | Real error messages |
| `test_shell_selector_renders` | No -- mocked | Shell buttons present | Missing buttons | Real shell availability |
| `test_powershell_selected_by_default` | No -- mocked | Default shell selection | Wrong default | N/A |
| `test_creates_session_with_default_shell` | No -- mocked | Default params to createSession | Wrong defaults | Real default handling |
| `test_shell_switch_creates_new_session` | No -- mocked | Shell switch lifecycle | Missing close/create calls | Real session lifecycle bugs |
| `test_restart_button_appears_on_exit` | No -- mocked | pty:closed -> restart button | Missing restart UI | Real process exit detection |
| `test_restart_creates_new_session` | No -- mocked | Restart -> new session | Missing session creation | Real session restart |
| `test_output_clears_on_restart` | No -- mocked | Restart -> clear output | Stale output after restart | Real output persistence |
| `test_initial_welcome_block_created` | No -- mocked | Mount -> welcome block | Missing welcome block | Real welcome block content |
| `test_command_creates_new_block` | No -- mocked | Enter -> new block created | Missing block creation | Real block output |
| `test_blocks_limited_to_max` | No -- mocked | MAX_BLOCKS constant | Wrong constant value | Slice enforcement logic |
| `test_startReading_called_after_listeners` | No -- mocked | Call ordering constraint | **emit/listen race** (order violation) | Real timing issues |
| `test_startReading_called_on_shell_switch` | No -- mocked | Shell switch -> startReading | Missing startReading on switch | Real reader restart |
| `test_startSession_cancels_on_remount` | No -- mocked | StrictMode double-mount | **Session leak on double-mount** | Real React StrictMode timing |

**Assessment**: The most comprehensive test file. Tests the component's behavioral contract against mocked backends. Key strengths:
- The `test_startReading_called_after_listeners` test verifies call ordering -- this IS the kind of test that catches the emit/listen race at the contract level.
- The `test_startSession_cancels_on_remount` test verifies StrictMode safety.

Key weakness: ALL tests use mocked IPC where async operations resolve instantly. The tests verify the component's sequential logic but NOT the real-world async timing. The mocked `listen()` registers callbacks synchronously, eliminating the real IPC round-trip delay that caused the emit/listen race.

### 2.8 Rust: `ansi/mod.rs` tests (18 tests)

**Mocks**: None (pure function tests)

| Test | Tests Real Behavior? | Code Path | Can Catch | Cannot Catch |
|------|---------------------|-----------|-----------|-------------|
| `test_plain_text_passes_through` | Yes | `filter()` with plain text | Text corruption | N/A |
| `test_sgr_color_preserved` | Yes | SGR red pass-through | Color stripping | Real ConPTY SGR output |
| `test_sgr_bold_preserved` | Yes | SGR bold pass-through | Bold stripping | Combined SGR |
| `test_sgr_multiple_params_preserved` | Yes | Multi-param SGR | Param joining bug | N/A |
| `test_osc_title_stripped` | Yes | OSC title removal | OSC leakage | Complex OSC sequences |
| `test_osc_hyperlink_stripped` | Yes | OSC hyperlink removal | Hyperlink leakage | iTerm2 file write attacks |
| `test_cursor_movement_stripped` | Yes | CSI H removal | Cursor leak | N/A |
| `test_erase_sequence_stripped` | Yes | CSI J removal | Erase leak | N/A |
| `test_device_query_stripped` | Yes | CSI n removal | DSR leak | N/A |
| `test_newline_preserved` | Yes | \n \r pass-through | Newline stripping | N/A |
| `test_tab_preserved` | Yes | \t pass-through | Tab stripping | N/A |
| `test_bell_stripped` | Yes | Bell removal | Bell leak | N/A |
| `test_empty_input` | Yes | Empty input | Crash on empty | N/A |
| `test_sgr_oversize_rejected` | Yes | MAX_SEQUENCE_LENGTH | Oversize pass-through | Unreachable via vte parser |
| `test_mixed_safe_and_unsafe` | Yes | Mixed SGR + OSC + CSI | Incorrect mixed filtering | N/A |
| `test_backspace_stripped` | Yes | Backspace removal | Backspace leak | N/A |
| `test_parser_persists_across_chunks` | Yes | Split SGR across calls | **Split sequence loss** | Real ConPTY split patterns |
| **Not tested**: DCS sequences | -- | -- | -- | DCS data leakage |

**Assessment**: Strong unit test coverage for the ANSI filter. The `test_parser_persists_across_chunks` test is particularly valuable -- it would have caught the original ANSI filter bug where the parser was recreated per call (which was fixed). Missing: DCS sequence test, C1 control code test, very long input, rapid sequential calls, real ConPTY output byte patterns.

### 2.9 Rust: `pty/mod.rs` tests (16 tests, 1 ignored)

**Mocks**: None -- but tests avoid real PTY operations

| Test | Tests Real Behavior? | Code Path | Can Catch | Cannot Catch |
|------|---------------------|-----------|-----------|-------------|
| `test_session_manager_starts_empty` | Yes | Constructor | N/A | N/A |
| `test_validate_shell_type_accepts_valid` | Yes | Shell validation | Missing valid shell | N/A |
| `test_validate_shell_type_rejects_invalid` | Yes | Shell validation | Injection attack | N/A |
| `test_close_nonexistent_session_returns_error` | Yes | Error path | Silent failure | Real close cleanup |
| `test_write_to_nonexistent_session_returns_error` | Yes | Error path | Silent failure | Real write |
| `test_resize_nonexistent_session_returns_error` | Yes | Error path | Silent failure | Real resize |
| `test_shutdown_flag_defaults_to_false` | Yes | AtomicBool init | Wrong default | N/A |
| `test_shutdown_flag_can_be_set` | Yes | AtomicBool set/get | Broken flag | N/A |
| `test_max_sessions_enforced` | Partial | Constant check only | Wrong constant | **Actual limit enforcement** |
| `test_spawn_powershell_session` | **IGNORED** | N/A | N/A | Everything real |
| `test_has_session_returns_false` | Yes | Map lookup | Wrong lookup | N/A |
| `test_start_reading_validates_session_exists` | Partial | has_session check only | N/A | Real reader start |
| `test_create_session_no_longer_takes_app_handle` | Partial | Signature check | N/A | Real session creation |
| `test_validate_dimensions_valid` | Yes | Dimension validation | Valid dims rejected | N/A |
| `test_validate_dimensions_zero_rows` | Yes | Dimension validation | Zero rows accepted | N/A |
| `test_validate_dimensions_zero_cols` | Yes | Dimension validation | Zero cols accepted | N/A |
| `test_validate_dimensions_overflow_rows` | Yes | Dimension validation | Overflow accepted | N/A |
| `test_validate_dimensions_overflow_cols` | Yes | Dimension validation | Overflow accepted | N/A |

**Assessment**: Almost entirely validation and error-path tests. ZERO tests exercise real PTY operations (session creation, writing, reading, closing). The one test that would (`test_spawn_powershell_session`) is `#[ignore]` with a `todo!()` body. The `test_max_sessions_enforced` test only checks the constant value (20), not the actual enforcement logic in `create_session`.

### 2.10 Rust: `commands/mod.rs` tests -- 0 tests

**The Tauri command layer has zero tests.** No `#[cfg(test)]` block exists in `commands/mod.rs`.

Untested code paths:
- `create_session` command: Parameter deserialization, state locking, spawn_blocking
- `start_reading` command: AppHandle forwarding, state locking
- `write_to_session` command: Parameter deserialization, state locking
- `resize_session` command: Parameter deserialization, state locking
- `close_session` command: Parameter deserialization, state locking

---

## 3. Gap Analysis Against TESTING.md

### Layer 1: Rust Integration Tests -- ALL MISSING

TESTING.md specifies these tests in `src-tauri/tests/integration/`:

| Required Test | Status | Priority |
|--------------|--------|----------|
| `test_real_powershell_echo` | **MISSING** | P0 |
| `test_real_ansi_output_filtered` | **MISSING** | P0 |
| `test_kill_session_terminates_process` | **MISSING** | P0 |
| `test_process_exit_detected` | **MISSING** | P1 |
| `test_multiple_sessions_independent` | **MISSING** | P1 |
| `test_large_output_streaming` | **MISSING** | P1 |
| `test_binary_output_handling` | **MISSING** | P2 |
| `test_rapid_input_while_streaming` | **MISSING** | P2 |

**Directory `src-tauri/tests/integration/` does not even exist.**

**Blocker**: The current PTY architecture emits events via `AppHandle`, which is unavailable in integration tests. TESTING.md explicitly calls out the channel refactor as a prerequisite.

### Layer 2: Tauri Command Integration Tests -- ALL MISSING

TESTING.md specifies these tests in `src-tauri/src/commands/mod.rs` or `src-tauri/tests/commands/`:

| Required Test | Status | Priority |
|--------------|--------|----------|
| `test_create_session_validates_shell_type` | **MISSING** | P1 |
| `test_create_session_validates_dimensions` | **MISSING** | P1 |
| `test_close_session_nonexistent_returns_error` | **MISSING** | P1 |
| `test_concurrent_command_access` | **MISSING** | P2 |

**Note**: Some validation is tested indirectly through `pty/mod.rs` unit tests (e.g., `validate_shell_type`, `validate_dimensions`), but the command handler layer itself -- parameter deserialization, state locking, `spawn_blocking` -- is untested.

### Layer 3: E2E Tests (Playwright) -- ALL MISSING

TESTING.md specifies these tests in `e2e/`:

| Required Test | Status | Priority |
|--------------|--------|----------|
| `type command and see output in block` | **MISSING** | P1 |
| `block shows exit code` | **MISSING** | P2 |
| `close pane kills process` | **MISSING** | P2 |

**Playwright is configured** (`playwright.config.ts` exists with `testDir: "./e2e"`) but the `e2e/` directory contains only `.gitkeep`.

---

## 4. Bugs That Tests Would Have Caught

### Bug: ConPTY Cursor Deadlock (FIX-009 / Reader Stuck After 4 Bytes)

**What happened**: `portable-pty` creates ConPTY with `PSEUDOCONSOLE_INHERIT_CURSOR` flag. ConPTY sends `\x1b[6n` (DSR cursor position query) as its first output and blocks until it receives `\x1b[row;colR` on stdin. Velocity never responded, causing the reader thread to block indefinitely after reading 4 bytes.

**Which test would have caught it**:
- **Layer 1**: `test_real_powershell_echo` -- Spawning a real PowerShell session and attempting to read output would have immediately revealed the 4-byte read followed by infinite blocking.
- **Layer 3**: `type command and see output in block` -- The E2E test would have timed out waiting for output.

**Why existing tests missed it**: All PTY tests are either `#[ignore]` or test only validation logic. No test spawns a real ConPTY session. The ANSI filter unit tests use synthetic byte arrays, never real ConPTY output.

**Priority if test existed**: Would have been caught immediately on first implementation. Estimated **3+ hours of debugging saved** (required 3 investigation reports to diagnose).

### Bug: ANSI Filter Stripping All ConPTY Output

**What happened**: The ANSI filter correctly stripped non-SGR sequences per its spec, but ConPTY output is 95%+ control sequences (cursor positioning, screen erase, line erase). Combined with the `!output.is_empty()` guard, most/all output events were suppressed.

**Which test would have caught it**:
- **Layer 1**: `test_real_ansi_output_filtered` -- Feeding real ConPTY output through the filter and asserting non-empty result would have immediately revealed the issue.
- **Layer 1**: `test_real_powershell_echo` -- The end-to-end spawn -> echo -> read -> filter path would have shown empty filtered output.

**Why existing tests missed it**: ANSI filter tests use hand-crafted synthetic inputs like `b"\x1b[31mred text\x1b[0m"`. Real ConPTY output looks nothing like these synthetic sequences. No test used captured real output as input.

**Priority if test existed**: Would have been caught during TASK-003 implementation. Estimated **2+ hours of debugging saved**.

### Bug: Emit/Listen Race Condition

**What happened**: The reader thread started emitting events immediately after session creation. The frontend's `listen()` calls are async IPC round-trips. Output emitted before listeners registered was permanently lost.

**Which test would have caught it**:
- **Layer 1**: With the channel refactor, an integration test would read from the channel (not events), making this race impossible at the Rust level.
- **Layer 2**: A command integration test exercising `create_session` -> `start_reading` -> verify output ordering would have caught it.
- **Layer 3**: An E2E test typing a command and expecting output would have revealed missing initial prompt.
- **Frontend**: `test_startReading_called_after_listeners` partially catches this by verifying call ordering. This test EXISTS and DID guide the `start_reading` lazy-reader fix. However, it could not catch the real timing issue because mocked `listen()` resolves synchronously.

**Why existing tests missed it**: Frontend tests mock `listen()` as synchronous -- eliminating the real IPC round-trip delay. The race only manifests with real async IPC.

**Priority if test existed**: The frontend test DID help here (it verified the ordering contract). A Layer 1 test with channels would have made this class of bug impossible.

### Bug: camelCase IPC Mismatch

**What happened**: Frontend sends parameters like `shellType`, `sessionId` (camelCase). Rust commands receive `shell_type`, `session_id` (snake_case). Tauri v2 auto-converts between these, so this was NOT actually a bug in Velocity. But the pattern is fragile.

**Which test would have caught it**:
- **Layer 2**: A Tauri command integration test using `tauri::test` utilities would invoke the real command handler with real parameter names, catching any deserialization mismatch.
- **Frontend**: `pty.test.ts` tests the frontend parameter names but against a mock. It verifies the frontend SENDS the right names. If the Rust side expected different names, this test would not catch it.

**Why existing tests missed it**: No test exercises the real Tauri parameter deserialization. Frontend tests mock `invoke()` and only verify the call shape. Rust tests don't invoke commands through the Tauri handler.

**A cross-boundary contract test** (shared type definitions or schema validation between frontend and Rust) would catch this class of bug.

---

## 5. PTY Refactoring Assessment

### Current Architecture (Untestable)

```
                  +-----------------+
                  |  Reader Thread  |
                  +-----------------+
                         |
                  reader.read(buf)
                         |
                  ansi_filter.filter()
                         |
                  app_handle.emit()  <-- Requires running Tauri app
                         |
                  Frontend listener
```

The reader thread in `src-tauri/src/pty/mod.rs:179-218` directly calls `app_handle.emit()`. This couples the PTY I/O logic to the Tauri runtime, making it impossible to test without a running Tauri application.

### Required Architecture (Testable)

```
                  +-----------------+
                  |  Reader Thread  |
                  +-----------------+
                         |
                  reader.read(buf)
                         |
                  ansi_filter.filter()
                         |
                  output_tx.send()   <-- Channel (testable)
                         |
              +----------+----------+
              |                     |
         [In tests]           [In production]
         test reads from      Bridge reads from
         output_rx            output_rx and calls
                              app_handle.emit()
```

### Files That Change

| File | Change | Effort |
|------|--------|--------|
| `src-tauri/src/pty/mod.rs` | **Major refactor**: Add `PtyEvent` enum, add `mpsc::UnboundedSender<PtyEvent>` to reader thread, store `mpsc::UnboundedReceiver<PtyEvent>` in `ShellSession`. Reader thread sends to channel instead of emitting. | **Medium** (50-80 lines changed) |
| `src-tauri/src/commands/mod.rs` | **New bridge logic**: `start_reading` command spawns a bridge task that reads from the channel and calls `app_handle.emit()`. Alternatively, the bridge is spawned when the session is created and the channel receiver is moved to it. | **Medium** (30-50 lines added) |
| `src-tauri/src/lib.rs` | Minor: May need to register new Tauri commands if the bridge is a separate command. | **Small** (1-5 lines) |

### New Files

| File | Purpose |
|------|---------|
| `src-tauri/tests/integration/mod.rs` | Integration test module |
| `src-tauri/tests/integration/pty_tests.rs` | Real PTY spawning + channel reading tests |

### Estimated Effort

| Phase | Effort |
|-------|--------|
| Define `PtyEvent` enum | 15 min |
| Add channel to `ShellSession` + reader thread | 30 min |
| Create bridge in `start_reading` or `commands/mod.rs` | 30 min |
| Update existing unit tests (if signatures change) | 15 min |
| Write Layer 1 integration tests (5-8 tests) | 2-3 hours |
| **Total** | **3.5 - 4.5 hours** |

### Risk Assessment

- **Low risk**: The refactor is an extraction, not a rewrite. The reader thread loop logic stays the same; only the output destination changes from `app_handle.emit()` to `channel.send()`.
- **Regression risk**: The bridge layer (channel -> emit) is new code that could introduce bugs. But it's trivially simple (read from channel, emit to frontend) and can be tested with Layer 2 tests.
- **Performance risk**: Negligible. `mpsc::unbounded_channel()` adds a channel hop but eliminates nothing. The channel's buffer prevents backpressure from the frontend from stalling the reader thread.

---

## 6. Coverage Summary Heatmap

```
Component              Unit Tests    Layer 1    Layer 2    Layer 3
                       (Mocked)      (Rust)     (Cmd)      (E2E)
=====================  ==========    =======    =======    =======
ANSI Filter            18 TESTS       NONE       N/A        NONE
  - SGR pass-through     COVERED       --         --          --
  - OSC stripping        COVERED       --         --          --
  - CSI stripping        COVERED       --         --          --
  - Real ConPTY input    MISSING       MISSING    --          --
  - Cross-chunk          COVERED       MISSING    --          --

PTY SessionManager     15 TESTS       NONE       NONE       NONE
  - Validation           COVERED       --         --          --
  - Error paths          COVERED       --         --          --
  - Real spawn           MISSING       MISSING    --          --
  - Real read/write      MISSING       MISSING    --          --
  - Process lifecycle    MISSING       MISSING    --          --
  - Concurrent sessions  MISSING       MISSING    --          --

Command Handlers       0 TESTS        N/A        NONE       NONE
  - Param deserialization  --          --         MISSING     --
  - State locking          --          --         MISSING     --
  - spawn_blocking         --          --         MISSING     --

Frontend IPC (pty.ts)  6 TESTS        N/A        N/A        NONE
  - Param shape          COVERED       --         --          --
  - Real IPC             MISSING       --         --          --

Terminal Component     20 TESTS        N/A        N/A        NONE
  - Render/DOM           COVERED       --         --          --
  - Session lifecycle    COVERED       --         --          --
  - Event routing        COVERED       --         --          --
  - StrictMode safety    COVERED       --         --          --
  - Real async timing    MISSING       --         --          --

BlockView Component    7 TESTS         N/A        N/A        NONE
  - Rendering            COVERED        --         --          --
  - Actions              COVERED        --         --          --

Full Pipeline          N/A             N/A        N/A        NONE
  - Type cmd -> see output  --          --         --        MISSING
  - Process exit           --           --         --        MISSING
  - Shell switch           --           --         --        MISSING
```

**Legend**: COVERED = tests exist, MISSING = no tests, NONE = entire layer missing, N/A = not applicable to this layer.

---

## 7. Prioritized Gaps

### Priority 0 (Would Have Prevented Production Bugs)

| # | Gap | Layer | Bug It Would Have Caught | Estimated Impact |
|---|-----|-------|--------------------------|-----------------|
| G-01 | **No real PTY spawn + read test** | Layer 1 | ConPTY cursor deadlock (3 investigations) | **Critical** -- 3+ hours debugging |
| G-02 | **No real ConPTY output through ANSI filter test** | Layer 1 | ANSI filter stripping all output | **Critical** -- 2+ hours debugging |
| G-03 | **No test for PTY output reaching frontend listener** | Layer 1/3 | Emit/listen race condition | **High** -- required architecture change (lazy reader) |

### Priority 1 (Prevent Future Bugs in Known Risk Areas)

| # | Gap | Layer | Risk |
|---|-----|-------|------|
| G-04 | **No command handler tests** | Layer 2 | Parameter deserialization bugs, state locking deadlocks |
| G-05 | **No process lifecycle test** (kill, exit, zombie) | Layer 1 | Orphaned processes, resource leaks |
| G-06 | **No concurrent session test** | Layer 1 | Cross-session contamination, deadlocks |
| G-07 | **No large output streaming test** | Layer 1 | Truncation, memory exhaustion, performance degradation |
| G-08 | **MAX_BLOCKS enforcement not behavior-tested** | Unit | Block eviction logic wrong (only constant value checked) |

### Priority 2 (Good Practice, Lower Risk)

| # | Gap | Layer | Risk |
|---|-----|-------|------|
| G-09 | **No E2E test at all** | Layer 3 | UI rendering bugs, full pipeline regression |
| G-10 | **No binary/non-UTF8 output test** | Layer 1 | Crash on binary output |
| G-11 | **No rapid input during streaming test** | Layer 1 | Deadlock under concurrent I/O |
| G-12 | **No output accumulation test** (pty:output -> active block) | Unit | Output routing to wrong block |
| G-13 | **No block status transition test** | Unit | Stale running indicators |
| G-14 | **No Copy Output ANSI stripping test** | Unit | ANSI sequences leaked to clipboard |
| G-15 | **ANSI filter: no DCS test** | Unit | DCS data leaking through |

---

## 8. Test Quality Assessment

### What the Existing Tests Do Well

1. **Frontend contract tests**: Terminal.test.tsx thoroughly tests the component's behavioral contract -- session creation, event routing, shell switching, restart, StrictMode safety, call ordering. These tests drove the correct fix for the emit/listen race.

2. **ANSI filter coverage**: 18 tests cover all major ANSI sequence categories (SGR, OSC, CSI, C0 controls). The cross-chunk persistence test is particularly valuable.

3. **Validation coverage**: Shell type validation and dimension validation are well-tested on the Rust side.

4. **IPC shape tests**: `pty.test.ts` verifies parameter names match, which provides a contract check against camelCase/snake_case mismatches.

### What the Existing Tests Do Poorly

1. **No real I/O anywhere**: 100% of tests use mocked I/O. Not a single test spawns a real process, reads from a real pipe, or sends a real IPC message. The PTY pipeline is the core of the application and has zero real-world testing.

2. **Synthetic ANSI input only**: All ANSI filter tests use hand-crafted byte sequences. Real ConPTY output is fundamentally different -- it's cursor-positioning-heavy with interleaved printable characters, not clean SGR-text-SGR patterns. This mismatch caused the "filter strips all output" bug.

3. **No cross-boundary tests**: Frontend and Rust are tested in isolation. No test verifies that the frontend's IPC call format matches what Rust expects, or that Rust's event emission format matches what the frontend's listener parses.

4. **Constant-value tests instead of behavior tests**: `test_max_sessions_enforced` checks `MAX_SESSIONS == 20` and `test_blocks_limited_to_max` checks `MAX_BLOCKS == 50`, but neither tests the actual enforcement logic (the `if sessions.len() >= MAX_SESSIONS` check or the `slice(-MAX_BLOCKS)` logic).

---

## 9. Recommendations

### Immediate (Before Next Feature Work)

1. **Implement the channel refactor** described in TESTING.md Section "Refactoring Required for Testability." This is the prerequisite for all Layer 1 tests. Without it, no real PTY behavior can be tested. Estimated: 1.5 hours.

2. **Write `test_real_powershell_echo`** -- the single highest-value test. Spawns a real PowerShell session, writes `echo hello\r\n`, reads from channel, asserts output contains "hello." This one test would have prevented the two biggest bugs. Estimated: 30 minutes (after channel refactor).

3. **Write `test_real_ansi_output_filtered`** -- spawns PowerShell, reads output through the ANSI filter, asserts the filtered result is non-empty and contains recognizable text (e.g., "PS" or "C:\\"). Estimated: 30 minutes.

### Short-Term (Next Sprint)

4. Write the remaining Layer 1 tests from TESTING.md (process lifecycle, concurrent sessions, large output).

5. Add Layer 2 command handler tests using `tauri::test` mock runtime.

6. Add behavior tests for MAX_BLOCKS enforcement and block status transitions.

### Medium-Term (After Pillar 2 - Block Model stabilizes)

7. Implement Playwright E2E tests for 3-5 critical user flows.

8. Add a cross-boundary contract test that validates frontend IPC parameter shapes against Rust command signatures (could be a build-time check or a shared schema).

---

## Appendix: Test Count Reconciliation

The task description states "43 frontend tests" and "34 Rust tests." My count from reading the files:

**Frontend**: 2 + 2 + 2 + 4 + 7 + 6 + 20 = **43 tests** (matches)

**Rust**: 18 (ansi) + 16 (pty, including 1 ignored) = **34 tests** (matches; 33 run + 1 ignored)

**E2E**: **0 tests** (matches)

## Appendix: Files Analyzed

| File | Purpose |
|------|---------|
| `C:\Velocity\prompts\TESTING.md` | 3-layer testing strategy |
| `C:\Velocity\src\__tests__\App.test.tsx` | App component tests |
| `C:\Velocity\src\__tests__\ansi.test.ts` | ANSI parsing tests |
| `C:\Velocity\src\__tests__\AnsiOutput.test.tsx` | AnsiOutput component tests |
| `C:\Velocity\src\__tests__\blocks.test.ts` | Block model + stripAnsi tests |
| `C:\Velocity\src\__tests__\BlockView.test.tsx` | BlockView component tests |
| `C:\Velocity\src\__tests__\pty.test.ts` | IPC wrapper shape tests |
| `C:\Velocity\src\__tests__\Terminal.test.tsx` | Terminal component tests |
| `C:\Velocity\src-tauri\src\ansi\mod.rs` | ANSI filter + 18 unit tests |
| `C:\Velocity\src-tauri\src\pty\mod.rs` | PTY session manager + 16 unit tests |
| `C:\Velocity\src-tauri\src\commands\mod.rs` | Tauri command handlers (0 tests) |
| `C:\Velocity\src-tauri\src\lib.rs` | Tauri app setup |
| `C:\Velocity\src\components\Terminal.tsx` | Terminal component |
| `C:\Velocity\src\components\AnsiOutput.tsx` | ANSI-styled text renderer |
| `C:\Velocity\src\components\blocks\BlockView.tsx` | Block rendering component |
| `C:\Velocity\src\lib\ansi.ts` | Frontend ANSI parsing |
| `C:\Velocity\src\lib\pty.ts` | Frontend IPC wrappers |
| `C:\Velocity\src\lib\types.ts` | Shared type definitions |
| `C:\Velocity\src\App.tsx` | App root component |
| `C:\Velocity\playwright.config.ts` | Playwright configuration |
| `C:\Velocity\e2e\.gitkeep` | Empty E2E directory |
| `C:\Velocity\prompts\reports\investigations\INVESTIGATION-pty-output-not-received.md` | Bug investigation #1 |
| `C:\Velocity\prompts\reports\investigations\INVESTIGATION-pty-output-still-missing.md` | Bug investigation #2 |
| `C:\Velocity\prompts\reports\investigations\INVESTIGATION-reader-stuck-after-4-bytes.md` | Bug investigation #3 |
| `C:\Velocity\prompts\reports\qa-reports\QA-REPORT-2026-03-12-R3.md` | QA report R3 |
| `C:\Velocity\prompts\tasks\TASK-003-ansi-filter.md` | ANSI filter task spec |
