# QA Report: TASK-018 Intelligent Intent Classifier + Mode Indicator

**Date**: 2026-03-16
**Reviewer**: QA Agent
**Round**: R1
**Verdict**: PASS (with findings)

---

## 1. Test Results

### Frontend Tests (Vitest)
- **Result**: 229/229 passed, 0 failed
- **Command**: `npm run test`
- **Duration**: 7.12s
- TASK-018-specific test files:
  - `src/__tests__/intent-classifier.test.ts` (38 tests) -- ALL PASS
  - `src/__tests__/ModeIndicator.test.tsx` (8 tests) -- ALL PASS
  - `src/__tests__/Terminal.test.tsx` (42 tests, including 7 TASK-018-specific) -- ALL PASS

### Rust Tests (cargo test)
- **Result**: 75/75 passed (65 unit + 10 integration), 1 ignored
- **Command**: `cd src-tauri && cargo test`
- TASK-018-specific:
  - `commands::tests::test_get_known_commands_returns_nonempty` -- PASS

---

## 2. Code-Level Bug Hunt

### 2.1 Never-Auto-Execute Guarantee (CRITICAL PATH)

**Status: SECURE**

The TASK-017 never-auto-execute guarantee remains intact after TASK-018 changes:

1. **`handleSubmit` in `Terminal.tsx` (lines 291-341)**: When `inputMode.intent === 'natural_language'`, the function calls `translateCommand()`, then does `setInput(translated)` followed by `return` on line 329. This exits before reaching `submitCommand()` on line 334.

2. **Second Enter path**: After the translated command populates the input, pressing Enter runs through `handleSubmit` again. The input has been classified as CLI (since `setModeOverride(false)` and `setInputMode({ intent: 'cli', confidence: 'high' })` were called on line 318-319), so the command flows through `submitCommand()`. Correct.

3. **`hasHashPrefix` removed**: The old double-check `intent === 'natural_language' && hasHashPrefix` is gone. Now routing is solely based on `inputMode.intent`. This is correct since the classifier is the single source of truth, and `#` prefix already forces `natural_language` via the classifier (line 21 of intent-classifier.ts).

**No bypass found.** The auto-execute guarantee holds.

### 2.2 Intent Classifier Accuracy

**Status: CORRECT (with trade-offs noted)**

Tested classification paths:

| Input | Expected | Actual | Notes |
|-------|----------|--------|-------|
| `git status` (git in knownCommands) | CLI high | CLI high | Known command match |
| `# find files` | NL high | NL high | Hash prefix backward compat |
| `show me all the log files` | NL high | NL high | Articles + 4+ words |
| `how do I list files` | NL high | NL high | Question starter |
| `ls -la` | CLI high | CLI high | Flags detected |
| `ps \| grep node` | CLI high | CLI high | Pipe detected |
| `Get-ChildItem -Recurse` | CLI high | CLI high | PowerShell Verb-Noun pattern |
| `./script.sh` | CLI high | CLI high | Path prefix |
| `C:\Users\test` | CLI high | CLI high | Windows drive path |
| `FOO=bar` | CLI high | CLI high | Assignment |
| `foobar` (unknown) | CLI low | CLI low | Short unknown |
| `foo bar baz` (unknown) | NL low | NL low | Multi-word unknown |
| `delete all temporary files` | NL high | NL high | NL verb + multi-word |
| (empty) | CLI high | CLI high | Default |

**Trade-offs documented below in section 2.3.**

### 2.3 Classifier Edge Cases and Trade-offs

**Status: ACCEPTABLE TRADE-OFFS (not bugs)**

1. **`find` command ambiguity**: On Windows, `find.exe` exists in `C:\Windows\System32`. With real runtime known commands, `find all typescript files modified today` would be classified as CLI high (known command match at line 47), not NL. The test `test_find_natural_is_nl` deliberately uses a set WITHOUT `find` to test the NL path. This is a correct trade-off -- a known command should default to CLI.

