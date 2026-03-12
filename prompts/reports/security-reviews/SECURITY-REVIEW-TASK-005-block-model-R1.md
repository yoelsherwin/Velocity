# Security Review -- TASK-005: Block Model -- Command/Output Containers (R1)

## Scope

- **Commit range**: `4953590..5e6afb6`
- **Tasks covered**: TASK-005 (block model), FIX-005 (code review fixes -- tests, clipboard, dedup)
- **HEAD at time of review**: `5e6afb6`
- **Commits in range**:
  - `6db813d` feat: implement block model with command/output containers
  - `5e6afb6` fix: address code review findings for block model -- tests, clipboard, dedup

## Previous Review Status

- **R1 lifecycle/shells (`4953590`)**: M-1 (rapid switch race) still open. M-2 (stale listeners) still open. L-1 (buttons not disabled during switch) still open. L-2 (mount/unmount race) still open. L-3 (`Ordering::Relaxed`) still open. L-4 (session ID format) still open. L-5 (`unsafe-inline` in `style-src`) still open.

## Nature of Changes

**This is a frontend-only change.** No Rust code was modified. No new IPC commands were added. No capabilities were changed. No dependencies were added or changed. The `package.json`, `Cargo.toml`, `src-tauri/`, and `capabilities/default.json` are all identical to the previous review HEAD.

The changes introduce:
1. `Block` interface in `src/lib/types.ts` (data model)
2. `BlockView` component in `src/components/blocks/BlockView.tsx` (rendering)
3. Terminal refactored to manage `Block[]` instead of single `output` string
4. `stripAnsi` utility in `src/lib/ansi.ts` (for clipboard)
5. `crypto.randomUUID()` for block IDs
6. `navigator.clipboard.writeText()` for copy actions
7. Rerun action that re-submits a stored command
8. CSS styles for block containers

## Attack Surface Map

### New Files

| File | Purpose | Attack-relevant? |
|------|---------|-----------------|
| `src/components/blocks/BlockView.tsx` | Renders a single block (command header, output, action buttons) | YES -- renders untrusted PTY output, clipboard writes, rerun action |
| `src/__tests__/BlockView.test.tsx` | Tests for BlockView | No |
| `src/__tests__/blocks.test.ts` | Tests for Block type and stripAnsi | No |
| `prompts/tasks/TASK-005-block-model.md` | Task specification | No |

### Modified Files

| File | Change | Attack-relevant? |
|------|--------|-----------------|
| `src/components/Terminal.tsx` | Replaced single `output` string with `Block[]` state, active block tracking, rerun handler, MAX_BLOCKS cap | YES -- command submission, output routing, block lifecycle |
| `src/lib/types.ts` | Added `Block` interface | No -- type definition only |
| `src/lib/ansi.ts` | Added `stripAnsi` function | YES -- processes untrusted output for clipboard |
| `src/__tests__/Terminal.test.tsx` | Added block model integration tests | No |
| `src/App.css` | Block container styles | No |

### Unchanged (Verified)

