# Code Review: TASK-017 Agent Mode UI (R1)

**Commit**: `c14fa59 feat: add agent mode with # trigger and LLM command translation`
**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-15
**Verdict**: **NEEDS CHANGES**

---

## Summary

This commit implements the Agent Mode UI -- the final link between the user's natural-language intent and the LLM command translation backend (TASK-016). It adds an intent classifier (`src/lib/intent-classifier.ts`), a CWD wrapper (`src/lib/cwd.ts`), a Rust `get_cwd` command, and wires the `# ` trigger into `Terminal.tsx` with loading/error states. The translated command is placed in the input editor for user review -- never auto-executed. Test coverage is comprehensive (7 new Terminal tests, 16 intent classifier tests, 1 Rust test, 2 E2E tests). All 193 frontend tests pass.

The implementation is clean and faithfully follows the task spec. The critical "never auto-execute" invariant is correctly enforced. However, there is one medium-severity race condition, one medium-severity correctness issue in the intent classifier, and several lower findings.

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/intent-classifier.ts` | NEW: 42 lines -- Intent classifier with heuristics and hash prefix stripping |
| `src/lib/cwd.ts` | NEW: 12 lines -- TypeScript IPC wrapper for `get_cwd` |
| `src/components/Terminal.tsx` | MODIFIED: +53 lines -- Agent mode state, async submit flow, loading/error UI |
| `src/App.css` | MODIFIED: +35 lines -- Agent mode styles (loading, error, hint) |
| `src/__tests__/intent-classifier.test.ts` | NEW: 71 lines -- 16 tests for classifier and hash stripping |
| `src/__tests__/Terminal.test.tsx` | MODIFIED: +182 lines -- 7 agent mode integration tests |
| `e2e/agent-mode.spec.ts` | NEW: 60 lines -- 2 Playwright E2E tests |
| `src-tauri/src/commands/mod.rs` | MODIFIED: +18 lines -- `get_cwd` command + Rust test |
| `src-tauri/src/lib.rs` | MODIFIED: +1 line -- Register `get_cwd` in invoke handler |
| `prompts/tasks/TASK-017-agent-mode-ui.md` | NEW: 317 lines -- Task specification |
| `prompts/STATE.md` | MODIFIED: 1 line -- Status update |

---

## Findings

### [F-01] PASS (CRITICAL): Never-Auto-Execute Guarantee

**Files**: `src/components/Terminal.tsx` lines 279-317, `src/__tests__/Terminal.test.tsx`

```typescript
if (intent === 'natural_language' && hasHashPrefix) {
    // ...
    const translated = await translateCommand(nlInput, shellType, cwd);
    setInput(translated); // Put translated command in the editor for review
    // ...
    return; // Don't execute -- user reviews first
}

// CLI mode: execute normally
addCommand(trimmed);
submitCommand(trimmed);
setInput('');
```

The agent mode code path has an explicit `return` BEFORE any call to `submitCommand` or `writeToSession`. The translated command is placed into `setInput()`, which populates the editor for human review. The user must press Enter a second time, at which point the text no longer starts with `#`, so it follows the CLI path and executes normally.

This is verified by three complementary tests:
1. `test_hash_input_triggers_translate` -- asserts `mockWriteToSession` was NOT called after translation.
2. `test_translated_command_populates_input` -- asserts the input value becomes the translated command.
3. `test_translated_command_executes_on_second_enter` -- asserts `writeToSession` IS called on the second Enter with the translated command.

The E2E test also validates this indirectly by verifying the error state appears (proving the agent path was taken) without any command output appearing.

**Assessment**: The never-auto-execute invariant is structurally sound. There is no code path where LLM output reaches `submitCommand` without a second user action.

---

### [F-02] MEDIUM: Race condition -- concurrent agent translations are not guarded

**File**: `src/components/Terminal.tsx`, lines 279-317

```typescript
const handleSubmit = useCallback(
    async (cmd: string) => {
        // ...
        if (intent === 'natural_language' && hasHashPrefix) {
            setAgentLoading(true);
            setAgentError(null);
            try {
                const cwd = await getCwd().catch(() => 'C:\\');
                const translated = await translateCommand(nlInput, shellType, cwd);
                setInput(translated);
            } catch (err) {
                setAgentError(String(err));
            } finally {
                setAgentLoading(false);
            }
            return;
        }
        // ...
    },
    [shellType, addCommand, submitCommand],
);
```

While the input is disabled during loading (`disabled={closed || agentLoading}`), there is no cancellation mechanism for in-flight translations. Consider this scenario:

1. User types `# list files`, presses Enter. Translation starts, loading shown.
2. User rapidly presses Escape or clicks the shell switcher, resetting the terminal.
3. The `translateCommand` promise resolves after the reset and calls `setInput(translated)` on a potentially stale component state.

