# Security Review: TASK-017 (Agent Mode UI)

**Reviewer**: Security Agent (automated)
**Date**: 2026-03-15
**Commit range**: `3682504..HEAD` (3 commits: `523426d`, `c14fa59`, `eb56db1`)
**Previous security review HEAD**: `3682504`
**Verdict**: PASS WITH FINDINGS (0 critical, 1 high, 2 medium, 2 low, 2 informational)

---

## 1. Executive Summary

This review covers TASK-017: Agent Mode UI, which introduces the `#`-prefix intent classifier, the command translation flow (natural language to shell command via LLM), and the review-before-execute pattern. The primary security invariant under audit is: **translated LLM commands must NEVER be auto-executed; the user must explicitly press Enter a second time to run them.**

The implementation correctly enforces this invariant. The translated command is placed into the input editor via `setInput(translated)` and the function returns early before reaching `submitCommand()`. The user must then consciously press Enter again, at which point the translated text (now just a plain string in the input box) flows through the normal CLI execution path. There is no code path that bypasses this review step.

Three new frontend modules were added (`intent-classifier.ts`, `cwd.ts`, and `llm.ts` wrapper). One new Rust command was added (`get_cwd`). The `handleSubmit` function in `Terminal.tsx` was significantly restructured to support the agent mode branch.

The most notable finding is a prompt injection risk: a malicious or compromised LLM could return a multi-line response containing text designed to confuse the user into executing a harmful command. While the review-first pattern mitigates auto-execution, it does not protect against social engineering via the translated output. This is rated High because Velocity is a terminal that executes system commands.

---

## 2. Critical Security Invariant: No Auto-Execution

### 2.1 Verification of Review-First Flow

The `handleSubmit` function in `Terminal.tsx` (lines 285-331) is the single entry point for all user submissions. The control flow is:

```
handleSubmit(cmd)
  |
  +--> trim + empty check
  |
  +--> classifyIntent(trimmed) + hasHashPrefix check
  |
  +--> IF natural_language AND hasHashPrefix:
  |      |
  |      +--> stripHashPrefix -> nlInput
  |      +--> getCwd()
  |      +--> translateCommand(nlInput, shellType, cwd)
  |      +--> setInput(translated)   <-- places in editor for review
  |      +--> return                 <-- EXITS before submitCommand()
  |
  +--> ELSE (CLI mode):
         |
         +--> addCommand(trimmed)
         +--> submitCommand(trimmed)  <-- writes to PTY
         +--> setInput('')
```

**Finding: PASS.** The `return` statement on line 322 guarantees the function exits before reaching `submitCommand()` on line 327. There is no `goto`, no exception handler, no `finally` block, and no callback that could cause `submitCommand` to be called during the agent branch. The `finally` block (lines 317-320) only manages `agentLoading` state -- it never calls `submitCommand`.

### 2.2 Can a Malicious LLM Response Bypass the Review?

Scenario: An adversarial LLM returns a response that somehow triggers automatic execution.

**Analysis**: The LLM response arrives as a plain string from the `translate_command` Tauri IPC call (`invoke<string>`). The string is passed to `setInput(translated)`, which sets React state. This state flows to `<InputEditor value={input}>` and is rendered as the `value` attribute of a `<textarea>`. The value is also rendered through the tokenizer into a `<pre>` overlay for syntax highlighting.

- The textarea `value` attribute is set via React's controlled component pattern, which uses DOM property assignment (not `innerHTML`). This is XSS-safe.
- The syntax highlighting overlay in `InputEditor.tsx` (line 79) renders tokens via `{token.value}` inside JSX `<span>` elements. React's JSX rendering auto-escapes all string content. A response containing `<script>alert(1)</script>` would be rendered as escaped text, not executed. This is XSS-safe.
- The LLM response cannot trigger a keypress event, form submission, or any other DOM event that would invoke `handleSubmit` or `submitCommand`.

**Finding: PASS.** A malicious LLM response cannot bypass the review-first flow. It can only place text into the input editor.

### 2.3 Second Enter Execution Path

When the user reviews the translated command and presses Enter, `handleSubmit` is called again. This time:
- `trimmed` is the translated command (e.g., `Get-ChildItem`)
- `classifyIntent(trimmed)` returns `'cli'` because it does not start with `#`
- The CLI branch executes: `submitCommand(trimmed)` writes to PTY

This is the expected behavior. The translated command is treated identically to any manually typed command. There is no privilege escalation.

---

## 3. Attack Surface Changes

### 3.1 New Attack Surface

