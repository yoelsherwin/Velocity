# Security Review: TASK-018 (Intelligent Intent Classifier + Mode Indicator)

**Reviewer**: Security Agent (automated)
**Date**: 2026-03-16
**Commit range**: `5e5fae7..04461db` (1 commit: `04461db`)
**Previous security review HEAD**: `5e5fae7`
**Verdict**: PASS WITH FINDINGS (0 critical, 1 high, 2 medium, 3 low, 2 informational)

---

## 1. Executive Summary

This review covers TASK-018: Intelligent Intent Classifier + Mode Indicator, which replaces the rudimentary `#`-prefix-only classifier with a multi-signal heuristic engine, adds a `get_known_commands` Rust command that scans PATH for executables, introduces a visual ModeIndicator component, and rewires the Terminal submit flow to route on `inputMode.intent` instead of `hasHashPrefix`.

The primary security invariant under audit is: **the classifier must never cause a natural language input to be sent to the shell for execution, and must never cause a CLI command to be silently swallowed into the LLM without the user's knowledge.** Auto-execution of LLM-translated commands must remain impossible.

The implementation correctly preserves the never-auto-execute guarantee. The new heuristic classifier is deterministic, runs client-side only, and its output is advisory (the user can toggle it). The `get_known_commands` Rust backend scans the system PATH and returns executable names to the frontend, which introduces a new information surface. The most significant finding is a classifier evasion vector where crafted input could trick the heuristic into misrouting CLI commands to the LLM (data exfiltration) or NL to the shell (accidental execution).

---

## 2. Critical Security Invariant: Never-Auto-Execute

### 2.1 Verification of Submit Flow

The `handleSubmit` function in `Terminal.tsx` (lines 291-341) now routes on `inputMode.intent`:

```
handleSubmit(cmd)
  |
  +--> trim + empty check
  |
  +--> IF inputMode.intent === 'natural_language':
  |      |
  |      +--> stripHashPrefix if starts with '#' (backward compat)
  |      +--> getCwd()
  |      +--> translateCommand(nlInput, shellType, cwd)
  |      +--> setInput(translated)   <-- places in editor for review
  |      +--> setModeOverride(false); setInputMode({ intent: 'cli', confidence: 'high' })
  |      +--> return                 <-- EXITS before submitCommand()
  |
  +--> ELSE (CLI mode):
         |
         +--> addCommand(trimmed)
         +--> submitCommand(trimmed)  <-- writes to PTY
         +--> setInput('')
         +--> setModeOverride(false); setInputMode reset
```

**Finding: PASS.** The `return` statement on line 329 guarantees the function exits before reaching `submitCommand()` on line 333. The never-auto-execute invariant is preserved. LLM-translated commands are placed in the editor via `setInput(translated)` and require an explicit second Enter press to execute.

### 2.2 Mode Reset After Translation

After a successful translation, the code resets `modeOverride` to `false` and `inputMode` to `{ intent: 'cli', confidence: 'high' }` (lines 318-319). This means the translated command (now in the input editor) will be classified as CLI on the next Enter press, causing it to be executed via `submitCommand`. This is correct and expected -- the translated command IS a CLI command.

However, there is a subtlety: the `handleInputChange` callback (lines 343-356) also runs `classifyIntent` on input changes when `!modeOverride`. After translation populates the editor, `modeOverride` is false, but `handleInputChange` is NOT called because `setInput` sets the state directly without triggering the `onChange` handler. The user must press Enter (calling `handleSubmit`), which checks `inputMode.intent` which was explicitly set to `'cli'`. This is correct.

**Finding: PASS.** The state transitions are sound.

---

## 3. `get_known_commands` Audit

### 3.1 PATH Scanning

The Rust `get_known_commands` command (`src-tauri/src/commands/mod.rs` lines 124-162) does the following:

1. Reads `std::env::var("PATH")` and splits on `;`
2. For each PATH directory, reads directory entries via `std::fs::read_dir(dir)`
3. Extracts the file name, takes everything before the first `.` as the base name, lowercases it
4. Adds the base name to a `Vec<String>`
5. Appends a hardcoded list of shell builtins
6. Sorts and deduplicates
7. Returns the full list to the frontend

