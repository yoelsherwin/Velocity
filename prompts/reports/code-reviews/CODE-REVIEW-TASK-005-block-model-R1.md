# Code Review: TASK-005 Block Model

**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-12
**Commit**: `6db813d` (`feat: implement block model with command/output containers`)
**Scope**: Block data model, BlockView component, Terminal refactor, stripAnsi utility, tests, styles

---

## Review Checklist

### Security

- [x] **No command injection** -- No new IPC commands. `handleRerun` sends commands through the existing `writeToSession` pathway, which is validated by the Rust backend.
- [x] **PTY output safety** -- Block output is rendered through the unchanged `<AnsiOutput>` component via `<pre><AnsiOutput text={block.output} /></pre>`. No `dangerouslySetInnerHTML` anywhere.
- [x] **Clipboard API usage is safe** -- Uses `navigator.clipboard.writeText()` (the modern, permission-gated API). The `stripAnsi` utility strips SGR before clipboard copy. No `document.execCommand('copy')`.
- [x] **No XSS vectors in block rendering** -- Command text is rendered inside `<span className="block-command">{block.command}</span>` (React auto-escapes). Output goes through AnsiOutput. Timestamp is formatted from `Date.now()` (numeric). No `innerHTML` or injection vectors.

### React Quality

- [x] **Hooks correctness**
  - `useCallback` dependency arrays in `handleRerun` (`[sessionId, closed, shellType]`) and `handleKeyDown` (`[sessionId, input, closed, shellType]`) are correct -- all referenced closure values are listed.
  - `useMemo` for `formattedTime` in BlockView has `[block.timestamp]` -- correct.
  - `useRef` for `activeBlockIdRef` avoids stale closure in event listeners -- correct pattern.
  - Cleanup in `useEffect` mount: unchanged, still cleans up listeners and closes session.

- [x] **No memory leaks** -- Event listeners are still cleaned up via `unlistenRefs`/`cleanupListeners()`. The pattern is unchanged from TASK-004.

- [x] **Memoization where needed**
  - `BlockView` is wrapped in `React.memo` -- good, prevents re-rendering blocks whose props have not changed.
  - `AnsiOutput` remains `React.memo` -- still effective per-block since each block has its own `text` prop.
  - `handleCopyCommand`, `handleCopyOutput`, `handleRerun` in BlockView are all `useCallback`-wrapped.

- [ ] **No unnecessary re-renders** -- **FINDING NC-1** (see below). The output event listener triggers `setBlocks(prev => prev.map(...))` which creates a new array on every PTY output chunk. This causes ALL `BlockView` components to re-render even though only the active block's output changed, because `blocks.map()` returns a new array identity for the parent. However, `React.memo` on `BlockView` mitigates this: non-active blocks receive identical `block` object references (the `.map()` returns the same object for `b.id !== activeBlockIdRef.current`), so `React.memo`'s shallow comparison should bail out for inactive blocks. **This is acceptable.**

### Performance

- [x] **Block output appending is efficient** -- Only the active block's output string is modified. Inactive blocks return their existing object identity from the `.map()`. `React.memo` on `BlockView` prevents re-rendering unmodified blocks.

- [x] **AnsiOutput memoization still effective per-block** -- Each `BlockView` has its own `<AnsiOutput text={block.output} />`. Only the active block's `text` changes, so only its `AnsiOutput` re-parses via `useMemo`. Other blocks' `AnsiOutput` instances are not affected. This is a significant improvement over the old single-buffer approach.

- [x] **MAX_BLOCKS enforcement correct** -- `MAX_BLOCKS = 50`. Enforcement is applied in both `handleKeyDown` and `handleRerun` via `withNew.length > MAX_BLOCKS ? withNew.slice(-MAX_BLOCKS) : withNew`. Slices from the end, keeping the most recent blocks. Correct.

### General

- [x] **Type safety** -- `Block` interface in `types.ts` uses `'running' | 'completed'` literal union, `ShellType` union, `string` and `number` for other fields. All usages are type-safe. `as const` assertion used correctly when finalizing block status.

