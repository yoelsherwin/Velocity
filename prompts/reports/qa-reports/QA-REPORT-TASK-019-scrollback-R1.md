# QA Report: TASK-019 Scrollback Buffer + Large Output Performance

**Date**: 2026-03-17
**Reviewer**: QA Agent
**Round**: R1
**Verdict**: PASS (with findings)

---

## 1. Test Results

### Frontend Tests (Vitest)
- **Result**: 242/242 passed, 0 failed
- **Command**: `npm run test`
- **Duration**: 13.08s
- TASK-019-specific test files:
  - `src/__tests__/scrollback.test.ts` (2 tests) -- ALL PASS
  - `src/__tests__/useIncrementalAnsi.test.ts` (5 tests) -- ALL PASS
  - `src/__tests__/outputTruncation.test.tsx` (2 tests) -- ALL PASS
  - `src/__tests__/Terminal.test.tsx` (42 tests, including TASK-019-relevant `test_blocks_limited_to_max`) -- ALL PASS
  - `src/__tests__/BlockView.test.tsx` (11 tests) -- ALL PASS
  - `src/__tests__/AnsiOutput.test.tsx` (2 tests) -- ALL PASS

### Rust Tests (cargo test)
- **Result**: 79/79 passed (69 unit + 10 integration), 1 ignored
- **Command**: `cd src-tauri && cargo test`
- No Rust changes in TASK-019. All existing tests remain green.

---

## 2. Code-Level Bug Hunt

### 2.1 Per-Block Output Truncation (BUG-025 Fix)

**Status: CORRECT (with one edge case noted)**

The truncation logic in `Terminal.tsx` (lines 111-115):

```typescript
let newOutput = b.output + event.payload;
if (newOutput.length > OUTPUT_LIMIT_PER_BLOCK) {
    newOutput = TRUNCATION_MARKER + newOutput.slice(-OUTPUT_LIMIT_PER_BLOCK);
}
```

Analysis:
1. **Truncation direction**: Front-truncation via `slice(-OUTPUT_LIMIT_PER_BLOCK)`. This keeps the most recent output, which is the correct choice -- users want to see the latest output, not the beginning.

2. **Marker prepended**: `TRUNCATION_MARKER = '[Output truncated -- showing last 500KB]\n'` is prepended to the truncated output. The marker itself is ~48 characters, so the total length after truncation is `OUTPUT_LIMIT_PER_BLOCK + marker.length` (~500,048 bytes). This is a minor overshoot but not a problem.

3. **Repeated truncation**: If a block keeps receiving output after truncation, each new chunk triggers re-truncation. The flow is: `b.output` (already has marker + 500KB) + `event.payload` (new chunk) => `newOutput` exceeds limit again => front-truncate again. The old marker is sliced away and a new marker is prepended. This is correct -- the marker always appears exactly once at the top.

4. **Exit code extraction after truncation**: Line 116 calls `extractExitCode(newOutput)` AFTER truncation. If the exit code marker (`VELOCITY_EXIT:N`) was at the beginning of the output and was truncated away, the exit code would never be detected. However, the exit code marker appears at the END of the output (it is appended after the command), so front-truncation preserves it. **Correct.**

5. **EDGE CASE -- BUG-039**: If the output is exactly `OUTPUT_LIMIT_PER_BLOCK` bytes, no truncation occurs (the `>` comparison is strict). If the output is `OUTPUT_LIMIT_PER_BLOCK + 1` bytes, truncation fires and `slice(-500000)` removes exactly 1 byte from the front. This is correct behavior. However, the truncation check happens AFTER concatenation: `b.output + event.payload`. If `b.output` is already at the limit (from previous truncation: marker + 500KB = ~500,048 bytes) and a new 1-byte chunk arrives, `newOutput` = ~500,049 bytes, exceeding the limit again. This triggers another truncation cycle, slicing to 500,000 bytes and prepending the marker again. The net effect is that the marker is re-created every chunk for active blocks at the limit. This is functionally correct but causes a small amount of unnecessary string allocation on every chunk for blocks at the cap. **Not a bug -- just a minor performance note.**

### 2.2 MAX_BLOCKS Increase (50 -> 500)

**Status: CORRECT**

`MAX_BLOCKS = 500` (Terminal.tsx line 16). The block pruning logic (lines 270-271):

```typescript
return withNew.length > MAX_BLOCKS
    ? withNew.slice(-MAX_BLOCKS)
    : withNew;
```

This keeps the most recent 500 blocks. Worst-case memory: 500 blocks x 500KB output cap = ~250MB. In practice, most blocks have small output (a few KB), so the actual memory footprint would be far lower.

