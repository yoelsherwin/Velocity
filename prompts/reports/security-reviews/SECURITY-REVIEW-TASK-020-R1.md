# Security Review: TASK-020 (Find in Terminal Output / Ctrl+Shift+F)

**Reviewer**: Security Agent (automated)
**Date**: 2026-03-17
**Commit range**: `b7bca3d..7251e29` (2 commits: `3848a3a feat: add find-in-output search with Ctrl+Shift+F` + `7251e29 fix: address code review findings for find-in-output`)
**Previous security review HEAD**: `25ae200` (SECURITY-REVIEW-TASK-019-R1)
**Verdict**: PASS WITH FINDINGS (0 critical, 0 high, 1 medium, 2 low, 2 informational)

---

## 1. Executive Summary

This review covers TASK-020: Find in Terminal Output (Ctrl+Shift+F). The changes are **entirely frontend** (React/TypeScript). There are zero Rust backend modifications, zero new IPC commands, zero dependency additions, and zero Tauri configuration changes.

The feature introduces:

1. A search overlay (`SearchBar.tsx`) activated by Ctrl+Shift+F
2. A search engine hook (`useSearch.ts`) that performs substring matching across all block outputs
3. Highlight rendering in `AnsiOutput.tsx` via a segment-splitting algorithm
4. Plumbing in `Terminal.tsx` and `BlockView.tsx` to wire search state to rendering
5. A forwarded ref mechanism for `InputEditor.tsx` to return focus on search close

### Key Security Invariants Verified

- **No new IPC surface**: No new Tauri commands or events. The search is entirely client-side.
- **No new data flow from untrusted sources**: The search operates on block output that has already passed through the Rust ANSI security filter.
- **No `dangerouslySetInnerHTML` or raw HTML injection**: All rendering uses React's JSX templating with automatic HTML escaping.
- **No regex on user input**: Search uses `String.indexOf()`, which is immune to ReDoS.
- **No command execution triggered by search**: The search feature is read-only; it does not invoke shell commands or IPC calls.
- **ANSI security filter pipeline unchanged**: Rust filters PTY output before it reaches the frontend. The search operates on already-filtered text.

---

## 2. Attack Surface Mapping

### 2.1 New Components

| Component | Type | Inputs | Outputs | Risk |
|-----------|------|--------|---------|------|
| `src/hooks/useSearch.ts` | React hook | `blocks` (PTY output, untrusted), `query` (user input, semi-trusted) | `matches[]`, `matchesByBlock` Map | Medium |
| `src/components/SearchBar.tsx` | React component | `query`, `matchCount`, keyboard events | Rendered DOM, callback invocations | Low |
| `src/components/AnsiOutput.tsx` (modified) | React component | `highlights[]` (derived from search), `text` (PTY output) | Rendered `<mark>` and `<span>` elements | Low |
| `src/components/Terminal.tsx` (modified) | React component | Keyboard events (Ctrl+Shift+F), search state | SearchBar rendering, blockHighlights Map | Low |
| `src/components/blocks/BlockView.tsx` (modified) | React component | `highlights[]` (passed through) | Forwarded to AnsiOutput | Low |
| `src/components/editor/InputEditor.tsx` (modified) | React component | `textareaRef` (forwarded ref) | Focus management | Low |

### 2.2 Data Flow Diagram

```
User types in search input (semi-trusted)
  -> setQuery() updates useSearch hook state
  -> 150ms debounce
  -> useSearch iterates blocks[].output (untrusted PTY output, already ANSI-filtered by Rust)
  -> stripAnsi() removes SGR sequences from output text
  -> String.indexOf() performs substring match (no regex)
  -> SearchMatch[] with {blockId, startOffset, length}
  -> Terminal.tsx computes blockHighlights Map (only for visible blocks)
  -> BlockView passes highlights to AnsiOutput
  -> AnsiOutput.buildSegments() splits spans at highlight boundaries
  -> React renders <mark> elements with CSS classes (no raw HTML)
```

### 2.3 Trust Boundary Analysis

The search query is **semi-trusted** (user-controlled input within the WebView). The block output is **untrusted** (PTY output from arbitrary shell processes). The critical question is: can the interaction between user search input and untrusted PTY output create a security issue?