- [ ] **Tests comprehensive** -- **FINDING NC-2** (see below). The `test_blocks_limited_to_max` test is a no-op: `expect(50).toBe(50)`. It tests nothing. Should import and check `MAX_BLOCKS` from Terminal.

- [x] **No unnecessary changes** -- All changes are directly related to the block model feature. The only non-feature changes are housekeeping (STATE.md update, QA report deletion, QA naming convention update) which are appropriate.

- [x] **Consistent with existing patterns** -- Uses the same `useRef` + `useState` dual-tracking pattern established in TASK-004. `createBlock` helper function follows the same structure as the session creation pattern.

---

## Findings

### NC-1: OUTPUT_BUFFER_LIMIT removed without per-block replacement (Low)

**Location**: `C:\Velocity\src\components\Terminal.tsx`

**Description**: The old `OUTPUT_BUFFER_LIMIT = 100_000` that capped total output string length has been removed. The new model caps total block count at 50, but individual block output strings are unbounded. A single long-running command (e.g., `dir C:\ /s` or a compilation log) can accumulate megabytes of output in a single block's `output` string.

**Impact**: Memory growth for commands that produce very large output. Since each output chunk triggers a full `AnsiOutput` re-parse of the entire block's output string via `Anser.ansiToJson()`, this also creates a performance cliff -- the same BUG-004 issue from the QA report, now at the per-block level rather than global level.

**Recommendation**: Consider adding a per-block output limit (e.g., 100K characters), truncating from the front when exceeded. This is not a blocker -- it was a known issue before this change -- but the removal of `OUTPUT_BUFFER_LIMIT` means there is now zero protection against unbounded output growth.

**Severity**: Low (pre-existing concern, not introduced by this change)

### NC-2: `test_blocks_limited_to_max` is a no-op test (Low)

**Location**: `C:\Velocity\src\__tests__\Terminal.test.tsx`, line 329-335

**Description**: The test body is:
```typescript
expect(50).toBe(50); // MAX_BLOCKS should be 50
```
This is a literal tautology that tests nothing. The comment says "verify the constant value via the module" but it never imports `MAX_BLOCKS` from the module.

**Recommendation**: Import `MAX_BLOCKS` and test it:
```typescript
import Terminal, { MAX_BLOCKS } from '../components/Terminal';
// ...
it('test_blocks_limited_to_max', () => {
  expect(MAX_BLOCKS).toBe(50);
});
```
Or better yet, write an actual behavioral test that creates 51+ blocks and verifies only 50 remain.

**Severity**: Low (test gap, not a code defect)

### NC-3: Duplicated block creation logic between `handleKeyDown` and `handleRerun` (Low)

**Location**: `C:\Velocity\src\components\Terminal.tsx`, lines 164-192 and 194-227

**Description**: The logic for finalizing the active block, creating a new block, enforcing `MAX_BLOCKS`, and handling write errors is duplicated nearly identically between `handleRerun` and `handleKeyDown`. This is approximately 25 lines of duplicated logic.

**Recommendation**: Extract a shared function like `submitCommand(command: string)` that both handlers call. This would reduce duplication and ensure any future changes to the block-creation logic only need to be made in one place.

**Severity**: Low (code quality / maintainability)

### NC-4: `handleCopyCommand` and `handleCopyOutput` do not handle clipboard errors (Low)

**Location**: `C:\Velocity\src\components\blocks\BlockView.tsx`, lines 17-23

**Description**: `navigator.clipboard.writeText()` returns a Promise that can reject (e.g., if the page loses focus, or clipboard permissions are denied). The current code ignores the returned Promise:
```typescript
const handleCopyCommand = useCallback(() => {
  navigator.clipboard.writeText(block.command);
}, [block.command]);
```
No `.catch()` or `await` to handle failures.

**Impact**: An unhandled promise rejection warning in the console if clipboard write fails. Not a security issue, but poor error handling.

**Recommendation**: Add `.catch(() => {})` at minimum, or surface a brief notification to the user.

