# Security Review: TASK-012, TASK-013, TASK-014

**Reviewer**: Security Agent (automated)
**Date**: 2026-03-14
**Commit range**: `65c9f9a..7ace1a7` (5 commits)
**Previous security review HEAD**: `5e6afb6`
**Verdict**: PASS WITH FINDINGS (2 medium, 3 low, 1 informational)

---

## 1. Executive Summary

This review covers three features: exit code detection via shell marker injection (TASK-012), draggable pane divider resizing (TASK-013), and per-tab pane focus management (TASK-014). The most security-critical change is the marker injection mechanism in TASK-012, which appends shell commands to user input before writing to the PTY. While the mechanism is architecturally sound (the user already controls what is sent to the shell), there are two medium-severity findings related to marker spoofing and PowerShell exit code fidelity. No new IPC commands or capability changes were introduced. No Rust code was modified in this commit range.

---

## 2. Attack Surface Changes

### 2.1 New Attack Surface

| Component | Change | Risk |
|-----------|--------|------|
| `src/lib/exit-code-parser.ts` | New module: parses `VELOCITY_EXIT:<code>` markers from PTY output | Medium -- marker spoofing |
| `src/components/Terminal.tsx` (`submitCommand`) | Appends shell-specific marker suffix to user commands before PTY write | Medium -- command injection analysis required |
| `src/components/layout/PaneContainer.tsx` (`usePaneDrag`) | Mouse event handlers for divider drag (document-level listeners) | Low -- DOM manipulation |
| `src/lib/pane-utils.ts` (`updatePaneRatio`) | New pure function to update split ratio in pane tree | None |
| `src/components/layout/TabManager.tsx` | `focusedPaneId` moved into `Tab` object; resize callback wiring | None |
| `src/lib/types.ts` | `exitCode` field added to `Block`; `focusedPaneId` added to `Tab` | None |

### 2.2 Unchanged Attack Surface

- **IPC commands**: No new Tauri commands added. The same 5 commands remain: `create_session`, `start_reading`, `write_to_session`, `resize_session`, `close_session`.
- **Tauri capabilities**: `default.json` unchanged -- `core:default` and `core:event:default` only.
- **CSP**: Remains `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`.
- **Rust backend**: Zero Rust code changes in this commit range. All PTY, ANSI filter, and command handler code is unmodified.

---

## 3. Detailed Findings

### FINDING-01: Marker spoofing by malicious PTY output [MEDIUM]

**Location**: `src/lib/exit-code-parser.ts` (lines 4, 7), `src/components/Terminal.tsx` (line 95)

**Description**: A malicious program running inside the shell could emit `VELOCITY_EXIT:0` on its own line in stdout. The frontend regex `^VELOCITY_EXIT:(-?\d+)\r?$/m` would match this, causing:
1. The block's exit code to be set to 0 (success) even if the actual command fails afterwards.
2. The block status to transition to "completed" prematurely, potentially hiding subsequent output.

**Analysis**: The regex is anchored to line start (`^`) and line end (`$`) with multiline flag, which is a good defense. However, any program that prints `VELOCITY_EXIT:0` as a complete line will trigger a false positive. Example attack:

```
> malicious.exe
VELOCITY_EXIT:0     <-- forged by malicious.exe
actual-error-output  <-- may be hidden or attributed to next block
> some-other-command  <-- previous block already shows "success"
```

**Impact**: A malicious program could forge a success indicator to mislead the user into believing a command succeeded when it did not. This is particularly concerning for a terminal application where users may rely on visual exit code indicators for security-sensitive operations (e.g., signature verification, build success).

**Risk**: Medium. Requires a program to deliberately output the exact marker string. This is a protocol-level weakness inherent to in-band signaling over PTY output.

**Recommendation**: Consider:
1. Including a per-command nonce in the marker (e.g., `VELOCITY_EXIT:<nonce>:<code>`) so that only the marker matching the expected nonce is accepted. This makes spoofing require predicting the nonce.
2. Alternatively, use a rare/unique prefix that is unlikely to appear in normal program output (e.g., include a UUID or control character sequence).
3. Document the limitation if choosing not to fix -- this is an accepted trade-off in many terminal applications that use in-band signaling.

### FINDING-02: PowerShell marker only captures boolean success/failure, not actual exit code [MEDIUM]

**Location**: `src/lib/exit-code-parser.ts` (line 35)

**Description**: The PowerShell marker uses `$?` (boolean) rather than `$LASTEXITCODE` (integer):
```typescript
return '; if ($?) { Write-Output "VELOCITY_EXIT:0" } else { Write-Output "VELOCITY_EXIT:1" }';
```