**Answer: No.** The search query is used only as a substring argument to `String.indexOf()`. It is never:
- Interpolated into shell commands
- Sent over IPC to the backend
- Used to construct DOM via `innerHTML` or `dangerouslySetInnerHTML`
- Used to construct CSS dynamically
- Used in a regex constructor
- Stored persistently (it lives in React state only)

The PTY output (block.output) is rendered through AnsiOutput, which uses React's JSX rendering. The `{seg.content}` expressions inside `<span>` and `<mark>` elements are automatically escaped by React. Even if PTY output contains `<script>alert(1)</script>`, React will render it as text, not HTML.

---

## 3. Attack Vector Audit

### 3.1 Command Injection (Vector #1) -- NOT AFFECTED

The search feature does not construct or execute shell commands. The search query never reaches the Rust backend or any IPC channel. There is no code path from the search input to `writeToSession()`.

**Finding: PASS.** No command injection vector.

### 3.2 IPC Command Abuse (Vector #2) -- NOT AFFECTED

No new IPC commands were added. The search is entirely client-side. The existing IPC surface (`create_session`, `write_to_session`, `close_session`, `start_reading`, `get_cwd`, `translate_command`) is unchanged.

**Finding: PASS.** No IPC changes.

### 3.3 Terminal Escape Injection (Vector #3) -- NOT AFFECTED

The search operates on block output that has already been filtered by the Rust ANSI security filter. `stripAnsi()` in `useSearch.ts` further removes all SGR sequences before substring matching. The highlight rendering in `AnsiOutput.tsx` splits existing ANSI spans at match boundaries but does not introduce new ANSI sequences or bypass the existing CSS color validation (`isValidRgb`).

The `buildSegments()` function copies the `spanStyle()` from the original ANSI span onto the highlighted segment. It does not create new style properties or modify existing color values. The `isValidRgb` validation that was applied during the original `parseAnsi()` call is preserved because `buildSegments()` only splits content strings and copies existing style objects.

**Finding: PASS.** ANSI security filter pipeline is preserved.

### 3.4 Path Traversal (Vector #4) -- NOT AFFECTED

The search feature does not read or write files. No file paths are involved.

**Finding: PASS.**

### 3.5 Environment Variable Leakage (Vector #5) -- NOT AFFECTED

The search feature does not access environment variables or system properties.

**Finding: PASS.**

### 3.6 Process Lifecycle Abuse (Vector #6) -- NOT AFFECTED

The search feature does not create, manage, or interact with PTY processes.

**Finding: PASS.**

### 3.7 LLM Prompt Injection (Vector #7) -- NOT AFFECTED

The search feature does not interact with the LLM translation pipeline. The search query is never sent to `translateCommand()`.

**Finding: PASS.**

### 3.8 Clipboard Injection (Vector #8) -- NOT AFFECTED

The search feature does not read from or write to the clipboard.

**Finding: PASS.**

### 3.9 Denial of Service (Vector #9) -- FINDINGS

See FINDING-1 and FINDING-2 below.

### 3.10 Cross-Pane Leakage (Vector #10) -- NOT AFFECTED

Velocity currently has a single-pane architecture. The search hook (`useSearch`) is scoped to the `blocks` array passed to it, which belongs to the current Terminal component instance. If/when multi-pane is implemented, each Terminal instance will have its own `useSearch` instance with its own block array. There is no shared state between search instances.

**Finding: PASS.**

---

## 4. Detailed Findings

### FINDING-1: CPU Exhaustion from Search on Large Block Output [MEDIUM]