### 3.2 Information Disclosure Analysis

**What is exposed**: The list of every executable name (without extension) found in every PATH directory, plus builtins. On a typical Windows system this could be 500-2000 entries.

**What is NOT exposed**: File paths, file sizes, file permissions, directory names, or any other metadata. Only the stem of the filename (e.g., `git`, `python`, `notepad`) is returned.

**Risk assessment**: The known command list reveals which software is installed on the system. An attacker who can read this list (e.g., via a WebView exploit or XSS) could:
- Fingerprint the system (identify developer tools, security software, administrative tools)
- Identify attack vectors (e.g., presence of `psexec`, `mimikatz`, or other tools)
- Determine OS version and edition based on available system utilities

**Mitigating factors**:
- The data stays local -- it is never sent to any external service (unlike CWD, which is sent to the LLM provider)
- The CSP prevents WebView JavaScript from exfiltrating data via network requests
- The list is the same information available to any process running as the current user
- Tauri capabilities (`default.json`) only grant `core:default` and `core:event:default` -- no filesystem or shell permissions beyond what the custom commands expose

**Finding**: MEDIUM -- the information is locally available anyway, but consolidating it into a single IPC call that returns the full list creates a convenient enumeration primitive for any code running in the WebView context.

### 3.3 Denial of Service via PATH Scanning

The `get_known_commands` function runs in `spawn_blocking` (correct -- it does filesystem I/O). It iterates every directory in PATH and every file in each directory. On a system with a bloated PATH (many directories, each containing many files), this could be slow.

**Mitigating factors**:
- Called once on mount via `useKnownCommands` hook (not on every keystroke)
- Errors in `read_dir` are silently skipped via `flatten()` (directories that don't exist or can't be read are ignored)
- The hook falls back to an empty `Set` on failure
- The frontend classifier still works without the known commands set (it uses structural signals)

**Finding**: LOW -- the scan is bounded by the PATH environment variable, which the user controls. No amplification attack is possible.

### 3.4 `unwrap()` Audit

Line 136: `name.split('.').next().unwrap_or(name)` -- this uses `unwrap_or`, which is safe. `split()` on any string always returns at least one element, so `.next()` never returns `None` here, but the `unwrap_or` fallback is still correct defense-in-depth.

**Finding: PASS.** No unsafe `unwrap()` on user-derived data.

### 3.5 Extension Stripping Logic

The comment says "Strip .exe, .cmd, .bat, .ps1 extensions" but the code uses `name.split('.').next()` which takes everything before the FIRST dot. This means:

- `git.exe` -> `git` (correct)
- `python3.12.exe` -> `python3` (loses the version component -- minor functional issue, not a security issue)
- `.gitkeep` -> `` (empty string, filtered out by `!base.is_empty()`)
- `no-extension` -> `no-extension` (correct -- whole name is kept)

This is functionally adequate and poses no security risk.

---

## 4. Classifier Routing Security

### 4.1 Can the Classifier Be Tricked into Sending CLI Commands to the LLM?

If a genuine CLI command is misclassified as `natural_language`, it will be sent to the LLM provider via `translateCommand`. This is a **data exfiltration** vector if the command contains sensitive information (e.g., `curl -H "Authorization: Bearer sk-secret..." https://api.example.com`).

**Analysis of misclassification scenarios**:

| Input | Expected | Actual | Correct? |
|-------|----------|--------|----------|
| `curl https://example.com` | CLI | CLI high (flags present: `-` not required, but `://` contains `>` no... actually `://` does NOT match `[|<>]`) | Depends on whether `curl` is in knownCommands |
| `curl https://example.com` (curl in PATH) | CLI | CLI high (`knownCommands.has('curl')`) | Yes |
| `ssh user@host` (ssh in PATH) | CLI | CLI high (`knownCommands.has('ssh')`) | Yes |
| `some-custom-script arg1 arg2` (not in PATH, 3 words) | CLI | NL low (3+ words, unknown first token) | **MISCLASSIFIED** |
| `myapp --secret=password` | CLI | CLI high (flags detected by `\s-{1,2}\w` pattern) | Yes |

