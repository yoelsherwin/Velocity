# Security Review: TASK-019 (Scrollback Buffer + Large Output Performance)

**Reviewer**: Security Agent (automated)
**Date**: 2026-03-17
**Commit range**: `a04290b..25ae200` (1 commit: `25ae200`)
**Previous security review HEAD**: `a04290b`
**Verdict**: PASS WITH FINDINGS (0 critical, 0 high, 1 medium, 2 low, 3 informational)

---

## 1. Executive Summary

This review covers TASK-019: Scrollback Buffer + Large Output Performance. The changes are exclusively in the frontend (React/TypeScript) with no Rust backend modifications. The task introduces:

1. Per-block output cap at 500KB with front-truncation
2. MAX_BLOCKS increase from 50 to 500
3. Incremental ANSI parsing via `useIncrementalAnsi` hook
4. IntersectionObserver-based block visibility detection for off-screen placeholder rendering
5. Fixes for BUG-004 (full ANSI re-parse per PTY event) and BUG-025 (unbounded output)

The primary security invariants under audit are:

- **Can crafted PTY output bypass the truncation limit?** No -- truncation is enforced in the Terminal component's output handler, which processes all PTY output.
- **Does truncation affect the ANSI security filter?** No -- the ANSI filter runs in Rust BEFORE output reaches the frontend. Truncation operates on already-filtered text.
- **Are there new DoS vectors from the rendering changes?** One medium-severity finding: a malicious program can force repeated 500KB string allocations per PTY chunk.
- **Are there memory leak vectors from the IntersectionObserver?** No -- observer cleanup is handled correctly on unmount.

---

## 2. Security Filter Pipeline Verification

### 2.1 ANSI Filter Position in Pipeline

The security-critical question: does output truncation happen BEFORE or AFTER the Rust ANSI security filter?

**Pipeline:**
```
PTY raw bytes (untrusted)
  -> AnsiFilter::filter() in Rust reader thread (src-tauri/src/pty/mod.rs line 108)
  -> Only SGR sequences + safe text pass through
  -> PtyEvent::Output(filtered_string) sent via Tauri event
  -> Frontend Terminal.tsx output handler receives filtered string
  -> Truncation applied (TRUNCATION_MARKER + slice(-500000))
  -> Stored in block state
  -> Rendered via AnsiOutput -> useIncrementalAnsi -> parseAnsi
```

**Finding: PASS.** Truncation operates on already-filtered output. The ANSI security filter is applied in Rust BEFORE the output reaches the frontend event handler. Truncation cannot introduce unsafe ANSI sequences because it only performs string slicing on filtered text and prepends a static marker string. The marker `[Output truncated -- showing last 500KB]\n` contains no ANSI escape sequences.

### 2.2 Can Truncation Create Partial ANSI Sequences?

When `newOutput.slice(-OUTPUT_LIMIT_PER_BLOCK)` slices the output, it could theoretically cut in the middle of an SGR escape sequence (e.g., `\x1b[31m` split into `\x1b[3` at the slice boundary). The remaining partial sequence would be:

1. Passed to `parseAnsi()` (via Anser library)
2. Anser would either ignore the incomplete sequence or treat it as literal text
3. The `isValidRgb` check in `ansi.ts` (line 27-29) only applies CSS colors that match the RGB triplet pattern

**Analysis**: A partial `\x1b[` at the start of the sliced output would be ignored by the Anser parser (it expects a complete CSI sequence). In the worst case, a few characters would be rendered as literal text. This is a rendering glitch, not a security issue.

**However**: The Rust ANSI filter only allows SGR (color/style) sequences through. All dangerous sequences (cursor movement, erase, OSC, DCS) are stripped BEFORE the output reaches the frontend. Even if truncation creates an unexpected byte pattern, the frontend can only encounter text and `\x1b[...m` sequences.

**Finding: PASS.** Partial sequences from truncation are a cosmetic rendering issue, not a security issue. The Rust filter ensures no dangerous sequences exist in the output.

