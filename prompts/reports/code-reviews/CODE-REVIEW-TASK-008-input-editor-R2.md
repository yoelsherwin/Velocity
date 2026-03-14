# Code Review: TASK-008 -- Decoupled Input Editor (Round 2)

**Reviewer**: Code Reviewer (Claude)
**Commit**: `2455f55` fix: address code review findings for input editor -- cleanup, unclosed quotes, tests
**Date**: 2026-03-14
**Verdict**: **APPROVE**

---

## Previous Round Resolution

### M1. `shellType` prop is accepted but unused -- dead parameter
**Status**: RESOLVED

The `shellType` prop has been fully removed from:
- `InputEditorProps` interface (`InputEditor.tsx` line 4-9)
- Component destructuring (`InputEditor.tsx` line 11)
- Call site in `Terminal.tsx` (line 300-305 -- no longer passes `shellType`)
- Test `defaultProps` in `InputEditor.test.tsx` (line 6-9 -- `shellType` removed)

The `ShellType` import has also been removed from `InputEditor.tsx`. Clean removal with no orphaned references.

---

### M2. `fullMatch` variable is assigned but never used
**Status**: RESOLVED

Renamed from `fullMatch` to `_fullMatch` in `shell-tokenizer.ts` line 40:
```typescript
const [_fullMatch, whitespace, dblString, sglString, doubleRedirect, pipeOrRedirect, word] = match;
```

Follows the standard `_` prefix convention for intentionally unused destructured variables. This will silence lint warnings.

---

### M3. Old `.terminal-input-row`, `.terminal-prompt`, `.terminal-input` CSS rules are now dead code
**Status**: RESOLVED

All three dead CSS rule blocks (`.terminal-input-row`, `.terminal-prompt`, `.terminal-input`, `.terminal-input:disabled`) have been removed from `App.css`. A search for these class names confirms they are no longer referenced anywhere in the codebase. The only remaining reference to `terminal-input` is the `data-testid` on the wrapper `<div>` in `Terminal.tsx` (line 299), which is the intentional backward-compatible test ID -- not a CSS class.

---

### S1. Unclosed quotes cause the tokenizer to consume the rest of the input as one token
**Status**: RESOLVED

The regex pattern was updated from:
```
("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')
```
to:
```
("(?:[^"\\]|\\.)*"?)|('(?:[^'\\]|\\.)*'?)
```

The closing quote character is now optional (`"?` and `'?`), which means the regex will match an unclosed string as a single `string` token consuming everything from the opening quote to the end of the input. This gives correct syntax highlighting while the user is typing (the unclosed string is highlighted in green rather than being split into argument tokens).

Two new tests were added to validate this:
- `test_unclosed_double_quote`: `echo "hello world` produces `[command, whitespace, string]` with the string value being `"hello world`
- `test_unclosed_single_quote`: `echo 'hello world` produces `[command, whitespace, string]` with the string value being `'hello world`

The fix is correct and the tests are well-structured.

---

### S2. Tab handling test is weak -- only tests `preventDefault`, not the actual space insertion
**Status**: RESOLVED

The test was rewritten to use `fireEvent.keyDown(textarea, { key: 'Tab' })` from React Testing Library instead of native `dispatchEvent`. It now asserts:
```typescript
expect(onChange).toHaveBeenCalledWith('  ');
```

This verifies the actual behavior (two spaces inserted via `onChange`) rather than just the side effect (`preventDefault`). The test is clean and idiomatic.

---

### S3. Overlay alignment risk: `<pre>` and `<textarea>` may desynchronize on scroll
**Status**: NOT ADDRESSED (acceptable)

No scroll sync handler was added. Both elements still have `overflow: hidden`. As noted in R1, this is unlikely to be an issue for typical command input (1-3 lines), and the current `rows={lineCount}` dynamically expands the textarea. For extremely long multi-line pastes, the highlight will desync, but this is an edge case that can be addressed in a future iteration. Not blocking.

---

## New Findings in R2

No new must-fix or should-fix issues found.

### N1. `aria-label` still missing on textarea (carried from R1)

**File**: `C:\Velocity\src\components\editor\InputEditor.tsx`, line 58

The textarea still lacks an `aria-label`. This is a nice-to-have for accessibility but not blocking. Can be addressed in a future accessibility pass.

---

## Security Assessment

**No security issues.** This commit is purely cleanup and does not introduce any new attack surface, IPC calls, or rendering changes. The same security posture from R1 holds: no `dangerouslySetInnerHTML`, no shell command interpolation, safe React children for token rendering.

---

## Test Assessment

**All 64 tests pass** (9 test files).

Changes to tests in this commit:
- `InputEditor.test.tsx`: Removed `shellType` from `defaultProps`; rewrote Tab test to use `fireEvent` and assert `onChange` call with two spaces.
- `shell-tokenizer.test.ts`: Added 2 new tests for unclosed double and single quotes (total: 13 tokenizer tests).

Test coverage is solid. The new unclosed-quote tests cover the exact edge case identified in R1.

---

## Positive Notes

1. **All three must-fix items addressed cleanly.** No over-engineering, no unnecessary changes beyond what was requested. The diff is minimal and focused.

2. **Regex fix for unclosed quotes is elegant.** Making the closing quote optional (`"?` / `'?`) is the simplest possible fix that covers the real-world scenario of typing a string character by character. No second pass or special-case logic needed.

3. **Tab test rewrite is properly idiomatic.** Using React Testing Library's `fireEvent` instead of native `dispatchEvent` ensures the test goes through the same event pipeline as real user interaction.

4. **No collateral damage.** The diff touches only the files relevant to the findings. No unrelated changes, no reformatting, no dependency bumps.

---

## Verdict: APPROVE

All three must-fix items (M1, M2, M3) are fully resolved. Two of three should-fix items (S1, S2) are resolved with proper test coverage. S3 (scroll desync) was not addressed but is acceptable for the current scope. No new issues introduced. The input editor feature is ready to merge.