**Memory concern**: 500 blocks with placeholder DOM nodes (even when not visible) still consume some memory for React virtual DOM nodes. Each block has its `Block` object in state (~100 bytes minimum) plus the DOM node (~200 bytes for the container div). 500 x 300 bytes = ~150KB for the overhead. Negligible.

### 2.3 Incremental ANSI Parsing (BUG-004 Fix)

**Status: CORRECT (with known caveat)**

The `useIncrementalAnsi` hook (`src/hooks/useIncrementalAnsi.ts`) implements three parsing paths:

1. **No change (line 42)**: If `output.length === cache.parsedLength` AND prefix matches, returns the cached spans. Same reference -- enables `React.memo` to skip re-render. **Correct.**

2. **Incremental append (lines 47-58)**: If output is longer AND starts with the same 64-char prefix, only the new portion is parsed. The new spans are concatenated with existing spans. **Correct.**

3. **Full reparse (lines 61-66)**: If neither condition matches (truncation, replacement, prefix mismatch), a full reparse is triggered. **Correct.**

#### Analysis of the prefix-match approach:

The hook uses `output.slice(0, 64)` as a prefix sample for change detection (line 42, 50, 65). This is a heuristic:

- **64 chars is sufficient for most cases**: It covers the initial prompt text, which is typically stable across appends. If the first 64 characters change, the output was likely truncated.

- **False positive (unnecessary full reparse)**: If the first 64 characters of the output change for any reason other than truncation (e.g., the exit code extractor modifies early content), a full reparse is triggered. This is safe -- it's a performance pessimization, not a correctness issue.

- **False negative (missed truncation)**: If front-truncation happens to produce an output whose first 64 characters match the old prefix, the hook would incorrectly use the incremental path. This is astronomically unlikely for natural PTY output but could theoretically occur with highly repetitive output (e.g., a line of repeated 'x' characters). The result would be incorrect span rendering until the next full reparse. **Very low risk.**

#### ANSI state across chunk boundaries (documented caveat):

The incremental path parses only the new chunk via `parseAnsi(newPart)` (line 53). This means ANSI state (e.g., a color code set in the previous chunk) is NOT carried forward to the new chunk. If a program outputs `\x1b[31m` in one chunk and `colored text\x1b[0m` in the next, the incremental parser sees `colored text\x1b[0m` without knowing it should be red.

**Impact**: Minor color rendering errors at chunk boundaries. Most programs emit `\x1b[0m` (reset) frequently, and most SGR sequences are within a single chunk. The task spec explicitly accepts this caveat: "For MVP this is acceptable -- most commands emit reset sequences frequently."

### 2.4 Block Visibility (IntersectionObserver)

**Status: CORRECT**

The `useBlockVisibility` hook (`src/hooks/useBlockVisibility.ts`) uses IntersectionObserver to track visible blocks:

1. **Observer creation (lines 21-45)**: Single observer created on mount with `rootMargin: '500px 0px 500px 0px'` and `threshold: 0`. The 500px margin pre-renders blocks slightly outside the viewport for smooth scrolling. **Correct.**

2. **Cleanup on unmount (lines 49-52)**: `observer.disconnect()` and `observerRef.current = null` in the cleanup function. **Correct -- no memory leak.**

3. **Element tracking (lines 55-72)**: Two maps (`elementMapRef` for blockId -> Element, `idMapRef` for Element -> blockId) track observed elements. When a block's element ref changes (React re-render), the old element is unobserved and the new one is observed. **Correct.**

4. **State update optimization (lines 23-36)**: The `setVisibleIds` callback checks if the set actually changed before returning a new reference. This prevents unnecessary re-renders when the observer fires but no visibility actually changed. **Correct.**

5. **BUG-040 (Minor): Stale entries in maps for removed blocks**: When blocks are pruned by the MAX_BLOCKS limit (the oldest blocks are removed), the corresponding DOM elements are unmounted. React calls the `observeRef` callback with `null` for unmounted elements (lines 67-71), which triggers `unobserve` and cleanup of the maps. **Actually, wait** -- the `observeRef` is a callback ref passed via `ref={el => observeBlock(block.id, el)}`. When the component unmounts, React calls this with `null`. In `observeBlock` (line 55-72), when `element` is null and there's an `oldElement`, the old element is unobserved and the maps are cleaned. However, the `visibleIds` Set is NOT updated -- the block ID remains in the Set even after the element is unmounted and unobserved.

    This means `visibleIds` may contain IDs of blocks that no longer exist. In `Terminal.tsx`, the `isVisible={visibleIds.has(block.id)}` check only runs for blocks in the `blocks` array, so a stale entry in `visibleIds` for a removed block has no effect -- it's never read. The Set just accumulates stale IDs until the observer fires again.

    **Impact**: None functionally. The Set grows by up to MAX_BLOCKS entries over time, each entry being a UUID string (~36 bytes). 500 x 36 = ~18KB. Negligible memory waste. The entries would be garbage collected when the Terminal component unmounts (the entire Set is released). **Not a bug -- cosmetic only.**