**Vector**: Denial of Service (#9)
**Location**: `src/hooks/useSearch.ts` lines 76-108 (the `matches` useMemo computation)

**Description**: The search engine iterates over ALL blocks and calls `stripAnsi()` + `String.indexOf()` in a loop for each block. With `MAX_BLOCKS = 500` and `OUTPUT_LIMIT_PER_BLOCK = 500,000`, the worst-case search space is 500 x 500KB = 250MB of text.

For a single-character search query like "a", `indexOf()` would need to scan 250MB of text and could produce up to `MAX_MATCHES = 10,000` results. The `stripAnsi()` call for each block processes up to 500KB via regex replacement.

The 150ms debounce mitigates rapid re-computation during typing, and the `strippedCacheRef` avoids redundant `stripAnsi()` calls for unchanged blocks. However, when blocks are actively receiving output (the active block updates on every PTY chunk), the cache for that block is invalidated on each chunk, forcing a `stripAnsi()` recomputation of up to 500KB per PTY event (after the debounce window).

**Exploit Scenario**: A malicious program outputs 500KB of text containing dense matches for a common character. The user opens search and types that character. The search engine scans 250MB of text synchronously on the main thread. If the active block is still receiving output, the search re-runs every 150ms, each time scanning the full 250MB.

**Mitigating Factors**:
- The `strippedCacheRef` avoids re-stripping unchanged blocks (only the active block needs re-stripping)
- `MAX_MATCHES = 10,000` cap prevents unbounded result array growth
- The 150ms debounce prevents per-keystroke computation
- `String.indexOf()` is highly optimized in V8 (uses Boyer-Moore or similar for longer needles)
- The search only runs when `isOpen` is true -- the user must explicitly open the search bar
- In practice, users search for multi-character terms, which are far faster to match

**Risk**: UI jank during search of large output with many matches. The main thread could block for 50-200ms during the search computation, causing dropped frames. This is a degraded user experience, not a crash or data integrity issue.

**Recommended Fix**: Consider running the search in a Web Worker to avoid blocking the main thread, or implement incremental search that processes blocks in batches using `requestIdleCallback`.

**Severity**: MEDIUM -- DoS of UI responsiveness when searching large output. Self-inflicted by the user (they must open search), which reduces the severity. However, a malicious program could craft output specifically to maximize search cost.

---

### FINDING-2: Unbounded DOM Element Count from Search Highlights [LOW]

**Vector**: Denial of Service (#9)
**Location**: `src/components/AnsiOutput.tsx` lines 39-125 (`buildSegments` function)

**Description**: When search highlights are active, `buildSegments()` splits ANSI spans at highlight boundaries, producing up to `2H + S` segments per block (where `H` is the number of highlights in the block and `S` is the original span count). Each segment becomes a DOM element (`<span>` or `<mark>`).

With `MAX_MATCHES = 10,000` total and potentially thousands of matches in a single block, a block could have thousands of additional `<mark>` elements. Combined with the original ANSI spans, a single block could have 10,000+ DOM elements.

**Mitigating Factors**:
- The `blockHighlights` computation in Terminal.tsx only computes highlights for **visible** blocks (checked via `visibleIds.has(blockId)`). Off-screen blocks do not receive highlight data and render via the fast path (no extra elements).
- Typically only 5-15 blocks are visible at once
- `MAX_MATCHES = 10,000` provides an absolute cap across all blocks
- React's reconciliation handles element creation efficiently

**Risk**: Minor rendering performance degradation if thousands of highlights are visible simultaneously. Unlikely in practice because only visible blocks render highlights.

**Recommended Fix**: Consider capping highlights per block (e.g., 500 per visible block) to prevent a single dense block from creating too many DOM elements.

**Severity**: LOW -- minor performance concern with effective mitigations already in place (visibility gating, match cap).

---

### FINDING-3: Search Query Not Cleared from Memory on Close [LOW]

**Vector**: Environment Variable Leakage (#5, tangential)
**Location**: `src/hooks/useSearch.ts` lines 153-159 (`close` callback)

**Description**: When the search is closed, `close()` sets `query` to `''` and `debouncedQuery` to `''`, which correctly clears the search state in React. However, JavaScript's garbage collection is non-deterministic -- the previous query string may remain in memory until GC collects it.

If a user searches for sensitive text (e.g., a password visible in terminal output), the search query string persists in V8's heap until garbage collected. This is indistinguishable from normal JavaScript string lifetime behavior.

**Mitigating Factors**:
- This is standard JavaScript behavior, not specific to this implementation
- The query string is not persisted to disk, localStorage, or any external storage
- The search query is only visible in the search input field, which is removed from DOM on close
- An attacker who can inspect V8 heap already has full access to the terminal session (and all block output)

**Risk**: Theoretical information disclosure in memory dump scenarios. The threat model for a terminal application already assumes the process memory contains sensitive data (all PTY output, command history, etc.).

**Severity**: LOW -- acknowledged but not actionable. This is inherent to JavaScript memory management and does not represent a regression from the baseline security posture.

---

### FINDING-4: stripAnsi Regex Handles Only SGR Sequences [INFORMATIONAL]

**Vector**: Terminal Escape Injection (#3, informational)
**Location**: `src/lib/ansi.ts` lines 18-21

**Description**: The `stripAnsi()` function used by `useSearch` strips only SGR sequences (`\x1b[...m`). If a non-SGR escape sequence somehow reached the frontend (bypassing the Rust filter), it would NOT be stripped by `stripAnsi()` and would be included in the search text.

**Analysis**: This is not a vulnerability because:
1. The Rust ANSI security filter (`AnsiFilter::filter()`) strips ALL non-SGR sequences before output reaches the frontend
2. `stripAnsi()` only needs to handle SGR because that is the only sequence type that can appear in filtered output
3. The `stripAnsi` regex pattern `/\x1b\[[0-9;:]*m/g` correctly handles all SGR sequences including those with `:` separators (used in 256-color and truecolor modes)

**Finding**: The regex is correct and sufficient for its purpose. The limitation is by design, not by oversight.

**Severity**: INFORMATIONAL -- design observation, no action needed.

---

### FINDING-5: Forwarded Ref Pattern Exposes Internal DOM Element [INFORMATIONAL]

**Vector**: None (defense-in-depth observation)
**Location**: `src/components/editor/InputEditor.tsx` lines 16, 19-21

**Description**: TASK-020 adds a `textareaRef` prop to `InputEditor` that allows the parent (`Terminal.tsx`) to hold a reference to the internal `<textarea>` DOM element. This is used to return focus to the editor when search closes.

The forwarded ref is a `RefObject<HTMLTextAreaElement | null>`, which gives the parent full access to the textarea's DOM API (e.g., `value`, `selectionStart`, `focus()`, `blur()`, etc.). In the current codebase, this ref is only used for `focus()`.

**Analysis**: This is a standard React pattern and does not introduce a security vulnerability. The parent component (`Terminal.tsx`) is in the same trust boundary as the child (`InputEditor.tsx`). The ref cannot be accessed from outside the React component tree. If a future developer misuses the ref (e.g., reads `textareaRef.current.value` instead of using the `value` prop), it could bypass React's controlled input pattern, but this is a code quality concern, not a security issue.

**Severity**: INFORMATIONAL -- no action needed, noted for architectural awareness.

---

## 5. XSS and Injection Audit

### 5.1 Search Query Rendering

The search query is rendered in two places:
1. The `<input>` element in `SearchBar.tsx` (line 89) via `value={query}` -- this is a controlled React input, no XSS vector
2. The match counter text (`counterText`) in `SearchBar.tsx` (lines 69-79) -- this only uses `matchCount` (number) and `currentMatchIndex` (number), not the query string itself

The query string is never rendered as HTML, used in `innerHTML`, or interpolated into CSS.

**Finding: PASS.** No XSS vector from search query rendering.

### 5.2 Highlight Rendering

Highlights are rendered as `<mark>` elements in `AnsiOutput.tsx` (lines 155-163):

```tsx
<mark
  key={i}
  className={seg.highlightClass}
  data-match-current={seg.isCurrent ? 'true' : undefined}
>
  <span style={seg.style}>{seg.content}</span>
</mark>
```

- `seg.highlightClass` is either `'search-highlight'` or `'search-highlight search-highlight-current'` -- these are static strings computed in `buildSegments()`, not user-controlled
- `seg.content` is a slice of ANSI span content (PTY output) rendered via React JSX text interpolation, which auto-escapes HTML entities
- `seg.style` is computed by `spanStyle()` which only sets CSS properties from validated values (colors validated by `isValidRgb`, booleans for bold/italic/underline/dim)
- `data-match-current` is either `'true'` or `undefined` -- not user-controlled

**Finding: PASS.** No XSS vector from highlight rendering.

### 5.3 CSS Class Injection

The `highlightClass` in `buildSegments()` (lines 91-93) is computed from `h.isCurrent`, which is a boolean derived from `currentMatch` comparison in `Terminal.tsx`. The class names are hardcoded strings, not user-derived.

**Finding: PASS.** No CSS class injection vector.

---

## 6. Configuration Review

### 6.1 Tauri Configuration

**File**: `src-tauri/tauri.conf.json` -- **UNCHANGED** from previous review.

CSP: `"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"`

The `'unsafe-inline'` in `style-src` is required for React's inline style rendering (used by AnsiOutput's `spanStyle()`). This was present before TASK-020 and is unchanged.

### 6.2 Tauri Capabilities

**File**: `src-tauri/capabilities/default.json` -- **UNCHANGED** from previous review.

Permissions: `"core:default"`, `"core:event:default"` -- minimal, no additional permissions.

### 6.3 Dependencies

**npm**: No new dependencies added. Existing `undici` high-severity advisory is pre-existing (not related to TASK-020) and affects Node.js HTTP client functionality, not the Tauri frontend.

**Cargo**: No dependency changes. Existing warnings are unmaintained GTK3 bindings from Tauri's Linux dependencies -- not relevant on Windows and not related to TASK-020.

---

## 7. Security Rules Compliance

| Rule | Status | Notes |
|------|--------|-------|
| NEVER string-interpolate user input into shell commands | PASS | Search query is never used in shell command construction |
| Always validate IPC inputs on Rust side | N/A | No Rust changes, no new IPC commands |
| Treat all PTY output as untrusted | PASS | PTY output is Rust-filtered before frontend. Search operates on filtered text. Rendering uses React JSX auto-escaping. |
| No `unwrap()` on user-derived data in Rust | N/A | No Rust changes |

---

## 8. Comparison with Pre-TASK-020 Security Posture

| Property | Before TASK-020 | After TASK-020 | Change |
|----------|-----------------|----------------|--------|
| IPC surface | 6 commands + 3 events | Unchanged | No change |
| Frontend attack surface | Terminal, BlockView, AnsiOutput, InputEditor | + SearchBar, useSearch | Small increase (read-only feature) |
| DOM element count (worst case) | ~500 blocks x spans | + up to 10K <mark> elements | Minor increase (visibility-gated) |
| CPU usage (worst case) | ANSI parsing + rendering | + search computation (250MB scan) | Increase when search is open |
| User input handling | Editor textarea only | + search input field | Small increase (no IPC from search) |
| Regex exposure | `stripAnsi`, `extractExitCode`, `isValidRgb` | Unchanged (search uses indexOf, not regex) | No change |
| Data persistence | None (React state only) | Unchanged | No change |
| External network calls | LLM translation only | Unchanged (search is offline) | No change |
| Dependencies | Unchanged | Unchanged | No change |

---

## 9. Verdict

**PASS WITH FINDINGS**

The TASK-020 implementation is security-sound. The feature is read-only and entirely client-side, introducing no new IPC surface, no new data flows to/from untrusted sources, and no new injection vectors. The search query is handled safely via `String.indexOf()` (immune to ReDoS) and rendered through React's auto-escaping JSX. The highlight rendering preserves the existing ANSI security filter pipeline and CSS color validation.

The single medium-severity finding (CPU exhaustion from searching large output) is a performance DoS concern, not a data integrity or code execution issue. It is partially mitigated by debouncing, caching, and the visibility gate.

### Action Items

| # | Finding | Severity | Action | Blocking? |
|---|---------|----------|--------|-----------|
| 1 | CPU exhaustion from search on large output | MEDIUM | Consider Web Worker or incremental search for large block sets | No (performance optimization) |
| 2 | Unbounded DOM element count from highlights | LOW | Consider per-block highlight cap | No (mitigated by visibility gating) |
| 3 | Search query not cleared from memory on close | LOW | Accepted; inherent to JavaScript GC | No |
| 4 | stripAnsi only handles SGR sequences | INFORMATIONAL | Correct by design; Rust filter ensures only SGR reaches frontend | No |
| 5 | Forwarded ref exposes internal textarea DOM | INFORMATIONAL | Standard React pattern; no security impact | No |

No findings are blocking. The implementation correctly adds search functionality without degrading the existing security guarantees.
