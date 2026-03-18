# Code Review: TASK-020 Find-in-Output Search (R1)

**Commit:** `3848a3a feat: add find-in-output search with Ctrl+Shift+F`
**Reviewer:** Code Reviewer Agent
**Date:** 2026-03-17

---

## Files Reviewed

| File | Change |
|------|--------|
| `src/hooks/useSearch.ts` | New — core search hook |
| `src/components/SearchBar.tsx` | New — search bar UI component |
| `src/components/AnsiOutput.tsx` | Modified — highlight overlay support |
| `src/components/Terminal.tsx` | Modified — search integration |
| `src/components/blocks/BlockView.tsx` | Modified — pass highlights through |
| `src/App.css` | Modified — search bar and highlight styles |
| `src/__tests__/useSearch.test.ts` | New — 9 tests |
| `src/__tests__/SearchBar.test.tsx` | New — 8 tests |
| `src/__tests__/AnsiOutput.test.tsx` | Modified — 7 new highlight tests |
| `src/__tests__/Terminal.test.tsx` | Modified — 3 new integration tests |
| `e2e/find-in-output.spec.ts` | New — E2E test |

---

## Critical (Must fix)

### C1: ReDoS vulnerability via user-controlled search query used with `indexOf`

- **File**: `src/hooks/useSearch.ts:88`
- **Issue**: While `indexOf` itself is not vulnerable to ReDoS (it is a literal string search, not regex), the current implementation allows **overlapping matches** (`pos = idx + 1` on line 95), which combined with a crafted single-character query like `"a"` against a 500KB block of `"aaa..."` could produce up to 500,000 match objects before hitting `MAX_MATCHES`. Each match is an object with 3 properties allocated on the heap. For 10,000 matches (the cap), this is manageable, but the `indexOf` loop will execute up to 500,000 times per block before the cap kicks in. With 500 blocks, this is up to 250 million iterations in a single synchronous `useMemo`.
- **Fix**: Add an early-exit when `searchQuery.length === 1` to use `pos = idx + searchQuery.length` instead of `pos = idx + 1` (since overlapping is impossible for single-char). More importantly, consider whether overlapping matches are actually desired UX. Most editors (VS Code, Chrome DevTools) do **not** produce overlapping matches. Switching to `pos = idx + searchQuery.length` for all cases would dramatically reduce iteration count.
- **Why**: A single-character search in a pane with many blocks of large output could freeze the UI thread for several seconds. This is a denial-of-service against the user (not a remote attack), but it degrades the UX significantly and could make the app appear hung.

### C2: `strippedCacheRef` is never pruned, causing unbounded memory growth

- **File**: `src/hooks/useSearch.ts:44`
- **Issue**: The `strippedCacheRef` Map stores a stripped copy of every block's output keyed by `block.id`. Blocks are evicted from `blocks[]` when they exceed `MAX_BLOCKS` (500), but the corresponding entries in `strippedCacheRef` are never removed. Over a long session, this cache grows without bound, holding stripped copies of output that no longer exists in the blocks array.
- **Fix**: After the search computation (or on block changes), prune stale cache entries by intersecting the cache keys with the current block IDs. For example:
  ```typescript
  // After computing matches, prune stale cache entries
  const currentIds = new Set(blocks.map(b => b.id));
  for (const key of strippedCacheRef.current.keys()) {
    if (!currentIds.has(key)) strippedCacheRef.current.delete(key);
  }
  ```
- **Why**: With `OUTPUT_LIMIT_PER_BLOCK` at 500KB and blocks being evicted, each evicted block leaves ~500KB of stripped text in the cache. Over time this is a significant memory leak.

---

## Important (Should fix)

### I1: `search` object in useEffect dependency causes re-subscription on every render

- **File**: `src/components/Terminal.tsx:411`
- **Issue**: The `useEffect` for the Ctrl+Shift+F keyboard handler has `[search]` as its dependency array. The `search` object returned by `useSearch` is a new object on every render (it contains properties like `matches`, `currentMatchIndex`, etc. that change frequently). This means the `keydown` event listener is removed and re-added on every render cycle where any search state changes.
- **Fix**: Extract only the specific stable callbacks needed: `[search.isOpen, search.open]`. Alternatively, use `useRef` to hold the `search` reference and use a stable dependency.
- **Why**: Frequent addEventListener/removeEventListener cycles are wasteful and can cause subtle timing bugs where a keypress is missed during the brief gap between removal and re-addition.