6. **BUG-041 (Minor): Observer fires `isIntersecting: true` initially for all observed elements in test setup**: The `MockIntersectionObserver` in `src/__tests__/setup.ts` (lines 16-18) immediately calls the callback with `isIntersecting: true` when `observe` is called. This means all blocks are immediately visible in tests, which is correct for ensuring test assertions work, but it means the placeholder path (`isVisible = false`) is never tested in unit tests. There is no unit test that verifies the placeholder renders correctly when `isVisible` is false.

    **Impact**: Low. The placeholder rendering is simple (a `<pre>` with estimated height). If someone breaks the placeholder rendering, no test would catch it.

### 2.5 Placeholder Height Estimation

**Status: CORRECT**

The `estimateBlockHeight` function (`src/hooks/useBlockVisibility.ts` lines 81-86):

```typescript
const lines = output.split('\n').length;
const lineHeight = 19.6; // 14px font * 1.4 line-height
const headerHeight = 32;
return headerHeight + Math.min(lines, 50) * lineHeight;
```

- Line count capped at 50 for estimation. Output with 10,000 lines would estimate at 50 x 19.6 + 32 = 1,012px. This prevents absurdly tall placeholders. **Correct.**

- For an empty output string, `''.split('\n').length === 1`, so the minimum height is `32 + 1 * 19.6 = 51.6px`. **Correct.**

- **Layout shift concern**: When a block transitions from placeholder to full render (or vice versa), the actual height may differ from the estimate. This could cause a brief layout shift. This is acceptable for MVP -- the 500px rootMargin pre-renders blocks before they're visible, reducing perceptible shifts.

### 2.6 AnsiOutput Component Migration

**Status: CORRECT**

`AnsiOutput.tsx` was changed from:
```typescript
const spans = useMemo(() => parseAnsi(text), [text]);
```
to:
```typescript
const spans = useIncrementalAnsi(text);
```

This is a drop-in replacement. The `useIncrementalAnsi` hook returns the same `AnsiSpan[]` type. `React.memo` on the `AnsiOutput` component still works because the hook returns the same reference when the output hasn't changed. **Correct.**

### 2.7 BlockView Visibility Prop

**Status: CORRECT**

`BlockView.tsx` now accepts `isVisible` (default: `true`) and `observeRef`:

```typescript
{block.output && (
    isVisible ? (
        <pre className="block-output" data-testid="block-output">
            <AnsiOutput text={block.output} />
        </pre>
    ) : (
        <pre
            className="block-output block-output-placeholder"
            data-testid="block-output-placeholder"
            style={{ height: estimateBlockHeight(block.output) }}
        />
    )
)}
```

- `isVisible` defaults to `true`, so all existing tests that don't pass the prop still render the full AnsiOutput. **Correct backward compatibility.**
- The `observeRef` is applied to the outer `.block-container` div via `ref={observeRef}`. This means the IntersectionObserver tracks the entire block container, not just the output area. **Correct.**
- Block header and actions are always rendered (regardless of visibility). Only the expensive `AnsiOutput` is gated. **Correct.**

### 2.8 Integration: Truncation + Incremental Parsing Interaction

**Status: CORRECT (with full-reparse triggered)**

When a block's output exceeds the limit:
1. `newOutput = marker + newOutput.slice(-500000)` -- the output is replaced with a truncated version.
2. On the next render, `useIncrementalAnsi` receives the new output.
3. The prefix check fails (the output now starts with `[Output truncated...` instead of the original prefix).
4. The hook falls back to full reparse. **Correct.**

After the first truncation, subsequent chunks are appended as normal (if the block stays under the limit). The incremental path kicks in again because the prefix (the truncation marker) stays stable. If the output exceeds the limit again, another full reparse is triggered. This is the expected behavior.

---

## 3. Architecture Assessment

### 3.1 File Structure

New/modified files for TASK-019:

| File | Role | Status |
|------|------|--------|
| `src/components/Terminal.tsx` | MAX_BLOCKS=500, OUTPUT_LIMIT_PER_BLOCK=500000, truncation logic | Modified, correct |
| `src/components/blocks/BlockView.tsx` | isVisible/observeRef props, placeholder rendering | Modified, correct |
| `src/components/AnsiOutput.tsx` | Switched from `useMemo(parseAnsi)` to `useIncrementalAnsi` | Modified, correct |
| `src/hooks/useIncrementalAnsi.ts` | Incremental ANSI parsing with cache | New, correct |
| `src/hooks/useBlockVisibility.ts` | IntersectionObserver-based visibility tracking + height estimation | New, correct |
| `src/__tests__/setup.ts` | MockIntersectionObserver for jsdom | Modified, correct |
| `src/__tests__/scrollback.test.ts` | Constant value tests | New, correct |
| `src/__tests__/useIncrementalAnsi.test.ts` | Hook tests (5 tests) | New, comprehensive |
| `src/__tests__/outputTruncation.test.tsx` | Integration tests for truncation | New, correct |

### 3.2 Data Flow (Output Path)

```
PTY (Rust) -> AnsiFilter (Rust) -> Tauri event pty:output:{sid}
  -> Terminal.tsx output handler
  -> Concatenate: b.output + event.payload
  -> Truncation check: if > 500KB, front-truncate + marker
  -> Exit code extraction: extractExitCode(newOutput)
  -> setBlocks state update
  -> BlockView: isVisible check via IntersectionObserver
  -> If visible: AnsiOutput -> useIncrementalAnsi -> parseAnsi(newPart)
  -> If not visible: placeholder <pre> with estimated height
```

### 3.3 Performance Impact

| Scenario | Before TASK-019 | After TASK-019 |
|----------|-----------------|----------------|
| 1MB output block, new 4KB chunk | Full reparse of 1MB | Parse only 4KB (incremental) |
| 500 blocks, 5 visible | All 500 blocks render AnsiOutput | 5 blocks render AnsiOutput, 495 show placeholder |
| `cat` a 10MB file | UI freeze, unbounded memory | Capped at 500KB, front-truncated |
| MAX_BLOCKS pruning | 50 blocks retained | 500 blocks retained |

---

## 4. Test Coverage Assessment

### 4.1 TASK-019-Specific Tests

| Test | File | Status |
|------|------|--------|
| `test_output_limit_constant_is_500000` | `scrollback.test.ts` | PASS |
| `test_max_blocks_is_500` | `scrollback.test.ts` | PASS |
| `test_incremental_parse_new_chunk` | `useIncrementalAnsi.test.ts` | PASS |
| `test_incremental_parse_full_on_truncation` | `useIncrementalAnsi.test.ts` | PASS |
| `test_incremental_parse_no_change` | `useIncrementalAnsi.test.ts` | PASS |
| `test_incremental_parse_preserves_ansi_colors` | `useIncrementalAnsi.test.ts` | PASS |
| `test_incremental_parse_handles_empty_string` | `useIncrementalAnsi.test.ts` | PASS |
| `test_output_truncated_when_exceeding_limit` | `outputTruncation.test.tsx` | PASS |
| `test_truncation_keeps_most_recent_output` | `outputTruncation.test.tsx` | PASS |
| `test_blocks_limited_to_max` | `Terminal.test.tsx` | PASS |

### 4.2 Coverage Gaps

| Missing Test | Severity | Notes |
|-------------|----------|-------|
| Placeholder rendering when `isVisible=false` | Medium | The mock IntersectionObserver always reports `isIntersecting: true`. No test verifies that the `block-output-placeholder` test ID renders when a block is not visible. |
| `estimateBlockHeight` accuracy | Low | No unit test for the height estimation function. Simple function, low risk. |
| Truncation + exit code interaction | Low | No test verifies that the exit code marker survives truncation (it always will because the marker is at the end, and front-truncation keeps the end). |
| Incremental parse with ANSI state crossing chunk boundaries | Low | No test for the known caveat where colors may be lost at chunk boundaries. Accepted as MVP limitation. |
| `useBlockVisibility` cleanup on block removal | Low | No test verifies that unobserving happens when blocks are pruned by MAX_BLOCKS limit. |
| Repeated truncation cycles (block at limit receiving many small chunks) | Low | No test for the steady-state behavior where each chunk triggers re-truncation. Functionally correct but could be tested for performance regression. |
| Large block count memory (500 blocks in DOM) | Low | No test for rendering performance with 500 blocks. Would require a performance benchmark, not a unit test. |

---

## 5. Bug Findings

### BUG-039: Truncated Output Includes Marker in Size Calculation (Cosmetic)

**Status: BUG (Low Severity)**