2. **NL with `>` character**: The input `what is > than 5` would be classified as CLI high due to the redirect detection regex `/[|<>]/.test(trimmed)`. This is a false positive for a rare natural language pattern, but the user can override with the toggle or the `#` prefix. Acceptable.

3. **Shell builtins as NL words**: Commands like `start`, `type`, `del`, `set` are in the builtins list and thus in `knownCommands`. Sentences like "type the following command" would be classified as CLI. Acceptable -- these are real commands, and the override toggle exists.

4. **Single-character flags in NL**: The regex `\s-{1,2}\w` detects flags. Input like `help - I need guidance` would be classified as CLI due to the dash. Very rare edge case.

5. **PowerShell cmdlet regex is too narrow**: The pattern `/^[A-Z][a-z]+-[A-Z][a-z]+/` requires exactly uppercase-then-lowercase on both sides of the dash. It would miss `Get-VM`, `Set-IP`, `New-PSSession` (first letter uppercase but second letter also uppercase). However, many of these are in PATH and would be caught by known command lookup. Minor gap.

### 2.4 Mode Override and Toggle Logic

**Status: CORRECT**

- **Toggle**: `handleToggleMode` (line 358-364) flips the intent, sets confidence to `high`, and sets `modeOverride = true`. This prevents `handleInputChange` from overwriting the user's choice on subsequent keystrokes. Correct.

- **Override persistence**: When `modeOverride` is true, the `handleInputChange` callback skips the `classifyIntent` call (line 351). The override persists across all input changes until submit. Correct.

- **Reset on submit**: Both the CLI path (line 337-338) and the NL translation success path (line 318-319) call `setModeOverride(false)` and reset `inputMode`. Correct.

### BUG-001: History Navigation Does Not Re-classify Intent (Low Severity)

**Status: BUG**

`handleNavigateUp` (line 366-372) and `handleNavigateDown` (line 374-379) call `setInput(prev)` directly, bypassing `handleInputChange`. This means:

1. **Intent is NOT re-classified** when the user navigates through command history with Up/Down arrows. If the user was in NL mode (e.g., typed "show me all files"), then presses Up to recall `dir`, the mode indicator still shows "AI" even though `dir` is a CLI command.

2. **`modeOverride` is NOT reset** during history navigation. If the user manually toggled to AI mode, navigates history to a CLI command, the override persists.

3. **`agentError` is NOT cleared** during history navigation. If there was an agent error displayed, navigating history does not clear it.

**Impact**: Low. History navigation is typically used in CLI mode. The mode indicator shows a stale value but the actual submit behavior is driven by `inputMode.intent` state, which is also stale -- so if the user had override to AI, navigated to `dir`, and pressed Enter, it would try to translate `dir` instead of executing it. This is a functional bug, though the user can work around it by clicking the toggle or by simply typing instead of using history.

**Suggested fix**: Call `classifyIntent` in the history navigation handlers, or route them through `handleInputChange`.

### BUG-002: ModeIndicator Missing `disabled` Attribute (Low Severity)

**Status: BUG (Accessibility)**

In `ModeIndicator.tsx` (line 31), when `disabled` is true, the component sets `onClick={disabled ? undefined : onToggle}` but does NOT set the `disabled` HTML attribute on the `<button>` element. This means:

1. The button remains focusable via Tab navigation even when disabled.
2. Screen readers do not announce the button as disabled.
3. No visual disabled state is communicated (no cursor change, no opacity change).
4. The `aria-label` still says "Click to toggle" even when clicking does nothing.

**Impact**: Low. Functionally, clicking does nothing when disabled (onClick is undefined), so there's no incorrect behavior. The issue is purely accessibility and visual feedback.

**Suggested fix**: Add `disabled={disabled}` to the `<button>` element and add a CSS rule `.mode-indicator:disabled { cursor: not-allowed; opacity: 0.4; }`.

### 2.5 Known Commands Loading Race

**Status: ACCEPTABLE (by design)**

If the user types before `get_known_commands` resolves (the Rust command scans PATH), the `knownCommands` set is empty. The classifier relies solely on structural signals (flags, pipes, paths, etc.) and NL patterns (question words, articles). Once the commands load, subsequent keystrokes use the full set. Pre-loading classifications are NOT retroactively updated.

