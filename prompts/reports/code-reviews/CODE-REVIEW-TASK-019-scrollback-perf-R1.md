# Code Review: TASK-019 -- Scrollback Buffer + Large Output Performance (R1)

**Reviewer**: Code Reviewer Agent (Claude Opus 4.6)
**Date**: 2026-03-17
**Commit**: `25ae200 feat: add scrollback buffer with output limits and incremental ANSI parsing`
**Verdict**: **NEEDS CHANGES** (1 medium, 5 advisory)

---

## Summary

TASK-019 addresses two P0 bugs (BUG-004: full ANSI re-parse per PTY event, BUG-025: no output size limit) and adds lightweight block virtualization. The change spans 11 files (+569/-94 lines): per-block output truncation, incremental ANSI parsing hook, IntersectionObserver-based visibility tracking, and placeholder rendering for off-screen blocks. MAX_BLOCKS increased from 50 to 500.

The architecture is sound and the approach is pragmatic (Option B from the task spec -- IntersectionObserver visibility gating rather than react-window virtualization). All 242 tests pass. However, there is one medium-severity issue in the output truncation logic that can cause unbounded output growth under sustained high-throughput streams.

---

## Scope of Review

| Area | Files |
|------|-------|
| Output truncation | `src/components/Terminal.tsx` |
| Incremental ANSI parsing | `src/hooks/useIncrementalAnsi.ts` |
| Block visibility tracking | `src/hooks/useBlockVisibility.ts` |
| Block rendering | `src/components/blocks/BlockView.tsx` |
| AnsiOutput integration | `src/components/AnsiOutput.tsx` |
| Test setup (IO mock) | `src/__tests__/setup.ts` |
| Truncation tests | `src/__tests__/outputTruncation.test.tsx` |
| Scrollback constant tests | `src/__tests__/scrollback.test.ts` |
| Incremental ANSI tests | `src/__tests__/useIncrementalAnsi.test.ts` |
| Existing test update | `src/__tests__/Terminal.test.tsx` |
| State file | `prompts/STATE.md` |

---

## Detailed Findings

### MEDIUM-1: Output truncation grows output beyond the cap

**File**: `src/components/Terminal.tsx`, lines 111-115

```typescript
let newOutput = b.output + event.payload;
// Apply per-block output cap: truncate from front, keep most recent output
if (newOutput.length > OUTPUT_LIMIT_PER_BLOCK) {
  newOutput = TRUNCATION_MARKER + newOutput.slice(-OUTPUT_LIMIT_PER_BLOCK);
}
```

When `newOutput` exceeds `OUTPUT_LIMIT_PER_BLOCK` (500,000 chars), it is sliced to the last 500,000 chars and then the `TRUNCATION_MARKER` (42 chars) is **prepended**. This means the resulting string is `500,042` characters long. On the next PTY event, the block output (now 500,042 chars) is concatenated with the new payload, exceeding the limit again. Truncation fires again, slicing to 500,000 and prepending the marker -- another 500,042 chars. This is stable at 500,042 per cycle.

**However, the real issue is subtler**: after truncation, the prefix of the output is now the `TRUNCATION_MARKER` string. The incremental ANSI parser uses a 64-char prefix sample for change detection. On the first truncation, the prefix changes from whatever the original output started with to `[Output truncated...`. On the *second* truncation (next event), the prefix is already the marker, so the incremental path is taken -- but the slice boundary cuts the accumulated output at a different point each time, meaning the incremental cache incorrectly assumes the prefix is unchanged while the content after the prefix has been rearranged.

**Impact**: After the first truncation event, every subsequent PTY event triggers a full reparse (not incremental) because the `parsedLength` in the cache will not match. The prefix sample *will* match (both start with the truncation marker), but the length will be `500,042 + len(new_event)` which is always greater than `parsedLength` (500,042), causing the incremental path to be taken. The incremental path then parses only the new event payload as a standalone chunk. This is actually correct in terms of output content but means:

1. The last-span ANSI state is never carried over (documented as a known caveat).
2. Spans accumulate without bound in the `parsedSpans` array even though the string is capped. After N truncation events, the cache holds spans from ALL incremental appends, even though the underlying text has been sliced from the front.

**The span array grows without bound** because the incremental path does `[...cache.parsedSpans, ...newSpans]` but never discards spans from the front that correspond to text that was truncated away.

**Fix**: After truncation, the cache should be invalidated. The simplest fix is to ensure that when the truncation marker is prepended, the prefix sample changes in a way that forces a full reparse. Alternatively, clear the incrementalAnsi cache when truncation occurs, or adjust the truncation to not prepend a marker (use a separate boolean/visual indicator instead).

A more robust approach: in `useIncrementalAnsi`, when the output length is *less than* `parsedLength + newPart.length` (i.e., the output was trimmed), force a full reparse. The current code does check `output.length > cache.parsedLength` for the incremental path, but after the first truncation cycle stabilizes at ~500,042 chars, subsequent events always increase the length (until the next truncation), so the incremental path is taken with a stale span array.

**Recommended fix**: After applying truncation in `Terminal.tsx`, the full reparse will naturally be triggered because the prefix changes (the original content before the marker is gone). But the span accumulation issue in the cache remains for the *steady-state* case where the marker is already present. The fix should be in `useIncrementalAnsi`: when appending incrementally, cap `parsedSpans` to a reasonable maximum, or detect that truncation occurred (e.g., compare `output.length` with `cache.parsedLength + newPart.length` -- if output is shorter than expected, force full reparse).

---

### ADVISORY-1: estimateBlockHeight calls split('\n') on potentially large output

**File**: `src/hooks/useBlockVisibility.ts`, line 82

```typescript
export function estimateBlockHeight(output: string): number {
  const lines = output.split('\n').length;
  const lineHeight = 19.6;
  const headerHeight = 32;
  return headerHeight + Math.min(lines, 50) * lineHeight;
}
```

This function is called in the render path of every non-visible block (`BlockView.tsx` line 75). When a block has a large output (up to 500KB), `output.split('\n')` allocates an array of potentially tens of thousands of strings just to count them, and only the count is used (capped at 50). This defeats part of the performance goal.

**Recommendation**: Replace with a loop that counts `\n` characters up to 50, then stops:

```typescript
export function estimateBlockHeight(output: string): number {
  let lines = 1;
  for (let i = 0; i < output.length && lines < 50; i++) {
    if (output[i] === '\n') lines++;
  }
  const lineHeight = 19.6;
  const headerHeight = 32;
  return headerHeight + lines * lineHeight;
}
```

This avoids the allocation entirely and short-circuits after finding 50 newlines.

---

### ADVISORY-2: observeBlock never cleans up entries for removed blocks

**File**: `src/hooks/useBlockVisibility.ts`, lines 55-72

When blocks are evicted (MAX_BLOCKS slicing in `Terminal.tsx` line 270-272), the corresponding entries in `elementMapRef` and `idMapRef` are never removed. The `observeBlock` callback is only invoked by React's ref system when the element mounts (`el` is non-null) or unmounts (`el` is null). When a BlockView unmounts due to MAX_BLOCKS eviction, React will call `observeRef(null)` for that element.

Looking at the code more carefully:

```typescript
const observeBlock = useCallback((blockId: string, element: HTMLElement | null) => {
  const observer = observerRef.current;
  if (!observer) return;

  const oldElement = elementMapRef.current.get(blockId);
  if (oldElement && oldElement !== element) {
    observer.unobserve(oldElement);
    idMapRef.current.delete(oldElement);
    elementMapRef.current.delete(blockId);
  }

  if (element) {
    elementMapRef.current.set(blockId, element);
    idMapRef.current.set(element, blockId);
    observer.observe(element);
  }
});
```