| Component | Change | Risk |
|-----------|--------|------|
| `src/lib/intent-classifier.ts` | NEW: Classifies input as CLI or natural language based on `#` prefix | **Low** -- pure logic, no I/O |
| `src/lib/cwd.ts` | NEW: IPC wrapper for `get_cwd` command | **Low** -- information disclosure vector |
| `src-tauri/src/commands/mod.rs` (`get_cwd`) | NEW: Returns `std::env::current_dir()` to frontend | **Medium** -- path disclosure |
| `Terminal.tsx` (`handleSubmit` refactor) | MODIFIED: Added async agent mode branch with translation flow | **Medium** -- primary control flow change |
| `App.css` (agent mode styles) | NEW: `.agent-loading`, `.agent-error`, `.agent-spinner` styles | None |
| `e2e/agent-mode.spec.ts` | NEW: E2E tests for agent mode | None |
| `src/__tests__/Terminal.test.tsx` | MODIFIED: Added 7 agent mode unit tests | None |
| `src/__tests__/intent-classifier.test.ts` | NEW: Unit tests for intent classifier | None |

### 3.2 Unchanged Attack Surface

- **Tauri capabilities**: `default.json` unchanged -- still only `core:default` and `core:event:default`.
- **CSP**: Unchanged. `default-src 'self'` prevents the WebView from making outbound requests. All HTTP originates from Rust.
- **PTY commands**: 5 existing commands unchanged.
- **LLM client** (`llm/mod.rs`): Already reviewed in SECURITY-REVIEW-TASKS-015-016-R1. No changes in this commit range.
- **Settings module**: No changes in this commit range.

### 3.3 IPC Command Inventory (Updated)

| Command | Sensitive Data | New in TASK-017? |
|---------|----------------|-----------------|
| `create_session` | No | No |
| `start_reading` | No | No |
| `write_to_session` | Yes (user commands) | No |
| `resize_session` | No | No |
| `close_session` | No | No |
| `get_settings` | Yes (API key) | No |
| `save_app_settings` | Yes (API key) | No |
| `translate_command` | Yes (user prompt, shell type, cwd) | No (TASK-016) |
| **`get_cwd`** | **Yes (file system path)** | **Yes** |

---

## 4. Findings

### FINDING-1: Prompt Injection / Social Engineering via LLM Response [HIGH]

**Component**: `Terminal.tsx` lines 308-312, `llm/mod.rs` `clean_response()`

**Description**: The LLM is instructed to return "ONLY the command. No explanations, no markdown, no code fences." However, the LLM is not constrained by any technical mechanism -- it returns whatever text it generates. A compromised, fine-tuned, or adversarial LLM could return:

1. A destructive command disguised as benign: `Get-ChildItem; Remove-Item -Recurse C:\Users -Force`
2. A multi-line response where the first line looks safe but hidden lines contain malicious commands
3. A command with obfuscated payloads: `powershell -enc <base64-encoded-malicious-script>`

The `clean_response()` function in Rust only strips markdown code fences and trims whitespace. It does not validate that the output is a single command, does not check for command chaining operators (`;`, `&&`, `||`, `|`), and does not sanitize dangerous patterns.

**Risk**: The user sees the translated command in the input editor before execution, but may not scrutinize a complex command. Terminal applications execute with the user's full privileges. A convincing-looking command could delete files, exfiltrate data, or install malware.

**Mitigation (in place)**: The review-first pattern ensures the user must press Enter. The input editor with syntax highlighting helps make the command visible. These are meaningful mitigations.

**Recommendation**:
- **Short term**: Display a clear visual warning when the translated command contains potentially dangerous patterns (`;`, `&&`, `Remove-Item`, `rm -rf`, `del /f`, pipe to `Invoke-Expression`, encoded commands, etc.).
- **Medium term**: Implement a command safety classifier that flags high-risk patterns and requires explicit user confirmation beyond just pressing Enter.
- **Long term**: Consider sandboxed preview execution or command explanation features.

**Severity**: HIGH -- while the review-first pattern provides a meaningful barrier, the attack surface is significant because (a) this is a terminal app with full system access, and (b) the LLM output is untrusted by definition.

---

### FINDING-2: `get_cwd` Exposes Application Working Directory [MEDIUM]

**Component**: `src-tauri/src/commands/mod.rs` lines 118-122

**Description**: The new `get_cwd` command returns the Rust process's current working directory via `std::env::current_dir()`. This is called every time the user triggers agent mode (line 308 of Terminal.tsx). The returned path is:
1. Sent to the LLM provider as part of the system prompt (via `build_system_prompt` in `llm/mod.rs`)
2. Accessible to any JavaScript running in the WebView via `invoke('get_cwd')`

The CWD reveals:
- The user's username (e.g., `C:\Users\johndoe\...`)
- The installation or development path of the application
- Potentially sensitive directory names

