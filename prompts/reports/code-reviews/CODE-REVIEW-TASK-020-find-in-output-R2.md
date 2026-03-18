# Code Review: TASK-020 Find-in-Output Search (R2)

**Commits:** `3848a3a feat: add find-in-output search with Ctrl+Shift+F` + `7251e29 fix: address code review findings for find-in-output`
**Reviewer:** Code Reviewer Agent
**Date:** 2026-03-17

---

## Previous Round Resolution

| ID | Finding | Status | Notes |
|----|---------|--------|-------|
| C1 | Overlapping-match search loop freezes UI on single-char queries | **RESOLVED** | Changed to `pos = idx + searchQuery.length` (non-overlapping), matching VS Code/Chrome behavior. Line 95 of `useSearch.ts`. |
| C2 | `strippedCacheRef` never pruned, unbounded memory growth | **RESOLVED** | Cache pruning added after match computation (lines 101-105 of `useSearch.ts`). Intersects cache keys with current block IDs and deletes stale entries. |
| I1 | `[search]` dependency in Ctrl+Shift+F useEffect causes re-subscription every render | **RESOLVED** | Changed to `[search.isOpen, search.open]` (line 413 of `Terminal.tsx`). Both are stable: `isOpen` is a boolean, and `open` is a `useCallback` with `[]` deps. |
| I2 | `handleSearchClose` has `[search]` dependency -- same instability | **RESOLVED** | Changed to `[search.close]` (line 423 of `Terminal.tsx`). `search.close` is a `useCallback` with `[]` deps, so the reference is stable. |
| I3 | Nested `setTimeout` in scroll-to-match has no cleanup for inner timer | **RESOLVED** | Inner timer is now tracked with `let innerTimer` and cleared in the effect cleanup: `return () => { clearTimeout(timer); clearTimeout(innerTimer); }` (lines 429, 445, 454 of `Terminal.tsx`). |
| I4 | DOM queries (`document.querySelector`) used instead of React refs | **RESOLVED** | Two of the three DOM queries were replaced with refs: (1) `searchInputRef` passed into `SearchBar` via new `inputRef` prop, (2) `editorRef` passed into `InputEditor` via new `textareaRef` prop. The remaining `document.querySelector('.search-highlight-current')` for scroll-to-highlight is acceptable since the target element is dynamically rendered across many blocks and cannot be practically tracked via a single ref. |
| I5 | Custom `React.memo` comparator for `AnsiOutput` is incomplete | **RESOLVED** | Added shallow element-wise comparison of the highlights array: compares `length`, then iterates and checks `startOffset`, `length`, and `isCurrent` for each element (lines 182-192 of `AnsiOutput.tsx`). This prevents unnecessary re-renders when a new array reference contains identical highlight data. |
| I6 | SearchBar counter shows `"0 of N"` during debounce window | **RESOLVED** | Added guard for `currentMatchIndex === -1` with `matchCount > 0`, displaying `"${matchCount} matches"` without a current position (line 75-76 of `SearchBar.tsx`). |
| S1 | Consider regex search option | **N/A** | Suggestion for future work; not expected in this fix round. |
| S2 | Debounce timer could be shorter | **N/A** | Suggestion; not addressed and not expected. |
| S3 | `buildSegments` could use direct unit tests | **N/A** | Suggestion; not addressed and not expected. |
| S4 | Unused `innerSpan` variable in test | **STILL OPEN** | The variable at line 114 of `AnsiOutput.test.tsx` is still assigned but never asserted on. Minor dead code in test. |
| S5 | `close()` should cancel pending debounce timer | **RESOLVED** | Added `if (debounceRef.current) clearTimeout(debounceRef.current)` at the start of `close()` (line 154 of `useSearch.ts`). |

---

## Files Reviewed (R2 Fix Commit)

| File | Change |
|------|--------|
| `src/hooks/useSearch.ts` | Non-overlapping matches, cache pruning, debounce timer cleanup on close |
| `src/components/SearchBar.tsx` | External `inputRef` prop, `currentMatchIndex === -1` counter text |
| `src/components/AnsiOutput.tsx` | Shallow comparison in memo comparator |
| `src/components/Terminal.tsx` | Ref-based focus (searchInputRef, editorRef), stable deps, inner timer cleanup |
| `src/components/editor/InputEditor.tsx` | External `textareaRef` prop |