**Severity**: Low (UX polish)

### NC-5: `stripAnsi` regex is limited to SGR-only (Acceptable)

**Location**: `C:\Velocity\src\lib\ansi.ts`, line 20

**Description**: The regex `/\x1b\[[0-9;]*m/g` only strips SGR sequences (those ending in `m`). It does not strip other CSI sequences, OSC, or other escape types.

**Assessment**: This is **correct by design**. The Rust ANSI filter already strips all non-SGR sequences before they reach the frontend. The `stripAnsi` function only needs to handle what the Rust filter allows through. The comment documents this clearly.

**Severity**: N/A (correct behavior, just noting for completeness)

### NC-6: `React.memo` on `BlockView` depends on `onRerun` reference stability (Low)

**Location**: `C:\Velocity\src\components\blocks\BlockView.tsx` (line 75) and `C:\Velocity\src\components\Terminal.tsx` (line 164)

**Description**: `BlockView` is wrapped in `React.memo`, which does shallow prop comparison. The `onRerun` prop is a `useCallback` with dependencies `[sessionId, closed, shellType]`. Whenever `sessionId`, `closed`, or `shellType` changes, `handleRerun` gets a new reference, which invalidates `React.memo` for ALL `BlockView` instances simultaneously.

**Impact**: During session state transitions (shell switch, restart, close), all blocks will re-render. This is infrequent and acceptable. During normal operation (output streaming), `handleRerun` reference is stable, so `React.memo` works correctly.

**Severity**: Low (negligible impact in practice)

---

## Tests

**All 39 frontend tests pass.** Breakdown:

| File | Tests | Status |
|------|-------|--------|
| `blocks.test.ts` | 4 | PASS |
| `BlockView.test.tsx` | 7 | PASS |
| `Terminal.test.tsx` | 17 | PASS |
| `AnsiOutput.test.tsx` | 2 | PASS |
| `ansi.test.ts` | 2 | PASS |
| `pty.test.ts` | 5 | PASS |
| `App.test.tsx` | 2 | PASS |

**Test coverage assessment:**
- Block data model: Adequate (type shape, stripAnsi)
- BlockView component: Good (render, actions, welcome block, running indicator)
- Terminal integration: Good (welcome block creation, command creates new block)
- Weak spot: `test_blocks_limited_to_max` is a no-op (NC-2)
- Missing: No test for "Copy Output" button calling `stripAnsi` + clipboard
- Missing: No test for the Rerun flow end-to-end through Terminal (only tested in BlockView isolation)

---

## Summary

This is a well-structured implementation of the block model. The key design decisions are sound:

1. **Frontend-only change** -- No Rust modifications needed. The PTY engine is untouched.
2. **`useRef` for active block ID** -- Prevents stale closures in event listeners. This is the correct pattern.
3. **`React.memo` on BlockView** -- Prevents re-rendering inactive blocks during output streaming.
4. **`crypto.randomUUID()` for block IDs** -- Cryptographically random, no collision risk.
5. **Clean separation** -- Block data model in `types.ts`, rendering in `BlockView`, state management in `Terminal`.
6. **Safe clipboard** -- `navigator.clipboard.writeText` with `stripAnsi` for clean copying.

The findings are all low severity. The most actionable ones are:

- **NC-2**: Fix the no-op test (trivial fix)
- **NC-3**: Extract shared command submission logic (optional refactor)
- **NC-1**: Consider adding a per-block output limit (future improvement)

No security concerns. No correctness bugs. No blocking issues.

---

## Verdict: **NEEDS CHANGES**

Two items should be addressed before approval:

1. **NC-2**: The `test_blocks_limited_to_max` test must actually test something. Import `MAX_BLOCKS` and verify it, or write a behavioral test. A no-op test creates false confidence.

2. **NC-4**: The clipboard `writeText` promises should have `.catch()` handlers to avoid unhandled promise rejections.

All other findings (NC-1, NC-3, NC-5, NC-6) are acceptable as-is and can be addressed in future tasks.