### I2: `handleSearchClose` has `[search]` dependency — same instability issue

- **File**: `src/components/Terminal.tsx:414-419`
- **Issue**: Same problem as I1. The `handleSearchClose` callback depends on `[search]`, meaning it is recreated every time any search state changes. Since it is passed as a prop to `SearchBar`, this causes `SearchBar` to re-render unnecessarily.
- **Fix**: Depend on `[search.close]` instead, or use a ref-based pattern.
- **Why**: Unnecessary re-renders of the SearchBar component, and the passed-down `onClose` prop changes identity constantly.

### I3: Scroll-to-match uses nested `setTimeout` without cleanup for inner timer

- **File**: `src/components/Terminal.tsx:439-443`
- **Issue**: Inside the `useEffect` for scrolling to the current match, there is an outer `setTimeout` (50ms) whose cleanup is handled, but inside its callback there is a nested `setTimeout` (200ms) on line 440. If the component unmounts or the effect re-runs during the 200ms window, the inner timeout will still fire and call `scrollIntoView` on a potentially stale or unmounted element.
- **Fix**: Track the inner timeout and clear it in the effect cleanup:
  ```typescript
  let innerTimer: number;
  const timer = setTimeout(() => {
    // ...
    innerTimer = setTimeout(() => { ... }, 200);
  }, 50);
  return () => { clearTimeout(timer); clearTimeout(innerTimer); };
  ```
- **Why**: Could cause React warnings about updating unmounted components, or scroll to incorrect positions after rapid navigation.

### I4: DOM queries (`document.querySelector`) used instead of React refs

- **File**: `src/components/Terminal.tsx:401, 417, 427, 434`
- **Issue**: Multiple places use `document.querySelector('.search-input')`, `document.querySelector('[data-testid="editor-textarea"]')`, and `document.querySelector('.search-highlight-current')` to imperatively access DOM elements. This bypasses React's declarative model and is fragile if class names or test IDs change.
- **Fix**: For the search input focus, pass a ref from Terminal into SearchBar. For the editor textarea focus, use a callback ref. The scroll-to-highlight usage is more acceptable since it needs to find a dynamically-placed element, but consider using a callback ref pattern with `scrollIntoView`.
- **Why**: Direct DOM queries are an anti-pattern in React. They break encapsulation, are not SSR-safe (not relevant here, but a code quality concern), and create hidden coupling between components.

### I5: Custom `React.memo` comparator for `AnsiOutput` is incomplete

- **File**: `src/components/AnsiOutput.tsx:175-183`
- **Issue**: The custom memo comparator returns `false` (re-render) when `prev.highlights !== next.highlights` and neither is empty. This means that even if the highlights array has identical content, a new array reference (which happens on every render due to the `useMemo` in Terminal computing `blockHighlights`) will trigger a re-render. The optimization is partially defeated.
- **Fix**: Either perform a shallow comparison of the highlights array elements, or ensure that the `blockHighlights` computation in Terminal returns stable references (e.g., by memoizing per-block arrays individually rather than rebuilding the entire Map).
- **Why**: During active search navigation (goToNext/goToPrev), every visible block's AnsiOutput will re-render even if only the "current" highlight changed in a different block. With large outputs this could cause jank.

### I6: `SearchBar` counter text shows `"0 of 0"` edge case