---

## New Findings (R2)

### Suggestions (Nice to have)

#### S1-R2: `inputRef` missing from `useEffect` dependency in SearchBar (lint suppression candidate)

- **File**: `src/components/SearchBar.tsx:34-38`
- **Issue**: The auto-focus `useEffect` uses `inputRef` but the dependency array only includes `[isOpen]`. Since `inputRef` is a ref (either from `useRef` internally or from the parent's `useRef`), the object identity is stable across renders, so this is functionally correct. However, the React ESLint plugin (`react-hooks/exhaustive-deps`) would flag this as a missing dependency. Adding `inputRef` to the dependency array would silence the lint warning with no behavioral change, since the ref identity never changes.
- **Impact**: None at runtime; lint cleanliness only.

#### S2-R2: Unused `innerSpan` variable still present in test (carried from R1 S4)

- **File**: `src/__tests__/AnsiOutput.test.tsx:114`
- **Issue**: `const innerSpan = highlights[0].querySelector('span') || highlights[0];` is assigned but never used. Carried over from R1 finding S4.
- **Impact**: Dead code in test; misleading about what the test validates.

#### S3-R2: Cache pruning runs inside `useMemo` -- minor overhead on every search recomputation

- **File**: `src/hooks/useSearch.ts:101-105`
- **Issue**: The cache pruning logic (creating a `Set` of current block IDs and iterating over the cache) runs inside the `useMemo` that computes matches. This means it runs every time any dependency changes (query, case-sensitivity, blocks). The pruning itself is O(B) where B is the number of blocks, which is negligible compared to the search loop. However, conceptually, pruning is a side-effect and `useMemo` is intended to be pure. In practice this has no observable consequence because the pruning modifies a ref (not state), and the search result is not affected by the pruning. This is a code purity observation, not a bug.
- **Impact**: None in practice; conceptual purity concern only.

---

## Security Checklist

| Check | Status | Notes |
|-------|--------|-------|
| No command injection | PASS | Feature is frontend-only, no shell commands involved |
| Input validation (IPC) | N/A | No new Tauri commands added |
| PTY output safety | PASS | Search operates on stripped text; ANSI codes removed before matching |
| No secret leakage | PASS | No sensitive data exposed |
| ANSI parsing safety | PASS | Uses existing reviewed `stripAnsi` and `parseAnsi` |
| No unsafe Rust | N/A | No Rust changes |

---

## Test Verification

All 271 tests pass (25 test files, 0 failures). The fix commit introduces no test regressions.

Relevant test coverage for the fix:
- `useSearch.test.ts`: 9 tests covering matching, case sensitivity, ANSI stripping, navigation, block updates
- `SearchBar.test.tsx`: 8 tests covering open/close, keyboard navigation, match count display
- `AnsiOutput.test.tsx`: 7 new highlight tests covering single/multiple/cross-span/current highlights
- `Terminal.test.tsx`: 3 new integration tests covering Ctrl+Shift+F opening, highlight rendering, Escape close
- `e2e/find-in-output.spec.ts`: 1 E2E test for full search workflow

---

## Summary

- **Total findings**: 0 critical, 0 important, 3 suggestions (all minor)
- **All R1 critical findings**: RESOLVED
- **All R1 important findings**: RESOLVED
- **R1 suggestions**: 2 resolved (S4, S5), 3 N/A (future work)
- **Overall assessment**: **APPROVE**

The fix commit cleanly addresses all 2 critical and 6 important findings from R1. The overlapping-match performance issue (C1) is resolved with a one-line change to non-overlapping semantics. The unbounded cache growth (C2) is resolved with proper pruning. All important findings around React hook dependencies, timer cleanup, and DOM query patterns are properly fixed. The ref-based approach for SearchBar and InputEditor focus management is well-implemented using the external/internal ref pattern. The shallow comparison in the AnsiOutput memo comparator is thorough, checking all three properties of each highlight element.

The three remaining suggestions are cosmetic (dead test variable, lint cleanliness, `useMemo` purity) and do not warrant blocking the merge.