The case of `some-custom-script arg1 arg2` (a valid CLI command not in PATH) would be misclassified as `natural_language` with `low` confidence. If the user does not notice the mode indicator and presses Enter, the input would be sent to the LLM.

**Mitigating factors**:
- The ModeIndicator shows `AI?` (uncertain) which signals the user should verify
- The input STILL goes through the review-first flow -- it is sent to the LLM for translation, NOT executed
- The LLM would likely return a similar command, which the user would then review
- The user can click the toggle to override to CLI

**Finding**: HIGH -- misclassification can cause unintended data disclosure to the LLM provider. The heuristic approach inherently has false positives/negatives. Any multi-word input where the first token is not in `knownCommands` and has no CLI structural signals (flags, pipes, paths) will be classified as NL. This is the fundamental tradeoff of heuristic classification.

### 4.2 Can the Classifier Be Tricked into Sending NL to the Shell?

If natural language input is misclassified as `cli`, it would be executed as a shell command when the user presses Enter. On most shells, natural language input would produce a "command not found" error and cause no harm. However:

**Dangerous scenario**: Input like `delete everything` where `delete` is a known command (it's in the `nlVerbs` list but NOT in the default `builtins` list). Let's trace:
- `firstToken` = `delete`
- Not in `knownCommands` (unless a `delete.exe` exists in PATH)
- Flags check: no flags -> continue
- Known commands check: depends on PATH
- Question words: no -> continue
- NL verbs: `nlVerbs.includes('delete')` = true, `words.length >= 3`? Only 2 words -> **no match**
- Ambiguous zone: `words.length >= 3`? No (2 words) -> continue
- Short unknown: `!knownCommands.has('delete') && words.length <= 2` -> **CLI low**

So `delete everything` would be classified as CLI (low confidence) and sent to the shell if the user presses Enter. On Windows CMD, `del everything` would fail (wrong syntax), but `delete` is not a valid CMD command either, so it would produce an error. Not dangerous.

**More concerning scenario**: `start notepad` where `start` is in the builtins list:
- `firstToken` = `start`
- `knownCommands.has('start')` = true (it's in the builtins)
- Returns CLI high -> executed as shell command

This is correct behavior -- `start notepad` IS a valid CLI command.

**Scenario with NL verb collision**: `open the browser` where `open` is in `nlVerbs` AND potentially in PATH (macOS has `open`, Windows has `start`):
- `firstToken` = `open`
- If `open` is in knownCommands: `knownCommands.has('open')` = true -> CLI high
- If `open` is NOT in knownCommands: NL verbs check: `nlVerbs.includes('open')` = true, `words.length >= 3` = true -> NL high

The classifier correctly prioritizes known commands over NL verb heuristics (the known-command check on line 47 runs before the NL verbs check on line 66-68). This is the right priority order.

**Finding**: The classifier handles NL-to-shell misclassification acceptably. The known-command lookup runs BEFORE NL heuristics, and CLI structural signals (flags, pipes, paths) run BEFORE both. The worst case for NL-to-shell misclassification is a nonsensical command that the shell will reject.

### 4.3 `#` Prefix Backward Compatibility

The `#` prefix check is the FIRST rule in the classifier (line 21), ensuring it always takes precedence. This preserves backward compatibility from TASK-017.

In `handleSubmit`, the NL branch now handles both `#`-prefixed and auto-detected NL input:
```typescript
const nlInput = trimmed.startsWith('#') ? stripHashPrefix(trimmed) : trimmed;
```

This means auto-detected NL input is sent to the LLM WITHOUT stripping a `#` prefix. This is correct.

**Finding: PASS.**

---

## 5. Mode Override and Cross-Session Leakage

### 5.1 Override State Lifecycle

The `modeOverride` state is a `useState(false)` in `Terminal.tsx`. It is:
- Set to `true` when the user clicks the toggle button (`handleToggleMode`, line 363)
- Reset to `false` after submit (both NL and CLI paths, lines 318/337)
- Component-scoped -- each `Terminal` instance has its own state

### 5.2 Cross-Tab/Pane Leakage

Each `Terminal` component is rendered independently per pane. The `modeOverride` state is React component state, not shared via context, store, or global variable. There is no mechanism for override state to leak between tabs or panes.

**Finding: PASS.** No cross-session leakage.

### 5.3 Override Persistence Across Input Changes

When `modeOverride` is true, `handleInputChange` (line 351) skips auto-classification:
```typescript
if (!modeOverride) {
    setInputMode(classifyIntent(newValue, knownCommands));
}
```

This means the override persists across all input changes until the user submits. This is correct per the task spec but has a usability-security implication: if the user toggles to CLI mode and then types a long natural language sentence, the classifier will NOT correct the mode. The user's NL input will be sent to the shell on Enter. However, this is the intended behavior -- the toggle is an explicit user override.

**Finding: PASS.** The override is intentional and user-initiated.

---

## 6. Known Commands List in Frontend

### 6.1 Data Flow

```
Rust (get_known_commands) --> IPC --> useKnownCommands hook --> Set<string> in state
                                                              |
                                                              v
                                          classifyIntent(input, knownCommands) on every input change
```

### 6.2 Caching and Refresh

The `useKnownCommands` hook calls `invoke('get_known_commands')` once on mount (empty dependency array `[]`). The result is cached in React state for the lifetime of the Terminal component.

**Concern**: If the user installs a new tool to PATH after the app starts, the known commands list will be stale. A newly installed command (e.g., `kubectl`) would be classified as unknown, potentially triggering NL classification for `kubectl get pods` (though the flags `-` would still trigger CLI detection via structural signals).

This is a minor functional concern, not a security issue. The classifier degrades gracefully to structural signals when the known commands set is incomplete.

### 6.3 Information Disclosure Risk to LLM

The known commands list is **NOT** sent to the LLM. It stays entirely client-side, used only for the heuristic classifier. This is confirmed by inspecting the `translateCommand` call in Terminal.tsx (lines 312-313) which only passes `nlInput`, `shellType`, and `cwd`.

**Finding: PASS.** Known commands are not exfiltrated to external services.

---

## 7. Attack Surface Changes

### 7.1 New Attack Surface

| Component | Change | Risk |
|-----------|--------|------|
| `src-tauri/src/commands/mod.rs` (`get_known_commands`) | NEW: Scans PATH + builtins, returns executable names | **Medium** -- system enumeration |
| `src/hooks/useKnownCommands.ts` | NEW: IPC wrapper, caches in React state | **Low** -- state management only |
| `src/lib/intent-classifier.ts` | REWRITTEN: Multi-signal heuristic engine | **High** -- routing decisions affect security |
| `src/components/editor/ModeIndicator.tsx` | NEW: Visual badge with toggle | **Low** -- UI only, no data flow |
| `src/components/editor/InputEditor.tsx` | MODIFIED: Added mode/onToggleMode props | None |
| `src/components/Terminal.tsx` | MODIFIED: Added inputMode/modeOverride state, rewired submit flow | **Medium** -- control flow change |
| `src/App.css` | MODIFIED: Added `.mode-indicator-*` styles | None |
| Tests (4 files) | NEW/MODIFIED: Unit and E2E tests | None |
| `e2e/intent-classifier.spec.ts` | NEW: E2E tests for mode indicator | None |

### 7.2 Unchanged Attack Surface

- **Tauri capabilities**: `default.json` unchanged -- `core:default` and `core:event:default` only.
- **CSP**: Unchanged.
- **LLM client** (`llm/mod.rs`): No changes.
- **PTY commands**: 5 existing commands unchanged.
- **Settings module**: No changes.
- **Dependencies**: No new crate or npm package dependencies.

### 7.3 IPC Command Inventory (Updated)

| Command | Sensitive Data | New in TASK-018? |
|---------|----------------|-----------------|
| `create_session` | No | No |
| `start_reading` | No | No |
| `write_to_session` | Yes (user commands) | No |
| `resize_session` | No | No |
| `close_session` | No | No |
| `get_settings` | Yes (API key) | No |
| `save_app_settings` | Yes (API key) | No |
| `translate_command` | Yes (user prompt, shell type, cwd) | No (TASK-016) |
| `get_cwd` | Yes (file system path) | No (TASK-017) |
| **`get_known_commands`** | **Yes (installed software inventory)** | **Yes** |

---

## 8. Findings

### FINDING-1: Heuristic Misclassification Can Cause Unintended Data Disclosure to LLM [HIGH]

**Component**: `src/lib/intent-classifier.ts` lines 70-80 (ambiguous zone)

**Description**: The heuristic classifier has an inherent false-positive/false-negative rate. Specifically, any input that:
- Has 3+ words
- First token is NOT in `knownCommands`
- Has no CLI structural signals (no flags, pipes, redirects, paths, or assignments)

...will be classified as `natural_language` (low confidence). If the user presses Enter without checking the mode indicator, this input is sent to the configured LLM provider for translation. If the input contains sensitive data (e.g., `mysecret-tool decrypt password123`), this data would be disclosed to the LLM API.

**Attack scenario**: A user has a custom script `deploy-prod` not in PATH. They type `deploy-prod staging cluster-3`. The classifier sees 3 unknown words, no CLI signals, and returns NL low. If the user doesn't notice the `AI?` badge and presses Enter, the input is sent to the LLM.

**Mitigating factors**:
- The ModeIndicator shows `AI?` (uncertain) which is a visual warning
- The input is NOT executed -- it goes to the LLM for translation, not to the shell
- The translated command is placed in the editor for review before execution
- The user can toggle the mode at any time
- The `low` confidence rating signals uncertainty to the user

**Risk**: Data exfiltration to LLM provider. Severity depends on how sensitive the user's command inputs are and which LLM provider is configured. Local/self-hosted providers have lower risk.

**Recommendation**:
- **Short term**: When confidence is `low`, consider prompting the user with a brief inline confirmation ("This looks like it might be a natural language request. Press Enter to translate with AI, or click CLI to execute as a command.") instead of silently routing to the LLM.
- **Medium term**: Allow users to add custom commands to the known-commands list (e.g., via settings or a `.velocity-commands` file).
- **Long term**: Log all inputs sent to the LLM (locally, with opt-in) so users can audit what was disclosed.

**Severity**: HIGH -- unintended data disclosure to a third-party API is a privacy violation. The heuristic approach fundamentally cannot achieve 100% accuracy.

---

### FINDING-2: `get_known_commands` Exposes Installed Software Inventory [MEDIUM]

**Component**: `src-tauri/src/commands/mod.rs` lines 124-162

**Description**: The `get_known_commands` IPC command returns the names of all executables in every PATH directory. This provides a convenient software inventory of the system. On a typical Windows developer machine, this could include:
- Security tools (e.g., `wireshark`, `nmap`, `burp`, `mimikatz`)
- Development tools (e.g., `python`, `node`, `docker`, `kubectl`, `terraform`)
- System administration tools (e.g., `psexec`, `powershell`, `wmic`)
- Custom/proprietary tools that reveal organizational information

**Risk**: If a WebView vulnerability (XSS, RCE) allows arbitrary JavaScript execution, the attacker can call `invoke('get_known_commands')` to enumerate installed software. This aids in reconnaissance for further exploitation. The CSP (`default-src 'self'`) mitigates exfiltration of this data via network requests, but a sophisticated attacker might exfiltrate via side channels (DNS, timing, etc.).

**Mitigating factors**:
- The data is locally available to any process running as the current user
- The list contains only command names, not full paths or metadata
- The CSP prevents direct network exfiltration from the WebView
- No known XSS vectors exist in the current codebase (React auto-escaping, controlled components)

**Recommendation**:
- Consider caching the result on the Rust side and rate-limiting calls to prevent abuse
- Consider filtering out commands from system directories (e.g., `C:\Windows\System32`) and only including user-installed tools -- or vice versa, as appropriate for the classifier's needs

**Severity**: MEDIUM -- information disclosure that aids reconnaissance, mitigated by CSP and lack of known XSS vectors.

---

### FINDING-3: NL Verb List Collision with Known Commands Creates Priority Dependency [MEDIUM]

**Component**: `src/lib/intent-classifier.ts` lines 46-47 (known commands check) vs lines 63-68 (NL verbs check)

**Description**: The classifier has two overlapping lists:
- `knownCommands` (from PATH scan + builtins): e.g., `find`, `sort`, `type`, `start`, `move`, `copy`
- `nlVerbs`: `show`, `list`, `create`, `delete`, `remove`, `search`, `look`, `check`, `tell`, `give`, `open`, `close`, `rename`, `download`, `deploy`, `configure`, `setup`, `reset`, `fix`, `debug`, `explain`, `describe`, `count`

Several `nlVerbs` could also be in `knownCommands` if corresponding executables exist in PATH:
- `find` (Windows `find.exe`) -- present in builtins
- `sort` (Windows `sort.exe`) -- NOT in builtins but likely in PATH
- `type` (CMD builtin) -- present in builtins

The security-relevant behavior depends on rule ordering. The known-command check (line 47) runs BEFORE the NL verbs check (line 66), so `find something` where `find` is in `knownCommands` will be classified as CLI. The NL verbs check explicitly requires `!knownCommands.has(firstToken)` (line 66). This is correct.

However, common NL verbs that ARE valid commands create user confusion:
- `find all typescript files modified today` -> CLI high (because `find` is a known command)
- The user expected NL mode but gets CLI mode
- If they press Enter, `find all typescript files modified today` is sent to the shell (CMD `find` searches for text strings, so this would likely fail harmlessly)

The test `test_find_natural_is_nl` in `intent-classifier.test.ts` (line 130-134) tests with a custom `noFind` set that omits `find`, acknowledging this ambiguity. But in production, `find` WILL be in the known commands set (it's a Windows system utility).

**Risk**: User confusion about mode classification for ambiguous verbs. This is primarily a UX issue, but has security implications if users learn to ignore the mode indicator because it's "often wrong" and stop reviewing the mode before pressing Enter.

**Recommendation**: Document the priority order clearly and consider special handling for known-ambiguous commands (commands that are both valid executables AND common English verbs). For example, if the input is `find` + 4+ words + articles, it could still be NL despite `find` being in knownCommands.

**Severity**: MEDIUM -- usability issue that could erode trust in the mode indicator, leading to reduced security vigilance.

---

### FINDING-4: PATH Separator Hardcoded to `;` (Windows Only) [LOW]

**Component**: `src-tauri/src/commands/mod.rs` line 131

**Description**: The PATH variable is split on `;`, which is the Windows path separator. If Velocity ever runs on WSL or Linux (via Tauri cross-platform), this would not correctly parse the PATH (which uses `:` on Unix). The current code would treat the entire PATH as a single directory path and fail to enumerate commands.

**Mitigating factors**:
- Velocity is explicitly a Windows terminal application
- WSL commands are executed via a WSL session, not via the Rust process's PATH
- The `read_dir` call would simply fail on the malformed path and be silently skipped

**Risk**: Non-functional, not a security risk in the current context.

**Recommendation**: Use `std::env::split_paths` instead of manual splitting for future portability.

**Severity**: LOW -- no security impact, noted for correctness.

---

### FINDING-5: ModeIndicator Disabled State Uses `onClick={undefined}` Instead of `disabled` Attribute [LOW]

**Component**: `src/components/editor/ModeIndicator.tsx` line 31

**Description**: When `disabled` is true, the ModeIndicator sets `onClick={disabled ? undefined : onToggle}` instead of using the HTML `disabled` attribute on the button. This means:
1. The button is still focusable via keyboard
2. The button can still be activated via assistive technology
3. Screen readers will not announce the button as disabled

This is a minor accessibility issue, not a direct security risk. The toggle only affects the mode indicator state (CLI vs AI), which is advisory. It cannot cause command execution.

**Severity**: LOW -- accessibility issue, no security impact.

---

### FINDING-6: Regex `\s-{1,2}\w` Does Not Match Flags at Start of Input [LOW]

**Component**: `src/lib/intent-classifier.ts` line 32

**Description**: The flag detection regex `/\s-{1,2}\w/` requires whitespace BEFORE the flag. This means input starting with a flag (e.g., `-la`, `--help`) is NOT detected as CLI via this rule. However:
- Input like `-la` would fall through to the ambiguous zone and be classified as CLI low (short unknown, 1 word)
- Input like `--help` would also be CLI low
- Input like `-la /path` would still not match (no whitespace before `-la`)

This is a minor gap in the heuristic but does not create a security vulnerability because:
1. Bare flags without a command name are unusual
2. The ambiguous zone defaults to CLI for short inputs
3. If the flag input has a known command as the first token, it would be caught by the known-command check

**Severity**: LOW -- minor heuristic gap, no security impact.

---

### FINDING-7: `useKnownCommands` Error Handling is Robust [INFORMATIONAL]

**Component**: `src/hooks/useKnownCommands.ts` lines 14-16

**Description**: The hook correctly handles IPC failures by falling back to an empty `Set`:
```typescript
.catch(() => setCommands(new Set())); // Fallback: empty set
```

With an empty known commands set, the classifier still functions via structural signals (flags, pipes, paths, PowerShell patterns). NL detection still works via question words, articles, and NL verbs. The only loss is the known-command lookup, which means some simple commands like `git status` might not be classified as CLI if they lack other structural signals. But `git status` has 2 words and no NL signals, so it would be classified as CLI low -- which is acceptable degradation.

**Finding: PASS.** Graceful degradation is correctly implemented.

**Severity**: INFORMATIONAL -- positive finding.

---

### FINDING-8: XSS Safety of Mode Indicator Rendering [INFORMATIONAL]

**Component**: `src/components/editor/ModeIndicator.tsx`

**Description**: The ModeIndicator renders static strings (`'CLI'`, `'AI'`, `'CLI?'`, `'AI?'`) derived from the `intent` and `confidence` props. These values are typed as `'cli' | 'natural_language'` and `'high' | 'low'` respectively (TypeScript union types). The rendered text is always one of the four static labels. There is no user-derived content rendered in this component.

The `aria-label` uses template literal interpolation: `` `Mode: ${label}. Click to toggle.` `` where `label` is one of the four static strings. This is XSS-safe.

**Finding: PASS.** No XSS vectors.

**Severity**: INFORMATIONAL -- positive finding.

---

## 9. Security Rules Compliance

| Rule | Status | Notes |
|------|--------|-------|
| NEVER string-interpolate user input into shell commands | PASS | User input flows through classifier (pure logic), then to either LLM or PTY via existing validated paths. No new shell command construction. |
| Always validate IPC inputs on Rust side | PASS | `get_known_commands` takes no inputs -- it reads from the environment only. |
| Treat all PTY output as untrusted | N/A | No PTY output changes in this task. |
| No `unwrap()` on user-derived data in Rust | PASS | Uses `unwrap_or` (safe), `.flatten()` (safe), `.map_err()` (safe). No bare `unwrap()` on user data. |

---

## 10. Test Coverage Assessment

### 10.1 Security-Relevant Tests Present

| Test | File | Verifies |
|------|------|----------|
| `test_hash_prefix_is_nl_high` | `intent-classifier.test.ts` | `#` prefix always forces NL high |
| `test_flags_are_cli_high` | `intent-classifier.test.ts` | CLI flags detected correctly |
| `test_pipe_is_cli_high` | `intent-classifier.test.ts` | Pipes detected as CLI |
| `test_known_command_is_cli_high` | `intent-classifier.test.ts` | Known commands route to CLI |
| `test_question_is_nl_high` | `intent-classifier.test.ts` | Question words route to NL |
| `test_works_with_empty_known_commands` | `intent-classifier.test.ts` | Classifier works without known commands |
| `test_auto_detects_nl` | `Terminal.test.tsx` | NL input auto-detected, mode indicator shows AI |
| `test_auto_detects_cli` | `Terminal.test.tsx` | CLI input auto-detected with known commands |
| `test_toggle_overrides` | `Terminal.test.tsx` | Toggle persists across input changes |
| `test_submit_resets_override` | `Terminal.test.tsx` | Override cleared after submit |
| `test_nl_mode_triggers_translate` | `Terminal.test.tsx` | NL mode routes to translation |
| `test_normal_command_not_translated` | `Terminal.test.tsx` | CLI commands bypass translation |
| `test_translated_command_executes_on_second_enter` | `Terminal.test.tsx` | Two-step execution preserved |
| `test_disabled_prevents_click` | `ModeIndicator.test.tsx` | Disabled toggle does not fire |
| `test_get_known_commands_returns_nonempty` | `commands/mod.rs` | Rust PATH scan returns results |
| E2E: mode indicator visible | `intent-classifier.spec.ts` | Mode indicator rendered in real app |
| E2E: mode indicator toggles | `intent-classifier.spec.ts` | Toggle works in real app |

### 10.2 Missing Security Tests

| Missing Test | Priority | Description |
|-------------|----------|-------------|
| Misclassification boundary test | Medium | Test edge cases where CLI commands might be classified as NL (e.g., 3-word commands with unknown first token) |
| Known command collision test | Medium | Test `find all typescript files` when `find` IS in knownCommands -- verify it's CLI, not NL |
| Override does not leak between Terminal instances | Low | Render two Terminal components, toggle in one, verify other is unaffected |
| `get_known_commands` with empty PATH | Low | Verify graceful handling when PATH is unset or empty |
| Large known commands list performance | Low | Verify `classifyIntent` remains <1ms with a realistic 2000-entry Set |

---

## 11. Verdict

**PASS WITH FINDINGS**

The never-auto-execute invariant is correctly preserved. The new heuristic classifier introduces an inherent tradeoff between classification accuracy and security, but the implementation makes sound design choices:
1. CLI structural signals take highest priority (flags, pipes, paths)
2. Known-command lookup takes priority over NL heuristics
3. The `#` prefix remains as an explicit, unambiguous NL trigger
4. Low-confidence results are visually indicated
5. The user can override the classification at any time
6. Override state is component-scoped and cannot leak between sessions

The primary concern is FINDING-1 (misclassification leading to unintended LLM data disclosure), which is inherent to any heuristic classification approach. The visual indicators and manual toggle provide meaningful mitigation.

### Action Items

| # | Finding | Severity | Action | Blocking? |
|---|---------|----------|--------|-----------|
| 1 | Heuristic misclassification data disclosure | HIGH | Add inline confirmation for low-confidence NL routing; allow custom command lists | No (future task) |
| 2 | `get_known_commands` software inventory exposure | MEDIUM | Consider rate-limiting and Rust-side caching | No |
| 3 | NL verb / known command collision confusion | MEDIUM | Document priority order; consider hybrid handling for ambiguous verbs | No |
| 4 | PATH separator hardcoded to `;` | LOW | Use `std::env::split_paths` for portability | No |
| 5 | ModeIndicator disabled state accessibility | LOW | Use HTML `disabled` attribute instead of `onClick={undefined}` | No |
| 6 | Flag regex doesn't match at input start | LOW | Minor heuristic gap, no security impact | No |

No findings are blocking. The implementation is sound for MVP.

---

## 12. Comparison with TASK-017 Security Posture

| Property | TASK-017 | TASK-018 | Change |
|----------|----------|----------|--------|
| Classifier complexity | 1 rule (`#` prefix) | ~15 rules (structural, known commands, NL patterns) | Increased attack surface |
| False positive rate | 0% (explicit `#` is unambiguous) | Low but non-zero (heuristic) | Regression in certainty |
| Auto-execute possible? | No | No | Unchanged |
| Data sent to LLM | Only `#`-prefixed input | Any auto-detected NL input | Wider exposure surface |
| User awareness | Must explicitly type `#` | Must check mode indicator | Reduced user intentionality |
| New IPC commands | `get_cwd` | `get_known_commands` | +1 enumeration primitive |
| Override mechanism | None (toggle not available) | Click badge to toggle | User control added |

The security posture has shifted from a high-certainty, low-convenience model (explicit `#`) to a lower-certainty, higher-convenience model (auto-detection with override). This is the expected and accepted tradeoff for TASK-018. The backward-compatible `#` prefix ensures power users retain the explicit trigger.