Because `handleSubmit` captures `shellType` from the closure, a shell switch during translation would use the old `shellType` but populate the input in the new shell context. The translated command might be for PowerShell when the user has switched to CMD.

More critically, there is no AbortController or request ID check, so if the component unmounts during translation, `setInput` will be called on an unmounted component. React 18 does not crash on this, but it produces a warning and is a memory leak.

**Severity**: Medium. The input is disabled during loading, which mitigates the most common trigger. But the shell switcher is not disabled, and `handleRestart` is accessible. This cannot cause auto-execution (the never-execute guarantee holds), but it can cause a stale command to appear in the wrong shell context.

**Suggested fix**: Add an AbortController or translation ID that is checked before calling `setInput`:

```typescript
const translationIdRef = useRef(0);

// In handleSubmit:
const thisTranslation = ++translationIdRef.current;
// ... await translateCommand ...
if (translationIdRef.current === thisTranslation) {
    setInput(translated);
}
```

---

### [F-03] MEDIUM: Intent classifier has false positive for 4+ word CLI commands

**File**: `src/lib/intent-classifier.ts`, lines 29-31

```typescript
const words = trimmed.split(/\s+/);
if (words.length >= 4 && !hasPathSeparators) return 'natural_language';
```

Commands with 4+ words that lack flags, pipes, redirects, or path separators are classified as `natural_language`. Examples that would be misclassified:

- `git commit -m message` -- correctly classified as CLI (has flags)
- `npm run build production` -- misclassified as NL (4 words, no flags/pipes/paths)
- `docker compose up detach` -- misclassified as NL
- `New-Item temp test file` -- misclassified as NL (PowerShell cmdlet)
- `Set-Location My Documents Folder` -- misclassified as NL

This is acknowledged in the code comments and the task spec ("for MVP, only `#` prefix triggers agent mode"). The submit flow double-checks `hasHashPrefix`, so the heuristic is NOT used in the actual execution path:

```typescript
if (intent === 'natural_language' && hasHashPrefix) {
```

**However**, the classifier is exported as a public API and its return value of `natural_language` for inputs like `npm run build production` is technically incorrect. Future code that uses `classifyIntent()` without the `hasHashPrefix` guard would have a real bug.

**Severity**: Medium. No current impact due to the `hasHashPrefix` guard, but the classifier function's contract is misleading -- it claims to classify intent but actually only reliably detects `#`-prefixed input. The heuristic branch is dead code in the current submit flow.

**Suggested fix**: Either (a) remove the heuristic branch entirely and document that only `#` prefix is supported, or (b) add a comment/JSDoc warning that the function's `natural_language` return for non-`#` inputs is a heuristic that MUST be gated by additional checks before acting on it. Option (a) is cleaner for MVP.

---

### [F-04] GOOD: Async flow -- loading and error states

**File**: `src/components/Terminal.tsx`, lines 298-310

```typescript
setAgentLoading(true);
setAgentError(null);
try {
    const cwd = await getCwd().catch(() => 'C:\\');
    const translated = await translateCommand(nlInput, shellType, cwd);
    setInput(translated);
} catch (err) {
    setAgentError(String(err));
} finally {
    setAgentLoading(false);
}
```

The loading/error state machine is correct:
- `setAgentLoading(true)` before async work begins.
- `setAgentError(null)` clears any previous error.
- On success: `setInput(translated)` populates the editor.
- On failure: `setAgentError(String(err))` displays the error.
- `finally` always clears loading, even on error.
- Error clears when user types (`handleInputChange` calls `setAgentError(null)`).
- Input is disabled during loading (`disabled={closed || agentLoading}`).

The `getCwd().catch(() => 'C:\\')` fallback is a nice touch -- if CWD retrieval fails, translation still proceeds with a reasonable default rather than blocking.

---

### [F-05] GOOD: LLM response handled as untrusted text

**File**: `src/components/Terminal.tsx`, line 303

```typescript
setInput(translated);
```

The translated command is placed into `setInput()`, which sets the React state for the textarea's `value` prop. React's controlled component pattern ensures the text is rendered via the DOM's `value` property (not `innerHTML`), so there is no XSS vector. Even if the LLM returned `<script>alert(1)</script>`, it would appear as literal text in the textarea.

The `InputEditor` component (`src/components/editor/InputEditor.tsx`) tokenizes the input for syntax highlighting in a `<pre>` element, but each token is rendered via `{token.value}` inside JSX, which React auto-escapes. No `dangerouslySetInnerHTML` is used anywhere.

---

### [F-06] GOOD: Error display does not use innerHTML

**File**: `src/components/Terminal.tsx`, lines 404-407

```typescript
{agentError && (
    <div className="agent-error" data-testid="agent-error">
        {agentError}
    </div>
)}
```