**Risk**: The path is sent to third-party LLM APIs in every translation request. If the user is working in a sensitive directory (e.g., `C:\Users\admin\CompanySecrets\ProjectX`), this information is disclosed to the LLM provider.

**Mitigation (in place)**: The CSP prevents frontend JavaScript from making outbound requests directly. The CWD is only sent via the Rust HTTP client to configured LLM providers. The `getCwd().catch(() => 'C:\\')` fallback in Terminal.tsx prevents errors from blocking the translation.

**Recommendation**:
- Consider allowing users to opt out of sending CWD context to the LLM.
- Document in settings/privacy information that the CWD is shared with the configured LLM provider.
- Note: `get_cwd` returns the **app's launch directory**, not the shell's CWD (as correctly documented in `cwd.ts`). This is less sensitive than the shell's actual CWD but still reveals information.

**Severity**: MEDIUM -- information disclosure to trusted third-party API, not a direct exploit.

---

### FINDING-3: Race Condition in Translation Staleness Guard is Correctly Handled [MEDIUM -- Positive Finding]

**Component**: `Terminal.tsx` lines 304-321, `translationIdRef`

**Description**: The staleness guard using `translationIdRef` is correctly implemented. When:
1. User triggers translation A
2. User switches shell (incrementing `translationIdRef`)
3. Translation A completes

The check `if (translationIdRef.current !== thisTranslation) return` correctly discards the stale response. This is verified in both the success path (line 311), error path (line 315), and finally block (line 318).

The guard is also incremented on `resetAndStart` (line 188) and `handleShellSwitch` (line 231), covering all invalidation scenarios.

**Finding: PASS.** The staleness guard correctly prevents stale translations from being applied to the wrong shell context.

**Severity**: MEDIUM (positive finding) -- correct implementation of a concurrency safety mechanism.

---

### FINDING-4: Intent Classifier Cannot Be Tricked Into Executing [LOW]

**Component**: `src/lib/intent-classifier.ts`

**Description**: The intent classifier is minimal: `trimmed.startsWith('#')` returns `'natural_language'`, everything else returns `'cli'`. In `handleSubmit`, the agent mode branch requires BOTH `intent === 'natural_language'` AND `hasHashPrefix` (redundant but defense-in-depth).

Attempted bypass scenarios:
- Input `# rm -rf /` -- correctly classified as `natural_language`, sent to LLM, not executed
- Input `## comment` -- classified as `natural_language` (starts with `#`), stripped to `# comment` by `stripHashPrefix`, sent to LLM
- Input ` # test` (leading whitespace) -- after `trimmed = cmd.trim()`, becomes `# test`, correctly classified
- Input `#` alone -- classified as `natural_language`, but `stripHashPrefix('#')` returns `''`, which triggers the empty check on line 300-303 and returns early without calling translateCommand
- Input `dir` -- classified as `'cli'`, executed normally, no translation

**Finding: PASS.** The classifier cannot be tricked into executing a natural language input directly.

**Severity**: LOW -- the simplicity of the `#` prefix approach is actually a security benefit. There is no ambiguous heuristic that could misclassify.

---

### FINDING-5: Agent Error Messages May Leak Internal Details [LOW]

**Component**: `Terminal.tsx` lines 313-316, line 419

**Description**: When the LLM translation fails, the error is converted to a string via `String(err)` and displayed in the UI via `{agentError}`. The error originates from the Rust `translate_command` function and may contain:
- HTTP error details (status codes, response bodies)
- Network error messages that reveal internal network topology
- API provider error messages

The Rust side already sanitizes API keys from error messages (via `sanitize_error` in `llm/mod.rs`). However, other sensitive details (endpoint URLs, deployment names, etc.) may still be present in error messages.

The error is rendered via React JSX (`{agentError}` on line 419), which auto-escapes all content. There is no XSS risk from the error message.

**Risk**: Information disclosure to the user (who is already authenticated) -- this is low risk but worth noting for defense-in-depth.

**Recommendation**: Consider sanitizing or truncating error messages displayed in the UI to prevent excessive detail leakage. The Rust side should own error formatting.

**Severity**: LOW -- errors are shown to the local authenticated user, not to remote attackers.

---

### FINDING-6: Input Editor Disabled During Translation [INFORMATIONAL]

**Component**: `Terminal.tsx` line 412, `InputEditor.tsx` line 94

**Description**: The `disabled={closed || agentLoading}` prop prevents user input while a translation is in-flight. When `agentLoading` is true, the textarea's `disabled` attribute is set, preventing:
- Typing new input
- Pressing Enter to submit
- Any keyboard interaction

This prevents a potential race where the user could submit another command while a translation is pending, which could cause confusion about which command is being translated.

**Finding: PASS.** This is a correct UI safety mechanism.

**Severity**: INFORMATIONAL -- positive finding.