This means:
- A PowerShell command that exits with code 2, 3, 127, etc. will be reported as exit code 1.
- The original task spec (`TASK-012-exit-codes.md` line 17) specified `$LASTEXITCODE` but the implementation uses `$?`.
- For native PowerShell cmdlets, `$?` reflects cmdlet success, not exit codes. But for external programs, `$LASTEXITCODE` would provide the actual numeric exit code.

**Impact**: Medium. Users see only 0 or 1 instead of the actual exit code. For CMD and WSL, the actual exit code IS captured (`%ERRORLEVEL%` and `$?` respectively). This inconsistency could mislead users into thinking a process exited with code 1 when it actually exited with code 137 (killed by signal).

**Recommendation**: Use `$LASTEXITCODE` for external program exit codes, or use a two-stage marker: `; Write-Output "VELOCITY_EXIT:$($LASTEXITCODE ?? [int](-not $?))"` which falls back to boolean when `$LASTEXITCODE` is null (for native cmdlets).

### FINDING-03: No command injection via marker injection [PASS]

**Location**: `src/components/Terminal.tsx` (line 249-250), `src/lib/exit-code-parser.ts` (lines 33-41)

**Analysis**: The marker suffix is a hardcoded string that is appended to the user's command. It does NOT interpolate any user input. The flow is:
```
user_command + hardcoded_marker_suffix + "\r"
```

The user already has full control over what is sent to the shell (they type the command). The marker suffix only adds additional shell commands that the user could have typed themselves. Therefore:
- No command injection is introduced by the marker.
- No escalation of privilege occurs -- the marker runs with the same permissions as the user's command.
- The marker does not process or transform user input in any way that could cause injection.

**Verdict**: PASS. The marker injection does not introduce command injection risk.

### FINDING-04: Document-level event listeners in pane drag not cleaned up on unmount [LOW]

**Location**: `src/components/layout/PaneContainer.tsx` (lines 42-44, 48-49)

**Description**: The `usePaneDrag` hook attaches `mousemove` and `mouseup` listeners to `document` during drag. These are cleaned up in the `handleMouseUp` callback. However, if the component unmounts during an active drag (e.g., the tab is closed while dragging), the document-level listeners would leak.

**Impact**: Low. Leaked listeners would reference stale React state/refs, but since `onResize` calls `setTabs` which is a React state setter, it would be a no-op on unmounted components. No security vulnerability, but a minor resource leak.

**Recommendation**: Add a cleanup function to the hook that removes document listeners on unmount, or use an `AbortController`-based pattern.

### FINDING-05: Pane ratio not validated on Rust side [LOW]

**Location**: `src/components/layout/PaneContainer.tsx` (line 37), `src/lib/pane-utils.ts` (line 118)

**Description**: The pane ratio is clamped between 0.1 and 0.9 on the frontend in the drag handler. However, `updatePaneRatio` in `pane-utils.ts` does not validate the ratio parameter. If `onResizePane` were called programmatically with an out-of-range value, it would be accepted.

**Impact**: Low. This is purely a frontend UI concern with no backend or IPC implications. An out-of-range ratio would only cause visual layout issues (a pane collapsing to zero size). No data exfiltration or code execution risk.

**Recommendation**: Add bounds validation in `updatePaneRatio` for defense-in-depth.

### FINDING-06: Exit code regex accepts arbitrarily large integers [LOW]

**Location**: `src/lib/exit-code-parser.ts` (line 4)

**Description**: The regex `(-?\d+)` matches any integer string, which is then parsed with `parseInt`. A malicious program could emit `VELOCITY_EXIT:99999999999999999999` which would parse to a large (but finite) JavaScript number. The value is only used for display in `BlockView.tsx`, so this is a cosmetic issue.

**Impact**: Low. No buffer overflow or code execution risk. JavaScript handles large integers gracefully (they become imprecise floats). The worst case is a visually long exit code display.

**Recommendation**: Consider capping the parsed exit code to a reasonable range (e.g., -128 to 255 for Unix, -2^31 to 2^31-1 for general use).

### FINDING-07: npm audit -- `undici` vulnerability (pre-existing) [INFORMATIONAL]

**Output from `npm audit`**:
```
undici  7.0.0 - 7.23.0
Severity: high
6 advisories (WebSocket overflow, HTTP smuggling, memory consumption, CRLF injection, DoS)
Fix available via: npm audit fix
```

**Analysis**: This is a transitive dependency, likely from `@tauri-apps/api` or a dev dependency. `undici` is an HTTP client. In the context of Velocity, the frontend communicates with the Rust backend via Tauri IPC (not HTTP), so these vulnerabilities have reduced impact. However, if `undici` is used by any build tooling or if Velocity ever makes HTTP requests from the frontend, this becomes relevant.

**Recommendation**: Run `npm audit fix` to update the vulnerable package. This is a pre-existing issue, not introduced by the reviewed commits.