The error string is rendered as a React text node, which is automatically escaped. Even if the LLM provider returns HTML in an error message (e.g., an API error page), it will be rendered as visible text, not parsed as HTML.

---

### [F-07] LOW: `stripHashPrefix` does not trim the input before stripping

**File**: `src/lib/intent-classifier.ts`, lines 40-42

```typescript
export function stripHashPrefix(input: string): string {
    return input.replace(/^#\s*/, '');
}
```

The `classifyIntent` function trims the input before checking `startsWith('#')`, but `stripHashPrefix` does not. If the user types `  # find files` (leading spaces), `classifyIntent` will correctly detect it as NL (line 13 trims first), but `stripHashPrefix` will receive the untrimmed string `  # find files` and the regex `^#\s*` won't match (because the string starts with spaces, not `#`). The result: the full string `  # find files` is sent to the LLM as the prompt.

Looking at the call site in `handleSubmit`:

```typescript
const trimmed = cmd.trim();
// ...
const nlInput = stripHashPrefix(trimmed);
```

The input IS trimmed before calling `stripHashPrefix`, so the actual code path is safe. But `stripHashPrefix` as a standalone function has a subtle contract dependency on pre-trimming.

**Severity**: Low. The call site is correct. But the function's behavior with leading whitespace is surprising and should be documented or defensively handled.

---

### [F-08] LOW: Rust `get_cwd` test does not exercise the Tauri command

**File**: `src-tauri/src/commands/mod.rs`, lines 141-149

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn test_get_cwd_returns_string() {
        let cwd = std::env::current_dir();
        assert!(cwd.is_ok());
        let cwd_str = cwd.unwrap().to_string_lossy().to_string();
        assert!(!cwd_str.is_empty());
    }
}
```

This test calls `std::env::current_dir()` directly, not the `get_cwd()` Tauri command. It verifies that `current_dir()` works in the test environment, which is trivially true. It does not test the Tauri command's error mapping (`map_err(|e| format!(...))`) or the async wrapper.

**Severity**: Low. The `get_cwd` function is 4 lines of straightforward code. The real verification happens in the frontend integration tests (which mock `getCwd` and verify it is called). But the Rust test provides no additional safety.

---

### [F-09] GOOD: `#`-only input handled as edge case

**File**: `src/components/Terminal.tsx`, lines 293-296

```typescript
const nlInput = stripHashPrefix(trimmed);
if (!nlInput) {
    setInput('');
    return;
}
```

If the user types just `#` and presses Enter, `stripHashPrefix('#')` returns `''`, and the empty check prevents sending an empty prompt to the LLM. The input is cleared and no error is shown. This is a sensible UX decision.

---

### [F-10] GOOD: E2E test design is robust

**File**: `e2e/agent-mode.spec.ts`

```typescript
const agentLoading = appPage.getByTestId('agent-loading');
const agentError = appPage.getByTestId('agent-error');

// Wait for either loading or error to appear (one must show up)
await expect(agentLoading.or(agentError)).toBeVisible({ timeout: 15_000 });
```

The E2E test uses Playwright's `.or()` combinator to handle timing uncertainty -- in a real test environment without an API key, the error may appear instantly or after a brief loading state. This avoids flaky tests that depend on timing. The 15-second timeout is generous enough for CI environments.

The second E2E test (`normal command executes without agent mode`) provides good negative coverage, verifying that standard commands bypass agent mode entirely.

---

### [F-11] GOOD: Input disabled during agent loading

**File**: `src/components/Terminal.tsx`, line 399

```typescript
<InputEditor
    // ...
    disabled={closed || agentLoading}
    // ...
/>
```

When `agentLoading` is true, the `InputEditor`'s textarea is disabled, preventing the user from typing or submitting while a translation is in flight. This prevents accidental double-submissions and makes the loading state clear.

---

### [F-12] OBSERVATION: `handleSubmit` dependency array is incomplete

**File**: `src/components/Terminal.tsx`, lines 279-318

```typescript
const handleSubmit = useCallback(
    async (cmd: string) => {
        // Uses: classifyIntent, stripHashPrefix, setAgentLoading, setAgentError,
        //       getCwd, translateCommand, setInput, shellType, addCommand, submitCommand
    },
    [shellType, addCommand, submitCommand],
);
```

The callback references `setInput`, `setAgentLoading`, `setAgentError`, `getCwd`, `translateCommand`, `classifyIntent`, and `stripHashPrefix`. Of these:
- `setInput`, `setAgentLoading`, `setAgentError` are React setState functions (stable by guarantee, correct to omit).
- `getCwd`, `translateCommand`, `classifyIntent`, `stripHashPrefix` are module-level imports (stable, correct to omit).
- `shellType`, `addCommand`, `submitCommand` are correctly listed.

The dependency array is technically correct. All variable dependencies are accounted for. This is just an observation to confirm the analysis.

---

