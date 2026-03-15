# QA Report: TASK-017 Agent Mode UI

**Date**: 2026-03-15
**Reviewer**: QA Agent
**Round**: R1
**Verdict**: PASS (with minor findings)

---

## 1. Test Results

### Frontend Tests (Vitest)
- **Result**: 193/193 passed, 0 failed
- **Command**: `npm run test`
- All 19 test files pass, including the TASK-017-specific test files:
  - `src/__tests__/intent-classifier.test.ts` (16 tests)
  - `src/__tests__/llm.test.ts` (2 tests)
  - `src/__tests__/Terminal.test.tsx` (36 tests, including 7 agent-mode-specific tests)

### Rust Tests (cargo test)
- **Result**: 74/74 passed (64 unit + 10 integration), 1 ignored
- **Command**: `cd src-tauri && cargo test`
- Agent-mode-specific tests:
  - `commands::tests::test_get_cwd_returns_string` -- PASS
  - `llm::tests::*` (14 tests) -- ALL PASS
  - `settings::tests::*` (12 tests) -- ALL PASS

---

## 2. Code-Level Bug Hunt

### 2.1 Never-Auto-Execute Guarantee (CRITICAL PATH)

**Status: SECURE**

The never-auto-execute guarantee is the most critical security property of agent mode. Analysis:

1. **`handleSubmit` in `Terminal.tsx` (lines 285-331)**: When `intent === 'natural_language' && hasHashPrefix`, the function calls `translateCommand()` and then does `setInput(translated)` followed by `return`. The `return` on line 322 exits before reaching the `submitCommand()` call on line 327. This is correct.

