# QA + Security Report: TASK-030 History Search (Ctrl+R) — R1

**Date**: 2026-03-23
**Commit**: `40dd84a` (HEAD on main)
**Reviewer**: Claude QA Agent
**Scope**: `HistorySearch.tsx`, `Terminal.tsx` integration, `App.css` styles, `commands.ts`, tests

---

## Test Results

| Suite | Result |
|-------|--------|
| Vitest (frontend) | **408 passed**, 0 failed |
| cargo test (Rust) | **113 passed**, 0 failed, 1 ignored + 11 integration |
| New tests added | 11 (HistorySearch.test.tsx) |

All existing and new tests pass.

---

## Security Review

**Verdict: PASS — no security issues found.**

- **No IPC changes**: Feature is entirely frontend; no new Tauri commands or Rust code.
- **No XSS risk**: `HighlightedMatch` uses React's JSX text content (`{before}`, `{matched}`, `{after}`) — never `dangerouslySetInnerHTML` or raw innerHTML. History entries containing `<script>`, HTML tags, or other payloads are safely escaped by React's default rendering. The `<mark>` element only wraps the matched substring via `.slice()`, not via regex replacement on raw HTML.
- **History is in-memory strings**: No persistence to disk, no IPC serialization, no injection surface.

---

## Code Review Findings

### BUG-001 (Low): `matchIndex` can desync from `matches` array if `history` prop changes mid-search

**File**: `src/components/HistorySearch.tsx`, line 72

```tsx
const currentMatch = matches.length > 0 ? history[matches[matchIndex]] : null;
```

If the `history` prop grows (e.g., another pane adds to shared history) while `historySearchOpen` is true and the user has cycled `matchIndex` forward, the `matches` array is recomputed via `useMemo` but `matchIndex` is not clamped. If the recomputed `matches` array is shorter than `matchIndex`, `matches[matchIndex]` is `undefined`, causing `history[undefined]` to be `undefined`. Since `undefined !== null`, the render path displays `<HighlightedMatch command={undefined} .../>`, which would call `.toLowerCase()` on `undefined` and throw.

**Impact**: Low — requires history to change externally while search is open with a cycled index, which is unlikely in single-pane usage. Multi-pane shared history would trigger it.

**Fix**: Clamp `matchIndex` to `matches.length - 1`:
```tsx
const clampedIndex = Math.min(matchIndex, Math.max(matches.length - 1, 0));
const currentMatch = matches.length > 0 ? history[matches[clampedIndex]] : null;
```

### BUG-002 (Low): Ctrl+R not guarded by `altScreenActive` in document-level handler

**File**: `src/components/Terminal.tsx`, lines 682-695

The document-level `keydown` handler for Ctrl+R does not check `altScreenActive`. In alt-screen mode (e.g., vim, less), if focus somehow escapes the grid element, Ctrl+R opens history search instead of being ignored or forwarded to the PTY.

In practice, `handleGridKeyDown` calls `e.stopPropagation()` so this only fires when the grid does not have focus — unlikely but possible.

**Fix**: Add `if (altScreenActive) return;` at the top of the handler, matching the pattern used by other intercepted shortcuts.

### STYLE-001 (Nit): `handleHistorySearchAccept` and `handleHistorySearchCancel` missing dependency

**File**: `src/components/Terminal.tsx`, lines 697-709

Both `useCallback` hooks have empty dependency arrays `[]`, but they reference `editorRef` (stable ref, OK) and call `setInput`/`setHistorySearchOpen` (stable setState, OK). This is technically correct since React state setters are stable, but `savedInputRef.current` in the cancel handler is also read from a ref (stable). No functional issue — just noting for documentation.

---

## Edge Case Analysis

| Edge Case | Status | Notes |
|-----------|--------|-------|
| Empty history (`[]`) | PASS | `findMatches` returns `[]`, no match displayed |
| Empty query | PASS | `findMatches` returns `[]` early; no match rendered |
| Single-character query (`"g"`) | PASS | Matches all history containing "g", cycles correctly |
| Very long command (1000+ chars) | PASS | CSS `text-overflow: ellipsis` + `overflow: hidden` handles display; no truncation of match logic |
| History with HTML/script tags | PASS (Security) | React escapes content; `<mark>` only wraps `.slice()` result |
| Ctrl+R at oldest match | PASS | Clamps via `Math.min(prev + 1, matches.length - 1)` |
| Ctrl+R with no query (empty input) | PASS | `matches` is `[]`, `setMatchIndex` is no-op |
| Escape restores original input | PASS | `savedInputRef.current` captured on open, restored on cancel |
| Enter with no match | PASS | `currentMatch` is `null`, `onAccept` not called |
| Repeated open/close cycles | PASS | `useEffect` resets `query` and `matchIndex` on each open |
| Keyboard conflict with Ctrl+Shift+F | NONE | Ctrl+R uses `!e.shiftKey` guard; no conflict |
| Keyboard conflict with block nav (Ctrl+Up/Down) | NONE | Different key, different modifier check |
| Command palette `history.search` action | PASS | Dispatches same open logic as Ctrl+R |

---

## Test Coverage Assessment

The 11 new tests cover:
- Basic search matching
- Case-insensitive search
- No-match display
- Ctrl+R cycling through matches
- Enter accepts current match
- Escape cancels
- Query change resets match index
- Open/close toggling
- Highlight rendering (`<mark>` tag)
- Enter-with-no-match guard
- Hidden-when-closed

**Missing test coverage**:
- No integration test for Ctrl+R opening history search from Terminal (document-level handler)
- No test for history with special characters (HTML tags, ANSI escapes, unicode)
- No test for Ctrl+R wrapping/clamping at the last match

---

## Summary

| Category | Verdict |
|----------|---------|
| Security | **PASS** — no XSS, no IPC, no injection surfaces |
| Functionality | **PASS with 2 low-severity bugs** |
| Tests | **PASS** — 408/408, 11 new |
| Code Quality | Good — clean separation, proper React patterns |

**Bugs to track**:
- **BUG-001**: `matchIndex` not clamped when `matches` array shrinks (Low)
- **BUG-002**: Ctrl+R not guarded by `altScreenActive` (Low)