### [F-13] OBSERVATION: Agent mode hint style defined but unused

**File**: `src/App.css`, lines 646-650

```css
.agent-hint {
    padding: 2px 8px;
    color: #585b70;
    font-size: 11px;
}
```

The `.agent-hint` class is defined in CSS but never referenced in any component. The task spec mentions this as "optional but nice" and explicitly defers it ("Decision: `#` prefix only for MVP"). This is dead CSS.

**Severity**: Observation. Harmless but should be removed or commented to avoid confusion.

---

## Required Changes

| ID | Severity | Description |
|----|----------|-------------|
| F-02 | MEDIUM | Add a staleness guard (translation ID or AbortController) to prevent stale translations from populating the input after a shell switch or component state reset. The never-execute guarantee is unaffected, but a stale command could appear in the wrong shell context. |
| F-03 | MEDIUM | Remove the dead heuristic branch (`words.length >= 4`) from `classifyIntent`, or add prominent documentation that it is unused in the submit flow and must be gated. The function's return value is misleading for non-`#` inputs. |

## Optional Improvements

| ID | Severity | Description |
|----|----------|-------------|
| F-07 | Low | Add defensive `.trim()` to `stripHashPrefix` or document the pre-trimming requirement |
| F-08 | Low | Replace the Rust `get_cwd` test with one that exercises the actual command function, or remove it (the frontend mocks cover the integration) |
| F-13 | Observation | Remove the unused `.agent-hint` CSS class |

---

## Test Assessment

| Suite | Tests | Status | Notes |
|-------|-------|--------|-------|
| `intent-classifier.test.ts` (Vitest) | 16 | PASS | classifyIntent (11 cases) + stripHashPrefix (5 cases) |
| `Terminal.test.tsx` agent mode (Vitest) | 7 | PASS | Trigger, populate, loading, error, error-clear, no-translate, second-enter |
| `commands::tests` (Rust) | 1 | PASS | get_cwd basic test |
| `agent-mode.spec.ts` (Playwright) | 2 | DEFINED | E2E: loading/error on # trigger, normal command bypasses agent |
| **Total frontend** | **193** | **PASS** | All tests pass including pre-existing suites |

**Coverage strengths**:
- The never-auto-execute invariant is tested from three angles: no writeToSession on translate, input populated with translation, writeToSession on second Enter.
- Loading state tested with a controlled promise (deferred resolve) -- good async testing pattern.
- Error state tested including clearance on typing.
- Negative case (normal CLI command) verified to not trigger translation.
- E2E tests handle timing uncertainty gracefully with `.or()` combinator.
- Intent classifier tests cover all heuristic branches and edge cases (empty, whitespace, leading whitespace + hash, various CLI patterns).

**Coverage gaps**:
- No test for what happens when the user switches shells while a translation is in progress (F-02 race condition).
- No test for the `#`-only input edge case (the code handles it, but there is no test for `handleSubmit` with input `#`).
- No test verifying that `getCwd` is called and its result passed to `translateCommand`.
- The Rust test does not exercise the actual Tauri command (F-08).

---

## Security Assessment

| Concern | Status | Notes |
|---------|--------|-------|
| Never auto-execute LLM output | **PASS** | Structural guarantee: `return` before `submitCommand`, translation goes to `setInput` |
| LLM response as untrusted text | **PASS** | Rendered via React controlled textarea and JSX text nodes (auto-escaped) |
| Error messages as untrusted text | **PASS** | Rendered via React JSX text node, no innerHTML |
| XSS via LLM response | **PASS** | No `dangerouslySetInnerHTML`, no eval, no dynamic script injection |
| API key handling | **PASS** | No new key handling; existing settings/LLM client from TASK-015/016 |
| `get_cwd` exposure | **PASS** | Exposes app launch directory, not sensitive (user sees this in shell prompt) |
| IPC surface | **PASS** | One new command (`get_cwd`) with no inputs -- minimal attack surface |
| Input validation | **PASS** | Empty/whitespace input handled, `#`-only input handled, `stripHashPrefix` on trimmed input |

---

## Verdict: NEEDS CHANGES

The implementation correctly enforces the critical never-auto-execute invariant, handles loading/error states properly, and treats LLM responses as untrusted text. Test coverage is thorough with good async testing patterns. The E2E tests are well-designed for CI reliability.

Two medium-severity issues require attention:

1. **F-02**: The race condition with stale translations is a real concern when the user switches shells during loading. A simple translation-ID guard would fix it.
2. **F-03**: The intent classifier's heuristic branch returns `natural_language` for common multi-word CLI commands. While the submit flow's `hasHashPrefix` guard prevents any impact today, the exported function has a misleading contract. Either remove the dead heuristic or document the limitation prominently.

After addressing F-02 and F-03, this would be an APPROVE. Neither issue affects the security invariants -- the never-execute guarantee holds regardless.
