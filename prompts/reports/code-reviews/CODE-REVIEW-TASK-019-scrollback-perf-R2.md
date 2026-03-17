# Code Review: TASK-019 -- Scrollback Buffer + Large Output Performance (R2)

**Reviewer**: Code Reviewer Agent (Claude Opus 4.6)
**Date**: 2026-03-17
**Commit**: `b7bca3d fix: reset incremental ANSI cache on output truncation`
**Previous Round**: R1 (`25ae200`) -- NEEDS CHANGES (1 medium, 5 advisory)
**Verdict**: **APPROVE**

---

## R1 Findings Disposition

| ID | Severity | R1 Finding | R2 Status |
|----|----------|------------|-----------|
| MEDIUM-1 | Medium | Span array grows unbounded after truncation; incremental cache never invalidated on front-truncation | **FIXED** -- suffix sample added, explicit truncation path added, full reparse forced on truncation and same-length content changes |
| ADVISORY-1 | Low | `estimateBlockHeight` allocates large array via `split('\n')` on up to 500KB output | **FIXED** -- replaced with counting loop capped at 50 newlines |
| ADVISORY-2 | Low | `visibleIds` Set accumulates stale IDs for unmounted blocks | Not addressed (accepted -- stale IDs are harmless since blocks no longer exist in render) |
| ADVISORY-3 | Info | Color state not carried across incremental chunk boundaries | Not addressed (accepted -- documented caveat for MVP) |
| ADVISORY-4 | Info | 64-char prefix sample is probabilistic, not exact | Not addressed (accepted -- now strengthened by suffix sample) |
| ADVISORY-5 | Low | No test for chunk-boundary color carry-over behavior | Not addressed (accepted -- future work) |
| ADVISORY-6 | Low | No test for BlockView placeholder rendering (`isVisible=false`) | Not addressed (accepted -- future work) |

---

## R2 Changes Analysis

The fix commit modifies 3 files (+82/-4 lines):

### 1. `src/hooks/useIncrementalAnsi.ts` -- Cache invalidation on truncation

**Changes**:
- Added `suffixSample` field (last 64 chars) to `IncrementalAnsiState`
- "No change" check now requires prefix AND suffix AND length to all match
- New explicit truncation path: when `output.length < cache.parsedLength`, full reparse
- Suffix sample updated in all cache-write paths (empty, truncation, incremental, fallback)

**Correctness trace for MEDIUM-1 scenario (sustained output at 500KB cap)**:

1. **First truncation event**: Output shrinks from ~510K to ~500,042 chars (marker + 500K). `output.length < cache.parsedLength` is true. Explicit truncation path fires: full reparse, cache reset. Correct.

2. **Subsequent events (steady state)**: Each event appends a small payload to ~500,042 chars, producing ~500,092 chars, which is re-truncated to ~500,042 chars. The hook receives a 500,042-char string. `cache.parsedLength` is also 500,042 from the previous cycle. Same length. Prefix matches (both start with truncation marker). But suffix differs -- the tail content shifted because new data was appended and the front was re-sliced at a different boundary. The suffix check fails, preventing a false cache hit. Control falls through to the catch-all full reparse (line 82-88). Span array is replaced, not accumulated. Correct.

3. **No-change case**: If the exact same output is passed (e.g., React re-render with no new PTY event), length matches, prefix matches, suffix matches. Cache hit returns same reference. Correct for React.memo optimization.

**Edge case -- outputs shorter than 64 chars**: `slice(0, 64)` and `slice(-64)` both return the full string. Both prefix and suffix checks become full-string equality checks. Strictly correct.

**Edge case -- identical prefix and suffix but different middle**: Theoretically possible for strings longer than 128 chars. Would cause a false cache hit. In practice, impossible for the Velocity output model where mutations are only appends and front-truncations. Same probabilistic trade-off as R1 ADVISORY-4, now slightly stronger due to the suffix guard. Acceptable.

### 2. `src/hooks/useBlockVisibility.ts` -- estimateBlockHeight optimization

**Changes**: `output.split('\n').length` replaced with a counting loop that increments `lines` for each `\n` found and short-circuits when `lines >= 50`.

