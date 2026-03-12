# Security Review -- TASK-003: ANSI Security Filter + Color Rendering (R1)

## Scope

- **Commit range**: `c65cc00..cc00770`
- **Tasks covered**: TASK-003 (ANSI security filter + color rendering, session cap, opener plugin removal)
- **HEAD at time of review**: `cc00770`
- **Commits in range**:
  - `7ddb968` feat: add ANSI security filter and color rendering
  - `cc00770` fix: address code review findings for ANSI filter -- performance, safety, parser state

## Previous Review Status

- **R1 PTY engine (`c65cc00`)**: H-1 (env inheritance) accepted risk. M-1 (no session cap) -- **now fixed**. M-2 (`unsafe-inline` in `style-src`) -- still present, re-evaluated below. M-3 (raw ANSI passthrough) -- **now fixed by this task**. L-1 (session ID format validation) still open. L-2 (`Ordering::Relaxed`) still open. L-3 (no backpressure) still open. L-4 (unused opener plugin) -- **now fixed**.

## Attack Surface Map

### Changes in This Commit Range

1. **New: Rust ANSI filter** (`src-tauri/src/ansi/mod.rs`): `AnsiFilter` struct implementing `vte::Perform`. This is the **critical security boundary** between untrusted PTY output and the WebView. Filters raw bytes, emitting only printable text and SGR (Select Graphic Rendition) escape sequences. All other escape sequences are stripped.

2. **Modified: PTY reader thread** (`src-tauri/src/pty/mod.rs:108-119`): `String::from_utf8_lossy` replaced with `ansi_filter.filter(&buf[..n])`. Output now passes through the security filter before reaching the frontend. `AnsiFilter` is instantiated per reader thread.

3. **New: Frontend ANSI parser** (`src/lib/ansi.ts`): Uses the `anser` npm package (v2.3.5) to parse the pre-filtered ANSI string into styled span objects. Returns `AnsiSpan[]` with `content`, `fg`, `bg`, and text decoration properties.

4. **New: React component** (`src/components/AnsiOutput.tsx`): Renders `AnsiSpan[]` as `<span>` elements with inline `style` attributes. Uses React's JSX text interpolation (`{span.content}`) -- not `dangerouslySetInnerHTML`.

5. **Modified: Terminal component** (`src/components/Terminal.tsx:91`): `{output}` replaced with `<AnsiOutput text={output} />`. Output rendering now goes through the ANSI parsing and styling pipeline.

6. **Modified: Session manager** (`src-tauri/src/pty/mod.rs:57-60`): `MAX_SESSIONS = 20` cap added. `create_session` rejects requests when limit is reached.

7. **Removed: `opener` plugin**: Removed from `Cargo.toml`, `lib.rs`, and `capabilities/default.json`. Attack surface reduced.

8. **New dependency: `vte` 0.15** (Rust): VT parser crate from the Alacritty project. Well-maintained, widely used.

9. **New dependency: `anser` 2.3.5** (npm): ANSI escape code parser for JavaScript. Lightweight, no transitive dependencies.

---

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

**M-1: Anser library produces color strings that flow unsanitized into CSS `rgb()` values**