This is acceptable because:
- The classifier still works reasonably without known commands (structural signals cover most CLI inputs).
- The command loading typically completes within 100-200ms, before the user types anything.
- The `handleInputChange` callback has `knownCommands` in its dependency array, so it gets recreated with the new set.

### 2.6 Hash Prefix Handling

**Status: CORRECT**

Backward compatibility with `#` prefix is fully preserved:

1. `classifyIntent` returns `{ intent: 'natural_language', confidence: 'high' }` for any input starting with `#` (line 21).
2. `handleSubmit` (line 303) strips the `#` prefix via `stripHashPrefix` before sending to translation.
3. Empty `#` (just `#` or `# `) is handled: `stripHashPrefix('#')` returns `''`, the `if (!nlInput)` guard (line 304) triggers, and the function returns early without calling the LLM.
4. `# ` with leading whitespace (e.g., `  # find files`) is handled: `trimmed` starts with `#` after `.trim()`.

### 2.7 Translation Success Resets to CLI Mode

**Status: CORRECT**

After a successful translation (line 318-319):
```typescript
setModeOverride(false);
setInputMode({ intent: 'cli', confidence: 'high' });
```

This ensures the translated CLI command in the editor shows "CLI" in the mode indicator, and the next Enter press executes it as CLI. The override is cleared so subsequent typing triggers auto-detection again.

### 2.8 Error Path Staleness

**Status: CORRECT**

The `translationIdRef` pattern is properly maintained from TASK-017:
- `handleSubmit` captures `thisTranslation = ++translationIdRef.current` (line 308).
- After `await translateCommand()`, checks `translationIdRef.current !== thisTranslation` (line 315) before acting.
- The `finally` block (line 325-327) only clears `agentLoading` if still current.
- Shell switch (`handleShellSwitch` line 237) increments `translationIdRef.current` and sets `agentLoading(false)`.

---

## 3. Architecture Assessment

### 3.1 File Structure

New/modified files for TASK-018:

| File | Role | Status |
|------|------|--------|
| `src/lib/intent-classifier.ts` | Heuristic classification engine | Rewritten, correct |
| `src/hooks/useKnownCommands.ts` | Known commands hook (one-shot load) | New, clean |
| `src/components/editor/ModeIndicator.tsx` | Mode badge component | New, clean |
| `src/components/editor/InputEditor.tsx` | Added mode/onToggleMode props | Modified, correct |
| `src/components/Terminal.tsx` | Intent state, override logic, submit routing | Modified, correct |
| `src-tauri/src/commands/mod.rs` | `get_known_commands` Tauri command | Modified, correct |
| `src-tauri/src/lib.rs` | Command registration | Modified, correct |
| `src/App.css` | ModeIndicator styles | Modified, correct |
| `src/__tests__/intent-classifier.test.ts` | 38 classifier tests | Rewritten, comprehensive |
| `src/__tests__/ModeIndicator.test.tsx` | 8 component tests | New, good coverage |
| `src/__tests__/Terminal.test.tsx` | 7 new integration tests | Modified, good coverage |
| `e2e/intent-classifier.spec.ts` | 2 E2E tests | New, correct |

### 3.2 IPC Registration

- `get_known_commands` registered in `lib.rs` line 27. Verified.
- `capabilities/default.json` includes `core:default` which allows all IPC commands. Verified.

### 3.3 Data Flow

```
User types "show me all the log files"
  -> handleInputChange()
  -> classifyIntent("show me all the log files", knownCommands)
  -> Returns { intent: 'natural_language', confidence: 'high' }
  -> ModeIndicator shows "AI" badge (accent blue)
  -> User presses Enter
  -> handleSubmit()
  -> inputMode.intent === 'natural_language'
  -> stripHashPrefix skipped (no #)
  -> translateCommand("show me all the log files", "powershell", cwd)
  -> On success: setInput(translated), reset override, set CLI mode
  -> User reviews, presses Enter again
  -> handleSubmit() -> CLI mode -> submitCommand() -> PTY
```