When React unmounts the BlockView, it calls `observeRef(null)`. The code enters the function with `element = null`. The `oldElement` lookup succeeds (the block was previously observed). `oldElement !== element` is true (old element is not null). So `unobserve`, `idMapRef.delete`, and `elementMapRef.delete` all fire correctly. Then `if (element)` is false, so no re-observe.

**This is actually correct.** The cleanup path handles unmount properly. However, the `visibleIds` Set still contains the ID of the unmounted block. The block is removed from the observer, so no further IntersectionObserver entries will fire for it. The stale ID in `visibleIds` is harmless (the block no longer exists in the `blocks` array, so no render uses it), but it does mean the Set grows monotonically.

**Recommendation**: In the `observeBlock` callback, when `element` is `null`, also remove the `blockId` from `visibleIds`:

```typescript
if (!element) {
  setVisibleIds(prev => {
    if (!prev.has(blockId)) return prev;
    const next = new Set(prev);
    next.delete(blockId);
    return next;
  });
}
```

This prevents the Set from growing unboundedly over a long session with hundreds of evicted blocks.

---

### ADVISORY-3: Incremental ANSI parsing loses color state at chunk boundaries

**File**: `src/hooks/useIncrementalAnsi.ts`, lines 46-58

The task spec explicitly documents this as a known caveat, and the code comment on lines 19-21 states: "Caveat: ANSI state (current color) may not carry across chunk boundaries. For MVP this is acceptable -- most commands emit reset sequences frequently."

This is acceptable for MVP, but worth noting the concrete scenario where it is visible:

1. Command outputs `\x1b[32m` (green) followed by a large block of text.
2. PTY delivers this in two chunks: `\x1b[32mHello ` and `World\x1b[0m`.
3. The first chunk is parsed: one green span "Hello ".
4. The second chunk is parsed independently: one default-colored span "World" (the `\x1b[0m` reset is a no-op since there's no active color in this independent parse).

Result: "Hello " is green, "World" is default color. The user sees a color discontinuity mid-word.

**Mitigation for a future task**: Track the last active SGR state from `parsedSpans` and prepend it to the new chunk before parsing. This is a ~10-line change.

**Verdict**: Documented caveat, acceptable for MVP. No action required now.

---

### ADVISORY-4: Prefix matching uses only 64-character sample

**File**: `src/hooks/useIncrementalAnsi.ts`, lines 42, 50

```typescript
if (output.length === cache.parsedLength && output.slice(0, 64) === cache.prefixSample) {
  return cache.parsedSpans;
}
```

The 64-char prefix sample is used as a proxy for "the output text has not been replaced." This is a probabilistic check -- if the first 64 characters happen to be identical but the content was actually replaced (different text after the prefix), the hook would return stale spans.

In practice, this scenario is extremely unlikely in the Velocity output model because:
1. Output is append-only (never modified in place) during normal operation.
2. The only non-append mutation is truncation, which changes the prefix (marker is prepended).
3. The length check provides an additional guard (same length + same prefix = almost certainly same content).

**Verdict**: The 64-char sample is a pragmatic trade-off between correctness and performance (avoiding a full string comparison on 500KB). Acceptable. The comment on line 8 documents this. No action required.

---

### ADVISORY-5: Missing test for chunk-boundary ANSI color carry-over

**File**: `src/__tests__/useIncrementalAnsi.test.ts`

The test `test_incremental_parse_preserves_ansi_colors` (line 64) verifies that colors are preserved when appending new ANSI-colored text. However, it does not test the **cross-chunk color carry-over** scenario described in ADVISORY-3. Specifically:

- No test for: initial render with `\x1b[31m` (set red, no reset), then append plain text. The plain text should ideally be red (carried-over state) but will be default-colored due to the documented limitation.

Adding this test would document the known limitation as a failing-then-skipped test, or as a test that explicitly asserts the *current* behavior (plain text after chunk boundary has no color). This prevents future regressions if the carry-over fix is implemented.

**Recommendation**: Add a test that documents the current behavior:

```typescript
it('test_incremental_parse_loses_color_at_chunk_boundary', () => {
  // Known limitation: color state does not carry across incremental chunks
  const { result, rerender } = renderHook(
    ({ output }) => useIncrementalAnsi(output),
    { initialProps: { output: '\x1b[31mred text' } }, // No reset
  );
  rerender({ output: '\x1b[31mred text more text' });
  const spans = result.current;
  const lastSpan = spans[spans.length - 1];
  // Currently: "more text" has no color (chunk parsed independently)
  expect(lastSpan.fg).toBeUndefined(); // Documents known limitation
});
```

---

### ADVISORY-6: IntersectionObserver mock always reports visible

**File**: `src/__tests__/setup.ts`, lines 16-32

The mock `IntersectionObserver` immediately reports every observed element as `isIntersecting: true`. This is correct for ensuring existing tests continue to work (blocks render their content). However, it means the *visibility gating* behavior (non-visible blocks showing placeholders) is **never exercised in any test**.

There is no test that verifies:
1. A block renders a placeholder (not AnsiOutput) when `isVisible=false`.
2. The placeholder has the estimated height.
3. Transitioning from visible to non-visible swaps between AnsiOutput and placeholder.

The BlockView component's placeholder path (`data-testid="block-output-placeholder"`) is untested. If this path were broken, no test would catch it.

**Recommendation**: Add at least one test in `BlockView.test.tsx` that passes `isVisible={false}` and verifies the placeholder renders with the correct height, and that `AnsiOutput` is NOT rendered.

---

## Performance Impact Assessment

### BUG-004 (ANSI re-parse per event) -- Fixed

Before: Every PTY chunk triggered `parseAnsi()` on the entire accumulated output. For a block with 100KB of output receiving 50-byte chunks, each event parsed 100KB.

After: Only the new 50-byte chunk is parsed incrementally. The cached spans are concatenated. Parsing cost is proportional to the *new* data, not the *total* data. This is a major improvement -- from O(total_output * num_events) to O(total_output) total parsing work.

**Caveat**: The span array still accumulates (see MEDIUM-1), which means DOM rendering still scales with total span count. But DOM rendering is gated by the visibility check, so only visible blocks pay this cost.

### BUG-025 (unbounded output) -- Fixed

Before: A single `cat large-file.txt` could accumulate megabytes in one block's output string and span array.

After: Output is capped at ~500KB per block with front-truncation. Memory is bounded at ~500 blocks x 500KB = 250MB worst case.

### Block Virtualization -- New

Non-visible blocks render a lightweight `<pre>` placeholder instead of parsing ANSI and rendering hundreds of `<span>` elements. With 500px rootMargin, roughly 5-10 blocks are "visible" at any time. This reduces the React reconciliation and DOM node count from O(all_blocks) to O(visible_blocks).

**Overall**: The three changes together represent a significant performance improvement for the target scenarios (large outputs, many blocks). The MEDIUM-1 finding (span accumulation after truncation) is a correctness issue that limits the long-term effectiveness of the incremental parsing optimization but does not cause crashes or incorrect rendering.

---

## Test Quality

### New Tests (20 new across 3 files)

| File | Tests | Quality |
|------|-------|---------|
| `useIncrementalAnsi.test.ts` | 5 | Good coverage of incremental, full reparse, no-change, color preservation, and empty string cases. Missing chunk-boundary color test (ADVISORY-5). |
| `outputTruncation.test.tsx` | 2 | Integration tests that render full Terminal component, simulate PTY events, and verify truncation marker and tail preservation in the DOM. Well-constructed. |
| `scrollback.test.ts` | 2 | Constants-only tests (OUTPUT_LIMIT_PER_BLOCK, MAX_BLOCKS). Simple but useful for catching accidental changes. |

### Modified Tests (1)

| File | Change | Impact |
|------|--------|--------|
| `Terminal.test.tsx` | `MAX_BLOCKS` assertion changed from 50 to 500 | Correct, matches new constant. |

### Test Setup (setup.ts)

The `MockIntersectionObserver` addition is well-implemented. It correctly implements the full `IntersectionObserver` interface, immediately reports elements as visible (necessary for existing tests), and properly tracks observed/unobserved elements.

### Missing Test Coverage

1. **BlockView placeholder rendering** (ADVISORY-6) -- no test for `isVisible={false}`.
2. **Span accumulation after truncation** (MEDIUM-1) -- no test verifying span array does not grow unboundedly.
3. **estimateBlockHeight accuracy** -- no test for the height estimation function.
4. **useBlockVisibility lifecycle** -- no test for the IntersectionObserver hook itself (observe, unobserve, cleanup).
5. **Multi-event truncation** -- no test simulating multiple PTY events that individually exceed the limit, verifying stable state.

---

## Security Notes

- Output truncation does not affect the ANSI security filter (filtering is in Rust before output reaches the frontend). Confirmed: no security regression.
- IntersectionObserver is a standard read-only DOM API. No security implications.
- The `estimateBlockHeight` function processes untrusted output (PTY data) but only calls `split('\n')` and counts the result. No injection vector.
- The truncation marker is a hardcoded string, not derived from user input. Safe.

---

## Findings Summary

| ID | Severity | Description | Action |
|----|----------|-------------|--------|
| MEDIUM-1 | Medium | Span array grows without bound after output truncation; incremental cache is never invalidated when front-truncation occurs | **Must fix**: detect truncation in `useIncrementalAnsi` (e.g., when output length after append is less than `parsedLength + newPart.length`, or when output length remains near the cap while parsedSpans grows) and force full reparse |
| ADVISORY-1 | Low | `estimateBlockHeight` allocates large array via `split('\n')` on up to 500KB output | Replace with counting loop capped at 50 |
| ADVISORY-2 | Low | `visibleIds` Set accumulates stale IDs for unmounted blocks | Clean up on `element=null` callback |
| ADVISORY-3 | Info | Color state not carried across incremental chunk boundaries | Documented caveat, acceptable for MVP |
| ADVISORY-4 | Info | 64-char prefix sample is probabilistic, not exact | Acceptable trade-off, well-documented |
| ADVISORY-5 | Low | No test for chunk-boundary color carry-over behavior | Add test documenting known limitation |
| ADVISORY-6 | Low | No test for BlockView placeholder rendering (`isVisible=false`) | Add test for placeholder path |

---

## Acceptance Criteria Checklist

- [x] Per-block output capped at 500KB with truncation marker
- [x] MAX_BLOCKS increased to 500
- [x] Incremental ANSI parsing -- only new chunks parsed, not full reparse
- [x] Block visibility detection via IntersectionObserver
- [x] Off-screen blocks show placeholder instead of rendered AnsiOutput
- [x] BUG-004 fixed (no full re-parse per event) -- with caveat (MEDIUM-1)
- [x] BUG-025 fixed (output size bounded)
- [x] `npm run test` passes (242 tests, all green)
- [x] Clean commit message
- [ ] **Span cache invalidation on truncation** (MEDIUM-1 -- not addressed)

---

## Verdict: **NEEDS CHANGES**

The implementation is architecturally sound and delivers significant performance improvements for the targeted scenarios. The IntersectionObserver approach is clean, the incremental parsing hook is well-designed, and the output truncation logic is straightforward. Test coverage is good for the happy paths.

However, MEDIUM-1 (span array unbounded growth after truncation) is a correctness issue that undermines the performance goal for the exact scenario this task is meant to fix -- sustained large output from a single command. When a block hits the 500KB cap, subsequent events will accumulate spans indefinitely in the cache despite the text being truncated. This can lead to memory pressure and slow React reconciliation for the active block over time.

**Required before merge**: Fix MEDIUM-1 by detecting front-truncation in `useIncrementalAnsi` and forcing a full reparse (discarding accumulated spans) when it occurs.

**Recommended for R2**: Address ADVISORY-1 (estimateBlockHeight performance) and ADVISORY-6 (placeholder test coverage).