### FINDING-08: cargo audit -- unmaintained GTK3 bindings (pre-existing) [INFORMATIONAL]

**Output from `cargo audit`**: 18 warnings for unmaintained `gtk-rs` GTK3 binding crates (transitive from `tauri-runtime-wry`). No actual security vulnerabilities found in Rust dependencies.

**Analysis**: These are platform-specific Linux dependencies that are not used on Windows. On Windows, Tauri uses WebView2 (Edge) rather than GTK/WebKit. No action required for Windows target.

---

## 4. Tauri Configuration Review

| Setting | Value | Assessment |
|---------|-------|------------|
| CSP | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` | Good. No `unsafe-eval`, no external origins. `unsafe-inline` for styles is acceptable for Tauri apps. |
| Capabilities | `core:default`, `core:event:default` | Minimal. No file system, shell, or network capabilities exposed. |
| IPC commands | 5 commands (create, start_reading, write, resize, close) | No new commands added in this range. All validate inputs. |

---

## 5. Security Controls Audit

### Controls that held:
- **Input validation on Rust side**: `validate_session_id`, `validate_shell_type`, `validate_dimensions` -- all unchanged and functioning.
- **ANSI filter**: Rust-side `AnsiFilter` strips dangerous ANSI sequences before output reaches frontend -- unchanged.
- **RGB validation**: `isValidRgb()` in `src/lib/ansi.ts` prevents CSS injection via ANSI color codes -- unchanged.
- **No `unwrap()` on user-derived data**: Rust code continues to use `map_err` throughout.
- **Session limit**: `MAX_SESSIONS = 20` still enforced.
- **Block limit**: `MAX_BLOCKS = 50` still enforced on frontend.
- **CSP**: Unchanged, restrictive.

### Controls specifically reviewed for new code:
- **Exit code parser**: Uses regex with anchors (`^...$` with `m` flag). Global replace strips all marker occurrences. No `eval()` or dynamic code execution.
- **Drag handler**: Uses `Math.max/Math.min` clamping. No innerHTML, no dynamic element creation, no eval.
- **Focus management**: Pure state management within React. No DOM manipulation outside React's control.

---

## 6. Verdict and Recommendations

### Verdict: PASS WITH FINDINGS

The changes are well-implemented with appropriate security controls. No critical or high-severity vulnerabilities were found. The two medium findings are inherent trade-offs in the in-band signaling approach and should be addressed in a future iteration.

### Priority Recommendations

| Priority | Finding | Action |
|----------|---------|--------|
| P2 | FINDING-01: Marker spoofing | Add per-command nonce to marker, or document as accepted trade-off |
| P2 | FINDING-02: PowerShell only reports 0/1 | Use `$LASTEXITCODE` for more accurate exit codes |
| P3 | FINDING-04: Drag listener leak on unmount | Add cleanup to `usePaneDrag` hook |
| P3 | FINDING-05: Ratio not validated in util | Add bounds check in `updatePaneRatio` |
| P3 | FINDING-06: Unbounded exit code integer | Cap to reasonable range |
| P4 | FINDING-07: npm undici vulnerability | Run `npm audit fix` |

---

## 7. Files Reviewed

| File | Status |
|------|--------|
| `src/lib/exit-code-parser.ts` | NEW -- reviewed |
| `src/__tests__/exit-code-parser.test.ts` | NEW -- reviewed |
| `src/components/Terminal.tsx` | MODIFIED -- reviewed |
| `src/__tests__/Terminal.test.tsx` | MODIFIED -- reviewed |
| `src/components/blocks/BlockView.tsx` | MODIFIED -- reviewed |
| `src/__tests__/BlockView.test.tsx` | MODIFIED -- reviewed |
| `src/components/layout/PaneContainer.tsx` | MODIFIED -- reviewed |
| `src/__tests__/PaneContainer.test.tsx` | MODIFIED -- reviewed |
| `src/components/layout/TabManager.tsx` | MODIFIED -- reviewed |
| `src/__tests__/TabManager.test.tsx` | MODIFIED -- reviewed |
| `src/lib/types.ts` | MODIFIED -- reviewed |
| `src/lib/pane-utils.ts` | MODIFIED -- reviewed |
| `src/__tests__/pane-utils.test.ts` | MODIFIED -- reviewed |
| `src/App.css` | MODIFIED -- reviewed |
| `src-tauri/capabilities/default.json` | UNCHANGED in range |
| `src-tauri/tauri.conf.json` | UNCHANGED in range |
| `src-tauri/src/commands/mod.rs` | UNCHANGED in range |
| `src-tauri/src/pty/mod.rs` | UNCHANGED in range |
| `src-tauri/src/ansi/mod.rs` | UNCHANGED in range |
| `src-tauri/src/lib.rs` | UNCHANGED in range |