- **File**: `src/components/SearchBar.tsx:73`
- **Issue**: When `currentMatchIndex` is -1 and `matchCount` is 0 with a non-empty query, the counter shows "No results" which is correct. But during the debounce window (query is typed, debounced query hasn't updated yet), `matchCount` could be from the old search while `currentMatchIndex` is -1. This would show `"0 of N"` which is confusing.
- **Fix**: Guard the display so that when `currentMatchIndex` is -1 and `matchCount > 0`, show something like `"-- of N"` or simply show the count without a current position.
- **Why**: Brief UI inconsistency during typing, though it self-resolves after the debounce. Minor UX polish issue.

---

## Suggestions (Nice to have)

### S1: Consider regex search option

- **File**: `src/hooks/useSearch.ts`
- **Issue**: The search only supports literal string matching. Power users in a terminal app frequently want regex search (e.g., searching for error codes matching a pattern).
- **Fix**: Add a regex toggle alongside the case-sensitivity toggle. Wrap user input in a try/catch when constructing the RegExp to handle invalid patterns gracefully.
- **Why**: Feature parity with VS Code terminal, Warp, and other modern terminals.

### S2: Debounce timer could be configurable or shorter

- **File**: `src/hooks/useSearch.ts:28`
- **Issue**: The 150ms debounce is reasonable but may feel slightly sluggish on fast machines. VS Code uses ~100ms for its search.
- **Fix**: Consider reducing to 100ms, or making it adaptive based on block count/size.
- **Why**: Minor responsiveness improvement.

### S3: The `buildSegments` function could benefit from a unit test

- **File**: `src/components/AnsiOutput.tsx:39-125`
- **Issue**: The `buildSegments` function contains non-trivial logic for splitting spans at highlight boundaries, handling cross-span highlights, and emitting correct segments. The existing tests exercise it indirectly through rendering, but direct unit tests of the function would catch edge cases more precisely (e.g., adjacent highlights, zero-length spans, highlights at exact span boundaries).
- **Fix**: Export `buildSegments` (or a wrapper) and add focused unit tests.
- **Why**: The span-splitting algorithm is the most complex piece of this feature and the most likely to have edge-case bugs.

### S4: Unused `innerSpan` variable in test

- **File**: `src/__tests__/AnsiOutput.test.tsx:114`
- **Issue**: `const innerSpan = highlights[0].querySelector('span') || highlights[0];` is assigned but never used in any assertion.
- **Fix**: Either add an assertion using `innerSpan` (e.g., check its `style.color`) or remove the dead variable.
- **Why**: Dead code in tests is misleading — it suggests the test is verifying something it is not.

### S5: The `close()` function clears `debouncedQuery` directly, bypassing the debounce

- **File**: `src/hooks/useSearch.ts:148-152`
- **Issue**: When closing search, `setDebouncedQuery('')` is called directly alongside `setQuery('')`. This is actually correct behavior (we want immediate clearing), but it means there is a pending debounce timer that will fire later and redundantly set the same empty state.
- **Fix**: Cancel the debounce timer in `close()`:
  ```typescript
  const close = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsOpen(false);
    setQuery('');
    setDebouncedQuery('');
    setCurrentMatchIndex(-1);
  }, []);
  ```
- **Why**: Clean resource management; avoids unnecessary state updates after close.

---

## Security Checklist

| Check | Status | Notes |
|-------|--------|-------|
| No command injection | PASS | Feature is frontend-only, no shell commands involved |
| Input validation (IPC) | N/A | No new Tauri commands added |
| No path traversal | N/A | No file operations |
| PTY output safety | PASS | Search operates on stripped text; ANSI codes are removed before matching |
| No secret leakage | PASS | No sensitive data exposed |
| No unsafe Rust | N/A | No Rust changes |
| ANSI parsing safety | PASS | Uses existing `stripAnsi` and `parseAnsi` which are already reviewed |
| IPC permissions | N/A | No IPC changes |

The search feature is entirely frontend-side and does not interact with the PTY or shell in any way. The search query is a user-controlled string used only for `indexOf` matching against already-rendered terminal output. No security concerns with this approach.

---

## Summary

- **Total findings**: 2 critical, 6 important, 5 suggestions
- **Overall assessment**: **NEEDS CHANGES**

The implementation is architecturally sound and well-structured. The separation of concerns (useSearch hook for logic, SearchBar for UI, AnsiOutput for rendering) is clean. Test coverage is good with 27 new tests across unit, component, and E2E levels.

However, there are two critical issues:

1. **C1**: The overlapping-match search loop can freeze the UI on pathological inputs (single-character queries against large outputs). Switching from `pos = idx + 1` to `pos = idx + searchQuery.length` is a one-line fix that eliminates the problem while matching standard editor behavior.

2. **C2**: The stripped-text cache grows without bound as blocks are evicted. A simple pruning step after search computation resolves this.

The important findings (I1-I6) are mainly about React performance and correctness patterns (unstable dependencies, missing timeout cleanup, DOM queries instead of refs). These should be addressed but are not blocking.