### 2.3 Truncation Marker Injection

Could a malicious program craft output that includes the truncation marker text to confuse the user?

The marker is: `[Output truncated -- showing last 500KB]\n`

A program could output this exact string to make the user think truncation occurred when it did not. This is a social engineering concern, not a security vulnerability. The marker is informational only -- it does not affect any security decisions.

**Finding: INFORMATIONAL.** The marker is a plain-text string that could be spoofed by PTY output. No security impact.

---

## 3. DoS / Resource Exhaustion Analysis

### 3.1 Rapid Output Flooding (MEDIUM)

**Component**: Terminal.tsx output handler (lines 108-124)

**Description**: A malicious or poorly written program can flood the PTY with output faster than the frontend can process it. For each chunk, the output handler:

1. Concatenates the chunk onto the existing output: `b.output + event.payload`
2. If over limit: allocates `TRUNCATION_MARKER + newOutput.slice(-500000)` (~500KB)
3. Calls `extractExitCode(newOutput)` on the ~500KB string

For a block that is already at the 500KB cap, EVERY incoming chunk (even 1 byte) triggers:
- A ~500KB string concatenation
- A ~500KB `slice` operation
- A ~500KB regex scan for exit code extraction
- A React state update (`setBlocks`)

If the PTY reader thread delivers 100 chunks/second (common for high-throughput commands like `cat /dev/urandom | xxd`), the frontend performs 100 x ~1.5MB of string operations per second.

**Mitigating factors**:
- JavaScript's V8 engine handles string operations efficiently (O(n) slice, O(n) regex)
- React batches state updates within the same event loop tick
- The PTY reader thread in Rust reads in 4096-byte chunks, throttled by I/O speed
- The Tauri event system has some inherent backpressure
- The browser's main thread scheduler will yield to user input

**Risk**: UI jank during high-throughput output for blocks at the cap. Not a crash or data loss scenario, but the UI may become unresponsive for the duration.

**Severity**: MEDIUM -- denial of service (UI freeze) during high-throughput output. This is the same underlying issue as BUG-004 but with different characteristics: before TASK-019, the bottleneck was ANSI re-parsing of the entire output; after TASK-019, the bottleneck is string allocation for truncation + exit code extraction. The absolute performance is better (string operations are faster than ANSI parsing), but the issue is not fully eliminated.