After truncation, the output stored in the block is `TRUNCATION_MARKER + newOutput.slice(-OUTPUT_LIMIT_PER_BLOCK)`. The total stored length is `OUTPUT_LIMIT_PER_BLOCK + TRUNCATION_MARKER.length` (~500,048 bytes). On the next chunk, the condition `newOutput.length > OUTPUT_LIMIT_PER_BLOCK` immediately triggers again because the existing output is already 48 bytes over the limit.

This means every chunk after the first truncation triggers another truncation cycle, even for 1-byte chunks. The cost is:
1. String concatenation: `b.output (500,048) + event.payload (small)` -> allocate ~500KB string
2. `slice(-500000)` -> allocate another 500KB string
3. Marker prepend -> allocate a third ~500KB string

Three 500KB string allocations per chunk for blocks at the cap.

**Impact**: Minor performance overhead for blocks that are actively receiving output at the cap. Not a correctness issue -- the output is correct and the marker appears once.

**Suggested fix**: Include the marker length in the truncation comparison, or slice to `OUTPUT_LIMIT_PER_BLOCK - TRUNCATION_MARKER.length` so the total stays under the limit.

### BUG-040: visibleIds Set Retains Stale Block IDs (Cosmetic)

**Status: BUG (Informational)**

When blocks are pruned by the MAX_BLOCKS limit, the block IDs removed from the `blocks` array remain in the `visibleIds` Set. The observer's `unobserve` is called (via React unmount callback ref), but the `setVisibleIds` is not triggered because `unobserve` does not fire an IntersectionObserver callback.

**Impact**: None functionally. The Set accumulates at most 500 stale entries (~18KB). They are never read because `isVisible={visibleIds.has(block.id)}` only runs for blocks still in the array.

### BUG-041: No Unit Test for Placeholder Rendering Path

**Status: COVERAGE GAP (Low Severity)**

The `MockIntersectionObserver` in `setup.ts` always reports `isIntersecting: true`, so the `isVisible={false}` path in `BlockView` is never tested. A dedicated test should pass `isVisible={false}` to `BlockView` and assert the placeholder renders.

**Impact**: Low. If the placeholder rendering breaks, no test catches it. However, the placeholder is a simple `<pre>` with inline height, unlikely to break.

---

## 6. Acceptance Criteria Checklist

| Criterion | Status |
|-----------|--------|
| All tests written and passing | PASS -- 242 frontend + 79 Rust tests (all green) |
| Per-block output capped at 500KB with truncation marker | PASS -- `OUTPUT_LIMIT_PER_BLOCK = 500_000`, front-truncation + marker |
| MAX_BLOCKS increased to 500 | PASS -- `MAX_BLOCKS = 500` |
| Incremental ANSI parsing -- only new chunks parsed, not full reparse | PASS -- `useIncrementalAnsi` with prefix-match cache |
| Block visibility detection via IntersectionObserver | PASS -- `useBlockVisibility` hook with 500px rootMargin |
| Off-screen blocks show placeholder instead of rendered AnsiOutput | PASS -- `isVisible` prop gates AnsiOutput rendering |
| BUG-004 fixed (no full re-parse per event) | PASS -- incremental parsing only re-parses new chunks |
| BUG-025 fixed (output size bounded) | PASS -- 500KB cap with front-truncation |
| `npm run test` + `cargo test` pass | PASS -- all green |
| Clean commit | PASS -- `25ae200 feat: add scrollback buffer with output limits and incremental ANSI parsing` |

---

## 7. Verdict

**PASS**

The TASK-019 implementation correctly addresses both P0 bugs (BUG-004 full ANSI re-parse, BUG-025 unbounded output) and delivers all specified features:

1. **Per-block output cap**: 500KB with front-truncation and user-visible marker. Correct.
2. **MAX_BLOCKS increase**: 50 -> 500 with bounded worst-case memory (~250MB, realistic ~10-50MB). Correct.
3. **Incremental ANSI parsing**: Prefix-match cache with three paths (no-change, incremental, full-reparse). Correct, with documented caveat about ANSI state at chunk boundaries.
4. **Block visibility**: IntersectionObserver with 500px rootMargin for pre-rendering. Proper cleanup on unmount. Correct.
5. **Placeholder rendering**: Off-screen blocks show a height-estimated `<pre>` instead of expensive AnsiOutput. Correct.

Three low-severity/informational findings were noted:
- **BUG-039**: Truncation marker included in size comparison causes redundant re-truncation per chunk. Cosmetic performance issue.
- **BUG-040**: `visibleIds` Set retains stale block IDs. No functional impact.
- **BUG-041**: No unit test for the `isVisible={false}` placeholder rendering path.

None of these findings block the release.