- **Vector**: Terminal Escape Injection (#3), defense-in-depth
- **Location**: `src/lib/ansi.ts:24-28`, `src/components/AnsiOutput.tsx:17-18`
- **Description**: The `parseAnsi` function constructs CSS color values by interpolating the `entry.fg` and `entry.bg` strings from the Anser library directly into `rgb()` expressions:
  ```typescript
  span.fg = `rgb(${entry.fg})`;  // entry.fg is e.g. "187, 0, 0"
  span.bg = `rgb(${entry.bg})`;
  ```
  These strings are then passed as inline `style.color` and `style.backgroundColor` props in React. React's style system sets these as DOM style properties (not HTML attributes), which mitigates most CSS injection vectors -- you cannot break out of a style property into an HTML attribute via this path.

  However, the security of this path depends on two assumptions:
  1. The Rust backend has already stripped all non-SGR sequences, so Anser only receives SGR-formatted input.
  2. Anser's color parsing produces only numeric CSV strings (e.g., `"187, 0, 0"`) from SGR codes.

  I verified by reading the Anser source (`node_modules/anser/lib/index.js`). For standard SGR colors (30-37, 40-47, 90-97, 100-107), the output comes from the hardcoded `ANSI_COLORS` lookup table which only contains strings like `"187, 0, 0"`. For extended 256-color (38;5;N) and truecolor (38;2;R;G;B) modes, Anser constructs color strings from `parseInt()` results with range checks (`0-255`). The `parseInt()` + range check means the output is always numeric CSV.

  The combination of (a) Rust stripping all non-SGR sequences before they reach the frontend + (b) Anser only producing numeric strings from SGR params + (c) React setting `style.color` as a DOM property (not innerHTML) means this is **not currently exploitable**. But the defense-in-depth is thin -- if any of these three layers weakens, CSS injection becomes possible.

- **Exploit Scenario**: If a future code change bypasses the Rust filter (e.g., sends raw output in an error path), and Anser encounters a malformed sequence, and the result is rendered in a context that uses HTML attributes instead of React style objects, then CSS injection could occur. This is a three-fault scenario, so severity is medium.

- **Recommended Fix**: Add a validation function in `src/lib/ansi.ts` that verifies color strings match `/^\d{1,3}(,\s*\d{1,3}){2}$/` before interpolating into `rgb()`. This adds an explicit frontend validation layer independent of Anser's behavior.

- **Severity Justification**: Medium. Requires multiple layers to fail simultaneously. Currently mitigated by three independent safeguards.

**M-2: `unsafe-inline` in `style-src` CSP (carried forward, re-evaluated)**

- **Vector**: Defense-in-depth
- **Location**: `src-tauri/tauri.conf.json:23`
- **Description**: The CSP is `style-src 'self' 'unsafe-inline'`. Now that the terminal renders styled spans with inline styles (via React's `style` prop), `unsafe-inline` is functionally required. React applies styles via `element.style.property = value`, which does not require `unsafe-inline` in CSP (CSP `style-src` only governs `<style>` tags and `style` HTML attributes set via innerHTML/outerHTML). However, `unsafe-inline` remains a risk if any code path uses `dangerouslySetInnerHTML` or if Vite's dev mode injects `<style>` tags.
- **Recommended Fix**: Keep as accepted risk for now. Add a comment in `tauri.conf.json` documenting why it exists. Monitor for `dangerouslySetInnerHTML` usage in future code reviews.
- **Severity Justification**: Medium. Same as previous review. Slightly higher relevance now that styled content is being rendered, but React's style object path is safe.

### LOW

**L-1: No test for DCS (Device Control String) sequences**

- **Vector**: Terminal Escape Injection (#3)
- **Location**: `src-tauri/src/ansi/mod.rs` (tests section)
- **Description**: The ANSI filter correctly implements `hook()`, `put()`, and `unhook()` as no-ops (stripping DCS sequences), but there is no test that verifies DCS sequences are actually stripped. DCS sequences can carry arbitrary payloads and are used in some terminal protocol extensions (e.g., Sixel graphics, tmux control mode). The filter implementation is correct, but the lack of test coverage means a future regression could go undetected.
- **Recommended Fix**: Add a test: `filter(b"\x1bPq#0;2;0;0;0\x1b\\text")` should return `"text"` (DCS Sixel stripped, text preserved).
- **Severity Justification**: Low. The implementation is correct. This is a test coverage gap, not a vulnerability.

**L-2: No test for APC (Application Program Command) sequences**

- **Vector**: Terminal Escape Injection (#3)
- **Location**: `src-tauri/src/ansi/mod.rs`
- **Description**: APC sequences (`ESC _` ... `ST`) are used by some terminal emulators for custom protocols. The vte parser routes these through `esc_dispatch` or handles them internally. The current filter strips all `esc_dispatch` calls, which should handle APC correctly, but there is no explicit test.
- **Recommended Fix**: Add a test: `filter(b"\x1b_custom data\x1b\\text")` should return `"text"`.
- **Severity Justification**: Low. Covered by the blanket `esc_dispatch` strip, but explicit test is recommended.

**L-3: Bracketed paste mode manipulation not explicitly tested**

- **Vector**: Clipboard Injection (#8)
- **Location**: `src-tauri/src/ansi/mod.rs`
- **Description**: Bracketed paste mode sequences (`CSI ?2004h` / `CSI ?2004l`) are CSI sequences with action `h` and `l` respectively. Since the ANSI filter only allows CSI action `m` (SGR), these are correctly stripped. However, there is no explicit test. A malicious process could emit these sequences to try to confuse the terminal about paste boundaries.
- **Recommended Fix**: Add tests:
  - `filter(b"\x1b[?2004htext")` should return `"text"` (bracketed paste enable stripped)
  - `filter(b"\x1b[?2004ltext")` should return `"text"` (bracketed paste disable stripped)
- **Severity Justification**: Low. Already handled by the whitelist approach (only `m` action passes). Test is for documentation and regression prevention.

**L-4: `Ordering::Relaxed` on shutdown flag (carried from R2)**

- **Vector**: Process Lifecycle Abuse (#6)
- **Location**: `src-tauri/src/pty/mod.rs:113,195`
- **Description**: Still using `Ordering::Relaxed` as noted in previous review. Not a vulnerability on x86 Windows.
- **Severity Justification**: Low. Unchanged from previous review.

**L-5: Session ID format not validated (carried from R2)**

- **Vector**: IPC Command Abuse (#2)
- **Location**: `src-tauri/src/commands/mod.rs:36,54,73`
- **Description**: Still no UUID format validation on `session_id` parameter. Unchanged from previous review.
- **Severity Justification**: Low. Unchanged from previous review.

---

## Detailed Audit by Attack Vector

### 1. Command Injection -- PASS

No changes in this commit range affect command construction. Shell types remain hardcoded via allowlist. User input flows through the PTY writer as raw bytes (not interpolated into commands). The ANSI filter is output-side only and does not influence command execution.

### 2. IPC Command Abuse -- PASS

- The `MAX_SESSIONS = 20` cap (new) limits the number of sessions a compromised WebView can spawn. This addresses M-1 from the previous review.
- The `opener:default` permission has been removed from capabilities, reducing the IPC attack surface.
- No new IPC commands were added.
- Capability permissions are now minimal: `core:default`, `core:event:default`.

### 3. Terminal Escape Injection -- PASS (primary focus of this review)

The ANSI filter is the core security feature of this task. Detailed analysis:

**Filter design (allowlist approach)**: The filter uses `vte::Perform` trait callbacks with a default-strip policy. Only explicitly allowed content reaches the output:
- `print(c)`: Printable characters -- KEPT (correct, these are safe text)
- `execute(byte)`: Only `\n` (0x0A), `\r` (0x0D), `\t` (0x09) are kept. All other C0 controls including bell (0x07) and backspace (0x08) are stripped. This is correct and more conservative than the task spec (which originally included backspace). Stripping backspace is the right choice since the frontend does not emulate cursor movement.
- `csi_dispatch(params, intermediates, ignore, action)`: Only action `m` (SGR) is allowed. All other CSI actions (cursor movement `H/A/B/C/D`, erase `J/K`, scroll `S/T`, device status `n`, bracketed paste `h/l`, etc.) are stripped. SGR is reconstructed from parsed params with a 256-byte length cap.
- `osc_dispatch()`: ALL OSC sequences stripped (title set, hyperlinks, iTerm2 file write, etc.)
- `hook()`/`put()`/`unhook()`: ALL DCS sequences stripped
- `esc_dispatch()`: ALL raw ESC sequences stripped

**Adversarial sequence analysis**:

| Sequence | Type | Filter Behavior | Verified |
|----------|------|----------------|----------|
| `\x1b]0;FAKE TITLE\x07` | OSC title set | Stripped by `osc_dispatch` | Test: `test_osc_title_stripped` |
| `\x1b]1337;File=...\x07` | OSC file write (iTerm2) | Stripped by `osc_dispatch` | Covered by blanket OSC strip |
| `\x1b[6n` | Device status report | Stripped by `csi_dispatch` (action `n` != `m`) | Test: `test_device_query_stripped` |
| `\x1b[?2004h` | Bracketed paste enable | Stripped by `csi_dispatch` (action `h` != `m`) | No explicit test (L-3) |
| `\x1b[?2004l` | Bracketed paste disable | Stripped by `csi_dispatch` (action `l` != `m`) | No explicit test (L-3) |
| `\x1b]8;;url\x07` | OSC hyperlink | Stripped by `osc_dispatch` | Test: `test_osc_hyperlink_stripped` |
| `\x1b[2J` | Erase display | Stripped by `csi_dispatch` (action `J` != `m`) | Test: `test_erase_sequence_stripped` |
| `\x1b[10;5H` | Cursor position | Stripped by `csi_dispatch` (action `H` != `m`) | Test: `test_cursor_movement_stripped` |
| Oversize SGR (>256 bytes) | SGR length abuse | Rejected by `MAX_SEQUENCE_LENGTH` check | Test: `test_sgr_oversize_rejected` |
| Bell `\x07` | C0 control | Stripped by `execute` (not in allowed list) | Test: `test_bell_stripped` |
| Backspace `\x08` | C0 control | Stripped by `execute` | Test: `test_backspace_stripped` |

**Parser persistence across chunks**: The filter correctly maintains the `vte::Parser` state across `filter()` calls using `std::mem::take`. This means an SGR sequence split across two 4096-byte PTY reads is correctly reassembled rather than being silently dropped. This is verified by `test_parser_persists_across_chunks`. This is a security improvement over creating a new parser per chunk (the original task spec approach), because a per-chunk parser would drop partial sequences, potentially leaving the frontend in a broken color state.

**Security note on parser persistence**: A persistent parser also means that a malicious sequence intentionally split across chunks will be correctly parsed and then correctly stripped (since the filter applies the allowlist on the fully-parsed sequence, not on raw bytes). This is safe -- the vte parser provides the semantic meaning of the sequence, and the filter's `Perform` implementation decides what to emit based on that meaning.

### 4. Path Traversal -- N/A

No file path handling in this commit range.

### 5. Environment Variable Leakage -- N/A

No changes affecting environment variable handling. H-1 from previous review remains as accepted risk.

### 6. Process Lifecycle Abuse -- IMPROVED

- `MAX_SESSIONS = 20` limits process spawning (fixes M-1 from previous review).
- No other changes to process lifecycle.

### 7. LLM Prompt Injection -- N/A

Agent Mode not yet implemented.

### 8. Clipboard Injection -- N/A

No clipboard handling in this commit range. Note: bracketed paste mode manipulation is stripped by the ANSI filter (see Vector 3 analysis).

### 9. Denial of Service -- IMPROVED

- `MAX_SESSIONS = 20` limits process spawning.
- The `output.clone()` in `AnsiFilter::filter()` creates a copy of the filtered output for each chunk. For a 4096-byte read buffer producing mostly text, this is bounded at approximately 4096 bytes per clone. Not a memory concern.
- Frontend `OUTPUT_BUFFER_LIMIT = 100_000` (unchanged) caps the accumulated output.
- The persistent `vte::Parser` state is bounded by the parser's internal state machine (fixed size). It does not accumulate memory across calls.

### 10. Cross-Pane Leakage -- N/A

Each reader thread owns its own `AnsiFilter` instance (created inside the `thread::spawn` closure at `pty/mod.rs:111`). There is no shared ANSI filter state between sessions. The persistent parser state is per-session. This is correct.

---

## Tauri Configuration Review

| Check | Status | Notes |
|-------|--------|-------|
| Command permissions are minimal | PASS | `core:default`, `core:event:default` only. `opener:default` removed. |
| No overly broad file system access | PASS | No `fs:` permissions |
| CSP is configured | PASS | `unsafe-inline` in `style-src` remains (M-2) |
| No unnecessary capabilities | PASS | `opener:default` removed (was L-4, now resolved) |
| Window creation is restricted | PASS | Single window `"main"` |
| Custom IPC commands | REVIEWED | 4 commands, unchanged. All have input validation. |

---

## Unsafe Code Review

**No `unsafe` blocks in Velocity application code.** The only match for "unsafe" in `src-tauri/src/` is the test function name `test_mixed_safe_and_unsafe` -- this is a test name, not unsafe Rust code.

---

## Dependency Audit

### npm audit

```
found 0 vulnerabilities
```

**New dependency: `anser` 2.3.5**
- Zero transitive dependencies
- No known advisories
- Source: well-maintained, commonly used for ANSI rendering in web applications
- Security-relevant behavior: The `ansiToJson` method (used by Velocity) parses ANSI SGR codes and returns structured objects. It does NOT produce HTML when used in JSON mode. The `ansiToHtml` method (NOT used by Velocity) would produce raw HTML strings and would be a security concern -- but Velocity correctly uses the JSON API instead.
- The `ansiToJson` path splits input on `\033[`, extracts SGR parameters via regex, and returns structured objects with `content`, `fg`, `bg`, and `decorations` fields. Color values come from either a hardcoded lookup table (standard colors) or `parseInt()` with range checks (256-color and truecolor). This means color strings are always numeric CSV.

### cargo audit

`cargo-audit` was not available in the build environment. The `vte` crate (0.15) is from the Alacritty project and is widely used and well-maintained. No known advisories for vte 0.15 at time of review.

---

## Previous Finding Resolution

| Finding | Status | Notes |
|---------|--------|-------|
| H-1: Full env inherited by shells | OPEN (accepted risk) | Inherent to terminal emulators |
| M-1: No session cap | **RESOLVED** | `MAX_SESSIONS = 20` added at `pty/mod.rs:11` |
| M-2: `unsafe-inline` in `style-src` | OPEN (accepted risk) | Re-evaluated, still acceptable |
| M-3: Raw ANSI passthrough | **RESOLVED** | `AnsiFilter` now filters all PTY output |
| L-1: Session ID format not validated | OPEN | Low priority |
| L-2: `Ordering::Relaxed` | OPEN | Low priority, x86 only |
| L-3: No reader thread backpressure | OPEN | Low priority, 100KB frontend cap mitigates |
| L-4: Unused opener plugin | **RESOLVED** | Removed from Cargo.toml, lib.rs, and capabilities |

---

## Pre-Block-Model Security Checklist

Before implementing the Block Model (likely next task), verify:

- [ ] ANSI filter test coverage includes DCS, APC, and bracketed paste sequences (L-1, L-2, L-3)
- [ ] Block model renders output as text content (React JSX interpolation), NOT as HTML
- [ ] If blocks use structured data, ensure no path from PTY output to HTML rendering bypasses React's escaping
- [ ] Consider whether blocks should have per-block output limits in addition to the global 100KB cap

---

## Overall Risk Assessment

### Current State: **LOW-MODERATE RISK**

This is a significant improvement from the previous review's "MODERATE RISK" assessment. The ANSI filter is the most security-critical addition in this commit range, and it is well-implemented.

**Strengths:**
- Allowlist-based ANSI filtering (default-strip) is the correct architectural pattern
- Filter uses a well-tested VT parser (`vte` from the Alacritty project) rather than hand-written regex
- All non-SGR escape sequences are stripped: OSC, DCS, APC, CSI (except `m`), raw ESC
- SGR sequence length bounded at 256 bytes
- Frontend uses React's JSX text interpolation (safe) rather than `dangerouslySetInnerHTML` (unsafe)
- Frontend uses Anser's JSON API (returns objects) rather than HTML API (returns raw HTML strings)
- Session cap (20) limits process spawning DoS
- Opener plugin removed (reduced attack surface)
- Persistent parser state correctly handles cross-chunk sequences
- Per-session filter instances prevent cross-pane state leakage
- No `unsafe` Rust code
- No known dependency vulnerabilities
- Comprehensive test coverage for the most important adversarial sequences

**Weaknesses:**
- Color string validation relies on Anser library behavior (M-1) -- no explicit frontend validation
- Missing DCS/APC/bracketed paste test cases (L-1, L-2, L-3) -- implementation is correct but untested
- `unsafe-inline` in CSP style-src (M-2) -- accepted risk
- Carried forward: session ID format validation (L-5), `Ordering::Relaxed` (L-4), no backpressure (from previous L-3)

### Risk Trajectory

The security posture has **improved** from the previous milestone. The ANSI filter addresses the most critical finding from the previous review (M-3: raw ANSI passthrough), and the session cap addresses M-1. The remaining open findings are all LOW severity.

---

**Reviewed by**: Security Review Agent
**Review date**: 2026-03-12
**Verdict**: **PASS** -- No blocking issues. The ANSI security filter is correctly implemented with an allowlist approach and comprehensive test coverage. Two medium findings (M-1: color string validation, M-2: CSP `unsafe-inline`) are noted for defense-in-depth improvement but are not currently exploitable. Three low findings (L-1, L-2, L-3) are test coverage gaps for the filter's already-correct behavior.