2. **Second Enter path**: After the translated command populates the input, pressing Enter again runs through `handleSubmit` again. This time, the input lacks the `#` prefix (it's the translated CLI command), so `classifyIntent()` returns `'cli'` and the command flows through the normal `submitCommand()` path. This is the intended two-step flow.

3. **Test coverage**: `test_hash_input_triggers_translate` verifies `mockWriteToSession` was NOT called. `test_translated_command_executes_on_second_enter` verifies the two-step flow end to end.

**No bypass found.** The auto-execute guarantee holds.

### 2.2 Input Disabled During Translation

**Status: CORRECT**

- `InputEditor` receives `disabled={closed || agentLoading}` (Terminal.tsx line 412).
- The `<textarea>` element has `disabled={disabled}` (InputEditor.tsx line 94).
- While `agentLoading` is true, the textarea is disabled, preventing the user from pressing Enter to trigger another translation or submit while one is in flight.

### 2.3 Staleness Guard (Translation Cancellation)

**Status: CORRECT**

The `translationIdRef` pattern is properly implemented:

- **On shell switch** (`handleShellSwitch`, line 231): `translationIdRef.current++` immediately cancels any in-flight translation, and `setAgentLoading(false)` clears the loading state.
- **On `resetAndStart`** (line 188): `translationIdRef.current++` cancels in-flight translation.
- **In `handleSubmit`** (lines 304, 311, 315, 318): A local `thisTranslation` captures the current ID before the async calls. After each `await`, the function checks `translationIdRef.current !== thisTranslation` and returns early (discarding the stale result) if the ID has changed.
- **`finally` block** (line 318): Only clears `agentLoading` if the translation is still current, preventing a stale translation from resetting loading state for a subsequent one.

### 2.4 Error Handling

**Status: CORRECT**

- **No API key**: Rust `translate_command` in `llm/mod.rs` (line 109) returns `Err("No API key configured. Open Settings to add one.")`. This propagates to the frontend and is displayed in the `agent-error` div.
- **Wrong API key**: Provider APIs return HTTP 401/403 errors, caught in each `call_*` function and propagated with sanitized messages.
- **Network timeout**: The HTTP client has a 30-second timeout (`llm/mod.rs` line 12). Timeout errors are caught by the `.map_err()` chain on the `.send().await`.
- **Unknown provider**: Returns `Err(format!("Unknown provider: {}", settings.llm_provider))`.
- **Error clearing**: `handleInputChange` (line 339) sets `setAgentError(null)` when the user types, clearing previous errors.

### 2.5 Intent Classifier

**Status: CORRECT (MVP scope)**

The classifier (`src/lib/intent-classifier.ts`) has been simplified for MVP:
- `#` prefix -> `natural_language`
- Everything else -> `cli`

This is intentionally simplified from the full heuristic-based classifier in the task spec. The task spec itself says "Decision: `#` prefix only for MVP."

The `handleSubmit` function has a double-check (`intent === 'natural_language' && hasHashPrefix`) on line 297 which is slightly redundant given the current MVP classifier always returns `natural_language` for `#` prefixed input, but provides defense-in-depth if the classifier is later expanded.

### 2.6 Command History Interaction

**Status: CORRECT**

- `addCommand(trimmed)` is only called on line 326, inside the CLI execution path.
- The agent mode path (lines 297-322) does NOT call `addCommand()`.
- This means:
  - The `# find files` natural language prompt is NOT added to history (correct -- it's not a real command).
  - The translated command (e.g., `Get-ChildItem`) IS added to history when the user presses Enter the second time (through the normal CLI path on line 326).
  - This is the correct behavior per the task spec: "agent translations should NOT be added to history until executed."

### 2.7 CWD Resolution

**Status: CORRECT with known limitation**

- `getCwd()` calls Rust's `std::env::current_dir()` which returns the Tauri app's launch directory.
- `handleSubmit` (line 308) calls `getCwd().catch(() => 'C:\\')` with a fallback.
- **Known limitation**: This is NOT the shell session's CWD. If the user runs `cd C:\Users`, the CWD passed to the LLM will still be the app's launch directory. The task spec explicitly acknowledges this: "Getting the shell's CWD requires shell integration. For MVP, the app's CWD is a reasonable approximation."

### 2.8 Empty `#` Input Edge Case

**Status: CORRECT**

- If the user types just `#` and presses Enter:
  - `trimmed` = `#`, `intent` = `natural_language`, `hasHashPrefix` = true
  - `stripHashPrefix('#')` returns `""` (empty string)
  - `nlInput` is empty, and the guard on line 300 (`if (!nlInput)`) triggers, calling `setInput('')` and returning early
  - No translation call is made. This is correct.

### 2.9 API Key Exposure in Google Provider URL

**Status: LOW-RISK (inherited from TASK-016)**

- `call_google()` passes the API key as a URL query parameter (line 251): `?key={}`.
- The `sanitize_error()` function is applied to all error messages, which replaces the API key with `[REDACTED]`.
- However, the API key is present in the URL string itself. If reqwest or a logging layer logs the URL, the key would be exposed in logs.
- This is a Google API design constraint (they require key as query parameter), not a Velocity-specific issue.
- The `sanitize_error` defense-in-depth is applied correctly on all error paths.

---

## 3. Architecture Assessment

### 3.1 File Structure

New/modified files for TASK-017:

| File | Role | Status |
|------|------|--------|
| `src/lib/intent-classifier.ts` | Intent classification (# prefix detection) | New, clean |
| `src/lib/cwd.ts` | CWD IPC wrapper | New, clean |
| `src/components/Terminal.tsx` | Agent mode state + submit flow | Modified, correct |
| `src-tauri/src/commands/mod.rs` | `get_cwd` Tauri command | Modified, correct |
| `src-tauri/src/lib.rs` | Command registration | Modified, correct |
| `src/__tests__/intent-classifier.test.ts` | Classifier unit tests | New, 16 tests |
| `src/__tests__/Terminal.test.tsx` | Agent mode integration tests | Modified, 7 new tests |
| `src/App.css` | Agent loading/error/hint styles | Modified, correct |

### 3.2 IPC Registration

- `get_cwd` is registered in `lib.rs` line 25 in the `invoke_handler` macro. Verified.
- `translate_command` is registered in `lib.rs` line 26. Verified.
- Tauri capabilities (`capabilities/default.json`) include `core:default` which allows all IPC commands.

### 3.3 Data Flow

```
User types "# find files" + Enter
  -> handleSubmit()
  -> classifyIntent() returns 'natural_language'
  -> hasHashPrefix check passes
  -> stripHashPrefix() extracts "find files"
  -> agentLoading = true, textarea disabled
  -> getCwd() -> Rust get_cwd -> app CWD
  -> translateCommand("find files", "powershell", cwd) -> Rust translate_command -> LLM API
  -> On success: setInput(translated), agentLoading = false
  -> On error: setAgentError(err), agentLoading = false
  -> On stale: silently discarded

User reviews translated command + Enter
  -> handleSubmit()
  -> classifyIntent() returns 'cli' (no # prefix)
  -> addCommand() + submitCommand() + setInput('')
  -> Normal PTY execution
```

---

## 4. Test Coverage Assessment

### 4.1 Intent Classifier Tests (16 tests)
- Hash prefix with/without space
- CLI patterns: flags, pipes, redirects, paths
- Edge cases: empty, whitespace-only, leading whitespace before #
- `stripHashPrefix` for various inputs

### 4.2 LLM IPC Tests (2 tests)
- Correct invoke parameters
- Error propagation

### 4.3 Terminal Agent Mode Tests (7 tests)
- `test_hash_input_triggers_translate` -- # triggers translateCommand, not auto-executed
- `test_translated_command_populates_input` -- Result goes into input editor
- `test_agent_loading_shown` -- Loading spinner appears and disappears
- `test_agent_error_shown` -- Error message displayed on failure
- `test_agent_error_clears_on_typing` -- Error clears when user types
- `test_normal_command_not_translated` -- Normal CLI bypasses agent mode
- `test_translated_command_executes_on_second_enter` -- Two-step flow works

### 4.4 Rust Tests
- `test_get_cwd_returns_string` -- CWD command works

### 4.5 Coverage Gaps (Minor)

| Missing Test | Severity | Notes |
|-------------|----------|-------|
| Shell switch cancels in-flight translation (staleness guard) | Low | Code is correct (translationIdRef pattern), but no dedicated test. The pattern is validated manually in code review. |
| Translation with empty `#` returns early without calling LLM | Low | The `if (!nlInput)` guard works but has no dedicated test. |
| Concurrent rapid translation requests | Low | The translationIdRef serialization handles this, but no stress test exists. |
| `getCwd` failure falls back to `C:\` | Low | The `.catch(() => 'C:\\')` is present but untested. |

---

## 5. Manual Test Plan

### 5.1 Happy Path
1. Open Velocity, configure an LLM provider and API key in Settings
2. Type `# list all files in current directory` and press Enter
3. Verify: Loading spinner "Translating..." appears, textarea is disabled
4. Verify: After a few seconds, translated command (e.g., `dir` or `Get-ChildItem`) appears in input editor
5. Verify: User can edit the translated command
6. Press Enter to execute the translated command
7. Verify: Command executes normally, output appears in a block

### 5.2 Error Path - No API Key
1. Open Settings, clear the API key, save
2. Type `# test command` and press Enter
3. Verify: Error "No API key configured. Open Settings to add one." appears below input
4. Verify: Error disappears when user starts typing

### 5.3 Error Path - Invalid API Key
1. Set API key to `invalid-key-12345`
2. Type `# list files` and press Enter
3. Verify: Error message from provider (e.g., "OpenAI API error (401): Incorrect API key") appears
4. Verify: API key is NOT visible in the error message

### 5.4 Shell Switch During Translation
1. Configure a valid API key
2. Type `# find typescript files` and press Enter
3. While "Translating..." spinner is visible, click "CMD" shell button
4. Verify: Loading spinner disappears
5. Verify: Stale translation result (if it arrives) does NOT populate the input

### 5.5 Normal Commands Unaffected
1. Type `dir` and press Enter -- executes immediately, no LLM call
2. Type `ls -la` and press Enter -- executes immediately
3. Type `echo hello | grep hello` and press Enter -- executes immediately

### 5.6 Edge Cases
1. Type `#` (just hash) and press Enter -- should clear input, no LLM call
2. Type `# ` (hash + space only) and press Enter -- should clear input, no LLM call
3. Type `  # find files` (leading spaces before hash) and press Enter -- should trigger agent mode
4. Type `## double hash` and press Enter -- should trigger agent mode, strip first `#`

### 5.7 Command History
1. Type `# find files`, press Enter, wait for translation (e.g., `dir`)
2. Press Enter again to execute `dir`
3. Press Up arrow -- should show `dir` (the executed command), NOT `# find files`

---

## 6. Findings Summary

### Bugs: None Found

No functional bugs were identified. The implementation correctly fulfills all acceptance criteria.

### BUG-001: None

### Observations (Non-Blocking)

| ID | Category | Severity | Description |
|----|----------|----------|-------------|
| OBS-001 | Test Gap | Low | No test for shell-switch cancellation of in-flight translation. Code is correct; test would add confidence. |
| OBS-002 | Test Gap | Low | No test for `getCwd` fallback (`C:\` default on error). |
| OBS-003 | Test Gap | Low | No test for empty `#` or `# ` (space only) edge case returning early. |
| OBS-004 | UX | Info | The `getCwd()` returns the app's launch directory, not the shell's current directory. Translations may reference the wrong CWD. Task spec explicitly defers this to a future task. |
| OBS-005 | Security | Info | Google provider passes API key as URL query parameter (`?key=...`). This is a Google API design constraint. The `sanitize_error()` defense-in-depth correctly redacts the key from error messages. Inherited from TASK-016. |
| OBS-006 | Redundancy | Info | The `hasHashPrefix` check in `handleSubmit` (line 295-297) is redundant with the current MVP classifier (which only returns `natural_language` for `#` prefixes). However, this provides defense-in-depth for future classifier expansion and is a good practice. |

---

## 7. Acceptance Criteria Checklist

| Criterion | Status |
|-----------|--------|
| All tests written and passing | PASS -- 193 frontend + 74 Rust tests |
| `#` prefix triggers agent mode (LLM translation) | PASS |
| Translated command populates input editor (NOT auto-executed) | PASS -- `return` before `submitCommand`, verified by test |
| Loading indicator while LLM processes | PASS -- `agent-loading` div with spinner |
| Error display on failure | PASS -- `agent-error` div |
| Error clears when user types | PASS -- `handleInputChange` clears `agentError` |
| Normal commands without `#` execute as before | PASS -- verified by test |
| `get_cwd` Tauri command returns working directory | PASS -- registered and tested |
| Intent classifier function with heuristics | PASS -- simplified for MVP per spec |
| `npm run test` + `cargo test` pass | PASS -- all green |

---

## 8. Verdict

**PASS**

The TASK-017 implementation is solid. The critical never-auto-execute guarantee is correctly implemented with proper code structure (early return in agent mode path) and test coverage. The staleness guard for shell switches is well-designed using the `translationIdRef` pattern. Error handling covers all expected failure modes with proper error sanitization. The observations are non-blocking and can be addressed in future iterations.
