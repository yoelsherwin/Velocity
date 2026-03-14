# Code Review: TASK-008 -- Decoupled Input Editor

**Reviewer**: Code Reviewer (Claude)
**Commit**: `e1afb70` feat: add decoupled input editor with multi-line and syntax highlighting
**Date**: 2026-03-13
**Verdict**: **NEEDS CHANGES**

---

## Summary

This commit replaces the basic `<input type="text">` in Terminal.tsx with a new `InputEditor` component that supports multi-line editing (Shift+Enter for newlines, Enter to submit) and syntax highlighting via a textarea + `<pre>` overlay technique. A regex-based shell tokenizer (`shell-tokenizer.ts`) provides token classification for commands, flags, strings, pipes/redirects, and arguments. Tests are comprehensive and all 62 pass.

The implementation is solid overall. The architecture is clean, the tokenizer is correct for all tested cases, XSS safety is properly maintained, and the overlay technique is well-executed. There are a few issues to address before merging.

---

## Findings

### MUST FIX (3)

#### M1. `shellType` prop is accepted but unused -- dead parameter

**File**: `C:\Velocity\src\components\editor\InputEditor.tsx`, line 13

```typescript
function InputEditor({ value, onChange, onSubmit, disabled, shellType }: InputEditorProps) {
```

`shellType` is destructured from props but never referenced in the component body. This is a dead parameter. TypeScript will not warn about unused destructured parameters by default, but it creates confusion about intent (does the editor need to know the shell type? should tokenization differ per shell?).

**Fix**: Either remove `shellType` from `InputEditorProps` and the destructuring, or add a comment explaining that it is reserved for future use (e.g., shell-specific tokenization). If removed, also remove it from the `<InputEditor>` call site in Terminal.tsx and from test `defaultProps`.

**Recommendation**: Remove it now. YAGNI. It can be added back when shell-specific tokenization is implemented.

---

#### M2. `fullMatch` variable is assigned but never used

**File**: `C:\Velocity\src\lib\shell-tokenizer.ts`, line 40

```typescript
const [fullMatch, whitespace, dblString, sglString, doubleRedirect, pipeOrRedirect, word] = match;
```

`fullMatch` is destructured but never referenced. This will trigger lint warnings (`@typescript-eslint/no-unused-vars`). Use `_` as the conventional prefix for intentionally unused variables.

**Fix**: Replace `fullMatch` with `_` or `_fullMatch`:
```typescript
const [_fullMatch, whitespace, dblString, sglString, doubleRedirect, pipeOrRedirect, word] = match;
```

---

#### M3. Old `.terminal-input-row`, `.terminal-prompt`, `.terminal-input` CSS rules are now dead code

**File**: `C:\Velocity\src\App.css`, lines 51-78

The old input styles (`.terminal-input-row`, `.terminal-prompt`, `.terminal-input`, `.terminal-input:disabled`) are no longer referenced anywhere in the codebase. The `<input>` element and its wrapper have been removed from Terminal.tsx and replaced with the `InputEditor` component which uses `.input-editor`, `.editor-prompt`, etc.

**Fix**: Remove the dead CSS rules (lines 51-78). They will confuse future maintainers into thinking the old input approach is still in use.

---

### SHOULD FIX (3)

#### S1. Unclosed quotes cause the tokenizer to consume the rest of the input as one token

**File**: `C:\Velocity\src\lib\shell-tokenizer.ts`, line 32

For input like `echo "hello world` (no closing quote), the regex `"(?:[^"\\]|\\.)*"` will fail to match the unclosed string. The `\S+` fallback then matches `"hello` as a single word (argument), and `world` as a separate argument. This means the syntax highlighting for an in-progress quote will be incorrect and confusing -- the user sees `"hello` colored as an argument rather than a string.

This matters because users type character by character, so every intermediate state (before the closing quote is typed) will display incorrectly.

**Fix**: Add a fallback for unclosed strings in the regex. A pattern like `"(?:[^"\\]|\\.)*"?` (optional closing quote) would match partial strings. Alternatively, add a second pass that detects `"` at the start of a token and coerces it to type `string`. Either approach is acceptable for a display-only tokenizer.

**Test to add**: `tokenize('echo "hello world')` should produce a `string` token for `"hello world` (or `"hello` at minimum).

---

#### S2. Tab handling test is weak -- only tests `preventDefault`, not the actual space insertion

**File**: `C:\Velocity\src\__tests__\InputEditor.test.tsx`, lines 60-76

The `test_tab_inserts_spaces` test only verifies that `preventDefault` was called, but does not verify that `onChange` was called with a value containing the two spaces. This is because the test uses native `dispatchEvent` instead of React's `fireEvent`, so the React event handler may or may not fire depending on the test environment.

**Fix**: Use `fireEvent.keyDown(textarea, { key: 'Tab' })` from React Testing Library and assert that `onChange` was called with `'  '` (two spaces). This tests the actual behavior, not just a side effect.

---