**Correctness**:
- Starts at `lines = 1` (correct -- a string with no newlines is 1 line)
- Loop condition `lines < 50` stops counting at 50 lines (matching the old `Math.min(lines, 50)` cap)
- Empty string: loop body never executes, `lines = 1`. Old code: `"".split('\n')` = `[""]`, length 1. Same result.
- Trailing newline: `"a\n".split('\n')` = `["a", ""]`, length 2. Loop: finds one `\n`, lines = 2. Same result.
- `Math.min(lines, 50)` removed from the height calculation since the loop already caps `lines` at 50. Correct.

**Performance**: Eliminates allocation of a potentially large string array on every render of a non-visible block. For a 500KB output with 10,000+ lines, this avoids creating a 10,000-element array and instead scans at most until the 50th newline (likely within the first few KB). Significant improvement for the target scenario.

### 3. `src/__tests__/useIncrementalAnsi.test.ts` -- Two new tests

**`test_incremental_reparse_on_truncation_with_marker`**: Tests the initial truncation scenario. Large output (1000 chars) is replaced with marker + shorter tail. Verifies that the hook produces spans matching a fresh `parseAnsi()` of the truncated output. This exercises the `output.length < cache.parsedLength` path (line 57). Well-constructed.

**`test_incremental_reparse_on_steady_state_truncation`**: Tests the steady-state scenario that was the core of MEDIUM-1. Two same-length outputs with the same prefix (truncation marker) but different suffixes (`ENDING_ONE` vs `ENDING_TWO`). Includes an explicit assertion that `output2.length === output1.length` to ensure the same-length path is exercised. Verifies content correctness and absence of stale data. This directly validates the suffix check. Well-constructed.

Both tests compare the hook's output against a fresh `parseAnsi()` call, which is the strongest possible correctness assertion (equivalent output).

### 4. `prompts/STATE.md` -- Updated project state

Transitioned from "MVP COMPLETE" to "Post-MVP Phase 1 (Usability)." Added BUG-039 (redundant re-truncation at cap) to outstanding issues. Updated test counts (244 Vitest, 69 Rust, 347 total). Condensed completed MVP tasks into a Phase 1 progress table. Reasonable and accurate.

---

## Remaining Advisory Items (not blocking)

### ADVISORY-R2-1: BUG-039 -- Redundant re-truncation at cap (existing, not introduced by R2)

After the first truncation, every subsequent PTY event triggers re-truncation because `b.output` (~500,042 chars including the marker) plus any payload always exceeds `OUTPUT_LIMIT_PER_BLOCK` (500,000). The truncation marker (42 chars) is included in the stored output, so the effective cap is 500,042 chars, not 500,000. Each event allocates a new string via `slice(-500_000)` and prepends the marker.

This is listed in STATE.md as BUG-039. It is a minor performance concern (one extra allocation per event for blocks at the cap), not a correctness issue. The R2 fix ensures the hook's span cache handles this correctly via full reparse, so the rendering is always accurate.

**Future fix**: Either account for the marker length in the truncation check, or use a separate boolean flag to indicate truncation rather than embedding the marker in the output string.

### ADVISORY-R2-2: Probabilistic cache identity check

The prefix+suffix+length triple is a practical heuristic, not a cryptographic identity check. For the Velocity output model (append-only with occasional front-truncation), it is extremely robust. The R2 suffix addition strengthens it meaningfully against the steady-state truncation scenario. No action needed.

---

## Test Verification

All 244 frontend tests pass, including the 2 new tests added in R2:

| File | Tests | Status |
|------|-------|--------|
| `useIncrementalAnsi.test.ts` | 7 (5 from R1 + 2 new) | All pass |
| All other test files | 237 | All pass |

---

## Security Notes

No security-relevant changes in R2. The suffix sample is derived from the same output string already processed by the ANSI security filter in Rust. The `estimateBlockHeight` optimization is a pure algorithmic change with no security implications.

---

## Verdict: **APPROVE**

The R2 fix correctly addresses MEDIUM-1 (the only blocking finding from R1). The suffix sample approach is a clean, minimal change that detects content changes at the same output length, forcing a full reparse when steady-state truncation produces different content. The two new tests directly exercise the exact scenarios described in MEDIUM-1 (initial truncation and steady-state truncation). ADVISORY-1 (estimateBlockHeight allocation) is also fixed with a correct counting-loop replacement.

The code is ready to merge.