```
User types "git status"
  -> handleInputChange()
  -> classifyIntent("git status", knownCommands)
  -> "git" found in knownCommands -> { intent: 'cli', confidence: 'high' }
  -> ModeIndicator shows "CLI" badge
  -> User presses Enter
  -> handleSubmit()
  -> inputMode.intent === 'cli'
  -> submitCommand("git status") -> PTY
```

```
User types "git status", clicks toggle to AI, presses Enter
  -> handleToggleMode() -> intent flipped to NL, override = true
  -> ModeIndicator shows "AI" badge
  -> User presses Enter
  -> handleSubmit()
  -> inputMode.intent === 'natural_language'
  -> translateCommand("git status", "powershell", cwd)
  -> Translation populates editor, override reset
```

---

## 4. Test Coverage Assessment

### 4.1 Intent Classifier Tests (38 tests)

Comprehensive coverage of all classification paths:
- Hash prefix (3 tests): with space, without space, with leading whitespace
- CLI signals (16 tests): flags, pipes, redirects, known commands, PowerShell cmdlets, paths (forward slash, backslash, Windows drive, tilde), assignments, empty, whitespace
- NL signals (8 tests): question starters, help/please, articles, NL verbs, find-natural
- Ambiguous zone (2 tests): short unknown, multi-word unknown
- Shape validation (1 test): return type correctness
- Empty known commands (1 test): fallback behavior
- stripHashPrefix (5 tests): various prefix patterns

### 4.2 ModeIndicator Tests (8 tests)

- CLI badge rendering
- AI badge rendering with accent class
- Uncertain CLI (CLI?) with uncertain class
- Uncertain AI (AI?) with uncertain class
- Click triggers onToggle
- Disabled prevents click
- CLI mode has correct class, not AI class
- High confidence does not have uncertain class

### 4.3 Terminal Integration Tests (7 new for TASK-018)

- `test_mode_indicator_visible` -- Badge appears in DOM
- `test_auto_detects_nl` -- NL input shows AI badge
- `test_auto_detects_cli` -- CLI input shows CLI badge
- `test_toggle_overrides` -- Toggle persists override across input changes
- `test_submit_resets_override` -- Override cleared after submit
- `test_nl_mode_triggers_translate` -- NL mode submits to LLM
- Plus existing TASK-017 agent mode tests (7) still pass

### 4.4 Rust Tests

- `test_get_known_commands_returns_nonempty` -- PATH scan + builtins produces non-empty list with expected builtins

### 4.5 E2E Tests

- `test_mode_indicator_visible` -- Mode indicator is visible and shows CLI
- `test_mode_indicator_toggles_on_click` -- Click changes the indicator text

### 4.6 Coverage Gaps

| Missing Test | Severity | Notes |
|-------------|----------|-------|
| History navigation does not re-classify intent | Medium | Related to BUG-001. No test verifies that navigating history updates the mode indicator. |
| Classification stale when knownCommands loads late | Low | Race condition between hook load and first input. Not tested but acceptable by design. |
| ModeIndicator disabled attribute not set on button | Low | Related to BUG-002. No test checks `disabled` HTML attribute. |
| Toggle from CLI to AI then back to CLI | Low | Only tests toggle from AI to CLI. Double-toggle is not tested. |
| `#` followed by NL text without space (`#find files`) still translates correctly | Low | Classifier test exists but no Terminal integration test for this case. |

---

## 5. Security Assessment

### 5.1 Known Commands from PATH

- `get_known_commands` scans the filesystem (`std::fs::read_dir`). This runs on the backend and is not exposed to the web frontend beyond the list of command names.
- The command list is local system info (executable names). Not sensitive. Not sent to any external service.
- The command is registered with Tauri's default capabilities, which is appropriate.

### 5.2 No Auto-Execution in NL Mode

- Verified: `handleSubmit` returns early after translation without calling `submitCommand`.
- Verified: No code path auto-executes translated commands.
- Verified: The `#` prefix backward-compatible path works correctly.