#### S3. Overlay alignment risk: `<pre>` and `<textarea>` may desynchronize on scroll

**File**: `C:\Velocity\src\components\editor\InputEditor.tsx`

When the textarea content exceeds the visible area (many lines), the textarea is scrollable but the `<pre>` overlay is not synced to the textarea's scroll position. Both elements have `overflow: hidden`, which means the `<pre>` will simply clip while the textarea scrolls. This will cause the highlighted text to desync from the cursor and actual text position.

For the current use case (short commands, typically 1-3 lines), this is unlikely to be a problem. But for a user pasting a long script, it will break.

**Fix**: Either (a) sync the `<pre>` element's `scrollTop` to the textarea's `scrollTop` via an `onScroll` handler, or (b) set a maximum rows limit so the textarea never scrolls (e.g., `rows={Math.min(lineCount, 10)}`). Option (b) is simpler and probably sufficient for now.

---

### NICE TO HAVE (3)

#### N1. No `aria-label` on the textarea

**File**: `C:\Velocity\src\components\editor\InputEditor.tsx`, line 60

The textarea has no `aria-label` or `aria-labelledby` attribute. Screen readers will not know its purpose. Consider adding `aria-label="Command input"` or similar.

---

#### N2. Token rendering uses array index as React key

**File**: `C:\Velocity\src\components\editor\InputEditor.tsx`, line 54

```tsx
<span key={i} className={`token-${token.type}`}>
```

Using array index as key is fine here because the token list is fully rebuilt on every value change (the entire `useMemo` recomputes), so there is no stale key problem. This is just a note for the record -- no change needed.

---

#### N3. Consider adding a `data-testid` to the highlight overlay

For future tests that need to verify overlay alignment or content independently from the textarea, having `data-testid="editor-highlight"` on the `<pre>` would be helpful.

---

## Security Assessment

**No security issues found.** This is a purely frontend change with no new IPC surface.

- No `dangerouslySetInnerHTML` anywhere in the codebase. Token rendering uses safe React children (`{token.value}` inside `<span>` elements). XSS is not possible through this path.
- The tokenizer is display-only and does not affect what is sent to the shell. The submit path still flows through the same `submitCommand` -> `writeToSession` IPC call.
- No user input is interpolated into shell commands. The tokenizer only classifies tokens for coloring; it does not transform or execute them.
- The `<pre aria-hidden="true">` correctly hides the overlay from screen readers, preventing duplicate content announcements.

---

## Test Assessment

**Tests are comprehensive and well-structured.**

- **Shell tokenizer**: 11 tests covering simple commands, arguments, flags (short and long), quoted strings (single and double), pipes, redirects, multiline, empty input, and whitespace preservation. All pass.
- **InputEditor component**: 8 tests covering rendering, prompt symbol, onChange, Enter submit, Shift+Enter non-submit, Tab preventDefault, disabled state, and syntax highlighting DOM structure. All pass.
- **Terminal integration**: All 20 existing Terminal.test.tsx tests updated to use `editor-textarea` testid instead of `terminal-input`. All pass.
- **E2E tests**: All 4 E2E test files updated to use `editor-textarea`. The backward-compatible `terminal-input` testid is preserved on the wrapper `<div>` in Terminal.tsx.

**Missing test coverage**:
- Unclosed quote handling (see S1)
- Tab actually inserting spaces (not just preventDefault; see S2)
- Multi-line submit (verify that Shift+Enter followed by Enter submits the full multi-line text)

---

## Positive Notes

1. **Clean separation of concerns**: The tokenizer is a pure function in its own file (`shell-tokenizer.ts`), easily testable independently. The InputEditor component is self-contained and accepts clean props.

2. **Correct use of `useMemo`**: Tokenization is memoized on `value`, and line count is memoized separately. This avoids unnecessary re-tokenization on unrelated re-renders.

3. **Backward compatibility preserved**: The `data-testid="terminal-input"` is kept on the wrapper div in Terminal.tsx, so any code (or future E2E tests) that references this testid will still find an element. E2E tests use the more specific `editor-textarea` for interaction.

4. **Tokenizer regex is well-designed**: The alternation order (whitespace, quoted strings, `>>` before `>`, pipe/redirect, word) correctly handles priority. The `expectCommand` state machine accurately tracks when the next word should be classified as a command (start of line, after pipe).

5. **No `dangerouslySetInnerHTML`**: The overlay rendering uses safe React children exclusively.

6. **Tab handling with cursor position restoration**: The Tab key handler correctly inserts spaces at the cursor position and uses `requestAnimationFrame` to restore cursor position after React re-renders. This is a thoughtful detail.

---

## Verdict: NEEDS CHANGES

Three must-fix items (dead parameter, unused variable, dead CSS) and three should-fix items (unclosed quote handling, weak Tab test, scroll desync risk). The must-fixes are all trivial cleanup. The should-fixes improve robustness and test quality. No security concerns. No blocking issues.

After addressing M1-M3 and ideally S1-S2, this is ready to merge.