- `src-tauri/src/**` -- Zero changes. ANSI filter, PTY engine, commands, lib.rs all unchanged.
- `src-tauri/capabilities/default.json` -- Unchanged. Permissions: `core:default`, `core:event:default`.
- `src-tauri/tauri.conf.json` -- Unchanged. CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`.
- `package.json` / `Cargo.toml` -- Zero dependency changes.

---

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

**M-1: Rerun action replays stored command without user confirmation**

- **Vector**: Command Replay / Accidental Execution
- **Location**: `src/components/blocks/BlockView.tsx:29-31` (`handleRerun`), `src/components/Terminal.tsx:194-199` (`handleRerun`)
- **Description**: The "Rerun" button in `BlockView` calls `onRerun(block.command)`, which directly calls `submitCommand(command)` in `Terminal.tsx`. This submits the stored command string to the active PTY session without any user confirmation dialog or preview. The command is sent exactly as stored, including the `\r` carriage return appended by `submitCommand` at line 181.

  **Attack scenario**: A malicious program running in the terminal could craft output that visually obscures the actual command text in a previous block (e.g., using long output to push the block header off-screen). If the user then clicks "Rerun" on a block whose actual command they do not remember or cannot see, they execute that command again blindly.

  More practically, this is a usability concern: a user may have run a destructive command (e.g., `rm -rf`, `format`, `Drop-Database`) and accidentally click Rerun without realizing which block they are acting on. Unlike typing a command (which requires the user to read what they type), Rerun bypasses that cognitive checkpoint.

  **Mitigating factors**:
  - The command text is displayed in the block header (`BlockView.tsx:48-50`) as plain text via React JSX (not `dangerouslySetInnerHTML`), so it cannot be visually spoofed via HTML injection.
  - The block header is visible when the user is hovering over the block (which is required to see the action buttons per the CSS hover behavior).
  - The command is stored in React state (not editable by the PTY output stream). A malicious process cannot modify the stored `block.command` value.

- **Recommended Fix**: For the MVP, consider adding a brief toast/confirmation or populating the input field with the command text instead of executing directly. Alternatively, this is acceptable as-is if the team explicitly accepts the risk (Warp and other block-based terminals have the same pattern).

- **Severity Justification**: Medium. The command text is visible in the block header and cannot be tampered with by PTY output, but the one-click execution pattern skips the cognitive checkpoint of reading a command before running it. Self-inflicted risk only (not remotely exploitable).

**M-2: Unbounded per-block output accumulation (memory exhaustion)**

- **Vector**: Denial of Service / Memory Exhaustion
- **Location**: `src/components/Terminal.tsx:64-68` (PTY output listener)
- **Description**: The PTY output listener appends `event.payload` to the active block's `output` string on every event:
  ```typescript
  b.id === activeBlockIdRef.current
    ? { ...b, output: b.output + event.payload }
    : b
  ```
  There is a `MAX_BLOCKS = 50` cap on the number of blocks, but there is no cap on the size of a single block's output. A single long-running command (e.g., `cat /dev/urandom | xxd`, `Get-Content -Path C:\huge.log`, or an infinite loop printing output) will accumulate unbounded output in the active block's `output` string.

  Since the output is stored as a React state string, each PTY output event creates a new string via concatenation. For high-throughput output:
  - Memory grows linearly with output size (no upper bound)
  - Each state update triggers re-render of the entire block list (due to `setBlocks` updating the array)
  - `AnsiOutput`'s `useMemo` on the active block will re-compute on every update (since `text` changes)
  - The browser tab can eventually crash with an out-of-memory error

  **Previous review (R1 TASK-004)** recommended: "Consider adding a per-block output limit in addition to the global 100KB cap." This recommendation was not implemented.

- **Exploit Scenario**: A user runs `yes` or `cat /dev/urandom` (or on Windows, a PowerShell infinite loop printing output). The active block's output grows without bound. After several hundred MB of accumulated string data, the browser process (WebView2) crashes or becomes unresponsive.

- **Recommended Fix**: Add a per-block output cap (e.g., 1MB or 5MB). When the cap is reached, either truncate the beginning of the output (ring-buffer style) or stop appending and show a "[Output truncated]" message. Example:
  ```typescript
  const MAX_BLOCK_OUTPUT = 1_000_000; // 1MB
  // In the output listener:
  const newOutput = b.output + event.payload;
  return { ...b, output: newOutput.length > MAX_BLOCK_OUTPUT
    ? newOutput.slice(-MAX_BLOCK_OUTPUT)
    : newOutput };
  ```

- **Severity Justification**: Medium. Self-inflicted DoS only. The attacker is the user (or a program the user chose to run). No remote exploitation possible. But it can crash the application, and users running `tail -f` or similar long-output commands is a common terminal workflow.

### LOW

**L-1: `stripAnsi` regex only strips SGR sequences -- correct but brittle**

- **Vector**: Defense-in-depth
- **Location**: `src/lib/ansi.ts:20`
- **Description**: The `stripAnsi` function uses the regex `/\x1b\[[0-9;]*m/g` to strip ANSI escape sequences from text before clipboard copying. This regex only matches SGR (Select Graphic Rendition) sequences -- the `\x1b[...m` pattern. The function comment correctly states: "Only strips SGR sequences -- the only kind our Rust filter allows through."

  This is currently correct because the Rust `AnsiFilter` (`src-tauri/src/ansi/mod.rs`) strips all non-SGR escape sequences. However, this creates a tight coupling: if the Rust filter is ever relaxed to allow additional escape types (e.g., cursor movement for a future full terminal emulator), the `stripAnsi` function would silently fail to strip those sequences from clipboard content.

  The defense-in-depth concern is that clipboard content could contain escape sequences that, when pasted into another terminal or application, trigger unintended behavior (clipboard injection attacks). Currently, only SGR sequences can reach the clipboard, and SGR sequences are benign when pasted.

- **Recommended Fix**: Consider using a more comprehensive ANSI stripping regex (e.g., `/\x1b\[[0-9;]*[A-Za-z]/g`) or a library like `strip-ansi` for future-proofing. Alternatively, document the coupling explicitly so future changes to the Rust filter trigger a review of `stripAnsi`.

- **Severity Justification**: Low. Currently correct. Risk is only future regression if the Rust filter scope changes.

**L-2: Command text rendered as text node but not length-bounded**

- **Vector**: UI Spoofing / DoS
- **Location**: `src/components/blocks/BlockView.tsx:48-50`
- **Description**: The block header renders the command text directly:
  ```tsx
  <span className="block-command">{block.command}</span>
  ```
  This is safe from XSS (React escapes text nodes). However, there is no length limit on the command text displayed. A very long command (e.g., a multi-KB command pasted into the input) will render as an extremely long, potentially overflowing header. This is a UI issue, not a security vulnerability, but could be used to push other blocks' headers off-screen to make a Rerun attack (M-1) slightly more plausible.

- **Recommended Fix**: Apply CSS `overflow: hidden; text-overflow: ellipsis` on `.block-command`, or truncate the display text with a "show more" toggle for commands exceeding a threshold (e.g., 500 characters).

- **Severity Justification**: Low. UI cosmetic issue. The command is still stored correctly and used faithfully for Rerun/Copy.

**L-3: Clipboard write errors silently swallowed**

- **Vector**: Usability / Silent Failure
- **Location**: `src/components/blocks/BlockView.tsx:18-20` (`handleCopyCommand`), `src/components/blocks/BlockView.tsx:23-26` (`handleCopyOutput`)
- **Description**: Both clipboard write operations use `.catch(() => {})` to silently ignore errors. The `navigator.clipboard.writeText()` API can fail if:
  - The document does not have focus
  - The Permissions Policy blocks clipboard access
  - The browser/WebView denies the permission

  The user receives no visual feedback when the copy operation fails. They may believe the clipboard contains the command/output when it does not.

- **Recommended Fix**: Add a brief visual indicator (e.g., button text changes to "Copied!" on success or "Failed" on error for 1-2 seconds). This is a UX improvement, not a security fix.

- **Severity Justification**: Low. No security impact. Usability concern only.

**L-4: `crypto.randomUUID()` availability not checked**

- **Vector**: Defense-in-depth
- **Location**: `src/components/Terminal.tsx:17`
- **Description**: Block IDs are generated via `crypto.randomUUID()`. This is available in all modern browsers and in Tauri's WebView2. However, `crypto.randomUUID()` requires a secure context (HTTPS or localhost). The Tauri dev server runs on `http://localhost:1420` (secure context by localhost exception), and the production build loads from `tauri://` (secure context). So this works in both environments.

  No fallback is provided. If `crypto.randomUUID()` were unavailable, the app would throw at runtime when creating a block. This is acceptable because the environments where it would be unavailable (non-secure HTTP contexts in legacy browsers) are not Velocity's target platform.

- **Recommended Fix**: None needed. Document the WebView2 requirement if not already documented.

- **Severity Justification**: Low. Non-issue in practice. Included for completeness.

---

## Detailed Audit by Attack Vector

### 1. XSS / HTML Injection -- PASS

**Block command rendering** (`BlockView.tsx:48-50`):
```tsx
<span className="block-command">{block.command}</span>
```
The command is rendered as a React text node via JSX interpolation. React automatically escapes HTML entities. A command like `<script>alert(1)</script>` would render as literal text, not as executable HTML. **No XSS vector.**

**Block output rendering** (`BlockView.tsx:56-58`):
```tsx
<pre className="block-output" data-testid="block-output">
  <AnsiOutput text={block.output} />
</pre>
```
The output is rendered through `AnsiOutput` (`src/components/AnsiOutput.tsx`), which:
1. Parses the text with `Anser.ansiToJson()` -- this returns a JSON array of objects with `content`, `fg`, `bg`, `decorations` properties. Anser's `ansiToJson` method does NOT produce HTML strings.
2. Maps each entry to a `<span>` element with inline styles (`color`, `backgroundColor`, `fontWeight`, etc.) and the `content` as a text node.
3. The `content` is rendered via JSX interpolation: `{span.content}` -- React escapes it.

**Critical check**: Anser is called with `{ use_classes: false, remove_empty: true }`. The `use_classes: false` option means Anser returns inline RGB color values, not CSS class names. This is the safe mode -- `ansiToHtml()` would produce raw HTML strings, but `ansiToJson()` returns structured data. The code never calls `ansiToHtml()`. **No XSS vector.**

**No `dangerouslySetInnerHTML`** used anywhere in the codebase (verified via grep). **No `innerHTML`** assignments (verified via grep).

**Timestamp rendering** (`BlockView.tsx:52`):
```tsx
<span className="block-timestamp">{formattedTime}</span>
```
`formattedTime` is derived from `new Date(block.timestamp).toLocaleTimeString()` where `block.timestamp` is `Date.now()` (a number set by the frontend). Not user-controlled. **No XSS vector.**

### 2. Clipboard Security -- PASS

**Clipboard write API**:
- Uses `navigator.clipboard.writeText()` (modern async Clipboard API). This is the recommended approach -- not `document.execCommand('copy')`.
- Only writes plain text (not HTML or rich content). No clipboard HTML injection possible.
- The `stripAnsi` function removes SGR sequences before writing to clipboard via "Copy Output", so pasting the output into another terminal won't replay color codes.

**Clipboard read**: Not used. The application never reads from the clipboard.

**CSP considerations**: The CSP does not need modification for `navigator.clipboard.writeText()` -- it's a browser API, not a script source.

### 3. Rerun Action Security -- PASS (with caveat M-1)

**Rerun flow**:
1. User clicks "Rerun" button on a block
2. `BlockView.tsx:29-31`: calls `onRerun(block.command)` with the stored command string
3. `Terminal.tsx:194-199`: `handleRerun` calls `submitCommand(command)`
4. `Terminal.tsx:164-192`: `submitCommand` creates a new block, sets it as active, calls `writeToSession(sessionId, command + '\r')`
5. `writeToSession` sends the command to the Rust backend via IPC (`invoke('write_to_session', ...)`)
6. Rust writes the command bytes to the PTY writer

**Security analysis**:
- The command string is stored in React state when the user originally typed it. It cannot be modified by PTY output (the output stream writes to `block.output`, not `block.command`).
- A malicious PTY program cannot alter stored block commands. The command is frozen at the time of submission.
- The rerun sends the command through the same IPC path as a normal command submission. No new IPC commands are used.
- The `\r` carriage return is appended by `submitCommand`, same as a normal Enter keypress.
- No command injection: the command is sent as raw bytes to the PTY, not interpolated into a shell invocation.

**Caveat**: See M-1 regarding user confirmation.

### 4. Output Rendering Security -- PASS

**Data flow**:
```
PTY process -> Rust reader thread -> AnsiFilter (vte parser) -> pty:output event -> React state -> AnsiOutput component -> DOM
```

The output rendering pipeline is unchanged from the previous review:
1. Raw PTY bytes are filtered by the Rust `AnsiFilter` (only SGR sequences and safe C0 controls pass through)
2. Filtered output is emitted as a Tauri event (`pty:output:{sid}`)
3. The frontend appends the event payload to `block.output` (previously appended to the single `output` string)
4. `AnsiOutput` parses the text with `Anser.ansiToJson()` and renders as `<span>` elements

**The change**: Output now accumulates per-block instead of in a single global string. The security properties are identical -- the same `AnsiOutput` component renders the same filtered text. No new rendering path was introduced.

### 5. Block ID Security -- PASS

Block IDs are generated via `crypto.randomUUID()` (`Terminal.tsx:17`). These IDs are used:
- As React `key` props for block rendering
- As the `activeBlockIdRef` to track which block receives output
- In CSS class toggling (`block-active`)

Block IDs are frontend-internal only. They are never sent to the Rust backend. They are not used in any security-critical decision. Even if they were predictable (which they are not -- `crypto.randomUUID()` is cryptographically random), no attack surface exists because:
- The IDs are not exposed to the PTY process
- The IDs are not used in IPC calls
- The IDs cannot influence command execution

### 6. Command Injection -- N/A

No changes to command construction. The Rerun action sends the same command text through `writeToSession`, which writes raw bytes to the PTY. No shell interpolation occurs.

### 7. IPC Surface -- N/A

No new IPC commands. No changes to `capabilities/default.json`. The Rerun action uses the existing `writeToSession` IPC command.

### 8. Denial of Service -- CONCERN (M-2)

The `MAX_BLOCKS = 50` cap limits the number of blocks. However, per-block output is unbounded (see M-2). The previous review's recommendation to add a per-block output limit was not implemented.

### 9. Cross-Session Data Leakage -- N/A

No changes to session management. The same session lifecycle (M-1, M-2 from R1 TASK-004) applies. Block state is cleared on session restart/switch (`Terminal.tsx:112`: `setBlocks([])`).

### 10. Information Leakage via Clipboard -- PASS

The "Copy Output" action strips ANSI via `stripAnsi` before writing to clipboard. The "Copy Command" action writes the user's own command text. No sensitive data is exposed beyond what the user intentionally copies.

---

## Tauri Configuration Review

| Check | Status | Notes |
|-------|--------|-------|
| Command permissions are minimal | PASS | `core:default`, `core:event:default` only. Unchanged. |
| No overly broad file system access | PASS | No `fs:` permissions |
| CSP is configured | PASS | `unsafe-inline` in `style-src` remains (L-5/R3, accepted risk) |
| No unnecessary capabilities | PASS | Unchanged from previous review |
| Window creation is restricted | PASS | Single window `"main"` |
| Custom IPC commands | PASS | 4 commands, unchanged from R1 TASK-004 |
| No new IPC commands | PASS | Verified: `lib.rs` unchanged in this commit range |
| No new capabilities | PASS | `capabilities/default.json` unchanged |

---

## Unsafe Code Review

**No `unsafe` blocks in Velocity application code.** The only match for "unsafe" in `src-tauri/src/` is the test function name `test_mixed_safe_and_unsafe` in `ansi/mod.rs:226` -- a test name, not unsafe Rust code. Unchanged.

**No `unwrap()` calls on user-derived data.** Unchanged.

**No `dangerouslySetInnerHTML`** in any React component. Verified via grep across `src/`.

**No `innerHTML`** assignments. Verified via grep across `src/`.

---

## Dependency Audit

### npm audit

```
found 0 vulnerabilities
```

No new npm dependencies in this commit range. `package.json` dependencies unchanged from previous review HEAD (`4953590`). The `anser` library (v2.3.5) was added in TASK-003 and reviewed in that security review.

### Rust dependencies

No changes to `Cargo.toml`. No new Rust dependencies.

---

## Test Coverage Review (Security-Relevant)

| Test | File | What it validates |
|------|------|-------------------|
| `test_stripAnsi_removes_sgr` | `blocks.test.ts:30-33` | SGR stripping for clipboard |
| `test_stripAnsi_preserves_plain_text` | `blocks.test.ts:35-38` | No false positives in stripping |
| `test_stripAnsi_handles_empty` | `blocks.test.ts:40-43` | Edge case handling |
| `test_BlockView_copy_command_button` | `BlockView.test.tsx:73-78` | Clipboard writes correct value |
| `test_BlockView_rerun_calls_handler` | `BlockView.test.tsx:80-85` | Rerun passes correct command |
| `test_blocks_limited_to_max` | `Terminal.test.tsx:329-332` | MAX_BLOCKS constant = 50 |
| `test_AnsiOutput_renders_colored_span` | `AnsiOutput.test.tsx:22-32` | ANSI rendering produces styled spans (not raw HTML) |

**Missing security-relevant tests**:
- No test for `stripAnsi` with complex/nested SGR sequences (e.g., `\x1b[1;31;42m`)
- No test for Rerun with empty command (edge case: welcome block has `command: ''`)
- No test for MAX_BLOCKS enforcement during actual block creation (only the constant value is tested)
- No test for very long command text in block header
- No test for very large output in a single block (memory behavior)

These are not blocking findings, but improving test coverage would strengthen confidence.

---

## Previous Finding Resolution

| Finding | Status | Notes |
|---------|--------|-------|
| M-1 (R1 T004): Rapid switch race | OPEN | Not addressed in this commit range |
| M-2 (R1 T004): Stale listener ordering | OPEN | Not addressed in this commit range |
| L-1 (R1 T004): Buttons not disabled during switch | OPEN | Not addressed |
| L-2 (R1 T004): Mount/unmount race | OPEN | Not addressed |
| L-3 (carried): `Ordering::Relaxed` | OPEN | No Rust changes |
| L-4 (carried): Session ID format validation | OPEN | No Rust changes |
| L-5 (carried): `unsafe-inline` in `style-src` | OPEN (accepted) | Unchanged |
| M-1 (R1 T003): Color string validation in Anser | OPEN | No changes to AnsiOutput |
| H-1 (R1 T002): Full env inherited by shells | OPEN (accepted) | Inherent to terminal emulators |
| Recommendation: Per-block output limit | NOT IMPLEMENTED | See new M-2 |

---

## Summary of New Findings

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| M-1 | MEDIUM | Rerun action replays command without user confirmation | `BlockView.tsx:29-31`, `Terminal.tsx:194-199` |
| M-2 | MEDIUM | Unbounded per-block output accumulation (memory exhaustion) | `Terminal.tsx:64-68` |
| L-1 | LOW | `stripAnsi` regex only strips SGR -- correct but tightly coupled to Rust filter | `ansi.ts:20` |
| L-2 | LOW | Command text in block header not length-bounded | `BlockView.tsx:48-50` |
| L-3 | LOW | Clipboard write errors silently swallowed | `BlockView.tsx:18-20, 23-26` |
| L-4 | LOW | `crypto.randomUUID()` availability not checked (non-issue in practice) | `Terminal.tsx:17` |

---

## Overall Risk Assessment

### Current State: **LOW RISK**

This is a frontend-only change with no new IPC surface, no new capabilities, no new dependencies, and no Rust modifications. The attack surface increase is minimal.

**Strengths:**
- **No XSS vectors**: All rendering uses React JSX text interpolation. No `dangerouslySetInnerHTML`, no `innerHTML`, no `document.write`. The Anser library is used in JSON mode (`ansiToJson`), not HTML mode (`ansiToHtml`).
- **ANSI filter pipeline intact**: Block output flows through the same `AnsiOutput` component that was validated in previous reviews. The Rust `AnsiFilter` still strips all dangerous escape sequences before they reach the frontend.
- **Clipboard API is modern and safe**: `navigator.clipboard.writeText()` with plain text only. ANSI codes stripped before clipboard write.
- **Block commands are immutable**: Stored in React state at submission time. PTY output cannot modify stored commands. Rerun uses the original, untampered command.
- **Block IDs are cryptographically random**: `crypto.randomUUID()` is non-guessable and frontend-internal only.
- **Block count is bounded**: `MAX_BLOCKS = 50` prevents unbounded block accumulation.
- **No new Rust code, no new IPC commands, no new capabilities**: Zero backend attack surface change.
- **39 tests passing**: Good coverage of block rendering, clipboard, rerun, and integration.

**Weaknesses:**
- Per-block output is unbounded (M-2) -- can lead to memory exhaustion on high-throughput commands
- Rerun action lacks confirmation (M-1) -- acceptable if risk is acknowledged (industry standard for block terminals)
- Several carried-forward findings from previous reviews remain open (rapid switch race, stale listeners, etc.)

### Risk Trajectory

Security posture is **stable** from the previous milestone. The block model is a pure UI refactor that does not introduce new trust boundaries, IPC commands, or rendering modes. The two medium findings are both self-inflicted (user-initiated) and not remotely exploitable.

### Recommendations for Next Task

Before implementing Pillar 2 features (Decoupled Input Editor):
- [ ] **Implement per-block output cap** (M-2) -- 1MB or 5MB with truncation indicator
- [ ] **Decide on Rerun UX** (M-1) -- either accept the one-click pattern (document the decision) or add input pre-population
- [ ] **Add CSS overflow handling** for long commands (L-2)
- [ ] **Fix rapid switch race** (M-1/R1 T004) -- still open from previous review
- [ ] **Fix stale listener ordering** (M-2/R1 T004) -- still open from previous review

---

**Reviewed by**: Security Review Agent
**Review date**: 2026-03-12
**Verdict**: **PASS** -- No blocking issues. Two medium findings (M-1: rerun confirmation, M-2: unbounded block output) are recommended for the next fix pass but do not represent exploitable vulnerabilities in the current threat model (single-user local desktop application). The block model correctly reuses the existing ANSI security filter pipeline, renders all content via safe React JSX patterns, and introduces no new IPC or capability surface. The `MAX_BLOCKS = 50` cap provides a baseline DoS mitigation. No XSS vectors were identified.