### 5.3 Override Does Not Bypass Security

- Toggling to AI mode does not automatically send anything to the LLM -- the user must press Enter.
- Toggling to CLI mode does not bypass validation -- the command still goes through `submitCommand` which validates session state.

---

## 6. Findings Summary

### Bugs

| ID | Severity | Description |
|----|----------|-------------|
| BUG-001 | Low | History navigation (Up/Down arrows) does not re-classify intent. Mode indicator shows stale state after navigating history. If override was active, navigating to a CLI command and pressing Enter would route it through the NL translation path instead of executing it. |
| BUG-002 | Low | `ModeIndicator` button does not set the HTML `disabled` attribute when `disabled` prop is true. The `onClick` handler is removed, so clicking does nothing, but the button remains focusable and accessible to screen readers without disabled semantics. |

### Observations (Non-Blocking)

| ID | Category | Severity | Description |
|----|----------|----------|-------------|
| OBS-001 | Classifier | Info | `find` on Windows is in PATH (`find.exe`). "find all typescript files" with real known commands is classified as CLI. Users must use `#` prefix or toggle for NL inputs starting with a known command. By design. |
| OBS-002 | Classifier | Info | Natural language containing `>`, `<`, or `|` characters is classified as CLI due to the redirect/pipe regex. Rare edge case. By design. |
| OBS-003 | Classifier | Info | PowerShell cmdlet regex `/^[A-Z][a-z]+-[A-Z][a-z]+/` misses short-name cmdlets like `Get-VM`, `Set-IP`, `New-PSSession`. These are typically in PATH and caught by known command lookup. Minor gap. |
| OBS-004 | UX | Info | If the user types very quickly before `get_known_commands` loads (~100-200ms), the first classification runs without known commands. Structural signals still work. Self-corrects on next keystroke. |
| OBS-005 | UX | Info | CWD passed to LLM translation is still the app's launch directory, not the shell's current directory. Inherited from TASK-017, explicitly deferred. |

---

## 7. Acceptance Criteria Checklist

| Criterion | Status |
|-----------|--------|
| All tests written and passing | PASS -- 229 frontend + 75 Rust tests |
| `get_known_commands` Rust command scans PATH + builtins | PASS -- PATH scan + 27 builtins, deduplicated |
| Intent classifier uses structural analysis + known commands + NL detection | PASS -- flags, pipes, paths, assignments, PowerShell cmdlets, known commands, question words, articles, NL verbs |
| Returns `{ intent, confidence }` -- not just intent | PASS -- `ClassificationResult` type with both fields |
| ModeIndicator badge shows CLI/AI/uncertain states | PASS -- CLI, AI, CLI?, AI? labels with appropriate CSS classes |
| Click to toggle, override persists until submit | PASS -- toggle flips intent, sets modeOverride=true, persists across input changes |
| `#` prefix still forces AI (backward compatible) | PASS -- classifier returns NL high for `#` prefix; `stripHashPrefix` strips it before translation |
| Auto-detection on input change (not debounced -- classifier is <1ms) | PASS -- called synchronously in `handleInputChange` |
| After submit, mode resets to auto-detect | PASS -- both CLI and NL paths reset override and mode |
| `npm run test` + `cargo test` pass | PASS -- all green |

---

## 8. Verdict

**PASS**

The TASK-018 implementation is solid and comprehensive. The intelligent intent classifier correctly uses a layered heuristic approach: explicit `#` trigger, structural CLI signals (flags, pipes, paths, assignments, PowerShell patterns), known command lookup from PATH, NL patterns (question words, articles, NL verbs), and a reasonable ambiguous-zone fallback. The ModeIndicator component provides clear visual feedback with appropriate styling. The override/toggle mechanism works as specified. The critical never-auto-execute security guarantee is maintained.

Two low-severity bugs were found:
- **BUG-001**: History navigation does not re-classify intent (functional but minor impact).
- **BUG-002**: ModeIndicator lacks HTML `disabled` attribute (accessibility only, no functional impact).

Neither bug blocks the release. Both can be addressed in a follow-up patch.