---

### FINDING-7: XSS Safety of LLM Output Rendering [INFORMATIONAL]

**Component**: `Terminal.tsx` line 312, `InputEditor.tsx` lines 77-85, 86-97

**Description**: The translated command string flows through two rendering paths:

1. **Textarea value** (`InputEditor.tsx` line 90): `value={value}` -- React sets the DOM property, not innerHTML. XSS-safe.
2. **Syntax highlight overlay** (`InputEditor.tsx` lines 78-81): The value is tokenized by `tokenize(value)` and each token's `.value` is rendered via `{token.value}` inside `<span>` JSX elements. React auto-escapes all string interpolations in JSX. XSS-safe.

A malicious LLM response such as `<img src=x onerror=alert(1)>` would be rendered as literal escaped text in both paths.

Additionally, the CSP (`script-src 'self'`) would block any inline script execution even if XSS were somehow achieved.

**Finding: PASS.** LLM output is rendered safely with no XSS vector.

**Severity**: INFORMATIONAL -- positive finding confirming XSS safety.

---

## 5. Security Rules Compliance

| Rule | Status | Notes |
|------|--------|-------|
| NEVER string-interpolate user input into shell commands | PASS | User's NL input goes to LLM, not to shell. Translated output goes to `setInput()`, not to PTY. Only explicit Enter press sends to PTY via `writeToSession`. |
| Always validate IPC inputs on the Rust side | PASS | `get_cwd` takes no inputs. `translate_command` (from TASK-016) validates API key presence, provider, model, and Azure endpoint. |
| Treat all PTY output as untrusted | N/A | No PTY output changes in this task. |
| No `unwrap()` on user-derived data in Rust | PASS | `get_cwd` uses `.map_err()`. No `unwrap()` on user data. Note: `clean_response` in `llm/mod.rs` uses `unwrap_or` which is safe. |

---

## 6. Test Coverage Assessment

### 6.1 Security-Relevant Tests Present

| Test | File | Verifies |
|------|------|----------|
| `test_hash_input_triggers_translate` | `Terminal.test.tsx` | `#` input calls translateCommand, NOT writeToSession |
| `test_translated_command_populates_input` | `Terminal.test.tsx` | Translated text goes to input editor, not PTY |
| `test_agent_loading_shown` | `Terminal.test.tsx` | Loading state correctly managed |
| `test_agent_error_shown` | `Terminal.test.tsx` | Error state correctly displayed |
| `test_agent_error_clears_on_typing` | `Terminal.test.tsx` | Error cleared on new input |
| `test_normal_command_not_translated` | `Terminal.test.tsx` | Non-`#` input bypasses agent mode |
| `test_translated_command_executes_on_second_enter` | `Terminal.test.tsx` | Two-step flow: translate, then explicit execute |
| Intent classifier tests (12 cases) | `intent-classifier.test.ts` | Edge cases for `#` prefix detection |
| E2E: agent mode loading/error | `agent-mode.spec.ts` | End-to-end validation of agent flow |
| E2E: normal command bypass | `agent-mode.spec.ts` | Normal commands unaffected by agent mode |

### 6.2 Missing Security Tests

| Missing Test | Priority |
|-------------|----------|
| Translation with malicious content (e.g., `<script>`, command chaining) does not cause XSS or auto-execution | Medium |
| Stale translation is discarded after shell switch (integration test) | Low |
| `get_cwd` returns valid path, not sensitive data leak | Low |
| Concurrent rapid `#` submissions do not cause race conditions | Low |

---

## 7. Verdict

**PASS WITH FINDINGS**

The primary security invariant (no auto-execution of LLM-translated commands) is correctly enforced. The implementation uses a clean control flow with an explicit `return` that prevents any code path from reaching `submitCommand` during the agent mode branch. The staleness guard is correctly implemented. XSS safety is ensured by React's auto-escaping and the existing CSP. The intent classifier is simple and cannot be confused.

The main concern is FINDING-1 (prompt injection / social engineering), which is inherent to any LLM-to-shell pipeline and is partially mitigated by the review-first pattern. This should be addressed in a future task with visual warnings for dangerous command patterns.

### Action Items

| # | Finding | Severity | Action | Blocking? |
|---|---------|----------|--------|-----------|
| 1 | Prompt injection / social engineering | HIGH | Add visual warning for dangerous command patterns in translated output | No (future task) |
| 2 | `get_cwd` path disclosure to LLM | MEDIUM | Document privacy implications; consider opt-out | No |
| 3 | Error message detail leakage | LOW | Consider truncating/sanitizing displayed errors | No |
| 4 | Missing security-focused tests | LOW | Add tests for malicious LLM output rendering | No |

No findings are blocking. The implementation is sound for MVP.