**Recommendation**: Consider debouncing the output handler to accumulate chunks before updating state, or moving the truncation logic to Rust (where string operations are cheaper and won't block the UI thread).

### 3.2 MAX_BLOCKS Memory Bound

**Component**: Terminal.tsx line 16

**Description**: `MAX_BLOCKS = 500` with `OUTPUT_LIMIT_PER_BLOCK = 500_000`. Worst-case memory: 500 x 500KB = 250MB of string data in React state.

**Analysis**: 250MB is significant but within the memory budget of a modern Electron/Tauri application. In practice:
- Most blocks have small output (a few KB for typical commands)
- Only a few blocks at a time would be at the 500KB cap (e.g., `cat` of a large file)
- A realistic estimate is 500 blocks x ~5KB average = ~2.5MB

The 250MB worst case would require 500 consecutive commands that each produce 500KB+ of output. This is unlikely in normal use but possible in adversarial scenarios (e.g., a loop that runs `cat large-file` 500 times).

**Mitigating factors**:
- Off-screen blocks only store their output string; they don't render AnsiOutput spans
- JavaScript strings are stored as UTF-16, so actual memory is 2x the character count (~500MB worst case)
- V8's garbage collector handles string deallocation
- The OS will swap to disk before OOM (Windows)

**Finding: LOW.** The memory bound is acceptable for normal use. A malicious actor controlling the terminal session (which already implies full system access) could force the 250MB worst case, but this is not a meaningful escalation.

### 3.3 IntersectionObserver Resource Usage

**Component**: `src/hooks/useBlockVisibility.ts`

**Description**: A single IntersectionObserver instance watches up to 500 block container elements. The observer uses `threshold: 0` (binary visible/not-visible), which minimizes callback frequency.

**Analysis**: IntersectionObserver is designed to efficiently track large numbers of elements. The browser batches intersection changes and delivers them asynchronously. Observing 500 elements with a single observer is well within the API's design limits (browsers commonly handle thousands of observed elements).

The callback (lines 22-36) iterates only the changed entries (not all observed elements), and uses a `Set` for O(1) lookups. The `changed` flag prevents unnecessary React state updates.

**Finding: PASS.** No resource exhaustion from IntersectionObserver.

---

## 4. Incremental Parsing Security

### 4.1 Can Incremental Parsing Miss Security-Relevant Sequences?

The `useIncrementalAnsi` hook only parses the new chunk when using the incremental path. Could this cause a security-relevant ANSI sequence to be missed?

**No.** The Rust ANSI filter has already stripped all non-SGR sequences. The incremental parser only sees text + SGR sequences. Missing an SGR sequence due to chunk-boundary splitting would only cause a cosmetic color rendering error.

The `isValidRgb` check in `ansi.ts` (line 27-29) validates color values before applying them as CSS. Even if the incremental parser somehow produced unexpected color values, the RGB validation would reject anything that doesn't match `^\d{1,3},\s?\d{1,3},\s?\d{1,3}$`.

**Finding: PASS.** Incremental parsing cannot bypass security filters.

### 4.2 Cache Poisoning

Could a malicious actor manipulate the `cacheRef` in `useIncrementalAnsi` to cause incorrect rendering?

The cache is stored in a `useRef` within the hook. It is not accessible from outside the component. The only way to influence the cache is by providing different `output` values to the hook, which is controlled by the Terminal component's state.

A malicious program could craft output that exploits the prefix-match heuristic (64-character prefix). If the program outputs 64 repeated characters, then changes content after position 64, and the program's output is subsequently front-truncated to start at position 64, the new output would have the same prefix as the cached output. The hook would use the incremental path, concatenating the new spans onto the old cached spans. The old spans would be stale (they contain content that was truncated away), resulting in incorrect rendering.

**Impact**: Temporary rendering corruption until a full reparse is triggered. Not a security issue -- the text content is still correct (from the spans' `content` properties), only the styling may be wrong.

**Finding: INFORMATIONAL.** Theoretical cache inconsistency from carefully crafted output + truncation timing. Self-corrects on the next full reparse.

---

## 5. XSS and Injection Audit

### 5.1 Truncation Marker

The marker string `[Output truncated -- showing last 500KB]\n` is a static constant (line 19 of Terminal.tsx). It does not include any user input or PTY output. It is rendered through `AnsiOutput` -> `useIncrementalAnsi` -> `parseAnsi`, which treats it as plain text with no ANSI sequences. The text is rendered inside a `<span>` element by React, which auto-escapes HTML entities.

**Finding: PASS.** No injection vector from the truncation marker.

### 5.2 estimateBlockHeight

The `estimateBlockHeight` function receives `block.output` (which contains PTY output) and calls `output.split('\n').length`. The result is used as a numeric `style.height` value. No PTY content is injected into CSS or HTML attributes.

**Finding: PASS.** No injection vector from height estimation.

### 5.3 Placeholder Data-Testid

The placeholder `<pre>` element uses `data-testid="block-output-placeholder"`, a static string. No user content in the attribute.

**Finding: PASS.**

---

## 6. Attack Surface Changes

### 6.1 New Attack Surface

| Component | Change | Risk |
|-----------|--------|------|
| `src/hooks/useIncrementalAnsi.ts` | NEW: Incremental ANSI parsing with prefix-match cache | **Low** -- pure computation, no I/O |
| `src/hooks/useBlockVisibility.ts` | NEW: IntersectionObserver wrapper | **Low** -- standard DOM API, no data flow |
| `src/components/Terminal.tsx` | MODIFIED: Truncation logic, MAX_BLOCKS=500, visibility integration | **Medium** -- output handling changes |
| `src/components/blocks/BlockView.tsx` | MODIFIED: Visibility prop, placeholder rendering | **Low** -- conditional rendering |
| `src/components/AnsiOutput.tsx` | MODIFIED: Switched to incremental hook | **Low** -- drop-in replacement |
| `src/__tests__/setup.ts` | MODIFIED: MockIntersectionObserver | None -- test infrastructure |
| Tests (3 files) | NEW: scrollback, incremental, truncation tests | None |

### 6.2 Unchanged Attack Surface

- **Rust backend**: No changes. ANSI filter, PTY management, settings, LLM client all unchanged.
- **IPC commands**: No new commands. No changes to existing commands.
- **Tauri capabilities**: Unchanged.
- **CSP**: Unchanged.
- **Dependencies**: No new npm or crate dependencies.

### 6.3 IPC Command Inventory (Unchanged from TASK-018)

No new IPC commands. The output event `pty:output:{sid}` carries the same payload type (String) as before. The frontend now truncates this payload before storing it.

---

## 7. Specific Security Questions from Task Spec

### Q: Can crafted PTY output bypass the truncation limit?

**A: No.** The truncation check is in the output event handler (Terminal.tsx lines 113-115), which processes ALL output events for the active block. There is no code path that appends output without the truncation check. The check runs synchronously within the `setBlocks` callback, so there is no TOCTOU (time-of-check-to-time-of-use) race.

The only way output could exceed the limit is:
1. A single `event.payload` larger than `OUTPUT_LIMIT_PER_BLOCK` -- this would be truncated immediately.
2. Accumulated output from many small chunks exceeding the limit -- this is caught by the check on `newOutput.length`.

Both cases are handled correctly.

### Q: Does truncation affect the ANSI security filter?

**A: No.** The ANSI security filter runs in the Rust reader thread (`AnsiFilter::filter()` in `src-tauri/src/pty/mod.rs` line 108). It processes raw PTY bytes BEFORE they are emitted as Tauri events. The frontend receives already-filtered output. Truncation operates on filtered output and cannot re-introduce stripped sequences.

Truncation can create partial SGR sequences at the slice boundary, but these are handled safely by the Anser parser (ignored or treated as literal text). The `isValidRgb` check prevents malformed color values from being used in CSS.

### Q: Any DoS vectors from the new rendering approach?

**A: One medium-severity finding.** Rapid output flooding forces repeated 500KB string allocations in the output handler for blocks at the cap (see Finding-1). This can cause UI jank but not a crash. The IntersectionObserver approach does not introduce DoS vectors.

---

## 8. Findings

### FINDING-1: Repeated String Allocation for Blocks at Output Cap [MEDIUM]

**Component**: `src/components/Terminal.tsx` lines 111-115

**Description**: When a block's output is at the 500KB cap, every incoming PTY chunk (even 1 byte) triggers:
1. String concatenation: `b.output (500KB + marker) + event.payload` -> ~500KB allocation
2. `slice(-500000)` -> ~500KB allocation
3. `TRUNCATION_MARKER + sliced` -> ~500KB allocation
4. `extractExitCode(newOutput)` -> regex scan of ~500KB

This is because the marker (~48 bytes) pushes the stored output over `OUTPUT_LIMIT_PER_BLOCK`, so the truncation check fires on every subsequent chunk.

**Attack scenario**: A malicious program outputs a continuous stream to the terminal (e.g., `while(true) { echo "x".repeat(4096) }`). Once the block reaches the 500KB cap, every 4KB chunk causes ~1.5MB of string allocations. At 100 chunks/second, this is ~150MB/s of short-lived string allocations, putting significant pressure on the JavaScript garbage collector.

**Mitigating factors**:
- The PTY reader reads in 4096-byte chunks, providing natural rate limiting
- V8's generational GC handles short-lived strings efficiently
- The UI remains responsive (state updates are batched)
- The user can stop the command (Ctrl+C)

**Risk**: UI jank during sustained high-throughput output to a capped block. Not exploitable for code execution or data exfiltration.

**Recommendation**: Slice to `OUTPUT_LIMIT_PER_BLOCK - TRUNCATION_MARKER.length` so the stored output (marker + body) stays exactly at the limit, preventing re-truncation on the next chunk.

**Severity**: MEDIUM -- DoS of UI responsiveness during high-throughput output.

---

### FINDING-2: Front-Truncation May Expose Mid-Stream Sensitive Data [LOW]

**Component**: `src/components/Terminal.tsx` lines 113-115

**Description**: Front-truncation keeps the LAST 500KB of output. If a program outputs sensitive data early (e.g., credentials in the first few lines) followed by large non-sensitive output, the sensitive data would be truncated away and is no longer visible or copyable. This is generally beneficial for security.

However, if the sensitive data appears near the 500KB boundary, truncation may slice it to show only a partial credential or token, which could confuse the user about what was disclosed.

**Risk**: Negligible. The truncation behavior (keeping the most recent output) is the correct choice. The alternative (keeping the beginning) would be worse for usability and no better for security.

**Severity**: LOW -- correct behavior, noted for completeness.

---

### FINDING-3: ANSI State Loss at Chunk Boundaries May Mask Output Structure [LOW]

**Component**: `src/hooks/useIncrementalAnsi.ts` lines 52-53

**Description**: The incremental parsing path does not carry ANSI state (current color, bold, etc.) across chunk boundaries. If a program sets a color in one PTY chunk and outputs colored text in the next chunk, the color is lost at the boundary.

A security-relevant scenario: a security tool that uses RED to highlight dangerous commands or WARNING to highlight sensitive output. If the color is set in one chunk and the text in the next, the highlighting would be missing, potentially causing the user to miss a security warning.

**Mitigating factors**:
- Most programs emit SGR sequences and text in the same output write
- PTY reads are 4096 bytes, which typically captures complete color sequences
- Programs that produce security warnings (e.g., `sudo`, `gpg`) tend to flush after each warning line
- The color information is cosmetic -- the text content is still correct

**Risk**: Missed visual security cues due to color loss. Unlikely in practice.

**Severity**: LOW -- cosmetic rendering issue that could theoretically affect user awareness of security warnings.

---

### FINDING-4: Truncation Marker is User-Spoofable [INFORMATIONAL]

**Component**: Terminal.tsx line 19

**Description**: The truncation marker `[Output truncated -- showing last 500KB]\n` is a plain-text string. A malicious program could output this exact string to make the user believe truncation occurred when it did not. This could be used to hide earlier output (social engineering: "the important stuff was truncated, don't worry about it").

**Risk**: Social engineering only. The user can scroll up to verify. The marker has no functional effect beyond informing the user.

**Severity**: INFORMATIONAL.

---

### FINDING-5: Mock IntersectionObserver Always Reports Visible [INFORMATIONAL]

**Component**: `src/__tests__/setup.ts` lines 16-18

**Description**: The test mock immediately reports all observed elements as `isIntersecting: true`. This means the `isVisible={false}` code path in `BlockView` is never tested. If a future change introduces a security-relevant behavior difference between the visible and placeholder paths (e.g., a XSS vulnerability that only exists in the placeholder), it would not be caught by tests.

**Risk**: Currently none -- the placeholder is a simple static `<pre>`. If the placeholder path is extended in the future to include dynamic content, test coverage should be added.

**Severity**: INFORMATIONAL.

---

### FINDING-6: estimateBlockHeight Uses output.split('\n') on Potentially Large Strings [INFORMATIONAL]

**Component**: `src/hooks/useBlockVisibility.ts` line 82

**Description**: The `estimateBlockHeight` function calls `output.split('\n').length` on block output that can be up to ~500KB. `String.prototype.split` creates an array of substrings. For a 500KB string with many newlines (e.g., 25,000 lines of 20 characters each), this creates a 25,000-element array just to count its length.

**Mitigating factors**:
- This function is only called for NOT-visible blocks (the placeholder path)
- V8 may optimize `split().length` without materializing the full array (speculative)
- The function runs synchronously but completes quickly (split is O(n))
- 500KB string split is a ~1ms operation

**Risk**: Minor performance overhead for off-screen blocks with large output. Not a security issue.

**Recommendation**: Consider using a regex counter `(output.match(/\n/g) || []).length` or a manual loop to count newlines without creating an array. Or cache the line count per block.

**Severity**: INFORMATIONAL -- performance observation.

---

## 9. Security Rules Compliance

| Rule | Status | Notes |
|------|--------|-------|
| NEVER string-interpolate user input into shell commands | N/A | No shell command construction in this task. |
| Always validate IPC inputs on Rust side | N/A | No Rust changes in this task. |
| Treat all PTY output as untrusted | PASS | PTY output is filtered by Rust ANSI filter before reaching frontend. Frontend truncation operates on filtered output. `isValidRgb` check prevents CSS injection from color values. |
| No `unwrap()` on user-derived data in Rust | N/A | No Rust changes in this task. |

---

## 10. Comparison with Pre-TASK-019 Security Posture

| Property | Before TASK-019 | After TASK-019 | Change |
|----------|-----------------|----------------|--------|
| Output size per block | Unbounded | Capped at 500KB | Improved |
| Block count | 50 | 500 | Larger, but bounded |
| Worst-case memory | Unbounded | ~250MB (500 x 500KB) | Improved (bounded) |
| ANSI parsing per chunk | Full reparse of all output | Incremental (new chunk only) | Improved |
| ANSI color accuracy | 100% (full reparse) | <100% (chunk boundary caveat) | Minor regression |
| Rendering cost | All blocks always rendered | Only visible blocks rendered | Improved |
| New IPC surface | N/A | None | No change |
| New dependencies | N/A | None | No change |
| ANSI security filter | Rust-side, before frontend | Unchanged | No change |
| DoS resilience | Poor (UI freeze on large output) | Better (capped + incremental) | Improved |

The security posture is improved by TASK-019. The output cap prevents unbounded memory growth, and the incremental parsing reduces CPU usage per chunk. The only regression is the cosmetic ANSI color accuracy at chunk boundaries, which does not affect security.

---

## 11. Verdict

**PASS WITH FINDINGS**

The TASK-019 implementation is security-sound. The critical invariant (ANSI security filter runs in Rust before output reaches the frontend) is preserved. Truncation operates on already-filtered output and cannot introduce or re-enable stripped sequences. The IntersectionObserver approach is clean and well-implemented with proper cleanup.

The single medium-severity finding (repeated string allocation for capped blocks) is a performance DoS concern, not a data integrity or code execution issue. It should be addressed in a follow-up optimization task.

### Action Items

| # | Finding | Severity | Action | Blocking? |
|---|---------|----------|--------|-----------|
| 1 | Repeated string allocation for capped blocks | MEDIUM | Adjust slice size to account for marker length, preventing re-truncation on every chunk | No (performance optimization) |
| 2 | Front-truncation may expose partial sensitive data | LOW | Document behavior; no code change needed | No |
| 3 | ANSI state loss at chunk boundaries | LOW | Accepted MVP caveat. Future: carry last SGR state forward | No |
| 4 | Truncation marker is user-spoofable | INFORMATIONAL | No action needed | No |
| 5 | Mock IntersectionObserver always reports visible | INFORMATIONAL | Add a test for `isVisible={false}` placeholder path | No |
| 6 | `estimateBlockHeight` uses split on large strings | INFORMATIONAL | Consider counting newlines without array allocation | No |

No findings are blocking. The implementation correctly addresses both P0 bugs while maintaining the existing security guarantees.
